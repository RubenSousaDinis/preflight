/**
 * B5c, flag 4 of 4: honeypot.
 *
 * A token whose buy leg succeeds and whose sell leg cannot is a position that only looks like one.
 * Confirmation is a simulated sell, never a source read: a source-read claim is B6 output and is
 * advisory, and only a simulator-confirmed finding moves a verdict.
 *
 * Two things this must not do, both of which would make it useless in different directions. It must
 * not call a token with no market a honeypot, because absence of a market is not evidence of a
 * trap and every fresh token would trip it. And it must not call normal price impact a trap, so the
 * probe sell asks for less than the reserves imply rather than for an exact quote.
 *
 * The exit is probed against the pair directly, in two legs on one stateful fork, so this never
 * depends on a router existing on the chain being judged.
 */

import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem'
import { SimulationError } from '../../../shared/errors.ts'
import type { Address, ChainId, Detector, Flag, Hex, PendingTx } from '../../../shared/types.ts'
import { dexFor, type DexConfig } from '../dex.ts'
import { forkAt, type ForkHandle } from '../fork.ts'
import { revertReasonFrom, type CallFrame } from '../trace.ts'

const FACTORY_ABI = parseAbi(['function getPair(address tokenA, address tokenB) view returns (address)'])
const PAIR_ABI = parseAbi([
  'function token0() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)',
])
const ERC20_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])

const ZERO = '0x0000000000000000000000000000000000000000'

/**
 * The constant product quote, with the standard 0.3% fee.
 *
 * Used only to size a probe that should comfortably succeed, never to judge a price.
 */
export function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n
  const withFee = amountIn * 997n
  return (withFee * reserveOut) / (reserveIn * 1000n + withFee)
}

export interface HoneypotDeps {
  forkAt: (chainId: ChainId, block?: bigint) => Promise<ForkHandle>
  dexFor: (chainId: ChainId) => DexConfig | null
}

const liveDeps: HoneypotDeps = { forkAt, dexFor }

/** The token this transaction leaves the sender holding more of, if any. */
function acquiredToken(
  deltas: { token: Address | 'native'; owner: Address; delta: bigint }[],
  owner: Address,
): { token: Address; amount: bigint } | null {
  for (const delta of deltas) {
    if (delta.token === 'native') continue
    if (delta.owner !== owner) continue
    if (delta.delta <= 0n) continue
    return { token: delta.token, amount: delta.delta }
  }
  return null
}

interface Market {
  pair: Address
  reserveIn: bigint
  reserveOut: bigint
  tokenIsToken0: boolean
}

async function findMarket(
  fork: ForkHandle,
  dex: DexConfig,
  token: Address,
): Promise<Market | null> {
  for (const quote of dex.quoteAssets) {
    const pairRaw = await fork.call(
      dex.factory,
      encodeFunctionData({ abi: FACTORY_ABI, functionName: 'getPair', args: [token, quote] }),
    )
    const pair = decodeFunctionResult({ abi: FACTORY_ABI, functionName: 'getPair', data: pairRaw })
    if (pair === ZERO) continue

    const [reserve0, reserve1] = decodeFunctionResult({
      abi: PAIR_ABI,
      functionName: 'getReserves',
      data: await fork.call(pair, encodeFunctionData({ abi: PAIR_ABI, functionName: 'getReserves' })),
    })
    if (reserve0 === 0n || reserve1 === 0n) continue

    const token0 = decodeFunctionResult({
      abi: PAIR_ABI,
      functionName: 'token0',
      data: await fork.call(pair, encodeFunctionData({ abi: PAIR_ABI, functionName: 'token0' })),
    })
    const tokenIsToken0 = token0.toLowerCase() === token.toLowerCase()
    return {
      pair,
      reserveIn: tokenIsToken0 ? BigInt(reserve0) : BigInt(reserve1),
      reserveOut: tokenIsToken0 ? BigInt(reserve1) : BigInt(reserve0),
      tokenIsToken0,
    }
  }
  return null
}

function flagFor(token: Address, pair: Address, leg: string, reason: string | null): Flag {
  const quoted = reason === null ? 'with no reason given' : `with "${reason}"`
  return {
    id: 'honeypot',
    severity: 'block',
    title: `${token} can be bought and cannot be sold`,
    detail:
      `Buying this token simulates clean. Selling the position straight back into its own pool at ` +
      `${pair} fails: ${leg} reverted ${quoted}. The exit does not exist at this block, so the ` +
      `balance this transaction would leave you holding cannot be converted back.`,
    confirmedBy: 'simulation',
  }
}

export function honeypotWith(deps: HoneypotDeps): Detector {
  return async (sim, tx: PendingTx) => {
    const dex = deps.dexFor(tx.chainId)
    // No configured market on this chain means the exit cannot be probed. Reporting nothing is the
    // honest answer, and it is a disclosed limit rather than a hidden one.
    if (dex === null) return []

    // A buy that failed on its own is not a trap, it is a failed transaction.
    if (sim.reverted) return []

    const acquired = acquiredToken(sim.balanceDeltas, tx.from)
    if (acquired === null) return []

    let fork: ForkHandle
    try {
      // Pinned to the block the main simulation ran at, so the exit is probed against the same
      // market the buy happened in. Its own fork, because these legs mutate state.
      fork = await deps.forkAt(tx.chainId, sim.block)
    } catch (cause) {
      throw new SimulationError(
        'the exit could not be probed because a second fork could not be established',
        { cause, retryable: true },
      )
    }

    try {
      // Leg 0: the pending transaction itself, so the sell runs from the state a buyer would be in.
      const buy = await fork.run(tx)
      if (buy.reverted) return []

      const market = await findMarket(fork, dex, acquired.token)
      // No pool is not a trap. Ship this case before the positive one, because it is the false
      // positive that would otherwise reach the stage on a chain this thin.
      if (market === null) return []

      // Leg 1: move the position into the pool. This is what selling is, and it is where a token
      // that blocks holders stops.
      const send = await fork.run({
        chainId: tx.chainId,
        from: tx.from,
        to: acquired.token,
        calldata: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [market.pair, acquired.amount],
        }),
        value: 0n,
      })
      if (send.reverted) {
        const reason = revertReasonFrom((send.raw as { callTrace?: CallFrame })?.callTrace ?? {})
        return [flagFor(acquired.token, market.pair, 'moving the position into the pool', reason)]
      }

      // Leg 2: take the proceeds. Asking for less than the reserves imply, so ordinary price impact
      // and rounding cannot be mistaken for a closed exit. A token that taxes the transfer leaves
      // the pool holding less than this quote assumed, and fails here instead.
      const out = (amountOut(acquired.amount, market.reserveIn, market.reserveOut) * 99n) / 100n
      if (out === 0n) return []
      const take = await fork.run({
        chainId: tx.chainId,
        from: tx.from,
        to: market.pair,
        calldata: encodeFunctionData({
          abi: PAIR_ABI,
          functionName: 'swap',
          args: [
            market.tokenIsToken0 ? 0n : out,
            market.tokenIsToken0 ? out : 0n,
            tx.from,
            '0x' as Hex,
          ],
        }),
        value: 0n,
      })
      if (take.reverted) {
        const reason = revertReasonFrom((take.raw as { callTrace?: CallFrame })?.callTrace ?? {})
        return [flagFor(acquired.token, market.pair, 'taking the proceeds out of the pool', reason)]
      }

      return []
    } finally {
      await fork.release().catch(() => undefined)
    }
  }
}

export const honeypot: Detector = honeypotWith(liveDeps)
