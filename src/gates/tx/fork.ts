/**
 * B5a: the fork and simulate harness.
 *
 * A pending transaction runs against a fork of its own chain at the live block, and what it would
 * do comes back as structured deltas. The mechanism is Foundry anvil, decided at the H+2 spike
 * (`spike/RESULT.md`) against the team's actual RPC and not revisited.
 *
 * Two invariants this file owns, from `01-INTERFACES.md` section 7:
 *
 * - **A gate that cannot simulate blocks.** Every failure here throws `SimulationError`. Nothing
 *   returns a partial result, because partial deltas read as an allow.
 * - **`calldata` is the exact bytes handed in.** Re-encoding simulates a different transaction, and
 *   deltas from a different transaction are confidently wrong.
 *
 * `Fork.run` is stateful and sequential: leg two observes the state leg one left behind. That is
 * what makes two-leg detection possible and it is also the trap, so each detector receives its own
 * fork and releases it.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getAddress, toHex } from 'viem'
import { rpcUrlFor } from '../../shared/config.ts'
import { SimulationError } from '../../shared/errors.ts'
import type { Address, ChainId, Fork, Hex, PendingTx, SimulationResult } from '../../shared/types.ts'
import {
  approvalDeltasFrom,
  balanceDeltasFrom,
  callGraphFrom,
  revertedFrom,
  type CallFrame,
  type PrestateDiff,
} from './trace.ts'

/**
 * Headroom injected on top of `value` so an unfunded demo wallet can execute.
 *
 * Disclosed, not hidden: without it every simulation for a wallet holding nothing fails on funds
 * and tests nothing. The fork runs at a zero gas price so this headroom does not leak into the
 * native balance deltas as a gas charge.
 */
export const INJECTED_HEADROOM_WEI = 10n ** 18n

/** Explicit, so anvil skips estimation and a reverting call still lands as a mined failure. */
const GAS_LIMIT = 30_000_000n

const READY_TIMEOUT_MS = 20_000
const CALL_TIMEOUT_MS = 60_000
const RECEIPT_TIMEOUT_MS = 10_000

function anvilBinary(): string {
  const configured = process.env.ANVIL_BIN
  if (configured !== undefined && configured.length > 0) return configured
  const inHome = join(homedir(), '.foundry', 'bin', 'anvil')
  return existsSync(inHome) ? inHome : 'anvil'
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('could not reserve a local port for the fork'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new SimulationError(`the fork answered ${method} with HTTP ${response.status}`, {
      retryable: true,
    })
  }
  const body = (await response.json()) as { result?: T; error?: { message?: string } }
  if (body.error !== undefined) {
    throw new SimulationError(`the fork rejected ${method}: ${body.error.message ?? 'no reason given'}`)
  }
  return body.result as T
}

