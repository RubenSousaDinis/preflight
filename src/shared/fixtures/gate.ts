/**
 * GateDecision fixtures: one hire and every refusal B1 owes a reason for.
 *
 * The refusal list is the list from 01-INTERFACES §4, one fixture per row, so a surface built
 * against these renders every path the gate can actually take rather than the happy one plus a
 * generic error state.
 */

import type { GateDecision, GatePolicy } from '../types.ts'
import {
  FIXTURE_RECORD_A,
  FIXTURE_RECORD_DRIFTED,
  FIXTURE_RECORD_EXPIRED,
  FIXTURE_RECORD_F,
  FIXTURE_RECORD_WRONG_VALIDATOR,
} from './agents.ts'

/** 01-INTERFACES §4: minGrade defaults to B. Staleness is a day, which is longer than the event. */
export const DEFAULT_GATE_POLICY: GatePolicy = { minGrade: 'B', maxAgeSeconds: 86_400 }

export const FIXTURE_DECISION_HIRE: GateDecision = {
  verdict: 'HIRE',
  reason: 'grade A meets the minimum of B, and the live tool surface matches the graded baseline',
  grade: 'A',
  score: 100,
  fingerprintMatch: true,
  record: FIXTURE_RECORD_A,
}

export const FIXTURE_DECISION_NO_RECORD: GateDecision = {
  verdict: 'REFUSE',
  reason: 'no validation record from this validator, so there is nothing to check the agent against',
  grade: null,
  score: null,
  fingerprintMatch: null,
  record: null,
}

export const FIXTURE_DECISION_WRONG_VALIDATOR: GateDecision = {
  verdict: 'REFUSE',
  reason: 'the only record found was written by another validator, which this gate does not trust',
  grade: null,
  score: null,
  fingerprintMatch: null,
  record: FIXTURE_RECORD_WRONG_VALIDATOR,
}

export const FIXTURE_DECISION_EXPIRED: GateDecision = {
  verdict: 'REFUSE',
  reason: 'the validation record expired, and an expired record is treated as absent',
  grade: null,
  score: null,
  fingerprintMatch: null,
  record: FIXTURE_RECORD_EXPIRED,
}

export const FIXTURE_DECISION_EVIDENCE_UNREACHABLE: GateDecision = {
  verdict: 'REFUSE',
  reason: 'the evidence bundle could not be retrieved, so the record could not be checked',
  grade: 'A',
  score: 100,
  fingerprintMatch: null,
  record: FIXTURE_RECORD_A,
}

export const FIXTURE_DECISION_HASH_MISMATCH: GateDecision = {
  verdict: 'REFUSE',
  reason: 'the retrieved evidence does not hash to the responseHash recorded onchain',
  grade: 'A',
  score: 100,
  fingerprintMatch: null,
  record: FIXTURE_RECORD_A,
}

export const FIXTURE_DECISION_FINGERPRINT_UNOBTAINABLE: GateDecision = {
  verdict: 'REFUSE',
  reason: 'the live tool surface could not be enumerated, so drift could not be ruled out',
  grade: 'A',
  score: 100,
  fingerprintMatch: null,
  record: FIXTURE_RECORD_A,
}

/** Drift outranks the letter. This is C2's headline row. */
export const FIXTURE_DECISION_DRIFT: GateDecision = {
  verdict: 'REFUSE',
  reason: 'graded A, but the live tool surface no longer matches the surface that was graded',
  grade: 'A',
  score: 100,
  fingerprintMatch: false,
  record: FIXTURE_RECORD_DRIFTED,
}

export const FIXTURE_DECISION_BELOW_POLICY: GateDecision = {
  verdict: 'REFUSE',
  reason: 'grade F is below the minimum of B',
  grade: 'F',
  score: 0,
  fingerprintMatch: true,
  record: FIXTURE_RECORD_F,
}

/** Every fixture decision, in the order a console would list them. */
export const FIXTURE_DECISIONS: GateDecision[] = [
  FIXTURE_DECISION_HIRE,
  FIXTURE_DECISION_NO_RECORD,
  FIXTURE_DECISION_WRONG_VALIDATOR,
  FIXTURE_DECISION_EXPIRED,
  FIXTURE_DECISION_EVIDENCE_UNREACHABLE,
  FIXTURE_DECISION_HASH_MISMATCH,
  FIXTURE_DECISION_FINGERPRINT_UNOBTAINABLE,
  FIXTURE_DECISION_DRIFT,
  FIXTURE_DECISION_BELOW_POLICY,
]
