import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  METHODOLOGY_VERSION,
  canonicalStringify,
  fingerprintToolDefs,
  type EvidenceBundle as LitmusBundle,
} from '@polygraphso/litmus'

import { GradeError } from '../shared/errors.ts'
import type { AgentCard, EvidenceBundle } from '../shared/types.ts'
import { canonicalize, canonicalizeValue, evidenceHash, hashCanonical } from './canonical.ts'
import {
  baselineToolFingerprint,
  composeToolFingerprint,
  gradeAgent,
  worstGrade,
} from './grade-agent.ts'
import { methodologyVersion } from './methodology.ts'

const FP_A = `0x${'a1'.repeat(32)}`
const FP_B = `0x${'b2'.repeat(32)}`

/** Two surfaces that differ, so two endpoints can carry genuinely different fingerprints. */
const TOOLS_ONE = [
  { name: 'summarize', description: 'Summarize text', inputSchema: { type: 'object' } },
]
const TOOLS_TWO = [{ name: 'translate', description: 'Translate text', inputSchema: { type: 'object' } }]

function card(agentId: string, endpoints: string[]): AgentCard {
  return {
    agentId,
    name: 'Demo agent',
    mcpEndpoints: endpoints,
    skillRefs: [],
    raw: { name: 'Demo agent', services: endpoints.map((url) => ({ name: 'MCP', endpoint: url })) },
    tokenURI: `https://cards.example/${agentId}.json`,
  }
}

/**
 * A bundle whose declared fingerprint is the hash of its own tool defs.
 *
 * gradeAgent cross-checks the two, so a fixture that declared an unrelated fingerprint would fail for
 * the right reason. Computing it here keeps every fixture internally consistent, the way a real bundle
 * is.
 */
function litmusBundle(overrides: Partial<LitmusBundle> = {}): LitmusBundle {
  const toolDefs = overrides.toolDefs ?? TOOLS_ONE
  return {
    schemaVersion: '1.10.0',
    methodologyVersion: METHODOLOGY_VERSION,
    serverRef: 'https/demo.example',
    resolvedVersion: null,
    selfReportedVersion: '1.2.3',
    target: { kind: 'http', url: 'https://demo.example/mcp' },
    toolDefsFingerprint: fingerprintToolDefs(toolDefs).fingerprint,
    toolDefs,
    ranAt: '2026-07-25T09:00:00.000Z',
    harness: {
      package: '@polygraphso/litmus',
      version: '0.36.0',
      node: process.version,
      dockerAvailable: false,
    },
    categories: [{ code: 'C-01', status: 'pass', probes: [] }],
    grade: 'A',
    gradeRationale: 'every applicable category passed',
    disclaimer: 'fixture',
    ...overrides,
  } as LitmusBundle
}

// --- the canonical form ----------------------------------------------------

test('keys sort recursively, so insertion order cannot change the bytes', () => {
  const one = { b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }
  const two = { a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }
  assert.equal(canonicalizeValue(one), canonicalizeValue(two))
  assert.equal(canonicalizeValue(one), '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}')
})

test('array order is preserved, because the bundle already fixed it', () => {
  assert.equal(canonicalizeValue([3, 1, 2]), '[3,1,2]')
  assert.notEqual(canonicalizeValue([1, 2]), canonicalizeValue([2, 1]))
})

test('a float, a NaN, an Infinity, or an unsafe integer throws instead of serializing', () => {
  assert.throws(() => canonicalizeValue({ n: 1.5 }), GradeError)
  assert.throws(() => canonicalizeValue({ n: Number.NaN }), GradeError)
  assert.throws(() => canonicalizeValue({ n: Number.POSITIVE_INFINITY }), GradeError)
  assert.throws(() => canonicalizeValue({ n: 2 ** 53 }), GradeError)
  assert.equal(canonicalizeValue({ n: Number.MAX_SAFE_INTEGER }), '{"n":9007199254740991}')
})

test('undefined, a bigint, and a Date throw rather than being dropped or guessed', () => {
  assert.throws(() => canonicalizeValue({ a: undefined }), GradeError)
  assert.throws(() => canonicalizeValue({ a: 1n }), GradeError)
  assert.throws(() => canonicalizeValue({ a: new Date(0) }), GradeError)
  assert.throws(() => canonicalizeValue({ a: new Map() }), GradeError)
})

test('non-ascii text keeps its raw code points, so hidden characters change the hash', () => {
  const plain = { note: 'cafe' }
  const composed = { note: 'café' }
  const decomposed = { note: 'café' }
  assert.notEqual(canonicalizeValue(composed), canonicalizeValue(decomposed))
  assert.notEqual(canonicalizeValue(plain), canonicalizeValue(composed))

  const withZeroWidth = { note: 'summarize​' }
  assert.notEqual(canonicalizeValue({ note: 'summarize' }), canonicalizeValue(withZeroWidth))
})