function terminate(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

/**
 * The `Fork` from `01-INTERFACES.md` section 7, plus the height it was taken at.
 *
 * The height is on the handle because a caller needs it before it runs anything: the drift check
 * fingerprints the callee at the fork block and has to happen before the transaction is simulated.
 * Additive, so anything typed against the frozen `Fork` still accepts this.
 */
export interface ForkHandle extends Fork {
  readonly block: bigint
  /**
   * A read only call against the fork's current state.
   *
   * Needed by the two-leg detector: reserves have to be read from the state the buy leg left
   * behind, not from the chain, or the sell is quoted against a market that no longer exists.
   * Additive, so anything typed against the frozen `Fork` still accepts this.
   */
  call(to: Address, data: Hex): Promise<Hex>
}

/**
 * Start a fork of `chainId` and hand back the handle.
 *
 * Forks at head unless a block is given. Head is the right default because the verdict answers
 * "what would this do now", and the block that was actually forked is recorded either way so the
 * answer stays reproducible for that block and state.
 */
export async function forkAt(chainId: ChainId, block?: bigint): Promise<ForkHandle> {
  const rpcUrl = rpcUrlFor(chainId)
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`

  const args = [
    '--fork-url',
    rpcUrl,
    '--port',
    String(port),
    '--host',
    '127.0.0.1',
    '--silent',
    // A zero gas price keeps gas out of the native balance deltas, so a delta on screen is value
    // the transaction moved rather than the cost of running it.
    '--gas-price',
    '0',
    '--block-base-fee-per-gas',
    '0',
    '--auto-impersonate',
  ]
  if (block !== undefined) args.push('--fork-block-number', String(block))

  let child: ChildProcess
  try {
    child = spawn(anvilBinary(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (cause) {
    throw new SimulationError('anvil could not be started, so this transaction cannot be simulated', {
      cause,
    })
  }

  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  let exited: string | null = null
  child.on('exit', (code, signal) => {
    exited = `anvil exited with code ${code ?? 'null'}${signal === null ? '' : ` on ${signal}`}`
  })

  const deadline = Date.now() + READY_TIMEOUT_MS
  let forkChainId: number | null = null
  while (Date.now() < deadline) {
    if (exited !== null) {
      // The fail closed case the spike checked: a fork that cannot be established exits rather
      // than serving an empty chain, and an empty chain would simulate against nothing at all.
      throw new SimulationError(
        `${exited}, so chain ${chainId} could not be forked. ${stderr.trim().split('\n').slice(-1)[0] ?? ''}`.trim(),
        { retryable: true },
      )
    }
    try {
      forkChainId = Number(await rpc<Hex>(url, 'eth_chainId', []))
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  if (forkChainId === null) {
    terminate(child)
    throw new SimulationError(`the fork of chain ${chainId} did not come up within ${READY_TIMEOUT_MS}ms`, {
      retryable: true,
    })
  }
  if (forkChainId !== chainId) {
    terminate(child)
    throw new SimulationError(
      `asked for chain ${chainId} and the fork reports chain ${forkChainId}; simulating the wrong network returns a confident irrelevant answer`,
    )
  }

  const forkBlock = BigInt(await rpc<Hex>(url, 'eth_blockNumber', []))

  return {
    block: forkBlock,
    async run(tx: PendingTx): Promise<SimulationResult> {
      return runOnFork(url, forkBlock, chainId, tx)
    },
    async storageAt(address: Address, slot: Hex): Promise<Hex> {
      return rpc<Hex>(url, 'eth_getStorageAt', [getAddress(address), slot, 'latest'])
    },
    async call(to: Address, data: Hex): Promise<Hex> {
      return rpc<Hex>(url, 'eth_call', [{ to: getAddress(to), data }, 'latest'])
    },
    async release(): Promise<void> {
      terminate(child)
    },
  }
}

async function runOnFork(
  url: string,
  forkBlock: bigint,
  forkChainId: ChainId,
  tx: PendingTx,
): Promise<SimulationResult> {
  if (tx.chainId !== forkChainId) {
    throw new SimulationError(
      `this transaction is for chain ${tx.chainId} and the fork is chain ${forkChainId}; a gate must not answer for a network it did not simulate`,
    )
  }

  const from = getAddress(tx.from)
  const to = getAddress(tx.to)

  // Step 5: inject the from-balance, then simulate the exact bytes. The injection is what makes an
  // unfunded demo wallet testable at all, and it is rendered rather than hidden.
  const existing = BigInt(await rpc<Hex>(url, 'eth_getBalance', [from, 'latest']))
  await rpc(url, 'anvil_setBalance', [from, toHex(existing + tx.value + INJECTED_HEADROOM_WEI)])
  await rpc(url, 'anvil_impersonateAccount', [from])

  const hash = await rpc<Hex>(url, 'eth_sendTransaction', [
    {
      from,
      to,
      data: tx.calldata,
      value: toHex(tx.value),
      gas: toHex(GAS_LIMIT),
      gasPrice: '0x0',
    },
  ])

  // anvil returns the hash before the receipt is queryable, so this polls rather than assuming.
  // A timeout here is a failure to simulate, which blocks: a missing receipt would otherwise read
  // as a transaction that did nothing.
  let receipt: { status: Hex } | null = null
  const receiptDeadline = Date.now() + RECEIPT_TIMEOUT_MS
  while (receipt === null && Date.now() < receiptDeadline) {
    receipt = await rpc<{ status: Hex } | null>(url, 'eth_getTransactionReceipt', [hash])
    if (receipt === null) await new Promise((resolve) => setTimeout(resolve, 25))
  }
  if (receipt === null) {
    throw new SimulationError(
      `the fork mined no receipt for the simulated transaction within ${RECEIPT_TIMEOUT_MS}ms`,
      { retryable: true },
    )
  }

  const callTrace = await rpc<CallFrame>(url, 'debug_traceTransaction', [
    hash,
    { tracer: 'callTracer', tracerConfig: { withLog: true } },
  ])
  const prestate = await rpc<PrestateDiff>(url, 'debug_traceTransaction', [
    hash,
    { tracer: 'prestateTracer', tracerConfig: { diffMode: true } },
  ])

  return {
    // The fork height, not the height this leg happened to mine into. Both legs of a two-leg
    // detection share one anchor, and that anchor is what `reproducibleFrom` records.
    block: forkBlock,
    reverted: receipt.status !== '0x1' || revertedFrom(callTrace),
    balanceDeltas: balanceDeltasFrom(callTrace, prestate),
    approvalDeltas: approvalDeltasFrom(callTrace),
    callGraph: callGraphFrom(callTrace),
    raw: { hash, receipt, callTrace, prestate },
  }
}

/**
 * The single-leg convenience path: fork, run one transaction, release.
 *
 * Defined exactly as that, so there is one simulation mechanism rather than two that can drift.
 */
export async function simulate(tx: PendingTx, block?: bigint): Promise<SimulationResult> {
  const fork = await forkAt(tx.chainId, block)
  try {
    return await fork.run(tx)
  } finally {
    await fork.release()
  }
}
