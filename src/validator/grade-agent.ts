/**
 * A3a: a resolved AgentCard becomes a letter, a score, and an evidence bundle whose canonical hash
 * any independent reader recomputes byte for byte.
 *
 * The engine does the grading. This module runs it across every endpoint the card declares, composes
 * the evidence, and pins the two hashes the rest of the system reads: `evidenceHash` over the
 * canonical bundle, and `toolFingerprint` over the surface that was actually graded.
 *
 * Nothing here holds a key. The whole task is offline in the sense that matters: it is runnable before
 * any wallet is funded, which is why A3 was split in two.
 */

import {
  runLitmus,
  type EvidenceBundle as LitmusBundle,
  type RunLitmusOptions,
} from '@polygraphso/litmus'

import { GradeError } from '../shared/errors.ts'
import { gradeRank, isGrade, scoreForGrade } from '../shared/grade.ts'
import type {
  AgentCard,
  EndpointEvidence,
  EvidenceBundle,
  Grade,
  GradeResult,
  Hex,
  JsonValue,
  ToolSurface,
} from '../shared/types.ts'
import { canonicalizeValue, evidenceHash, hashCanonical, toJsonValue } from './canonical.ts'
import { methodologyVersion } from './methodology.ts'

const FINGERPRINT_PATTERN = /^0x[0-9a-f]{64}$/

export type RunLitmusFn = (endpoint: string, opts?: RunLitmusOptions) => Promise<LitmusBundle>

export interface GradeAgentOptions {
  /** Wall-clock ceiling for one endpoint's run. An unbounded grade parks the critical path. */
  timeoutMs?: number
  /** A3a's pre-authorized degrade: grade the first declared endpoint and record the coverage limit. */
  firstEndpointOnly?: boolean
  /** Injected engine, for tests. Defaults to the installed package's `runLitmus`. */
  runLitmusImpl?: RunLitmusFn
  /** Injected clock, so a test can assert a byte-identical bundle. Unix seconds. */
  nowSeconds?: () => number
  onProgress?: (endpoint: string, done: number, total: number, label: string) => void
}

export const DEFAULT_RUN_TIMEOUT_MS = 180_000

/** The worst letter wins. A card is only as good as its weakest declared surface. */
export function worstGrade(grades: readonly Grade[]): Grade {
  if (grades.length === 0) {
    throw new GradeError('no endpoint produced a grade, so there is no letter to report')
  }
  return grades.reduce((worst, grade) => (gradeRank(grade) > gradeRank(worst) ? grade : worst))
}

/**
 * One fingerprint over every graded endpoint, composed the same way on both sides.
 *
 * B1 recomputes this from the live surfaces and compares. Composing even a single endpoint keeps one
 * code path on both sides: a baseline built one way and a recheck built another compares two
 * different things while looking like it compares one.
 */
export function composeToolFingerprint(
  entries: readonly { endpoint: string; fingerprint: string }[],
): Hex {
  if (entries.length === 0) {
    throw new GradeError('no tool surface was enumerated, so there is no fingerprint to compose')
  }
  for (const entry of entries) {
    if (!FINGERPRINT_PATTERN.test(entry.fingerprint)) {
      throw new GradeError(
        `the fingerprint for ${entry.endpoint} is not 32 lowercase hex bytes, so it is not usable as a baseline`,
      )
    }
  }
  const sorted = [...entries]
    .map((entry) => ({ endpoint: entry.endpoint, fingerprint: entry.fingerprint }))
    .sort((a, b) => (a.endpoint < b.endpoint ? -1 : a.endpoint > b.endpoint ? 1 : 0))
  return hashCanonical(canonicalizeValue(sorted))
}

