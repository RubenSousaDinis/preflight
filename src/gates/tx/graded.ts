/**
 * The code fingerprint a contract carried when it was graded.
 *
 * Drift is "this contract's executing code moved since we graded it", so the check needs a
 * baseline to compare against. This is that baseline, and nothing more: it is not a grade store,
 * and it never decides an allow on its own.
 *
 * Absence is not drift. A contract with no recorded baseline reports `driftFromGraded: null` and
 * the simulation proceeds, because blocking on absence would block every first-seen contract.
 */

import { contractRef } from './fingerprint.ts'
import type { Address, ChainId, Hex } from '../../shared/types.ts'

export interface GradedCode {
  fingerprint: Hex
  /** The block the baseline was taken at, so the pair of blocks can be shown side by side. */
  observedBlock: bigint
}

const baselines = new Map<string, GradedCode>()

export function recordGradedCode(
  chainId: ChainId,
  address: Address,
  code: GradedCode,
): void {
  baselines.set(contractRef(chainId, address), code)
}

export function gradedCodeFor(chainId: ChainId, address: Address): GradedCode | null {
  return baselines.get(contractRef(chainId, address)) ?? null
}

/**
 * Forget every baseline.
 *
 * Fixture state pollutes across run-throughs: a rehearsal that upgraded the proxy leaves the next
 * run looking at drift that the audience never saw happen. This is the documented reset.
 */
export function clearGradedCode(): void {
  baselines.clear()
}
