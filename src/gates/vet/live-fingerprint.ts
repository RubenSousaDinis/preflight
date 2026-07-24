/**
 * The live tool-surface fingerprint, recomputed at call time.
 *
 * This is the active recheck, not a cached lookup. 02-DECISIONS §8 keeps the free passive read and this
 * genuinely different operations, and implementing the recheck as a cached read for latency would
 * remove the one property the gate has that a grade lookup does not.
 *
 * Enumeration goes through the engine, which follows `tools/list` to the end of its cursor and refuses
 * rather than returning a partial surface. That matters more than it sounds: a server can park a
 * funds-moving tool behind a `nextCursor`, invisible to a one-page reader and served to a real agent, so
 * a capped read is an attacker-chosen parameter.
 *
 * Composition is A3a's, so the live value and the graded baseline are built by the same function. A
 * second serializer here would refuse everything and look like a gate bug.
 */

import { liveFingerprint as engineLiveFingerprint } from '@polygraphso/litmus'

import { FingerprintError } from '../../shared/errors.ts'
import type { Hex } from '../../shared/types.ts'
import { composeToolFingerprint } from '../../validator/grade-agent.ts'

export type FingerprintEndpointFn = (endpoint: string) => Promise<string>

export interface LiveFingerprintOptions {
  /** Injected enumerator, for tests and for a target the engine's guard would refuse. */
  fingerprintEndpoint?: FingerprintEndpointFn
  /** A3a's pre-authorized degrade: fingerprint the first declared endpoint only. */
  firstEndpointOnly?: boolean
}

/**
 * 01-INTERFACES §4. Throws when any endpoint or any page fails.
 *
 * Any failure makes the whole fingerprint unobtainable, which the gate reads as a refusal. A target
 * that stalls the recheck must not be cheaper to hire than one that answers.
 */
export async function liveFingerprint(
  endpoints: string[],
  options: LiveFingerprintOptions = {},
): Promise<Hex> {
  if (endpoints.length === 0) {
    throw new FingerprintError('there are no endpoints to fingerprint')
  }
  const targets = options.firstEndpointOnly ? endpoints.slice(0, 1) : endpoints
  const enumerate =
    options.fingerprintEndpoint ??
    (async (endpoint: string) => (await engineLiveFingerprint(endpoint)).fingerprint)

  const entries: { endpoint: string; fingerprint: string }[] = []
  for (const endpoint of targets) {
    let fingerprint: string
    try {
      fingerprint = await enumerate(endpoint)
    } catch (err) {
      throw new FingerprintError(`the live tool surface at ${endpoint} could not be enumerated`, {
        retryable: true,
        cause: err,
      })
    }
    entries.push({ endpoint, fingerprint })
  }
  return composeToolFingerprint(entries)
}
