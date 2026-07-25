/**
 * Build ENS mirror text records from the ValidationRegistry only.
 *
 * Claim and sync both call this so a grade letter never appears on a name unless
 * the registry already carries that score. Empty return means "do not invent".
 */

import { publicAppOrigin, validationRegistry } from '../../shared/config.ts'
import { gradeForScore } from '../../shared/grade.ts'
import { configuredTopicId } from '../../receipts/hcs-mirror.ts'
import type { AgentId } from '../../shared/types.ts'
import { readValidationWithEvidence } from '../validation-registry.ts'
import { agentGradeUrl, buildTextRecords, type EnsKey } from './records.ts'

export interface RegistryMirrorRecords {
  records: Record<EnsKey, string>
  lastUpdate: number
  score: number
}

/**
 * Returns null when the agent has no validation record, or a score this
 * methodology does not map to a letter. Callers must not invent a substitute.
 */
export async function recordsFromValidationRegistry(
  agentId: AgentId,
  options: {
    receiptsHead?: `0x${string}` | null
    receiptsCount?: number | null
    /** Override the public app origin; tests inject a fixed host. */
    appOrigin?: string
  } = {},
): Promise<RegistryMirrorRecords | null> {
  const record = await readValidationWithEvidence(agentId, undefined, {
    includeExpired: true,
  })
  if (record === null) return null
  const grade = gradeForScore(record.score)
  if (grade === null) return null

  const registry = validationRegistry()
  const origin = options.appOrigin ?? publicAppOrigin()
  return {
    lastUpdate: record.lastUpdate,
    score: record.score,
    records: buildTextRecords({
      agentId,
      grade,
      score: record.score,
      evidenceURI: record.responseURI,
      evidenceHash: record.responseHash,
      registry: registry.address,
      chainId: registry.chainId,
      updatedAt: record.lastUpdate,
      methodology: record.tag,
      receiptsHead: options.receiptsHead ?? null,
      receiptsCount: options.receiptsCount ?? null,
      hcsTopic: configuredTopicId(),
      appUrl: agentGradeUrl(agentId, origin),
    }),
  }
}