test('our canonical form and the engine serializer agree byte for byte', () => {
  const values: unknown[] = [
    { b: 1, a: 2 },
    { deep: { z: [1, 2, { y: 'x' }], a: null } },
    { text: 'café 中文 🚀', n: Number.MAX_SAFE_INTEGER },
    [],
    {},
    litmusBundle(),
  ]
  for (const value of values) {
    assert.equal(canonicalizeValue(value), canonicalStringify(value))
  }
})

// --- the round trip, which is the acceptance test --------------------------

async function gradedBundle(): Promise<EvidenceBundle> {
  const result = await gradeAgent(card('7', ['https://demo.example/mcp']), {
    runLitmusImpl: async () =>
      litmusBundle({
        toolDefs: [
          {
            name: 'summarize',
            description: 'Summarize é text with a ​ zero width and 🚀',
            inputSchema: { type: 'object', properties: { big: { const: Number.MAX_SAFE_INTEGER } } },
          },
        ],
      }),
    nowSeconds: () => 1_785_056_400,
  })
  return result.bundle
}

test('canonicalizing twice in one process is byte identical', async () => {
  const bundle = await gradedBundle()
  assert.equal(canonicalize(bundle), canonicalize(bundle))
})

test('the round trip holds across a separate process, keys reordered on the way', async () => {
  const bundle = await gradedBundle()
  const canonical = canonicalize(bundle)
  const hash = evidenceHash(bundle)

  // Write the bundle with its keys in a different order than the canonical one, so the child cannot
  // pass by accident: it has to sort them back itself.
  const shuffled = Object.fromEntries(Object.entries(bundle).reverse())
  const dir = mkdtempSync(join(tmpdir(), 'preflight-roundtrip-'))
  const file = join(dir, 'bundle.json')
  writeFileSync(file, JSON.stringify(shuffled))

  const script = join(process.cwd(), 'src', 'validator', 'canonical-roundtrip.ts')
  assert.ok(existsSync(script), 'the round-trip child script has to exist to be run')
  const child = spawnSync(process.execPath, [script, file], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)

  const [childHash, childLength] = child.stdout.trim().split('\n')
  assert.equal(childHash, hash, 'a reloaded bundle must hash to the value written onchain')
  assert.equal(Number(childLength), Buffer.byteLength(canonical))
})

test('the hash is keccak256 over the canonical bytes, and it moves when a byte moves', async () => {
  const bundle = await gradedBundle()
  assert.equal(evidenceHash(bundle), hashCanonical(canonicalize(bundle)))
  const nudged: EvidenceBundle = { ...bundle, ranAt: bundle.ranAt + 1 }
  assert.notEqual(evidenceHash(nudged), evidenceHash(bundle))
})

// --- the grade -------------------------------------------------------------

test('the reported methodology version is the installed package constant', () => {
  assert.equal(methodologyVersion(), METHODOLOGY_VERSION)
  assert.match(methodologyVersion(), /^litmus-v\d+$/)
})

test('grading the A fixture returns A and 100, the F fixture F and 0', async () => {
  const a = await gradeAgent(card('1', ['https://a.example/mcp']), {
    runLitmusImpl: async () => litmusBundle({ grade: 'A' }),
    nowSeconds: () => 1_785_056_400,
  })
  assert.equal(a.grade, 'A')
  assert.equal(a.score, 100)
  assert.equal(a.methodologyVersion, METHODOLOGY_VERSION)
  assert.equal(a.bundle.endpoints[0].grade, 'A')
  assert.equal(a.bundle.coverage.note, null)

  const f = await gradeAgent(card('2', ['https://f.example/mcp']), {
    runLitmusImpl: async () => litmusBundle({ grade: 'F' }),
    nowSeconds: () => 1_785_056_400,
  })
  assert.equal(f.grade, 'F')
  assert.equal(f.score, 0)
})

test('a C grade scores 50, which the plan table once omitted', async () => {
  const c = await gradeAgent(card('3', ['https://c.example/mcp']), {
    runLitmusImpl: async () => litmusBundle({ grade: 'C' }),
  })
  assert.equal(c.score, 50)
})

test('the worst letter across endpoints wins', async () => {
  assert.equal(worstGrade(['A', 'C', 'B']), 'C')
  assert.equal(worstGrade(['A']), 'A')
  assert.equal(worstGrade(['B', 'F']), 'F')
  assert.throws(() => worstGrade([]), GradeError)

  const mixed = await gradeAgent(card('4', ['https://one.example/mcp', 'https://two.example/mcp']), {
    runLitmusImpl: async (endpoint) =>
      litmusBundle({
        grade: endpoint.includes('two') ? 'D' : 'A',
        toolDefs: endpoint.includes('two') ? TOOLS_TWO : TOOLS_ONE,
      }),
  })
  assert.equal(mixed.grade, 'D')
  assert.equal(mixed.score, 25)
  assert.equal(mixed.bundle.coverage.endpointsGraded, 2)
})

