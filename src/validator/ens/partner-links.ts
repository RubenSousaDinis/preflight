/**
 * Partner showcase links for 0G Storage and Hedera HCS.
 *
 * Used by ENS text records and the public agent page. Empty string means that
 * partner was not used for this grade / mirror, so UI and re-sync clear the key.
 * Pure: no env, no chain.
 */

/** Keep in sync with `EVIDENCE_URI_MAX_CHARS` in records.ts (avoid an import cycle). */
const EVIDENCE_URI_MAX_CHARS = 512

/** True when the evidence URI is a 0G Storage retrieval URL. */
export function isZerogEvidenceUri(uri: string): boolean {
  const trimmed = uri.trim()
  if (trimmed.length === 0) return false
  try {
    const host = new URL(trimmed).hostname.toLowerCase()
    return host === '0g.ai' || host.endsWith('.0g.ai')
  } catch {
    return /(?:^|[/.])0g\.ai(?:\/|$)/i.test(trimmed)
  }
}

/**
 * ENS / UI link for 0G evidence. Empty when the URI is not 0G or is too long
 * for a text record (same cap as `preflight.evidence`).
 */
export function zerogShowcaseUrl(evidenceUri: string): string {
  const trimmed = evidenceUri.trim()
  if (!isZerogEvidenceUri(trimmed)) return ''
  if (trimmed.length > EVIDENCE_URI_MAX_CHARS) return ''
  return trimmed
}

/** HashScan (Hedera testnet) for an HCS topic id. Empty when no topic. */
export function hederaTopicExplorerUrl(topicId: string | null | undefined): string {
  const id = topicId?.trim() ?? ''
  if (id.length === 0) return ''
  return `https://hashscan.io/testnet/topic/${id}`
}
