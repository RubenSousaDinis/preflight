/**
 * B5 composition: txGuard, the contract boundary.
 *
 * The order is the design, per `01-INTERFACES.md` section 9:
 *
 *   1. Fork the chain the transaction is for, at head unless a block is pinned.
 *   2. Fingerprint the callee at that block and compare it to what it carried when graded.
 *      **Drift blocks here, before anything is simulated.** A contract whose code moved since
 *      grading blocks regardless of what the simulation would have shown.
 *   3. Simulate the exact bytes.
 *   4. Run the detectors over the result.
 *   5. Compose the verdict, and record the tuple that makes it reproducible.
 *
 * Every error path returns `BLOCK`. A gate that cannot see must not permit, so there is no path
 * through this function that returns ALLOW because something failed.
 */

import { keccak256 } from 'viem'
import { reasonOf } from '../../shared/errors.ts'
import type {
  Detector,
  Flag,
  Hex,
  PendingTx,
  TxPolicy,
  TxTuple,
  TxVerdict,
} from '../../shared/types.ts'
import { codeFingerprint } from './fingerprint.ts'
import { forkAt, type ForkHandle } from './fork.ts'
import { DETECTORS as REGISTERED } from './detectors/index.ts'
import { gradedCodeFor } from './graded.ts'
import type { SimulationResult, ChainId, Address, CodeFingerprint } from '../../shared/types.ts'

export { DETECTORS } from './detectors/index.ts'

/** A zero word, meaning "never obtained", used only on a path that already blocks. */
const UNKNOWN_HASH = `0x${'00'.repeat(32)}` as Hex

export interface TxGuardDeps {
  forkAt: (chainId: ChainId, block?: bigint) => Promise<ForkHandle>
  codeFingerprint: (chainId: ChainId, address: Address, atBlock: bigint) => Promise<CodeFingerprint>
  gradedCodeFor: typeof gradedCodeFor
  detectors: Detector[]
}

const liveDeps: TxGuardDeps = {
  forkAt,
  codeFingerprint: (chainId, address, atBlock) => codeFingerprint(chainId, address, atBlock),
  gradedCodeFor,
  detectors: REGISTERED,
}

function tupleFor(tx: PendingTx, block: bigint): TxTuple {
  return {
    block,
    from: tx.from,
    to: tx.to,
    calldataHash: keccak256(tx.calldata),
    value: tx.value,
  }
}

/**
 * An advisory finding can never block.
 *
 * `confirmedBy: 'llm-scan'` with `severity: 'block'` is not a flag this gate honors, and the check
 * lives here rather than in the scanner, so a jailbroken scan cannot manufacture a block by
 * claiming one. The finding survives as advisory: suppressing it entirely would hide what the scan
 * said, and what the scan said is worth reading even when it cannot move the verdict.
 */
export function withoutManufacturedBlocks(flags: Flag[]): Flag[] {
  return flags.map((flag) =>
    flag.confirmedBy === 'llm-scan' && flag.severity === 'block'
      ? { ...flag, severity: 'advisory' as const }
      : flag,
  )
}

function blocked(
  reason: string,
  tuple: TxTuple,
  fingerprint: Hex,
  driftFromGraded: boolean | null,
  deltas: TxVerdict['deltas'] = [],
  flags: Flag[] = [],
): TxVerdict {
  return {
    verdict: 'BLOCK',
    flags,
    reason,
    deltas,
    reproducibleFrom: tuple,
    codeFingerprint: fingerprint,
    driftFromGraded,
  }
}

export async function txGuardWith(
  tx: PendingTx,
  policy: TxPolicy | undefined,
  deps: TxGuardDeps,
): Promise<TxVerdict> {
  // The tuple exists before the fork does, so a structural failure still reports which transaction
  // was refused. Its block is filled in once the fork reports one; zero means the fork never came
  // up, which the reason says in words.
  let tuple = tupleFor(tx, policy?.atBlock ?? 0n)
  let fingerprint: Hex = UNKNOWN_HASH
  let drift: boolean | null = null
  let fork: ForkHandle | null = null

  try {
    fork = await deps.forkAt(tx.chainId, policy?.atBlock)
  } catch (err) {
    return blocked(
      `this transaction cannot be simulated, so it is blocked: ${reasonOf(err)}`,
      tuple,
      fingerprint,
      drift,
    )
  }

  try {
    let simulation: SimulationResult
    let code: CodeFingerprint
    try {
      // Anchor everything to the block the fork actually reported, never to the block that was
      // asked for. Fingerprint, simulation, and tuple all describe the same state.
      tuple = tupleFor(tx, fork.block)

      code = await deps.codeFingerprint(tx.chainId, tx.to, fork.block)
      fingerprint = code.fingerprint

      const graded = deps.gradedCodeFor(tx.chainId, tx.to)
      drift = graded === null ? null : graded.fingerprint !== code.fingerprint
      if (drift === true) {
        // Before the simulation, deliberately. The trace of an upgraded contract is a description
        // of code nobody graded, and reading it would answer a question nobody asked.
        return blocked(
          `the code at ${tx.to} moved since it was graded, so this is blocked without simulating it`,
          tuple,
          fingerprint,
          drift,
        )
      }

      simulation = await fork.run(tx)
    } catch (err) {
      return blocked(
        `this transaction cannot be simulated, so it is blocked: ${reasonOf(err)}`,
        tuple,
        fingerprint,
        drift,
      )
    }

    let flags: Flag[]
    try {
      const found = await Promise.all(
        deps.detectors.map((detector) => detector(simulation, tx, code)),
      )
      flags = withoutManufacturedBlocks(found.flat())
    } catch (err) {
      // A detector that throws leaves the question unanswered, and an unanswered question is a
      // refusal here, not a pass.
      return blocked(
        `a check could not be completed, so this is blocked: ${reasonOf(err)}`,
        tuple,
        fingerprint,
        drift,
        simulation.balanceDeltas,
      )
    }

    const blocking = flags.filter((flag) => flag.severity === 'block')
    if (blocking.length > 0) {
      return blocked(
        blocking.map((flag) => flag.title).join('; '),
        tuple,
        fingerprint,
        drift,
        simulation.balanceDeltas,
        flags,
      )
    }

    return {
      verdict: 'ALLOW',
      flags,
      reason:
        simulation.reverted === true
          ? 'no red flag fired, and this transaction reverts in simulation'
          : 'no red flag fired for this transaction at this block',
      deltas: simulation.balanceDeltas,
      reproducibleFrom: tuple,
      codeFingerprint: fingerprint,
      driftFromGraded: drift,
    }
  } finally {
    await fork.release().catch(() => undefined)
  }
}

/**
 * Allow or block one pending transaction, at one block, on its own chain.
 *
 * The verdict is reproducible for the block and state in `reproducibleFrom`. It is not a
 * prediction of what the transaction does once it lands.
 */
export async function txGuard(tx: PendingTx, policy?: TxPolicy): Promise<TxVerdict> {
  return txGuardWith(tx, policy, liveDeps)
}
