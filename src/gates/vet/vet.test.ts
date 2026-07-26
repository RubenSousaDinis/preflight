import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fingerprintToolDefs, METHODOLOGY_VERSION } from '@polygraphso/litmus'

import type { Address, EvidenceBundle, JsonValue, Score, ValidationRecord } from '../../shared/types.ts'
import { canonicalize, hashCanonical } from '../../validator/canonical.ts'
import { composeToolFingerprint } from '../../validator/grade-agent.ts'
import { ReceiptChain } from '../../receipts/receipt-chain.ts'
import { createSigner } from '../../receipts/signer.ts'
import { handleMcpRequest } from '../../demo/mcp-server.ts'
import { PAGE_SIZE, toolsFor } from '../../demo/tool-surface.ts'
import { resetToolSurface, setToolSurface } from '../../demo/variant-store.ts'
import { liveFingerprint } from './live-fingerprint.ts'
import { DEFAULT_POLICY, vetAgent, type GateRecord } from './vet-agent.ts'

const VALIDATOR: Address = '0xCFad8f21B8469790ADc3922814d1df4E08ECF1c8'
const OTHER: Address = '0x2222222222222222222222222222222222222222'
const ENDPOINT = 'https://demo.invalid/mcp'
const NOW = 1_785_060_000
const AGENT = '8427'