test('an endpoint the engine cannot grade fails the whole grade', async () => {
  await assert.rejects(
    () =>
      gradeAgent(card('5', ['https://up.example/mcp', 'https://down.example/mcp']), {
        runLitmusImpl: async (endpoint) => {
          if (endpoint.includes('down')) throw new Error('connect ECONNREFUSED')
          return litmusBundle()
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof GradeError)
      assert.match(err.reason, /could not grade https:\/\/down\.example\/mcp/)
      assert.equal(err.retryable, true)
      return true
    },
  )
})

test('a bundle with no grade, no fingerprint, or no surface throws instead of being patched', async () => {
  const cases: Partial<LitmusBundle>[] = [
    { grade: undefined as unknown as LitmusBundle['grade'] },
    { toolDefsFingerprint: '0xnothex' },
    { toolDefs: [] },
    { methodologyVersion: 'litmus-v1' },
  ]
  for (const override of cases) {
    await assert.rejects(
      () =>
        gradeAgent(card('6', ['https://x.example/mcp']), {
          runLitmusImpl: async () => litmusBundle(override),
        }),
      GradeError,
    )
  }
  await assert.rejects(
    () =>
      gradeAgent(card('6', ['https://x.example/mcp']), {
        runLitmusImpl: async () => undefined as unknown as LitmusBundle,
      }),
    GradeError,
  )
})

test('the degrade grades the first endpoint only and says so in the bundle', async () => {
  const result = await gradeAgent(
    card('8', ['https://one.example/mcp', 'https://two.example/mcp']),
    { runLitmusImpl: async () => litmusBundle(), firstEndpointOnly: true },
  )
  assert.equal(result.bundle.coverage.endpointsDeclared, 2)
  assert.equal(result.bundle.coverage.endpointsGraded, 1)
  assert.match(String(result.bundle.coverage.note), /first declared endpoint only/)
})

// --- the drift baseline ----------------------------------------------------

test('the composed fingerprint is stable, order independent, and moves with the surface', () => {
  const one = composeToolFingerprint([
    { endpoint: 'https://a.example/mcp', fingerprint: FP_A },
    { endpoint: 'https://b.example/mcp', fingerprint: FP_B },
  ])
  const reversed = composeToolFingerprint([
    { endpoint: 'https://b.example/mcp', fingerprint: FP_B },
    { endpoint: 'https://a.example/mcp', fingerprint: FP_A },
  ])
  assert.equal(one, reversed)

  const moved = composeToolFingerprint([
    { endpoint: 'https://a.example/mcp', fingerprint: FP_B },
    { endpoint: 'https://b.example/mcp', fingerprint: FP_B },
  ])
  assert.notEqual(moved, one)
  assert.match(one, /^0x[0-9a-f]{64}$/)
})

test('a fingerprint that is not 32 hex bytes is refused as a baseline', () => {
  assert.throws(() => composeToolFingerprint([]), GradeError)
  assert.throws(
    () => composeToolFingerprint([{ endpoint: 'https://a.example/mcp', fingerprint: '0xabc' }]),
    GradeError,
  )
  assert.throws(
    () => composeToolFingerprint([{ endpoint: 'https://a.example/mcp', fingerprint: FP_A.toUpperCase() }]),
    GradeError,
  )
})

test('the graded fingerprint is the composition B1 will recompute', async () => {
  const result = await gradeAgent(card('9', ['https://a.example/mcp']), {
    runLitmusImpl: async () => litmusBundle(),
  })
  const expected = fingerprintToolDefs(TOOLS_ONE).fingerprint
  assert.equal(
    result.toolFingerprint,
    composeToolFingerprint([{ endpoint: 'https://a.example/mcp', fingerprint: expected }]),
  )
  assert.equal(baselineToolFingerprint(result.bundle), result.toolFingerprint)
})

test('a bundle whose recorded surface does not match its own fingerprint is refused', async () => {
  await assert.rejects(
    () =>
      gradeAgent(card('10', ['https://a.example/mcp']), {
        runLitmusImpl: async () => ({ ...litmusBundle(), toolDefsFingerprint: FP_B }) as LitmusBundle,
      }),
    (err: unknown) => {
      assert.ok(err instanceof GradeError)
      assert.match(err.reason, /no usable tool fingerprint|does not fingerprint to what the engine reported/)
      return true
    },
  )
})
