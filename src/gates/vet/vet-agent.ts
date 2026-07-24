/**
 * B1: the agent boundary. An agent is hired only when a record from our validator, the evidence behind
 * it, and the agent's live tool surface all agree right now.
 *
 * The order of the checks is the design, not an implementation detail:
 *
 * 1. The record, filtered to our validator, before anything is fetched. An unfiltered read lets anyone
 *    self-attest a passing score onto any agent, which turns the registry into a suggestion box.
 * 2. Expiry, against the wall clock, tightened by the policy. Expired is treated as absent.
 * 3. The evidence at `responseURI`, fetched and hashed. The score is a number; the bundle is the
 *    reason. Trusting the number alone drops the reproducibility claim.
 * 4. The live surface, every page, compared to the baseline derived from that evidence.
 * 5. The letter, last, so a drift refusal always reports drift rather than a grade.
 *
 * Every error path returns REFUSE. `fingerprintMatch: null` is a refusal, not an abstention: no verdict
 * here may be read as permission.
 */

import { getAddress } from 'viem'

import { reasonOf } from '../../shared/errors.ts'
import { validatorAddress } from '../../shared/config.ts'
import { gradeForScore, meetsMinGrade } from '../../shared/grade.ts'
import type {
  Address,
  AgentId,
  EvidenceBundle,
  GateDecision,
  GatePolicy,
  Grade,
  Hex,
  ValidationRecord,
} from '../../shared/types.ts'
import { resolveAgent, type ResolveAgentOptions } from '../../validator/resolve-agent.ts'
import { baselineToolFingerprint } from '../../validator/grade-agent.ts'
import { canonicalizeValue, hashCanonical } from '../../validator/canonical.ts'
import {
  readForeignValidators,
  readValidationWithEvidence,
  type ReadOptions,
} from '../../validator/validation-registry.ts'
import { fetchPublishedEvidence } from '../../validator/pin-evidence.ts'
import type { ReceiptChain } from '../../receipts/receipt-chain.ts'
import { liveFingerprint, type LiveFingerprintOptions } from './live-fingerprint.ts'

/** 01-INTERFACES §4: minGrade defaults to B. The staleness bound is a day, longer than the event. */
export const DEFAULT_POLICY: GatePolicy = { minGrade: 'B', maxAgeSeconds: 86_400 }

export interface VetAgentOptions extends LiveFingerprintOptions {
  read?: ReadOptions
  resolve?: ResolveAgentOptions
  validator?: Address
  now?: number
  /** Emits a receipt for the decision, hire or refuse. */
  receipts?: ReceiptChain
  /** Injected readers, for tests. */
  readRecord?: (agentId: AgentId) => Promise<GateRecord | null>
  fetchEvidence?: (uri: string) => Promise<string>
  resolveEndpoints?: (agentId: AgentId) => Promise<string[]>
}

/** What the gate needs from a record: §3's fields, plus `lastUpdate` for the policy bound. */
export type GateRecord = ValidationRecord & { lastUpdate?: number; requestHash?: Hex }

function refuse(
  reason: string,
  parts: Partial<GateDecision> = {},
): GateDecision {
  return {
    verdict: 'REFUSE',
    reason,
    grade: parts.grade ?? null,
    score: parts.score ?? null,
    fingerprintMatch: parts.fingerprintMatch ?? null,
    record: parts.record ?? null,
  }
}

async function withReceipt(
  decision: GateDecision,
  options: VetAgentOptions,
): Promise<GateDecision> {
  if (options.receipts !== undefined) {
    // A gate that records only its approvals has no evidence it ever refused anything.
    await options.receipts.emit(decision, {
      evidenceURI: decision.record?.responseURI ?? null,
    })
  }
  return decision
}

