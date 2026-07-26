/**
 * A pair of chains for the receipts panel: one the verifier accepts, one it rejects.
 *
 * The panel used to render the frozen fixture chain alone. Its hashes are labelled stand-ins, so
 * the verifier rejected it on the very first receipt, on the very first content check, and stopped
 * there. Two things were wrong with that. It never reached a prevHash link, a receipt hash, or a
 * signature, so the checks the panel advertises were never once exercised in front of anyone. And
 * a screen that can only ever report a break says exactly as little as one that can only ever
 * report agreement: in both cases the answer does not depend on what was handed over, so nothing
 * has been shown about the verifier at all.
 *
 * So the panel gets both answers, from one chain. The receipts here are real: emitted through
 * `ReceiptChain`, hashed by the same code the gates use, and signed with a live Ed25519 key. The
 * second chain is that same chain with one receipt's subject edited after signing, which is the
 * forgery worth showing: the numbers on screen no longer match the hash the signature covers.
 */

import type { JsonValue, Receipt } from '../shared/types.ts'
import { ReceiptChain } from './receipt-chain.ts'
import type { ReceiptSigner } from './signer.ts'

export interface ReceiptDemonstration {
  /** Really signed, really linked. `verifyChain` accepts this. */
  intact: Receipt[]
  /** The same receipts, one of them edited after the fact. `verifyChain` rejects this. */
  tampered: Receipt[]
  /** Index of the edited receipt, so a caller can point at it without re-deriving it. */
  tamperedAt: number
  /** What was changed, in words, so the panel states it rather than implying it. */
  tamperNote: string
}

/**
 * The four moments beat 1 produces: a refusal, a hire, a payment, a freeze.
 *
 * The same shapes the fixture chain carried, so the panel reads as it always did. What changed is
 * that these are hashed and signed rather than described.
 */
const SUBJECTS: JsonValue[] = [
  {
    kind: 'agent',
    verdict: 'REFUSE',
    reason: 'grade D is below the minimum of B',
    grade: 'D',
  },
  {
    kind: 'agent',
    verdict: 'HIRE',
    reason:
      'grade B meets the minimum of B, the evidence hashes to the record, and the live tool surface matches the surface that was graded',
    grade: 'B',
  },
  {
    kind: 'payment',
    rail: 'hedera-transfer',
    amount: '1 HBAR',
    note: 'one honest call, paid after the gate cleared it',
  },
  {
    kind: 'freeze',
    reason: 'tool output tried to redirect the caller, so the budget was frozen',
  },
]

/**
 * Which receipt gets edited.
 *
 * The payment, and deliberately not the first receipt. A break on receipt one tells a reader only
 * that the verifier can fail on the row it starts at; a break here means it walked two receipts,
 * checked their links, hashes and signatures, accepted them, and then caught the third. The
 * payment is also the receipt somebody would have a reason to rewrite.
 */
const TAMPERED_INDEX = 2

const TAMPER_NOTE =
  'the payment receipt below says 1 HBAR was paid. In the copy underneath it that figure was edited to 9 HBAR after the receipt was signed, and nothing else was touched.'

function editedSubject(subject: JsonValue): JsonValue {
  return { ...(subject as Record<string, JsonValue>), amount: '9 HBAR' }
}

/**
 * Build the pair.
 *
 * The signer is a parameter so a caller can pin one, and defaults to the chain's own, which
 * generates a key at process start. Nothing here needs a configured key: a receipt verifies
 * against the public key it carries, which is the property that lets anyone check one.
 */
export async function receiptDemonstration(
  signer?: ReceiptSigner,
): Promise<ReceiptDemonstration> {
  const chain = signer === undefined ? new ReceiptChain() : new ReceiptChain(signer)
  for (const subject of SUBJECTS) {
    await chain.emitSubject(subject)
  }
  const intact = chain.all()

  // Only the subject moves. The hash and the signature stay exactly as they were signed, because
  // that is what a forgery looks like: the record still carries its original proof, and the proof
  // no longer describes it.
  const tampered = intact.map((receipt, index) =>
    index === TAMPERED_INDEX
      ? { ...receipt, subject: editedSubject(receipt.subject) }
      : receipt,
  )

  return { intact, tampered, tamperedAt: TAMPERED_INDEX, tamperNote: TAMPER_NOTE }
}
