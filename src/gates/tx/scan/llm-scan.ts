/**
 * B6: the LLM source scan, advisory only.
 *
 * Every flag this file emits carries `confirmedBy: 'llm-scan'` and `severity: 'advisory'`, stamped
 * in exactly one place. A rule enforced at every call site is a rule that gets missed at one call
 * site, so `advisory` is applied by construction here and checked again when the verdict is
 * composed (01-INTERFACES section 8 and section 9).
 *
 * Both directions of that rule matter. A jailbroken scan cannot manufacture a block, and it cannot
 * suppress one either, because it was never in the blocking path to begin with. That is fail closed
 * by architecture rather than by prompt hardening, and D3's injection fixture is the proof rather
 * than the test of it.
 *
 * This scan is deliberately NOT registered as a detector. Its findings sit beside the verdict, not
 * inside it: model output is not reproducible, so it must not sit inside the thing that claims to
 * be. Two runs may disagree, and saying that out loud is stronger than implying stability.
 */

import type { Address, ChainId, Flag, FlagId } from '../../../shared/types.ts'
import { SCAN_IDS, activeRoute, type ScanCandidate, type ScanRoute } from './routes.ts'
import { SOURCE_BUDGET_BYTES, verifiedSourceOf } from './source.ts'

function isFlagId(value: string): value is FlagId {
  return (SCAN_IDS as string[]).includes(value)
}

/**
 * The single stamp.
 *
 * Nothing else in this file constructs a `Flag`. Model output cannot choose its own severity, its
 * own provenance, or an id outside the closed four: a candidate naming a fifth risk is discarded
 * rather than widening the set, because letting a model name a new flag turns this into a general
 * auditor by accident.
 */
export function stampAdvisory(
  candidates: ScanCandidate[],
): { flags: Flag[]; discarded: string[] } {
  const flags: Flag[] = []
  const discarded: string[] = []

  for (const candidate of candidates) {
    if (!isFlagId(candidate.id)) {
      discarded.push(candidate.id)
      continue
    }
    flags.push({
      id: candidate.id,
      severity: 'advisory',
      title: candidate.title.trim().length > 0 ? candidate.title : candidate.id,
      detail: candidate.detail,
      confirmedBy: 'llm-scan',
    })
  }

  return { flags, discarded }
}

/**
 * The section 11 signature: scan source text for an address, return advisory flags.
 *
 * Every failure resolves to `[]`. The advisory path is not a gate, so it failing must not block,
 * and an empty list is not a clean bill of health either. `scanAddress` is what a surface should
 * call, because it can tell those two apart.
 */
export async function llmScan(
  source: string,
  address: Address,
  route: ScanRoute | null = activeRoute(),
): Promise<Flag[]> {
  if (route === null) return []
  try {
    return stampAdvisory(await route.propose(source, address)).flags
  } catch {
    return []
  }
}

export interface ScanReport {
  /** `'not-scanned'` is a rendered state. An absence must never read as a clean result. */
  state: 'scanned' | 'not-scanned'
  /** Which route ran, for the log and the panel. */
  route: string | null
  reason: string | null
  flags: Flag[]
  /** One line per finding, plain English, for the panel to print beside the verdict. */
  findings: string[]
  discarded: string[]
}

function notScanned(reason: string, route: string | null = null): ScanReport {
  return { state: 'not-scanned', route, reason, flags: [], findings: [], discarded: [] }
}

/**
 * Fetch verified source for an address and scan it.
 *
 * The states this can end in are all distinct on purpose: not verified, not configured, the model
 * failed, scanned and found nothing, scanned and found something. Collapsing any of them into
 * "clean" is the failure mode this whole task exists to avoid.
 */
export async function scanAddress(
  chainId: ChainId,
  address: Address,
  route: ScanRoute | null = activeRoute(),
  fetchSource: typeof verifiedSourceOf = verifiedSourceOf,
): Promise<ScanReport> {
  if (route === null) {
    return notScanned('no inference route is configured, so no scan ran')
  }

  const source = await fetchSource(chainId, address)
  if (source === null) {
    return notScanned('this address has no published source, so there was nothing to scan')
  }

  let candidates: ScanCandidate[]
  try {
    candidates = await route.propose(source.text, address)
  } catch (err) {
    return notScanned(
      `the scan did not complete: ${err instanceof Error ? err.message : 'unknown failure'}`,
      route.name,
    )
  }

  const { flags, discarded } = stampAdvisory(candidates)
  const findings = flags.map((flag) => `${flag.title}. ${flag.detail}`)
  if (source.truncated) {
    findings.push(
      `Source was truncated at ${SOURCE_BUDGET_BYTES} bytes of ${source.bytes} for this scan, so anything past that point was not read.`,
    )
  }

  return {
    state: 'scanned',
    route: route.name,
    reason: null,
    flags,
    findings,
    discarded,
  }
}