export async function vetAgent(
  agentId: AgentId,
  policy: GatePolicy = DEFAULT_POLICY,
  options: VetAgentOptions = {},
): Promise<GateDecision> {
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const validator = getAddress(options.validator ?? validatorAddress())

  // --- 1. the record, filtered to our validator -----------------------------
  let record: GateRecord | null
  try {
    record =
      options.readRecord !== undefined
        ? await options.readRecord(agentId)
        : await readValidationWithEvidence(agentId, validator, {
            ...options.read,
            now,
            includeExpired: true,
          })
  } catch (err) {
    // A gate that cannot read its source of truth has no basis to hire.
    return withReceipt(
      refuse(`the validation registry could not be read: ${reasonOf(err)}`),
      options,
    )
  }

  if (record === null) {
    // Naming a foreign record is better for the operator than reporting a bare absence, and it never
    // affects the decision: the trusted read already returned nothing.
    let foreign: Address[] = []
    try {
      foreign =
        options.readRecord !== undefined
          ? []
          : await readForeignValidators(agentId, validator, { ...options.read })
    } catch {
      foreign = []
    }
    if (foreign.length > 0) {
      return withReceipt(
        refuse(
          `agent ${agentId} carries a record from ${foreign.join(', ')}, not from the validator this gate trusts (${validator})`,
        ),
        options,
      )
    }
    return withReceipt(
      refuse(`no validation record from ${validator} for agent ${agentId}, so there is nothing to check`),
      options,
    )
  }

  if (record.validator !== validator) {
    return withReceipt(
      refuse(
        `the record for agent ${agentId} was written by ${record.validator}, not by the validator this gate trusts (${validator})`,
        { record },
      ),
      options,
    )
  }

  // --- 2. expiry, tightened by the policy -----------------------------------
  // The tighter of the two bounds, per B1's open question 2. The registry stores no expiry, so
  // `expiresAt` is the reader's derived bound and `lastUpdate + maxAgeSeconds` is the policy's.
  const policyExpiry =
    record.lastUpdate !== undefined && Number.isFinite(policy.maxAgeSeconds)
      ? record.lastUpdate + policy.maxAgeSeconds
      : record.expiresAt
  const effectiveExpiry = Math.min(record.expiresAt, policyExpiry)
  if (effectiveExpiry <= now) {
    return withReceipt(
      refuse(
        `the validation record for agent ${agentId} expired at ${effectiveExpiry}, and an expired record is treated as absent`,
        { record },
      ),
      options,
    )
  }

  const attested = gradeForScore(record.score)
  if (attested === null) {
    return withReceipt(
      refuse(
        `the record for agent ${agentId} carries score ${record.score}, which is not a value this methodology writes`,
        { record },
      ),
      options,
    )
  }

  // --- 3. the evidence behind the record ------------------------------------
  if (record.responseURI.trim().length === 0) {
    return withReceipt(
      refuse(
        `the record for agent ${agentId} points at no evidence, and a record with no evidence is a claim`,
        { record, grade: attested, score: record.score },
      ),
      options,
    )
  }

  let evidenceText: string
  try {
    evidenceText =
      options.fetchEvidence !== undefined
        ? await options.fetchEvidence(record.responseURI)
        : await fetchPublishedEvidence(record.responseURI)
  } catch (err) {
    return withReceipt(
      refuse(
        `the evidence at ${record.responseURI.slice(0, 80)} could not be retrieved, so the record could not be checked: ${reasonOf(err)}`,
        { record, grade: attested, score: record.score },
      ),
      options,
    )
  }

  let bundle: EvidenceBundle
  let recomputed: Hex
  try {
    const parsed: unknown = JSON.parse(evidenceText)
    recomputed = hashCanonical(canonicalizeValue(parsed))
    bundle = parsed as EvidenceBundle
  } catch (err) {
    return withReceipt(
      refuse(
        `the evidence at ${record.responseURI.slice(0, 80)} is not a canonical bundle: ${reasonOf(err)}`,
        { record, grade: attested, score: record.score },
      ),
      options,
    )
  }

  if (recomputed.toLowerCase() !== record.responseHash.toLowerCase()) {
    // Either the bundle was swapped or canonicalization diverged. Both refuse; only the log tells them
    // apart, and it never falls back to trusting the onchain score alone.
    return withReceipt(
      refuse(
        `evidence hash mismatch for agent ${agentId}: the published bundle hashes to ${recomputed}, the record says ${record.responseHash}`,
        { record, grade: attested, score: record.score },
      ),
      options,
    )
  }

  // --- 4. the live surface, every page --------------------------------------
  let baseline: Hex
  try {
    baseline = baselineToolFingerprint(bundle)
  } catch (err) {
    return withReceipt(
      refuse(
        `the evidence for agent ${agentId} records no usable tool surface, so there is no baseline to compare: ${reasonOf(err)}`,
        { record, grade: attested, score: record.score },
      ),
      options,
    )
  }

  let endpoints: string[]
  try {
    endpoints =
      options.resolveEndpoints !== undefined
        ? await options.resolveEndpoints(agentId)
        : (await resolveAgent(agentId, options.resolve)).mcpEndpoints
  } catch (err) {
    return withReceipt(
      refuse(
        `agent ${agentId} could not be resolved, so its live surface could not be read: ${reasonOf(err)}`,
        { record, grade: attested, score: record.score },
      ),
      options,
    )
  }

  let live: Hex
  try {
    live = await liveFingerprint(endpoints, options)
  } catch (err) {
    return withReceipt(
      refuse(
        `the live tool surface of agent ${agentId} could not be enumerated, so drift could not be ruled out: ${reasonOf(err)}`,
        { record, grade: attested, score: record.score },
      ),
      options,
    )
  }

  if (live !== baseline) {
    // Drift outranks the letter. The letter is a claim about a past surface; drift says the surface is
    // no longer that one, so the letter no longer describes the target. The grade stays populated, so
    // the row reads "grade A" next to "REFUSE", which is the point rather than an untidiness.
    return withReceipt(
      refuse(
        `graded ${attested}, but the live tool surface of agent ${agentId} no longer matches the surface that was graded (live ${live.slice(0, 18)}…, graded ${baseline.slice(0, 18)}…)`,
        { record, grade: attested, score: record.score, fingerprintMatch: false },
      ),
      options,
    )
  }

  // --- 5. the letter, last --------------------------------------------------
  if (!meetsMinGrade(attested, policy.minGrade)) {
    return withReceipt(
      refuse(`grade ${attested} is below the minimum of ${policy.minGrade}`, {
        record,
        grade: attested,
        score: record.score,
        fingerprintMatch: true,
      }),
      options,
    )
  }

  return withReceipt(
    {
      verdict: 'HIRE',
      reason: `grade ${attested} meets the minimum of ${policy.minGrade}, the evidence hashes to the record, and the live tool surface matches the surface that was graded`,
      grade: attested,
      score: record.score,
      fingerprintMatch: true,
      record,
    },
    options,
  )
}

export type { Grade }
