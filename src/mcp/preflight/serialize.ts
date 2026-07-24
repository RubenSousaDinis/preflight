/**
 * Turning a verdict into JSON without losing a number.
 *
 * JSON has no bigint, so every one of them is written out as a decimal string, explicitly, at one
 * place. A coercion would put a wrong `value` or a wrong block height on screen while looking like it
 * worked, and the fields that carry bigints here are exactly the ones a reader checks a verdict
 * against.
 *
 * No field is added, renamed, or summarized. The shapes are §4 and §9 with their bigints spelled out.
 */

import type { GateDecision, SerializedTxTuple, TxVerdict } from '../../shared/types.ts'

export interface SerializedBalanceDelta {
  token: string
  owner: string
  delta: string
}

export interface SerializedTxVerdict {
  verdict: TxVerdict['verdict']
  flags: TxVerdict['flags']
  reason: string
  deltas: SerializedBalanceDelta[]
  reproducibleFrom: SerializedTxTuple
  codeFingerprint: string
  driftFromGraded: boolean | null
}

export function serializeTxVerdict(verdict: TxVerdict): SerializedTxVerdict {
  return {
    verdict: verdict.verdict,
    flags: verdict.flags,
    reason: verdict.reason,
    deltas: verdict.deltas.map((delta) => ({
      token: delta.token,
      owner: delta.owner,
      delta: delta.delta.toString(),
    })),
    reproducibleFrom: {
      block: verdict.reproducibleFrom.block.toString(),
      from: verdict.reproducibleFrom.from,
      to: verdict.reproducibleFrom.to,
      calldataHash: verdict.reproducibleFrom.calldataHash,
      value: verdict.reproducibleFrom.value.toString(),
    },
    codeFingerprint: verdict.codeFingerprint,
    driftFromGraded: verdict.driftFromGraded,
  }
}

/** A GateDecision is already JSON, so this exists to keep the two paths symmetrical and explicit. */
export function serializeGateDecision(decision: GateDecision): GateDecision {
  return {
    verdict: decision.verdict,
    reason: decision.reason,
    grade: decision.grade,
    score: decision.score,
    fingerprintMatch: decision.fingerprintMatch,
    record: decision.record,
  }
}

/** The payload a failed check returns. A blocked verdict, never an exception the caller can shrug off. */
export function blockedVerdict(reason: string, tx?: { from?: string; to?: string; value?: string }): SerializedTxVerdict {
  const zero = `0x${'0'.repeat(64)}`
  return {
    verdict: 'BLOCK',
    flags: [],
    reason,
    deltas: [],
    reproducibleFrom: {
      block: '0',
      from: (tx?.from ?? `0x${'0'.repeat(40)}`) as `0x${string}`,
      to: (tx?.to ?? `0x${'0'.repeat(40)}`) as `0x${string}`,
      calldataHash: zero as `0x${string}`,
      value: tx?.value ?? '0',
    },
    codeFingerprint: zero,
    driftFromGraded: null,
  }
}

export function refusedDecision(reason: string): GateDecision {
  return {
    verdict: 'REFUSE',
    reason,
    grade: null,
    score: null,
    fingerprintMatch: null,
    record: null,
  }
}
