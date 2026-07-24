/**
 * B2: every gate decision leaves a signed, order-fixed record.
 *
 * Three invariants carry this, and each is the difference between a chain and a log:
 *
 * - **`hash` covers `prevHash`.** Without it the links reorder without detection.
 * - **`prevHash: null` is legal for exactly one receipt.** A second null is a verification failure, not
 *   a second chain, because otherwise a chain can be forked and the shorter branch presented.
 * - **`sig` is over `hash`, not over the subject.** Signing the subject leaves the link unsigned.
 *
 * The canonicalizer is A3a's, imported rather than reimplemented. A second canonicalizer is precisely
 * how a verify path drifts from a write path, and the drift shows up as every receipt failing to
 * verify for reasons nobody can locate.
 *
 * Refusals are recorded too. A gate that only records its approvals has no evidence it ever refused
 * anything, and the refusal caused by an RPC failure is the decision most worth having a record of.
 */

import { keccak256, stringToBytes } from 'viem'

import { ReceiptError } from '../shared/errors.ts'
import type {
  ChainVerification,
  GateDecision,
  Hex,
  JsonValue,
  Receipt,
  SerializedTxTuple,
  TxTuple,
  TxVerdict,
} from '../shared/types.ts'
import { canonicalizeValue } from '../validator/canonical.ts'
import { methodologyVersion } from '../validator/methodology.ts'
import { createSigner, verifySignature, type ReceiptSigner } from './signer.ts'

export function serializeTxTuple(tuple: TxTuple): SerializedTxTuple {
  return {
    block: tuple.block.toString(),
    from: tuple.from,
    to: tuple.to,
    calldataHash: tuple.calldataHash,
    value: tuple.value.toString(),
  }
}

/** The decision, as the bytes that get hashed. bigints become decimal strings; nothing is dropped. */
export function agentSubject(decision: GateDecision): JsonValue {
  return {
    kind: 'agent',
    verdict: decision.verdict,
    reason: decision.reason,
    grade: decision.grade,
    score: decision.score,
    fingerprintMatch: decision.fingerprintMatch,
    record:
      decision.record === null
        ? null
        : {
            agentId: decision.record.agentId,
            score: decision.record.score,
            responseURI: decision.record.responseURI,
            responseHash: decision.record.responseHash,
            tag: decision.record.tag,
            validator: decision.record.validator,
            expiresAt: decision.record.expiresAt,
            txHash: decision.record.txHash,
          },
  }
}

export function txSubject(verdict: TxVerdict): JsonValue {
  return {
    kind: 'tx',
    verdict: verdict.verdict,
    reason: verdict.reason,
    flags: verdict.flags.map((flag) => ({
      id: flag.id,
      severity: flag.severity,
      title: flag.title,
      detail: flag.detail,
      confirmedBy: flag.confirmedBy,
    })),
    deltas: verdict.deltas.map((delta) => ({
      token: delta.token,
      owner: delta.owner,
      delta: delta.delta.toString(),
    })),
    reproducibleFrom: { ...serializeTxTuple(verdict.reproducibleFrom) },
    codeFingerprint: verdict.codeFingerprint,
    driftFromGraded: verdict.driftFromGraded,
  }
}

function isTxVerdict(input: GateDecision | TxVerdict): input is TxVerdict {
  return input.verdict === 'ALLOW' || input.verdict === 'BLOCK'
}

/** keccak256 over the canonical verdict. */
export function responseHashOf(subject: JsonValue): Hex {
  return keccak256(stringToBytes(canonicalizeValue(subject)))
}

/**
 * The link. Binds every field of the receipt except the signature, including `prevHash`.
 *
 * `responseHash` stands in for the subject here, and a verifier recomputes it from the subject before
 * recomputing this, so altering a byte of the subject still breaks the chain.
 */
export function receiptHash(input: {
  id: string
  responseHash: Hex
  evidenceURI: string | null
  methodologyVersion: string
  reproducibleFrom: SerializedTxTuple | null
  prevHash: Hex | null
  signerPubKey: Hex
}): Hex {
  return keccak256(
    stringToBytes(
      canonicalizeValue({
        schema: 'preflight-receipt-v1',
        id: input.id,
        responseHash: input.responseHash,
        evidenceURI: input.evidenceURI,
        methodologyVersion: input.methodologyVersion,
        reproducibleFrom: input.reproducibleFrom === null ? null : { ...input.reproducibleFrom },
        prevHash: input.prevHash,
        signerPubKey: input.signerPubKey,
      }),
    ),
  )
}

export interface EmitOptions {
  /** For agent decisions. Absence is a fact about the decision, so it is recorded, not skipped. */
  evidenceURI?: string | null
  signer?: ReceiptSigner
  /** Monotonic by counter, never by clock: a wall clock going backwards must not reorder a chain. */
  index?: number
}

export function receiptId(index: number): string {
  return `receipt-${String(index).padStart(4, '0')}`
}

let ambientSigner: ReceiptSigner | null = null
let ambientIndex = 0

function defaultSigner(): ReceiptSigner {
  ambientSigner ??= createSigner()
  return ambientSigner
}

