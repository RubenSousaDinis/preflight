/**
 * The RPC backed fork: the same handle, with no local process.
 *
 * This exists so the deployed site can answer for itself. anvil is a binary, a serverless runtime
 * cannot spawn one, and a gate that cannot simulate blocks, so without this the hosted URL would
 * refuse every transaction for a structural reason. It is a second backend behind the interface
 * section 7 already required, not a reopening of the H+2 decision: anvil is still the mechanism for
 * the runs driven from a machine we control.
 *
 * **What changes, and it belongs in the disclosure rather than in a footnote.** With anvil we
 * execute the EVM ourselves. Here reth executes it on the provider's node and we read the trace
 * back. The verdict stays falsifiable, because anyone can call the same endpoints and get the same
 * answer, but "we forked the chain and ran it ourselves" is not literally true of this path, and the
 * copy for it should not say so.
 *
 * Two endpoints, because neither serves both halves. Our own RPC answers `debug_traceCall`, which
 * carries the nested call graph and the storage diff. It denies `eth_simulateV1`, which is the only
 * way to run legs in sequence, and the public endpoint serves that. Checked live on both Base
 * networks at the H+2 spike.
 */

import { getAddress, toHex } from 'viem'
import { optionalEnv, rpcUrlFor } from '../../shared/config.ts'
import { SimulationError } from '../../shared/errors.ts'
import type { Address, ChainId, Hex, PendingTx, SimulationResult } from '../../shared/types.ts'
import type { ForkHandle } from './fork-handle.ts'
import { INJECTED_HEADROOM_WEI } from './fork.ts'
import {
  approvalDeltasFrom,
  balanceDeltasFrom,
  callGraphFrom,
  revertedFrom,
  type CallFrame,
  type PrestateDiff,
  type TraceLog,
} from './trace.ts'

/**
 * Where sequential simulation goes when our own endpoint will not serve it.
 *
 * Overridable per chain, because depending on an endpoint we neither pay for nor control is a real
 * dependency and should be one line to move.
 */
const SIMULATE_FALLBACK: Record<ChainId, string> = {
  8453: 'https://mainnet.base.org',
  84532: 'https://sepolia.base.org',
}

const SIMULATE_ENV: Record<ChainId, string> = {
  8453: 'BASE_MAINNET_SIMULATE_RPC_URL',
  84532: 'BASE_SEPOLIA_SIMULATE_RPC_URL',
}

const TIMEOUT_MS = 60_000
const GAS_LIMIT = 30_000_000n

export function simulateUrlFor(chainId: ChainId): string {
  const configured = SIMULATE_ENV[chainId] === undefined ? undefined : optionalEnv(SIMULATE_ENV[chainId])
  const fallback = SIMULATE_FALLBACK[chainId]
  const url = configured ?? fallback
  if (url === undefined) {
    throw new SimulationError(
      `no sequential-simulation endpoint is configured for chain ${chainId}, so a two-leg check cannot run there`,
    )
  }
  return url
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    throw new SimulationError(`${method} could not reach the endpoint`, { cause, retryable: true })
  }
  const body = (await response.json()) as { result?: T; error?: { message?: string } }
  if (body.error !== undefined) {
    throw new SimulationError(`${method} was rejected: ${body.error.message ?? 'no reason given'}`)
  }
  if (body.result === undefined) {
    throw new SimulationError(`${method} returned nothing`)
  }
  return body.result
}

interface SimulatedCall {
  status: Hex
  returnData?: Hex
  logs?: TraceLog[]
  error?: { message?: string }
}

function callObject(tx: PendingTx): Record<string, string> {
  return {
    from: getAddress(tx.from),
    to: getAddress(tx.to),
    data: tx.calldata,
    value: toHex(tx.value),
    gas: toHex(GAS_LIMIT),
  }
}

/**
 * Open a fork-shaped handle backed by RPC.
 *
 * Sequence is kept by replay rather than by holding state: every leg is re-sent with the ones
 * before it, in order, in a single `eth_simulateV1`. Three legs is the most any detector asks for,
 * and replaying them is what makes leg two observe what leg one left behind without a process to
 * hold that state in.
 */
