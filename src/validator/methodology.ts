/**
 * The methodology version, read from the installed engine at runtime.
 *
 * Never typed as a literal. Three sources reported three different answers before the event
 * (02-DECISIONS §2 recorded npm at 0.35.0, the plan at 0.31.0, a stale checkout at litmus-v13), and
 * the installed package on the day reports something else again. This value is written into an
 * onchain tag, where a wrong one cannot be corrected, so it is imported rather than written down.
 *
 * The import is static: if the package is missing, this module fails to load, which is the correct
 * failure. A dynamic read that degrades to a placeholder puts a plausible looking wrong tag onchain.
 */

import { BUNDLE_SCHEMA_VERSION, METHODOLOGY_VERSION } from '@polygraphso/litmus'

export function methodologyVersion(): string {
  return METHODOLOGY_VERSION
}

/** The engine's own evidence-bundle format version, recorded alongside ours. */
export function engineBundleSchemaVersion(): string {
  return BUNDLE_SCHEMA_VERSION
}
