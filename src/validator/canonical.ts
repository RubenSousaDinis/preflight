/**
 * The canonical form, and the hash over it.
 *
 * One implementation, imported everywhere. Two implementations of a canonical form is two canonical
 * forms, and the failure shows up later as every gate refusing, which reads as a gate bug rather than
 * a serialization bug. The rules are stated rather than inherited:
 *
 * - Object keys are sorted, recursively, by UTF-16 code unit, which is what `Array#sort` compares.
 * - Array order is preserved. The bundle already fixes it.
 * - Numbers must be safe integers. A float, a NaN, an Infinity, or an integer past 2^53 throws
 *   rather than serializing, because two writers disagree about those and neither looks wrong.
 * - Strings keep their raw code points. No NFC, no NFKC. Unicode normalization would collapse
 *   distinct byte sequences into one hash, and hidden-character tampering is exactly what has to
 *   change the hash.
 * - `undefined`, a bigint, a function, a symbol, a Date, a Map, or any other non-plain object throws.
 *   Silently dropping an undefined field is how a bundle and its hash stop describing each other.
 * - No whitespace, no indentation, no trailing newline.
 *
 * The engine ships its own `canonicalStringify` with the same intent. This is not a wrapper around it
 * on purpose: our hash goes into an onchain tag, so the form has to be ours and pinned. A test
 * asserts the two agree byte for byte on every fixture, so a divergence surfaces as a failing test
 * rather than as an unverifiable attestation.
 */

import { keccak256, stringToBytes } from 'viem'

import { GradeError } from '../shared/errors.ts'
import type { EvidenceBundle, Hex } from '../shared/types.ts'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

function write(value: unknown, out: string[], path: string): void {
  if (value === null) {
    out.push('null')
    return
  }
  switch (typeof value) {
    case 'boolean':
      out.push(value ? 'true' : 'false')
      return
    case 'string':
      // JSON.stringify escapes exactly what JSON requires and leaves every other code point raw,
      // including lone surrogates, which it emits as escapes. Deterministic across engines.
      out.push(JSON.stringify(value))
      return
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new GradeError(
          `${path} is ${String(value)}, and the canonical form carries safe integers only, never floats`,
        )
      }
      out.push(String(value))
      return
    case 'bigint':
      throw new GradeError(`${path} is a bigint; encode it as a decimal string before canonicalizing`)
    case 'undefined':
      throw new GradeError(`${path} is undefined, which the canonical form does not drop silently`)
    default:
      break
  }

  if (Array.isArray(value)) {
    out.push('[')
    value.forEach((entry, index) => {
      if (index > 0) out.push(',')
      write(entry, out, `${path}[${index}]`)
    })
    out.push(']')
    return
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort()
    out.push('{')
    keys.forEach((key, index) => {
      if (index > 0) out.push(',')
      out.push(JSON.stringify(key))
      out.push(':')
      write(value[key], out, `${path}.${key}`)
    })
    out.push('}')
    return
  }

  throw new GradeError(
    `${path} is a ${Object.prototype.toString.call(value)}, which has no canonical form here`,
  )
}

/** The canonical string. Accepts any value so the rules are enforced at runtime, where they matter. */
export function canonicalizeValue(value: unknown): string {
  const out: string[] = []
  write(value, out, '$')
  return out.join('')
}

/** 01-INTERFACES §2. Byte identical between the write path and any verify path. */
export function canonicalize(bundle: EvidenceBundle): string {
  return canonicalizeValue(bundle)
}

/** keccak256 over the canonical bundle, matching the chain's hash at the boundary. */
export function evidenceHash(bundle: EvidenceBundle): Hex {
  return hashCanonical(canonicalize(bundle))
}

export function hashCanonical(canonical: string): Hex {
  return keccak256(stringToBytes(canonical))
}

/**
 * Converts an engine value into plain JSON before it enters the bundle.
 *
 * The engine's bundle is defined as a JSON document, but an optional field that is present and set to
 * `undefined` would make the canonical form throw. This drops exactly those, which is the same
 * transform serializing the document to JSON already applies, and it throws on anything JSON cannot
 * hold rather than guessing.
 */
export function toJsonValue(value: unknown, what: string): import('../shared/types.ts').JsonValue {
  let text: string
  try {
    text = JSON.stringify(value)
  } catch (err) {
    throw new GradeError(`${what} is not JSON, so it cannot be hashed as evidence`, { cause: err })
  }
  if (text === undefined) {
    throw new GradeError(`${what} serialized to nothing, so there is no evidence to hash`)
  }
  return JSON.parse(text) as import('../shared/types.ts').JsonValue
}
