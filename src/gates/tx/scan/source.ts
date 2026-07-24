/**
 * Verified source for an address, fetched from the same explorer B5d reads status from.
 *
 * Two rules here, both from B6's edge cases. No verified source means no scan at all, which is a
 * rendered state rather than a clean result: an absence shown as "no findings" is the worst output
 * this path can produce. And oversized source is truncated at a fixed byte budget, recorded in the
 * finding, so a re-run against a longer file is explainable rather than surprising.
 */

import { getAddress } from 'viem'
import type { Address, ChainId } from '../../../shared/types.ts'

const SOURCIFY = 'https://sourcify.dev/server/v2/contract'
const FETCH_TIMEOUT_MS = 10_000

/**
 * The truncation budget, in bytes of concatenated source.
 *
 * One number, written down (B6 open question 2). 60 KB fits every fixture here whole and stays
 * well inside any model's context, so a truncated scan is a real event rather than the norm.
 */
export const SOURCE_BUDGET_BYTES = 60_000

export interface VerifiedSource {
  chainId: ChainId
  address: Address
  /** Concatenated source, in path order, so two runs of the same contract produce the same text. */
  text: string
  files: string[]
  truncated: boolean
  bytes: number
}

interface SourcifySources {
  sources?: Record<string, { content?: string }>
}

/** Deterministic: files in path order, cut at the budget, never sampled or summarized. */
export function assemble(
  sources: Record<string, { content?: string }>,
): { text: string; files: string[]; truncated: boolean; bytes: number } {
  const paths = Object.keys(sources).sort()
  const parts: string[] = []
  for (const path of paths) {
    const content = sources[path].content ?? ''
    parts.push(`// file: ${path}\n${content}`)
  }
  const full = parts.join('\n\n')
  const bytes = Buffer.byteLength(full, 'utf8')
  if (bytes <= SOURCE_BUDGET_BYTES) {
    return { text: full, files: paths, truncated: false, bytes }
  }
  return {
    text: Buffer.from(full, 'utf8').subarray(0, SOURCE_BUDGET_BYTES).toString('utf8'),
    files: paths,
    truncated: true,
    bytes,
  }
}

/** `null` means no published source, which is a state the surface names, not a clean result. */
export async function verifiedSourceOf(
  chainId: ChainId,
  address: Address,
): Promise<VerifiedSource | null> {
  const target = getAddress(address)
  let body: SourcifySources
  try {
    const response = await fetch(`${SOURCIFY}/${chainId}/${target}?fields=sources`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null
    body = (await response.json()) as SourcifySources
  } catch {
    // The advisory path is not a gate. A fetch that fails means not scanned, and the deterministic
    // verdict is entirely unaffected either way.
    return null
  }

  const sources = body.sources
  if (sources === undefined || Object.keys(sources).length === 0) return null

  const assembled = assemble(sources)
  // Verified but empty, or a stub. Scanning that and reporting clean is the failure this avoids.
  if (assembled.text.trim().length === 0) return null

  return { chainId, address: target, ...assembled }
}
