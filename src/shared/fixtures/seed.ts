/**
 * Deterministic placeholder values for the fixture set.
 *
 * Every hash and address below is the hex encoding of its own label, right-padded with zeros. That
 * is deliberate: decode `0x6b6e6f776e2d61...` and it reads `known-a...`, so a fixture can never be
 * mistaken on screen for a real keccak256 or a real account. Fixtures are for building against a
 * seam that has not landed; they are replaced at the TODO-INTEGRATE points, never demoed as
 * evidence.
 */

import type { Address, Hex } from '../types.ts'

function hexOfLabel(label: string, byteLength: number): Hex {
  const encoded = Array.from(label)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
  return `0x${(encoded + '0'.repeat(byteLength * 2)).slice(0, byteLength * 2)}`
}

/** A 32-byte stand-in for a hash. */
export function fixtureHash(label: string): Hex {
  return hexOfLabel(label, 32)
}

/** A 20-byte stand-in for an account. Lowercase, so `getAddress` normalizes it without throwing. */
export function fixtureAddress(label: string): Address {
  return hexOfLabel(label, 20)
}

/** A 64-byte stand-in for an Ed25519 signature. */
export function fixtureSignature(label: string): Hex {
  return hexOfLabel(label, 64)
}

/** 2026-07-25T09:00:00Z, in unix seconds. Fixed so no fixture changes between two renders. */
export const FIXTURE_RAN_AT = 1_785_056_400

export const FIXTURE_VALIDATOR: Address = fixtureAddress('fixture-validator')
export const FIXTURE_OTHER_VALIDATOR: Address = fixtureAddress('other-validator')
export const FIXTURE_SIGNER_PUBKEY: Hex = fixtureHash('fixture-receipt-signer')

/** The methodology tag is read from the installed package at runtime; this is its fixture stand-in. */
export const FIXTURE_METHODOLOGY_VERSION = 'fixture-methodology'
export const FIXTURE_ENGINE_VERSION = 'fixture-engine'