export async function rpcForkAt(chainId: ChainId, block?: bigint): Promise<ForkHandle> {
  const traceUrl = rpcUrlFor(chainId)
  const simulateUrl = simulateUrlFor(chainId)

  const head = BigInt(await rpc<Hex>(traceUrl, 'eth_blockNumber', []))
  const forkBlock = block ?? head
  const at = toHex(forkBlock)

  /** Every leg run so far, in order. Replayed to reconstruct the state each new leg sees. */
  const legs: PendingTx[] = []
  /** Balances injected so an unfunded wallet can execute, disclosed exactly as on the anvil path. */
  const overrides: Record<string, { balance: Hex }> = {}

  const injectFor = (tx: PendingTx): void => {
    const from = getAddress(tx.from)
    overrides[from] = { balance: toHex(tx.value + INJECTED_HEADROOM_WEI) }
  }

  async function replay(extra: { to: Address; data: Hex } | null): Promise<SimulatedCall[]> {
    const calls = legs.map(callObject)
    if (extra !== null) {
      calls.push({ from: getAddress(legs[0]?.from ?? extra.to), to: getAddress(extra.to), data: extra.data, gas: toHex(GAS_LIMIT) })
    }
    const blocks = await rpc<{ calls: SimulatedCall[] }[]>(simulateUrl, 'eth_simulateV1', [
      {
        blockStateCalls: [{ stateOverrides: overrides, calls }],
        traceTransfers: true,
        validation: false,
      },
      at,
    ])
    const results = blocks[0]?.calls
    if (results === undefined) throw new SimulationError('the sequential simulation returned no calls')
    return results
  }

  return {
    block: forkBlock,
    backend: 'rpc',

    async run(tx: PendingTx): Promise<SimulationResult> {
      if (tx.chainId !== chainId) {
        throw new SimulationError(
          `this transaction is for chain ${tx.chainId} and the fork is chain ${chainId}; a gate must not answer for a network it did not simulate`,
        )
      }
      injectFor(tx)

      // The first leg is the transaction under judgement, and it gets the full trace: the nested
      // call graph flag 3 reads and the storage diff flag 4 reads both come from here.
      if (legs.length === 0) {
        legs.push(tx)
        const config = {
          tracer: 'callTracer',
          tracerConfig: { withLog: true },
          stateOverrides: overrides,
        }
        const callTrace = await rpc<CallFrame>(traceUrl, 'debug_traceCall', [callObject(tx), at, config])
        const prestate = await rpc<PrestateDiff>(traceUrl, 'debug_traceCall', [
          callObject(tx),
          at,
          { tracer: 'prestateTracer', tracerConfig: { diffMode: true }, stateOverrides: overrides },
        ])
        return {
          block: forkBlock,
          reverted: revertedFrom(callTrace),
          balanceDeltas: balanceDeltasFrom(callTrace, prestate),
          approvalDeltas: approvalDeltasFrom(callTrace),
          callGraph: callGraphFrom(callTrace),
          raw: { backend: 'rpc', callTrace, prestate },
        }
      }

      // Later legs are the two-leg probe. `eth_simulateV1` reports status and logs but no internal
      // call tree, which is all the exit check needs: whether the position can be sold, and why not.
      legs.push(tx)
      const results = await replay(null)
      const last = results[results.length - 1]
      const reverted = last.status !== '0x1'
      const frame: CallFrame = {
        from: tx.from,
        to: tx.to,
        input: tx.calldata,
        logs: last.logs ?? [],
        ...(reverted ? { error: last.error?.message ?? 'execution reverted' } : {}),
      }
      return {
        block: forkBlock,
        reverted,
        balanceDeltas: balanceDeltasFrom(frame, {}),
        approvalDeltas: approvalDeltasFrom(frame),
        // Empty rather than wrong: this endpoint does not return the call tree, and inventing one
        // from the logs would put a shape in front of a detector that never observed it.
        callGraph: [],
        raw: { backend: 'rpc', callTrace: frame, prestate: undefined },
      }
    },

    async call(to: Address, data: Hex): Promise<Hex> {
      // Replayed with the legs, so a read after a leg sees what that leg did. Reading the chain
      // directly here would quote a market the buy already moved.
      const results = await replay({ to, data })
      const last = results[results.length - 1]
      if (last.status !== '0x1') {
        throw new SimulationError(
          `a read against ${to} failed on the simulated state: ${last.error?.message ?? 'reverted'}`,
        )
      }
      return last.returnData ?? '0x'
    },

    async storageAt(address: Address, slot: Hex): Promise<Hex> {
      if (legs.length > 0) {
        // Sequential simulation returns call results, not storage. Reading the chain here would
        // report the state before the legs ran, which is a wrong answer wearing a right shape.
        throw new SimulationError(
          'this backend cannot read storage after a leg has run; the value would predate the leg',
        )
      }
      return rpc<Hex>(traceUrl, 'eth_getStorageAt', [getAddress(address), slot, at])
    },

    async release(): Promise<void> {
      legs.length = 0
    },
  }
}