/**
 * 01-INTERFACES §5. Emits one receipt for a decision, linked to `prev`.
 *
 * The linking argument is the previous receipt's hash rather than the receipt, so a caller holding only
 * a hash can continue a chain.
 */
export async function emitReceipt(
  decision: GateDecision | TxVerdict,
  prev: Hex | null,
  options: EmitOptions = {},
): Promise<Receipt> {
  const signer = options.signer ?? defaultSigner()
  const index = options.index ?? ++ambientIndex
  const isTx = isTxVerdict(decision)
  const subject = isTx ? txSubject(decision) : agentSubject(decision)
  const responseHash = responseHashOf(subject)
  const reproducibleFrom = isTx ? serializeTxTuple(decision.reproducibleFrom) : null
  const evidenceURI = isTx ? null : (options.evidenceURI ?? decision.record?.responseURI ?? null)
  const id = receiptId(index)
  const version = methodologyVersion()

  const hash = receiptHash({
    id,
    responseHash,
    evidenceURI,
    methodologyVersion: version,
    reproducibleFrom,
    prevHash: prev,
    signerPubKey: signer.publicKey,
  })

  return {
    id,
    subject,
    responseHash,
    evidenceURI,
    methodologyVersion: version,
    reproducibleFrom,
    prevHash: prev,
    hash,
    sig: signer.sign(hash),
    signerPubKey: signer.publicKey,
  }
}

/**
 * Walks the chain forward and stops at the first break, naming the field.
 *
 * A boolean with no location is not usable on stage, so `brokenAt` carries the index and `reason` says
 * which check failed and why.
 */
export async function verifyChain(receipts: Receipt[]): Promise<ChainVerification> {
  const broken = (index: number, reason: string): ChainVerification => ({
    ok: false,
    brokenAt: index,
    reason,
  })

  if (receipts.length === 0) {
    return { ok: false, brokenAt: null, reason: 'there are no receipts to verify' }
  }

  let previous: Receipt | null = null
  for (const [index, receipt] of receipts.entries()) {
    if (index === 0) {
      if (receipt.prevHash !== null) {
        return broken(0, `${receipt.id} opens the chain but points at a previous receipt`)
      }
    } else if (receipt.prevHash === null) {
      return broken(index, `${receipt.id} has no prevHash, and only the first receipt may open a chain`)
    } else if (receipt.prevHash !== previous?.hash) {
      return broken(
        index,
        `${receipt.id} points at ${receipt.prevHash.slice(0, 12)}… but the receipt before it hashes to ${previous?.hash.slice(0, 12)}…`,
      )
    }

    const recomputedResponse = responseHashOf(receipt.subject)
    if (recomputedResponse !== receipt.responseHash) {
      return broken(index, `${receipt.id} subject does not hash to its responseHash`)
    }

    const recomputedHash = receiptHash({
      id: receipt.id,
      responseHash: receipt.responseHash,
      evidenceURI: receipt.evidenceURI,
      methodologyVersion: receipt.methodologyVersion,
      reproducibleFrom: receipt.reproducibleFrom,
      prevHash: receipt.prevHash,
      signerPubKey: receipt.signerPubKey,
    })
    if (recomputedHash !== receipt.hash) {
      return broken(index, `${receipt.id} fields do not hash to its recorded hash`)
    }

    if (!verifySignature(receipt.hash, receipt.sig, receipt.signerPubKey)) {
      return broken(index, `${receipt.id} signature does not verify against its signer public key`)
    }

    if (previous !== null && receipt.id <= previous.id) {
      return broken(index, `${receipt.id} does not follow ${previous.id} in order`)
    }

    previous = receipt
  }

  return { ok: true, brokenAt: null, reason: null }
}

/**
 * One run's chain, in memory.
 *
 * Session scoped by default (B2 open question 1). Losing a receipt to a slow store is worse than an
 * unpersisted chain, so nothing here can fail on a write.
 */
export class ReceiptChain {
  #receipts: Receipt[] = []
  #signer: ReceiptSigner

  constructor(signer: ReceiptSigner = defaultSigner()) {
    this.#signer = signer
  }

  get signerPubKey(): Hex {
    return this.#signer.publicKey
  }

  get head(): Hex | null {
    return this.#receipts.at(-1)?.hash ?? null
  }

  get length(): number {
    return this.#receipts.length
  }

  async emit(
    decision: GateDecision | TxVerdict,
    options: Omit<EmitOptions, 'signer' | 'index'> = {},
  ): Promise<Receipt> {
    const receipt = await emitReceipt(decision, this.head, {
      ...options,
      signer: this.#signer,
      index: this.#receipts.length + 1,
    })
    this.#receipts.push(receipt)
    return receipt
  }

  /** A serializable array, so the console renders the chain directly. */
  all(): Receipt[] {
    return [...this.#receipts]
  }

  toJSON(): Receipt[] {
    return this.all()
  }

  verify(): Promise<ChainVerification> {
    return verifyChain(this.all())
  }

  at(index: number): Receipt {
    const receipt = this.#receipts[index]
    if (receipt === undefined) throw new ReceiptError(`there is no receipt at index ${index}`)
    return receipt
  }
}
