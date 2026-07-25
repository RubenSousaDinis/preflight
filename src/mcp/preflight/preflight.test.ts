import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fingerprintToolDefs, METHODOLOGY_VERSION } from '@polygraphso/litmus'

import type { Address, EvidenceBundle, GateDecision, JsonValue, TxVerdict, ValidationRecord } from '../../shared/types.ts'
import { FIXTURE_VERDICT_ALLOW, FIXTURE_VERDICT_BLOCK_DRAINER, FIXTURE_TX_DRAINER } from '../../shared/fixtures/index.ts'
import { canonicalize, hashCanonical } from '../../validator/canonical.ts'
import { vetAgent } from '../../gates/vet/vet-agent.ts'
import { toolsFor } from '../../demo/tool-surface.ts'
import { resetToolSurface, setToolSurface } from '../../demo/variant-store.ts'
import { AGENT_TOOL, TOOL_DEFINITIONS, TX_TOOL, callPreflightTx, dispatch, parsePendingTx } from './server.ts'
import { serializeGateDecision, serializeTxVerdict } from './serialize.ts'

const VALIDATOR: Address = '0x0000000000000000000000000000000000000001'
const ENDPOINT = 'https://demo.invalid/mcp'
const NOW = 1_785_060_000

async function call(name: string, args: JsonValue, deps = {}): Promise<{ payload: JsonValue; isError: unknown }> {
  const response = (await dispatch(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    deps,
  )) as { result: { structuredContent: JsonValue; isError: unknown; content: { text: string }[] } }
  // The text and the structured payload must agree: a client reading either sees the same verdict.
  assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent)
  return { payload: response.result.structuredContent, isError: response.result.isError }
}

