/**
 * Reloads a bundle written by another process, canonicalizes it, and prints the hash.
 *
 * This exists to be run as a separate process. Canonicalizing twice inside one process proves nothing
 * about key insertion order surviving a write and a reload, and if the form is not byte identical
 * across processes then every gate refuses and the failure presents as a gate bug rather than as a
 * serialization bug. Two processes is the check; one is a rehearsal.
 *
 *   node src/validator/canonical-roundtrip.ts <path-to-bundle.json>
 *
 * Prints two lines: the hash, then the canonical byte length.
 */

import { readFileSync } from 'node:fs'

import { reasonOf } from '../shared/errors.ts'
import { canonicalizeValue, hashCanonical } from './canonical.ts'

function main(): void {
  const path = process.argv[2]
  if (path === undefined) {
    console.error('usage: canonical-roundtrip.ts <path-to-bundle.json>')
    process.exitCode = 1
    return
  }
  const reloaded: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const canonical = canonicalizeValue(reloaded)
  console.log(hashCanonical(canonical))
  console.log(String(Buffer.byteLength(canonical)))
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('canonical-roundtrip.ts') || entry.endsWith('canonical-roundtrip.js')) {
  try {
    main()
  } catch (err) {
    console.error(reasonOf(err))
    process.exitCode = 1
  }
}
