/**
 * D5d: the text records that mirror one validation record.
 *
 * **These records are a mirror, never a source.** The ValidationRegistry holds the grade; this is a
 * copy of it published where a resolver can answer for it. A reader that trusted a text record over
 * the registry has inverted the trust order of the whole product, so the `description` record says so
 * in words, on the name itself, and the UI repeats it beside every value that came from here.
 *
 * The builder always emits every key. A value that is absent is written as an empty string rather
 * than skipped, because a re-sync has to be able to clear a record that a previous sync set: skipping
 * it would leave last week's evidence URI on a name whose grade has since moved.
 *
 * Pure. Nothing here reads a chain, an environment variable, or a key.
 */

import { getAddress } from 'viem'

import type { Address, AgentId, ChainId, Grade, Hex } from '../../shared/types.ts'
import { hederaTopicExplorerUrl, zerogShowcaseUrl } from './partner-links.ts'

/**
 * Every key this project writes, in the order they are written.
 *
 * The spelling lives here and nowhere else. Two surfaces inventing two spellings of the same key is
 * drift within hours, and the reader of the second one sees a name with no grade on it.
 *
 * `url` is the standard ENS text key a profile reader surfaces under Records. It points at the
 * Preflight page that shows the live grade and evidence; it is still a pointer, not a source. Note
 * that no L1 reader sees it: these names answer on the Base Sepolia Basenames resolver only, and
 * resolving one through L1 returns null for every key here.
 *
 * `preflight.zerog` and `preflight.hedera` are partner showcase links: set only when that stack was
 * actually used (0G evidence URI, or an HCS receipt-mirror topic), cleared on re-sync otherwise.
 */
export const ENS_KEYS = [
  'preflight.grade',
  'preflight.score',
  'preflight.evidence',
  'preflight.evidenceHash',
  'preflight.registry',
  'preflight.agentId',
  'preflight.updatedAt',
  'preflight.methodology',
  'preflight.receipts.head',
  'preflight.receipts.count',
  'preflight.hcsTopic',
  'preflight.zerog',
  'preflight.hedera',
  'url',
  'description',
] as const

export type EnsKey = (typeof ENS_KEYS)[number]

/**
 * How long an evidence URI may be before the record carries only its hash.
 *
 * Evidence is pinned as a `data:` URI when no pinning provider is configured, and those run to tens
 * of kilobytes. Writing one into a text record would cost more gas than the rest of the sync put
 * together and tell a reader nothing they could not get from the registry. Over the cap the key is
 * cleared and `preflight.evidenceHash`, which is always written, is what a reader checks against.
 */
export const EVIDENCE_URI_MAX_CHARS = 512

/** Path on the Preflight app that shows grade and evidence for one agent. */
export function agentGradePath(agentId: AgentId): string {
  return `/a/${agentId}`
}

/** Absolute URL for that page. `origin` has no trailing slash. */
export function agentGradeUrl(agentId: AgentId, origin: string): string {
  const base = origin.replace(/\/+$/, '')
  return `${base}${agentGradePath(agentId)}`
}

/** `eip155:{chainId}:{checksummedAddress}`, the pointer at what these records copy. */
export function sourcePointer(chainId: ChainId, registry: Address): string {
  return `eip155:${chainId}:${getAddress(registry)}`
}

export interface TextRecordInput {
  agentId: AgentId
  grade: Grade
  score: number
  /** The registry's `responseURI`. Written only when short enough to belong in a text record. */
  evidenceURI: string
  evidenceHash: Hex
  registry: Address
  chainId: ChainId
  /** The registry's `lastUpdate`, in unix seconds. The mirror never invents its own timestamp. */
  updatedAt: number
  methodology: string
  /** The head of the receipt chain at the time of the sync, when there is one. */
  receiptsHead?: Hex | null
  receiptsCount?: number | null
  hcsTopic?: string | null
  /**
   * Public Preflight page for this agent (grade + evidence). Written to the standard ENS `url`
   * record when present. Empty string clears a stale link on re-sync.
   */
  appUrl?: string | null
}

/**
 * The sentence on the name itself.
 *
 * It names the registry record as the thing to check, because someone who arrives at these records
 * through a name resolver has no other way of knowing that this is the copy and not the original.
 */
export function describeMirror(pointer: string, appUrl?: string | null): string {
  const base = `A mirror of the Preflight validation record at ${pointer}, which is the source. These text records are a copy of it and never the thing to trust; read the registry to check them.`
  if (appUrl !== undefined && appUrl !== null && appUrl.length > 0) {
    return `${base} Grade and evidence: ${appUrl}.`
  }
  return base
}

/** Every key, in order, with an empty string wherever a value is absent. */
export function buildTextRecords(input: TextRecordInput): Record<EnsKey, string> {
  const pointer = sourcePointer(input.chainId, input.registry)
  const appUrl = input.appUrl ?? ''
  const hcsTopic = input.hcsTopic ?? ''
  const evidence =
    input.evidenceURI.length > 0 && input.evidenceURI.length <= EVIDENCE_URI_MAX_CHARS
      ? input.evidenceURI
      : ''

  return {
    'preflight.grade': input.grade,
    'preflight.score': String(input.score),
    'preflight.evidence': evidence,
    'preflight.evidenceHash': input.evidenceHash,
    'preflight.registry': pointer,
    'preflight.agentId': input.agentId,
    'preflight.updatedAt': String(input.updatedAt),
    'preflight.methodology': input.methodology,
    'preflight.receipts.head': input.receiptsHead ?? '',
    'preflight.receipts.count':
      input.receiptsCount === undefined || input.receiptsCount === null
        ? ''
        : String(input.receiptsCount),
    'preflight.hcsTopic': hcsTopic,
    'preflight.zerog': zerogShowcaseUrl(input.evidenceURI),
    'preflight.hedera': hederaTopicExplorerUrl(hcsTopic),
    url: appUrl,
    description: describeMirror(pointer, appUrl),
  }
}