function toolDefs(variant: 'baseline' | 'drifted') {
  return toolsFor(variant).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

function bundleFor(variant: 'baseline' | 'drifted'): EvidenceBundle {
  const tools = toolDefs(variant)
  return {
    schema: 'preflight-evidence-v1',
    agentId: '42',
    tokenURI: 'https://cards.invalid/42.json',
    card: { name: 'Demo agent' },
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

/** The real gate, with only the registry read stubbed and the live surface read from E1's own defs. */
function realVet(graded: 'baseline' | 'drifted') {
  const bundle = bundleFor(graded)
  const record: ValidationRecord & { lastUpdate: number } = {
    agentId: '42',
    score: 75,
    responseURI: 'https://evidence.invalid/42.json',
    responseHash: hashCanonical(canonicalize(bundle)),
    tag: METHODOLOGY_VERSION,
    validator: VALIDATOR,
    expiresAt: NOW + 3600,
    lastUpdate: NOW - 120,
    txHash: '0xabc',
  }
  return async (ref: string, minGrade: 'A' | 'B' | 'C' | 'D' | 'F'): Promise<GateDecision> =>
    vetAgent(ref, { minGrade, maxAgeSeconds: 86_400 }, {
      now: NOW,
      validator: VALIDATOR,
      readRecord: async () => record,
      fetchEvidence: async () => canonicalize(bundle),
      resolveEndpoints: async () => [ENDPOINT],
      // The live surface is whatever the demo server is serving right now.
      fingerprintEndpoint: async () => {
        const { currentToolSurface } = await import('../../demo/variant-store.ts')
        const variant = await currentToolSurface()
        return fingerprintToolDefs(toolDefs(variant === 'drifted' ? 'drifted' : 'baseline')).fingerprint
      },
    })
}

// --- the tool surface -------------------------------------------------------

test('the server lists exactly the two fixed tool names', async () => {
  const response = (await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
    result: { tools: { name: string; inputSchema: { required: string[] } }[] }
  }
  assert.deepEqual(
    response.result.tools.map((tool) => tool.name),
    ['preflight_agent', 'preflight_tx'],
  )
  assert.deepEqual(response.result.tools[0].inputSchema.required, ['ref'])
  assert.deepEqual(response.result.tools[1].inputSchema.required, [
    'chainId',
    'from',
    'to',
    'calldata',
    'value',
  ])
})

test('it ships unmetered: no price and no 402 anywhere in what a client can see', async () => {
  const surface = JSON.stringify(TOOL_DEFINITIONS)
  const initialized = JSON.stringify(await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
  const verdict = JSON.stringify((await call(TX_TOOL, { chainId: 84532, from: FIXTURE_TX_DRAINER.from, to: FIXTURE_TX_DRAINER.to, calldata: FIXTURE_TX_DRAINER.calldata, value: '0' }, { guard: async () => FIXTURE_VERDICT_ALLOW })).payload)

  for (const text of [surface, initialized, verdict]) {
    assert.doesNotMatch(text, /\$\d|402|payment required|price|per call/i)
  }
})

// --- verdict equivalence, which is the acceptance test ----------------------

test('preflight_agent returns exactly what vetAgent returned, field for field', async () => {
  await resetToolSurface()
  const vet = realVet('baseline')
  const direct = await vet('42', 'B')
  const { payload, isError } = await call(AGENT_TOOL, { ref: '42' }, { vet })

  assert.equal(isError, false)
  assert.deepEqual(payload, serializeGateDecision(direct))
  assert.equal((payload as unknown as GateDecision).verdict, 'HIRE')
})

test('preflight_tx returns exactly what txGuard returned, field for field', async () => {
  const guard = async (): Promise<TxVerdict> => FIXTURE_VERDICT_BLOCK_DRAINER
  const direct = await guard()
  const { payload } = await call(
    TX_TOOL,
    {
      chainId: 84532,
      from: FIXTURE_TX_DRAINER.from,
      to: FIXTURE_TX_DRAINER.to,
      calldata: FIXTURE_TX_DRAINER.calldata,
      value: '0',
    },
    { guard },
  )
  assert.deepEqual(payload, serializeTxVerdict(direct) as unknown as JsonValue)
  assert.equal((payload as { verdict: string }).verdict, 'BLOCK')
  assert.equal((payload as { flags: unknown[] }).flags.length, 1)
})

test('a drifted target refuses through the tool exactly as it does through the sdk', async () => {
  await resetToolSurface()
  // Graded against the drifted surface while the target serves baseline: the gate refuses on drift.
  const vet = realVet('drifted')
  const direct = await vet('42', 'B')
  const { payload } = await call(AGENT_TOOL, { ref: '42' }, { vet })
  assert.deepEqual(payload, serializeGateDecision(direct))
  assert.equal((payload as unknown as GateDecision).verdict, 'REFUSE')
  assert.equal((payload as unknown as GateDecision).fingerprintMatch, false)
})

// --- the call is live, not cached ------------------------------------------

test('flipping the target surface between two calls changes the verdict', async () => {
  await resetToolSurface()
  const vet = realVet('baseline')

  const first = (await call(AGENT_TOOL, { ref: '42' }, { vet })).payload as unknown as GateDecision
  await setToolSurface('drifted')
  const second = (await call(AGENT_TOOL, { ref: '42' }, { vet })).payload as unknown as GateDecision
  await setToolSurface('baseline')
  const third = (await call(AGENT_TOOL, { ref: '42' }, { vet })).payload as unknown as GateDecision
  await resetToolSurface()

  assert.equal(first.verdict, 'HIRE')
  assert.equal(second.verdict, 'REFUSE', 'a cached read would have answered HIRE twice')
  assert.equal(second.fingerprintMatch, false)
  assert.equal(third.verdict, 'HIRE')
})

test('minGrade is honoured, and an unknown grade refuses rather than being ignored', async () => {
  await resetToolSurface()
  const vet = realVet('baseline')
  const strict = (await call(AGENT_TOOL, { ref: '42', minGrade: 'A' }, { vet })).payload as unknown as GateDecision
  assert.equal(strict.verdict, 'REFUSE')
  assert.match(strict.reason, /below the minimum of A/)

  const nonsense = (await call(AGENT_TOOL, { ref: '42', minGrade: 'Z' }, { vet })).payload as unknown as GateDecision
  assert.equal(nonsense.verdict, 'REFUSE')
  assert.match(nonsense.reason, /is not a grade/)
})

// --- bigints and malformed input -------------------------------------------

test('bigints survive the wire as decimal strings, with no precision lost', async () => {
  const huge = 2n ** 255n - 1n
  const verdict: TxVerdict = {
    ...FIXTURE_VERDICT_ALLOW,
    deltas: [{ token: 'native', owner: FIXTURE_TX_DRAINER.from, delta: -huge }],
    reproducibleFrom: { ...FIXTURE_VERDICT_ALLOW.reproducibleFrom, block: huge, value: huge },
  }
  const { payload } = await call(
    TX_TOOL,
    {
      chainId: 84532,
      from: FIXTURE_TX_DRAINER.from,
      to: FIXTURE_TX_DRAINER.to,
      calldata: '0x',
      value: huge.toString(),
    },
    { guard: async () => verdict },
  )
  const serialized = payload as unknown as { deltas: { delta: string }[]; reproducibleFrom: { block: string; value: string } }
  assert.equal(serialized.reproducibleFrom.block, huge.toString())
  assert.equal(serialized.reproducibleFrom.value, huge.toString())
  assert.equal(serialized.deltas[0].delta, (-huge).toString())
  assert.equal(BigInt(serialized.reproducibleFrom.value), huge)
})

test('the pending transaction is parsed strictly, and every rejection names its field', () => {
  const good = {
    chainId: 84532,
    from: FIXTURE_TX_DRAINER.from,
    to: FIXTURE_TX_DRAINER.to,
    calldata: '0x095ea7b3',
    value: '0',
  }
  assert.ok('tx' in parsePendingTx(good))

  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...good, chainId: undefined }, /chainId/],
    [{ ...good, chainId: 1.5 }, /chainId/],
    [{ ...good, from: '0x1234' }, /from/],
    [{ ...good, to: 'not-an-address' }, /to/],
    [{ ...good, calldata: '0x095ea7b' }, /calldata/],
    [{ ...good, calldata: 'no-prefix' }, /calldata/],
    [{ ...good, value: 'lots' }, /value/],
    [{ ...good, value: '-1' }, /value/],
    [{ ...good, value: {} }, /value/],
  ]
  for (const [args, pattern] of cases) {
    const parsed = parsePendingTx(args)
    assert.ok('error' in parsed, `${JSON.stringify(args)} should not parse`)
    assert.match(parsed.error, pattern)
  }
})

test('a malformed transaction blocks in the payload, never as a protocol error', async () => {
  const { payload, isError } = await call(TX_TOOL, { chainId: 84532, from: '0x00', to: '0x00', calldata: 'x', value: '0' })
  assert.equal(isError, false)
  assert.equal((payload as { verdict: string }).verdict, 'BLOCK')
  assert.match((payload as { reason: string }).reason, /blocks this action/)
})

// --- failures serialize as refusals ---------------------------------------

test('a gate that throws blocks in the payload, which a client cannot read as permission', async () => {
  const { payload, isError } = await call(
    TX_TOOL,
    { chainId: 84532, from: FIXTURE_TX_DRAINER.from, to: FIXTURE_TX_DRAINER.to, calldata: '0x', value: '0' },
    {
      guard: async () => {
        throw new Error('fetch failed: the RPC is gone')
      },
    },
  )
  assert.equal(isError, false)
  assert.equal((payload as { verdict: string }).verdict, 'BLOCK')
  assert.match((payload as { reason: string }).reason, /the RPC is gone/)
  assert.deepEqual((payload as { flags: unknown[] }).flags, [], 'a structural block carries no flags')
})

test('a vet that throws refuses in the payload', async () => {
  const { payload, isError } = await call(
    AGENT_TOOL,
    { ref: '42' },
    {
      vet: async () => {
        throw new Error('registry unreachable')
      },
    },
  )
  assert.equal(isError, false)
  assert.equal((payload as { verdict: string }).verdict, 'REFUSE')
  assert.match((payload as { reason: string }).reason, /registry unreachable/)
})

test('a missing ref refuses rather than throwing a schema error at the caller', async () => {
  const { payload } = await call(AGENT_TOOL, {})
  assert.equal((payload as { verdict: string }).verdict, 'REFUSE')
  assert.match((payload as { reason: string }).reason, /ref must be/)
})

test('an agent id sent as a number is accepted, because it is the same value', async () => {
  await resetToolSurface()
  const vet = realVet('baseline')
  const asNumber = (await call(AGENT_TOOL, { ref: 8427 } as unknown as JsonValue, { vet })).payload
  const asString = (await call(AGENT_TOOL, { ref: '8427' }, { vet })).payload
  assert.deepEqual(asNumber, asString, 'a stock client that coerces the id must get the same verdict')

  // A non-integer is still refused: it is not an id, and guessing is not this tool's job.
  const fractional = (await call(AGENT_TOOL, { ref: 1.5 } as unknown as JsonValue, { vet })).payload
  assert.equal((fractional as { verdict: string }).verdict, 'REFUSE')
})

test('an unknown tool is a protocol error, because it is not a verdict about anything', async () => {
  const response = (await dispatch({
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: { name: 'preflight_everything', arguments: {} },
  })) as { error: { code: number } }
  assert.equal(response.error.code, -32602)
})

test('a notification gets no response, and an unknown method is an error', async () => {
  assert.equal(await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)
  const response = (await dispatch({ jsonrpc: '2.0', id: 3, method: 'nope' })) as { error: { code: number } }
  assert.equal(response.error.code, -32601)
})

test('callPreflightTx and the dispatcher agree, so neither transport can answer differently', async () => {
  const args = { chainId: 84532, from: FIXTURE_TX_DRAINER.from, to: FIXTURE_TX_DRAINER.to, calldata: '0x', value: '7' }
  const deps = { guard: async () => FIXTURE_VERDICT_ALLOW }
  const direct = await callPreflightTx(args, deps)
  const viaDispatch = await call(TX_TOOL, args as unknown as JsonValue, deps)
  assert.deepEqual(viaDispatch.payload, direct.structuredContent)
})
