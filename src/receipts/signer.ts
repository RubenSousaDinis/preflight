/**
 * The Ed25519 signer behind every receipt.
 *
 * Ed25519 rather than an EVM signature scheme because a receipt is an off-chain audit artifact, not a
 * transaction: it has to verify anywhere, with no RPC and no chain access, which is exactly what lets
 * someone check a verdict without asking us anything.
 *
 * The private key never leaves this module. It is not exported, not logged, and not part of any shape
 * that reaches a UI or a receipt. What travels is the 32-byte public key, which is all a verifier
 * needs.
 *
 * A key is generated at process start unless `RECEIPT_SIGNER_PRIVATE_KEY` provides one (base64 PKCS8),
 * so a demo that restarts keeps the same signer and one published public key stays true.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from 'node:crypto'
import { hexToBytes } from 'viem'

import { ReceiptError } from '../shared/errors.ts'
import type { Hex } from '../shared/types.ts'

function rawPublicKey(key: KeyObject): Hex {
  const jwk = key.export({ format: 'jwk' }) as { x?: string }
  if (typeof jwk.x !== 'string') {
    throw new ReceiptError('the signing key did not export a public component')
  }
  return `0x${Buffer.from(jwk.x, 'base64url').toString('hex')}`
}

function publicKeyFromHex(pubKey: Hex): KeyObject {
  const bytes = Buffer.from(pubKey.slice(2), 'hex')
  if (bytes.length !== 32) {
    throw new ReceiptError(`a receipt signer public key is 32 bytes, got ${bytes.length}`)
  }
  return createPublicKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', x: bytes.toString('base64url') },
  })
}

export interface ReceiptSigner {
  readonly publicKey: Hex
  /** Signs the 32 raw bytes of a hash, never its hex text. */
  sign(hash: Hex): Hex
}

export function createSigner(): ReceiptSigner {
  const configured = process.env.RECEIPT_SIGNER_PRIVATE_KEY?.trim()
  let privateKey: KeyObject
  let publicKey: KeyObject

  if (configured !== undefined && configured.length > 0) {
    try {
      privateKey = createPrivateKey({
        key: Buffer.from(configured, 'base64'),
        format: 'der',
        type: 'pkcs8',
      })
      publicKey = createPublicKey(privateKey)
    } catch (err) {
      throw new ReceiptError('RECEIPT_SIGNER_PRIVATE_KEY is not a base64 PKCS8 Ed25519 key', {
        cause: err,
      })
    }
  } else {
    const pair = generateKeyPairSync('ed25519')
    privateKey = pair.privateKey
    publicKey = pair.publicKey
  }

  const exported = rawPublicKey(publicKey)
  return {
    publicKey: exported,
    sign(hash: Hex): Hex {
      const signature = nodeSign(null, hexToBytes(hash), privateKey)
      return `0x${signature.toString('hex')}`
    },
  }
}

/**
 * Verifies a signature against a public key and nothing else.
 *
 * No chain, no store, no other project state: hand someone a receipt and they can check it. Any
 * malformed input is a failed verification rather than a throw, because a verifier that crashes on a
 * bad receipt cannot report which receipt was bad.
 */
export function verifySignature(hash: Hex, sig: Hex, signerPubKey: Hex): boolean {
  try {
    const signature = Buffer.from(sig.slice(2), 'hex')
    if (signature.length !== 64) return false
    return nodeVerify(null, hexToBytes(hash), publicKeyFromHex(signerPubKey), signature)
  } catch {
    return false
  }
}

/** Exports a generated key so the operator can pin one signer across restarts. */
export function exportSignerKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519')
  return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
}
