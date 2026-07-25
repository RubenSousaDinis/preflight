/**
 * A four-receipt chain covering beat 1: a refusal, a hire, a payment, and a freeze.
 *
 * The chain links by `prevHash`, so a surface can render the "receipt 3 follows receipt 2" property
 * before B2 exists. The hashes and signatures are labelled stand-ins, not Ed25519 output; only B2
 * produces a chain that `verifyChain` accepts.
 */

import type { JsonValue, Receipt } from '../types.ts'
import {
  FIXTURE_DECISION_BELOW_POLICY,
  FIXTURE_DECISION_HIRE,
} from './gate.ts'
import {
  FIXTURE_METHODOLOGY_VERSION,
  FIXTURE_SIGNER_PUBKEY,
  fixtureHash,
  fixtureSignature,
} from './seed.ts'

function receipt(
  index: number,
  label: string,
  subject: JsonValue,
  evidenceURI: string | null,
  prevHash: Receipt['prevHash'],
): Receipt {
  return {
    id: `fixture-receipt-${String(index).padStart(4, '0')}`,
    subject,
    responseHash: fixtureHash(`${label}-response`),
    evidenceURI,
    methodologyVersion: FIXTURE_METHODOLOGY_VERSION,
    reproducibleFrom: null,
    prevHash,
    hash: fixtureHash(`${label}-receipt`),
    sig: fixtureSignature(`${label}-signature`),
    signerPubKey: FIXTURE_SIGNER_PUBKEY,
  }
}

const refusedSubject: JsonValue = {
  kind: 'agent',
  verdict: FIXTURE_DECISION_BELOW_POLICY.verdict,
  reason: FIXTURE_DECISION_BELOW_POLICY.reason,
  grade: FIXTURE_DECISION_BELOW_POLICY.grade,
}

const hiredSubject: JsonValue = {
  kind: 'agent',
  verdict: FIXTURE_DECISION_HIRE.verdict,
  reason: FIXTURE_DECISION_HIRE.reason,
  grade: FIXTURE_DECISION_HIRE.grade,
}

const paidSubject: JsonValue = {
  kind: 'payment',
  rail: 'hedera-transfer',
  amount: '100000000',
  note: 'one honest call, paid after the gate cleared it',
}

const frozenSubject: JsonValue = {
  kind: 'freeze',
  reason: 'tool output tried to redirect the caller, so the budget was frozen',
}

export const FIXTURE_RECEIPT_REFUSED = receipt(1, 'refused', refusedSubject, null, null)

export const FIXTURE_RECEIPT_HIRED = receipt(
  2,
  'hired',
  hiredSubject,
  'https://fixture.invalid/evidence/fixture-agent-a.json',
  FIXTURE_RECEIPT_REFUSED.hash,
)

export const FIXTURE_RECEIPT_PAID = receipt(
  3,
  'paid',
  paidSubject,
  null,
  FIXTURE_RECEIPT_HIRED.hash,
)

export const FIXTURE_RECEIPT_FROZEN = receipt(
  4,
  'frozen',
  frozenSubject,
  null,
  FIXTURE_RECEIPT_PAID.hash,
)

export const FIXTURE_RECEIPT_CHAIN: Receipt[] = [
  FIXTURE_RECEIPT_REFUSED,
  FIXTURE_RECEIPT_HIRED,
  FIXTURE_RECEIPT_PAID,
  FIXTURE_RECEIPT_FROZEN,
]
