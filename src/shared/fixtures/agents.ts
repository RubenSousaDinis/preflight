/**
 * Agent-side fixtures: cards, grades, and validation records.
 *
 * Three agents, because those are the three rows beat 1 needs: one that passes, one that fails on
 * its letter, and one whose letter is fine and whose live surface moved. The third is the row a
 * judge will probe, so it exists in the fixture set from the first hour.
 *
 * TODO-INTEGRATE: agent ids and endpoints are replaced by D1's registered agents and E1's URL.
 */

import { scoreForGrade } from '../grade.ts'
import type { AgentCard, EvidenceBundle, GradeResult, ToolSurface, ValidationRecord } from '../types.ts'
import {
  FIXTURE_ENGINE_VERSION,
  FIXTURE_METHODOLOGY_VERSION,
  FIXTURE_RAN_AT,
  FIXTURE_OTHER_VALIDATOR,
  FIXTURE_VALIDATOR,
  fixtureHash,
} from './seed.ts'

export const FIXTURE_AGENT_A = 'fixture-agent-a'
export const FIXTURE_AGENT_F = 'fixture-agent-f'
export const FIXTURE_AGENT_DRIFTED = 'fixture-agent-drifted'

function card(agentId: string, name: string, path: string): AgentCard {
  const raw = {
    name,
    description: 'Fixture card. Replaced by a registered card at D1.',
    service: [{ type: 'mcp', url: `https://fixture.invalid/${path}/mcp` }],
    skills: ['fixture.summarize'],
  }
  return {
    agentId,
    name,
    mcpEndpoints: [`https://fixture.invalid/${path}/mcp`],
    skillRefs: ['fixture.summarize'],
    raw,
    tokenURI: `https://fixture.invalid/${path}/card.json`,
  }
}

export const FIXTURE_CARD_A: AgentCard = card(FIXTURE_AGENT_A, 'Fixture agent, graded A', 'agent-a')
export const FIXTURE_CARD_F: AgentCard = card(FIXTURE_AGENT_F, 'Fixture agent, graded F', 'agent-f')
export const FIXTURE_CARD_DRIFTED: AgentCard = card(
  FIXTURE_AGENT_DRIFTED,
  'Fixture agent, graded A, surface moved',
  'agent-drifted',
)

function toolSurface(endpoint: string, toolNames: string[]): ToolSurface {
  return {
    endpoint,
    pages: [
      {
        cursor: null,
        tools: toolNames.map((name) => ({
          name,
          description: `Fixture tool ${name}`,
          inputSchema: { type: 'object', properties: {} },
        })),
      },
    ],
    toolCount: toolNames.length,
  }
}

function bundle(cardValue: AgentCard, grade: 'A' | 'F', toolNames: string[]): EvidenceBundle {
  const endpoint = cardValue.mcpEndpoints[0]
  return {
    schema: 'preflight-evidence-v1',
    agentId: cardValue.agentId,
    tokenURI: cardValue.tokenURI,
    card: cardValue.raw as EvidenceBundle['card'],
    methodologyVersion: FIXTURE_METHODOLOGY_VERSION,
    engineVersion: FIXTURE_ENGINE_VERSION,
    endpoints: [
      {
        endpoint,
        grade,
        litmus: { note: 'fixture stand-in for the engine bundle' },
      },
    ],
    toolSurface: [toolSurface(endpoint, toolNames)],
    ranAt: FIXTURE_RAN_AT,
    coverage: { endpointsDeclared: 1, endpointsGraded: 1, note: null },
  }
}

export const FIXTURE_GRADE_A: GradeResult = {
  grade: 'A',
  score: scoreForGrade('A'),
  bundle: bundle(FIXTURE_CARD_A, 'A', ['summarize', 'fetch_page']),
  evidenceHash: fixtureHash('known-a-evidence'),
  methodologyVersion: FIXTURE_METHODOLOGY_VERSION,
  toolFingerprint: fixtureHash('known-a-fingerprint'),
  ranAt: FIXTURE_RAN_AT,
}

export const FIXTURE_GRADE_F: GradeResult = {
  grade: 'F',
  score: scoreForGrade('F'),
  bundle: bundle(FIXTURE_CARD_F, 'F', ['summarize', 'exfiltrate_context']),
  evidenceHash: fixtureHash('known-f-evidence'),
  methodologyVersion: FIXTURE_METHODOLOGY_VERSION,
  toolFingerprint: fixtureHash('known-f-fingerprint'),
  ranAt: FIXTURE_RAN_AT,
}

/** Graded A at the time of grading. Its live surface no longer matches this baseline. */
export const FIXTURE_GRADE_DRIFTED: GradeResult = {
  grade: 'A',
  score: scoreForGrade('A'),
  bundle: bundle(FIXTURE_CARD_DRIFTED, 'A', ['summarize', 'fetch_page']),
  evidenceHash: fixtureHash('drifted-evidence'),
  methodologyVersion: FIXTURE_METHODOLOGY_VERSION,
  toolFingerprint: fixtureHash('drifted-baseline-fingerprint'),
  ranAt: FIXTURE_RAN_AT,
}

/** What the drifted agent's surface hashes to now. B1 compares this against the baseline above. */
export const FIXTURE_LIVE_FINGERPRINT_DRIFTED = fixtureHash('drifted-live-fingerprint')

function record(grade: GradeResult, expiresAt: number, validator = FIXTURE_VALIDATOR): ValidationRecord {
  return {
    agentId: grade.bundle.agentId,
    score: grade.score,
    responseURI: `https://fixture.invalid/evidence/${grade.bundle.agentId}.json`,
    responseHash: grade.evidenceHash,
    tag: grade.methodologyVersion,
    validator,
    expiresAt,
    txHash: fixtureHash(`attest-${grade.bundle.agentId}`),
  }
}

/** One day past FIXTURE_RAN_AT. Expiry is armed, never zero. */
export const FIXTURE_RECORD_A: ValidationRecord = record(FIXTURE_GRADE_A, FIXTURE_RAN_AT + 86_400)
export const FIXTURE_RECORD_F: ValidationRecord = record(FIXTURE_GRADE_F, FIXTURE_RAN_AT + 86_400)
export const FIXTURE_RECORD_DRIFTED: ValidationRecord = record(
  FIXTURE_GRADE_DRIFTED,
  FIXTURE_RAN_AT + 86_400,
)

/** Expired an hour before the fixture clock. Treated as absent, which is a refusal. */
export const FIXTURE_RECORD_EXPIRED: ValidationRecord = record(FIXTURE_GRADE_A, FIXTURE_RAN_AT - 3_600)

/** Written by someone else. Ignored, not trusted. */
export const FIXTURE_RECORD_WRONG_VALIDATOR: ValidationRecord = record(
  FIXTURE_GRADE_A,
  FIXTURE_RAN_AT + 86_400,
  FIXTURE_OTHER_VALIDATOR,
)