function toolDefs(variant: 'baseline' | 'drifted' | 'poisoned') {
  return toolsFor(variant).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

/** An evidence bundle recording the surface that was graded, in the shape A3a writes. */
function bundleFor(variant: 'baseline' | 'drifted'): EvidenceBundle {
  const tools = toolDefs(variant)
  return {
    schema: 'preflight-evidence-v1',
    agentId: AGENT,
    tokenURI: 'https://cards.invalid/8427.json',
    card: { name: 'Demo agent', services: [{ name: 'MCP', endpoint: ENDPOINT }] },
    methodologyVersion: METHODOLOGY_VERSION,
    engineVersion: '0.36.0',
    endpoints: [{ endpoint: ENDPOINT, grade: 'B', litmus: { note: 'test bundle' } }],
    toolSurface: [
      { endpoint: ENDPOINT, pages: [{ cursor: null, tools: tools as unknown as JsonValue[] }], toolCount: tools.length },
    ],
    ranAt: NOW - 120,
    coverage: { endpointsDeclared: 1, endpointsGraded: 1, note: null },
  }
}

function fingerprintOf(variant: 'baseline' | 'drifted'): string {
  return composeToolFingerprint([
    { endpoint: ENDPOINT, fingerprint: fingerprintToolDefs(toolDefs(variant)).fingerprint },
  ])
}

interface Scenario {
  score?: Score
  variantGraded?: 'baseline' | 'drifted'
  variantLive?: 'baseline' | 'drifted'
  validator?: Address
  lastUpdate?: number
  responseURI?: string
  responseHash?: `0x${string}`
  record?: GateRecord | null
  readThrows?: boolean
  fetchThrows?: boolean
  fingerprintThrows?: boolean
  evidenceText?: string
  policy?: typeof DEFAULT_POLICY
  receipts?: ReceiptChain
}

async function vet(scenario: Scenario = {}) {
  const graded = scenario.variantGraded ?? 'baseline'
  const bundle = bundleFor(graded)
  const evidence = scenario.evidenceText ?? canonicalize(bundle)
  const record: ValidationRecord & { lastUpdate: number } = {
    agentId: AGENT,
    score: scenario.score ?? 75,
    responseURI: scenario.responseURI ?? 'https://evidence.invalid/8427.json',
    responseHash: scenario.responseHash ?? hashCanonical(canonicalize(bundle)),
    tag: METHODOLOGY_VERSION,
    validator: scenario.validator ?? VALIDATOR,
    expiresAt: (scenario.lastUpdate ?? NOW - 120) + 86_400,
    lastUpdate: scenario.lastUpdate ?? NOW - 120,
    txHash: '0x3dfae8f6e6de531ce9b7f2886bbb8357bde6bcfe6a98883ffe9da4a6bf3c7f0c',
  }

  return vetAgent(AGENT, scenario.policy ?? DEFAULT_POLICY, {
    now: NOW,
    validator: VALIDATOR,
    receipts: scenario.receipts,
    readRecord: async () => {
      if (scenario.readThrows === true) throw new Error('fetch failed')
      return scenario.record === undefined ? record : scenario.record
    },
    fetchEvidence: async () => {
      if (scenario.fetchThrows === true) throw new Error('HTTP 404')
      return evidence
    },
    resolveEndpoints: async () => [ENDPOINT],
    fingerprintEndpoint: async () => {
      if (scenario.fingerprintThrows === true) throw new Error('connection closed')
      return fingerprintToolDefs(toolDefs(scenario.variantLive ?? 'baseline')).fingerprint
    },
  })
}

// --- the three acceptance checks -------------------------------------------

test('check 1: a record, its evidence, and a matching live surface all agree, so HIRE', async () => {
  const decision = await vet({ score: 75 })
  assert.equal(decision.verdict, 'HIRE')
  assert.equal(decision.fingerprintMatch, true)
  assert.equal(decision.grade, 'B')
  assert.equal(decision.score, 75)
  assert.ok(decision.record !== null)
  assert.match(decision.reason, /meets the minimum of B/)
})

test('check 2: a grade below the policy is refused, and the reason names the shortfall', async () => {
  const decision = await vet({ score: 0 })
  assert.equal(decision.verdict, 'REFUSE')
  assert.equal(decision.grade, 'F')
  assert.equal(decision.score, 0)
  assert.equal(decision.fingerprintMatch, true, 'the surface still matched; only the letter failed')
  assert.match(decision.reason, /grade F is below the minimum of B/)
})

test('check 3: the surface moved after grading, so REFUSE with the letter still showing', async () => {
  const decision = await vet({ score: 100, variantGraded: 'baseline', variantLive: 'drifted' })
  assert.equal(decision.verdict, 'REFUSE')
  assert.equal(decision.grade, 'A', 'the A next to the refusal is the point')
  assert.equal(decision.fingerprintMatch, false)
  assert.match(decision.reason, /no longer matches the surface that was graded/)
})

test('drift outranks the letter: an F that also drifted reports drift, not the grade', async () => {
  const decision = await vet({ score: 0, variantLive: 'drifted' })
  assert.equal(decision.fingerprintMatch, false)
  assert.match(decision.reason, /no longer matches/)
  assert.doesNotMatch(decision.reason, /below the minimum/)
})

test('check 4: a surface read one page deep fingerprints differently from the whole surface', async () => {
  await resetToolSurface()
  const body = await handleMcpRequest(
    new Request('https://demo.invalid/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  )
  const firstPage = ((await body.json()) as { result: { tools: { name: string; description: string; inputSchema: unknown }[] } })
    .result.tools
  assert.equal(firstPage.length, PAGE_SIZE)

  const pageOneOnly = fingerprintToolDefs(firstPage).fingerprint
  const wholeSurface = fingerprintToolDefs(toolDefs('baseline')).fingerprint
  assert.notEqual(pageOneOnly, wholeSurface, 'a one-page read must not produce the full fingerprint')
})

// --- the id a record is looked up under -------------------------------------

/*
  A Base mainnet agent cannot hold a record on the Sepolia ValidationRegistry under its own id. The
  publish path mirrors it to a Sepolia identity first and writes the record against that id, so a
  gate reading under the mainnet id misses a record that exists, and misses it as "no record at
  all". On screen that reads as an agent nobody ever graded, which is a different and much worse
  claim than "this lookup went to the wrong key".

  Driven through the env link map rather than `recordMirrorLink`, because that helper writes the
  durable map in `data/`, and a test has no business editing it.
*/
async function withMirrorLinks<T>(
  links: { mainnetId: string; sepoliaId: string; linkedAt: number }[],
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env.MAINNET_SEPOLIA_LINKS
  process.env.MAINNET_SEPOLIA_LINKS = JSON.stringify(links)
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.MAINNET_SEPOLIA_LINKS
    else process.env.MAINNET_SEPOLIA_LINKS = previous
  }
}

test('a mirrored mainnet agent is looked up under the id its record was published against', async () => {
  const asked: string[] = []
  const decision = await withMirrorLinks(
    [{ mainnetId: '22387', sepoliaId: '8499', linkedAt: 1 }],
    () =>
      vetAgent('22387', DEFAULT_POLICY, {
        now: NOW,
        validator: VALIDATOR,
        readRecord: async (id) => {
          asked.push(id)
          return null
        },
      }),
  )

  assert.deepEqual(asked, ['8499'], 'the mirror id is the one the registry is asked about')
  assert.equal(decision.verdict, 'REFUSE')
  // Both ids, so an operator can see which key was read rather than guessing.
  assert.match(decision.reason, /22387/)
  assert.match(decision.reason, /8499/)
})

test('an agent with no mirror is still looked up under its own id', async () => {
  const asked: string[] = []
  const decision = await withMirrorLinks([], () =>
    vetAgent(AGENT, DEFAULT_POLICY, {
      now: NOW,
      validator: VALIDATOR,
      readRecord: async (id) => {
        asked.push(id)
        return null
      },
    }),
  )

  assert.deepEqual(asked, [AGENT])
  assert.equal(decision.verdict, 'REFUSE')
  // No mirror, so nothing to disclose: the reason names one id and not a mapping.
  assert.doesNotMatch(decision.reason, /mirror/)
})

// --- every refusal cause, each distinguishable ------------------------------

test('all the refusal causes are reachable, and every reason reads differently', async () => {
  const bundle = bundleFor('baseline')
  const causes = {
    registryUnreadable: await vet({ readThrows: true }),
    noRecord: await vet({ record: null }),
    foreignValidator: await vet({ validator: OTHER }),
    expired: await vet({ policy: { minGrade: 'B', maxAgeSeconds: 60 } }),
    offScaleScore: await vet({ score: 42 as Score }),
    noEvidenceURI: await vet({ responseURI: '   ' }),
    evidenceUnreachable: await vet({ fetchThrows: true }),
    hashMismatch: await vet({ responseHash: `0x${'11'.repeat(32)}` }),
    notABundle: await vet({ evidenceText: 'not json' }),
    fingerprintUnobtainable: await vet({ fingerprintThrows: true }),
    drift: await vet({ variantLive: 'drifted' }),
    belowPolicy: await vet({ score: 25 }),
  }

  for (const [name, decision] of Object.entries(causes)) {
    assert.equal(decision.verdict, 'REFUSE', `${name} should refuse`)
    assert.ok(decision.reason.length > 0, `${name} needs a reason`)
  }

  const reasons = Object.values(causes).map((d) => d.reason)
  assert.equal(new Set(reasons).size, reasons.length, 'two causes must never read the same')

  assert.match(causes.registryUnreadable.reason, /registry could not be read/)
  assert.match(causes.noRecord.reason, /no validation record from/)
  assert.match(causes.foreignValidator.reason, /not by the validator this gate trusts/)
  assert.match(causes.expired.reason, /expired at/)
  assert.match(causes.evidenceUnreachable.reason, /could not be retrieved/)
  assert.match(causes.hashMismatch.reason, /hash mismatch/)
  assert.match(causes.fingerprintUnobtainable.reason, /could not be enumerated/)
  assert.match(causes.drift.reason, /no longer matches/)
  assert.match(causes.belowPolicy.reason, /below the minimum/)

  // Absence and unreadability both refuse with a null record, and neither is an abstention.
  assert.equal(causes.noRecord.record, null)
  assert.equal(causes.noRecord.fingerprintMatch, null)
  assert.equal(causes.fingerprintUnobtainable.fingerprintMatch, null)
  assert.equal(hashCanonical(canonicalize(bundle)).length, 66)
})

test('a live surface that is a strict subset of the graded one still refuses', async () => {
  const graded = toolDefs('drifted')
  const bundle = bundleFor('drifted')
  const decision = await vetAgent(AGENT, DEFAULT_POLICY, {
    now: NOW,
    validator: VALIDATOR,
    readRecord: async () => ({
      agentId: AGENT,
      score: 100,
      responseURI: 'https://evidence.invalid/8427.json',
      responseHash: hashCanonical(canonicalize(bundle)),
      tag: METHODOLOGY_VERSION,
      validator: VALIDATOR,
      expiresAt: NOW + 3600,
      lastUpdate: NOW - 120,
      txHash: '0xabc',
    }),
    fetchEvidence: async () => canonicalize(bundle),
    resolveEndpoints: async () => [ENDPOINT],
    // The live surface has three fewer tools than the graded one. Removal is drift too.
    fingerprintEndpoint: async () => fingerprintToolDefs(graded.slice(0, -3)).fingerprint,
  })
  assert.equal(decision.verdict, 'REFUSE')
  assert.equal(decision.fingerprintMatch, false)
})

test('the policy tightens the bound: a record inside the derived expiry can still be too old', async () => {
  const fresh = await vet({ lastUpdate: NOW - 30, policy: { minGrade: 'B', maxAgeSeconds: 60 } })
  assert.equal(fresh.verdict, 'HIRE')
  const stale = await vet({ lastUpdate: NOW - 120, policy: { minGrade: 'B', maxAgeSeconds: 60 } })
  assert.equal(stale.verdict, 'REFUSE')
  assert.match(stale.reason, /expired at/)
})

// --- receipts on both outcomes ---------------------------------------------

test('a receipt is emitted for a hire and for a refusal, and the chain verifies', async () => {
  const receipts = new ReceiptChain(createSigner())
  await vet({ score: 75, receipts })
  await vet({ score: 0, receipts })
  await vet({ record: null, receipts })

  assert.equal(receipts.length, 3)
  const subjects = receipts.all().map((r) => (r.subject as { verdict: string }).verdict)
  assert.deepEqual(subjects, ['HIRE', 'REFUSE', 'REFUSE'])
  assert.deepEqual(await receipts.verify(), { ok: true, brokenAt: null, reason: null })
  assert.equal(receipts.at(0).evidenceURI, 'https://evidence.invalid/8427.json')
  assert.equal(receipts.at(2).evidenceURI, null, 'a refusal with no record points at no evidence')
})

// --- the live fingerprint itself -------------------------------------------

test('liveFingerprint composes across endpoints and refuses an empty list', async () => {
  const one = await liveFingerprint([ENDPOINT], {
    fingerprintEndpoint: async () => fingerprintToolDefs(toolDefs('baseline')).fingerprint,
  })
  assert.equal(one, fingerprintOf('baseline'))

  const two = await liveFingerprint([ENDPOINT, 'https://second.invalid/mcp'], {
    fingerprintEndpoint: async (endpoint) =>
      fingerprintToolDefs(toolDefs(endpoint === ENDPOINT ? 'baseline' : 'drifted')).fingerprint,
  })
  assert.notEqual(two, one, 'a second endpoint changes the composed value')

  await assert.rejects(() => liveFingerprint([]), /no endpoints to fingerprint/)
  await assert.rejects(
    () =>
      liveFingerprint([ENDPOINT], {
        fingerprintEndpoint: async () => {
          throw new Error('closed')
        },
      }),
    /could not be enumerated/,
  )
})

test('the graded baseline derives from the evidence, matching what the engine reported', async () => {
  await setToolSurface('baseline')
  const bundle = bundleFor('baseline')
  const { baselineToolFingerprint } = await import('../../validator/grade-agent.ts')
  assert.equal(baselineToolFingerprint(bundle), fingerprintOf('baseline'))
  await resetToolSurface()
})

// --- the record the gate selects when an agent has been re-graded ----------

/**
 * A registry with two records for one agent, sharing a consensus second.
 *
 * This is the shape beat 4 creates: an A record and the F record that superseded it. Ordering by
 * `lastUpdate` cannot tell them apart, so the gate has to order by block or it hires an agent that has
 * already been re-graded.
 */
function twoRecordRegistry(): { client: never; bundle: EvidenceBundle } {
  const bundle = bundleFor('baseline')
  const responseHash = hashCanonical(canonicalize(bundle))
  const older = '0xaaa1' as const
  const newer = '0xaaa2' as const
  const entries = [
    { requestHash: older, block: 100n, logIndex: 0, score: 100 },
    { requestHash: newer, block: 200n, logIndex: 0, score: 0 },
  ]
  const client = {
    getBlockNumber: async () => 1_000n,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      entries
        .filter((entry) => entry.block >= fromBlock && entry.block <= toBlock)
        .map((entry) => ({
          args: {
            requestHash: entry.requestHash,
            responseURI: 'https://evidence.invalid/42.json',
            responseHash,
            response: entry.score,
            tag: METHODOLOGY_VERSION,
            validatorAddress: VALIDATOR,
          },
          blockNumber: entry.block,
          logIndex: entry.logIndex,
          transactionHash: `0xtx${entry.logIndex}`,
        })),
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      if (functionName === 'getAgentValidations') return entries.map((entry) => entry.requestHash)
      if (functionName === 'getValidationStatus') {
        const entry = entries.find((candidate) => candidate.requestHash === String(args[0]))
        if (entry === undefined) throw new Error('execution reverted: unknown')
        // Both records carry the same lastUpdate, which is the trap.
        return [VALIDATOR, 42n, entry.score, responseHash, METHODOLOGY_VERSION, BigInt(NOW - 60)]
      }
      throw new Error(`unexpected call ${functionName}`)
    },
  }
  return { client: client as never, bundle }
}

test('a re-graded agent is judged on the newer record, selected by block', async () => {
  const { client, bundle } = twoRecordRegistry()
  const decision = await vetAgent(
    '42',
    DEFAULT_POLICY,
    {
      now: NOW,
      validator: VALIDATOR,
      read: { client, registry: '0x1111111111111111111111111111111111111111', chainId: 84532 },
      fetchEvidence: async () => canonicalize(bundle),
      resolveEndpoints: async () => [ENDPOINT],
      fingerprintEndpoint: async () => fingerprintToolDefs(toolDefs('baseline')).fingerprint,
    },
  )

  assert.equal(decision.verdict, 'REFUSE', 'the F record superseded the A record')
  assert.equal(decision.grade, 'F')
  assert.match(decision.reason, /below the minimum of B/)
  assert.equal(
    decision.fingerprintMatch,
    true,
    'the surface still matched, so this refusal is about the letter and not about drift',
  )
})