function readLitmusBundle(endpoint: string, bundle: LitmusBundle | undefined): {
  grade: Grade
  fingerprint: string
  surface: ToolSurface
  engineVersion: string
  json: JsonValue
} {
  // Never synthesize an empty bundle. A hash over nothing is stable, meaningless, and verifies
  // cleanly forever, which is worse than having no letter at all.
  if (bundle === undefined || bundle === null) {
    throw new GradeError(`the engine returned no evidence bundle for ${endpoint}`)
  }
  if (!isGrade(bundle.grade)) {
    throw new GradeError(`the engine returned no usable grade for ${endpoint}`)
  }
  if (!FINGERPRINT_PATTERN.test(bundle.toolDefsFingerprint ?? '')) {
    throw new GradeError(`the engine returned no usable tool fingerprint for ${endpoint}`)
  }
  if (!Array.isArray(bundle.toolDefs) || bundle.toolDefs.length === 0) {
    throw new GradeError(`the engine graded ${endpoint} without enumerating a tool surface`)
  }
  if (bundle.methodologyVersion !== methodologyVersion()) {
    throw new GradeError(
      `the bundle for ${endpoint} reports methodology ${bundle.methodologyVersion}, but the installed engine reports ${methodologyVersion()}`,
    )
  }

  const json = toJsonValue(bundle, `the engine bundle for ${endpoint}`)
  return {
    grade: bundle.grade,
    fingerprint: bundle.toolDefsFingerprint,
    // The engine follows tools/list pagination to the end internally and hands back the flattened
    // canonical surface it hashed, so this is one page carrying the whole surface rather than a
    // per-page record. It is the surface the grade certifies, which is what B1 compares against.
    surface: {
      endpoint,
      pages: [{ cursor: null, tools: toJsonValue(bundle.toolDefs, 'the tool defs') as JsonValue[] }],
      toolCount: bundle.toolDefs.length,
    },
    engineVersion: bundle.harness?.version ?? 'unknown',
    json,
  }
}

export async function gradeAgent(
  card: AgentCard,
  options: GradeAgentOptions = {},
): Promise<GradeResult> {
  const engine = options.runLitmusImpl ?? ((endpoint, opts) => runLitmus(endpoint, opts))
  const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS
  const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))

  const declared = card.mcpEndpoints
  if (declared.length === 0) {
    throw new GradeError(`agent ${card.agentId} declares no endpoint, so there is nothing to grade`)
  }
  const targets = options.firstEndpointOnly ? declared.slice(0, 1) : declared

  const endpoints: EndpointEvidence[] = []
  const surfaces: ToolSurface[] = []
  const fingerprints: { endpoint: string; fingerprint: string }[] = []
  const grades: Grade[] = []
  let engineVersion = 'unknown'

  for (const endpoint of targets) {
    let bundle: LitmusBundle
    try {
      bundle = await engine(endpoint, {
        timeoutMs,
        onProgress: options.onProgress
          ? (done, total, label) => options.onProgress?.(endpoint, done, total, label)
          : undefined,
      })
    } catch (err) {
      // Grading the reachable subset silently produces a letter with missing evidence, which is
      // worse than no letter, so one unreachable endpoint fails the whole grade.
      throw new GradeError(`the engine could not grade ${endpoint}`, { retryable: true, cause: err })
    }

    const read = readLitmusBundle(endpoint, bundle)
    endpoints.push({ endpoint, grade: read.grade, litmus: read.json })
    surfaces.push(read.surface)
    fingerprints.push({ endpoint, fingerprint: read.fingerprint })
    grades.push(read.grade)
    if (read.engineVersion !== 'unknown') engineVersion = read.engineVersion
  }

  const grade = worstGrade(grades)
  const bundle: EvidenceBundle = {
    schema: 'preflight-evidence-v1',
    agentId: card.agentId,
    tokenURI: card.tokenURI,
    card: toJsonValue(card.raw, `the card for agent ${card.agentId}`),
    methodologyVersion: methodologyVersion(),
    engineVersion,
    endpoints,
    toolSurface: surfaces,
    ranAt: now(),
    coverage: {
      endpointsDeclared: declared.length,
      endpointsGraded: targets.length,
      note:
        targets.length < declared.length
          ? `graded the first declared endpoint only; ${declared.length - targets.length} declared endpoint(s) were not exercised`
          : null,
    },
  }

  return {
    grade,
    score: scoreForGrade(grade),
    bundle,
    evidenceHash: evidenceHash(bundle),
    methodologyVersion: methodologyVersion(),
    toolFingerprint: composeToolFingerprint(fingerprints),
    ranAt: bundle.ranAt,
  }
}
