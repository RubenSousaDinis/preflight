import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enumerateTools, fingerprintToolDefs, type ToolDef } from '@polygraphso/litmus'

import type { ToolSurfaceVariant } from '../shared/types.ts'
import { handleControlRequest } from './control.ts'
import { POISONED_OUTPUT, POISONED_TOOL, handleMcpRequest } from './mcp-server.ts'
import { BASELINE_TOOL_COUNT, DRIFTED_TOOL_COUNT, PAGE_SIZE } from './tool-surface.ts'
import { checkToolOutput } from './output-check.ts'
import { currentToolSurface, resetToolSurface, setToolSurface } from './variant-store.ts'

let nextId = 1

async function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const response = await handleMcpRequest(
    new Request('https://demo.invalid/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    }),
  )
  assert.equal(response.status, 200, `${method} answered ${response.status}`)
  return (await response.json()) as Record<string, unknown>
}

/**
 * Enumerates the surface through the engine's own paginating enumerator, which is the code B1's live
 * recheck runs. Testing pagination with a hand-rolled loop would prove our loop works, not that the
 * surface the gate sees is the whole surface.
 */
function engineClient(): { listTools: (params?: { cursor?: string }) => Promise<unknown> } {
  return {
    listTools: async (params) => {
      const body = await rpc('tools/list', params?.cursor ? { cursor: params.cursor } : {})
      return body.result
    },
  }
}

async function surfaceOf(variant: ToolSurfaceVariant): Promise<{ tools: ToolDef[]; fingerprint: string }> {
  await setToolSurface(variant)
  const listed = await enumerateTools(engineClient() as never)
  const defs: ToolDef[] = listed.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
  }))
  return { tools: defs, fingerprint: fingerprintToolDefs(defs).fingerprint }
}

test('the server initializes and echoes the protocol version a client asks for', async () => {
  await resetToolSurface()
  const body = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  })
  const result = body.result as Record<string, unknown>
  assert.equal(result.protocolVersion, '2025-03-26')
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } })
  assert.equal((result.serverInfo as Record<string, string>).name, 'preflight-demo-agent')
})

test('a notification gets no body, and an unknown method is a JSON-RPC error', async () => {
  const accepted = await handleMcpRequest(
    new Request('https://demo.invalid/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }),
  )
  assert.equal(accepted.status, 202)
  assert.equal(await accepted.text(), '')

  const body = await rpc('tools/nope')
  assert.equal((body.error as { code: number }).code, -32601)
})

test('tools/list spans more than one page, and a paginating client sees every tool', async () => {
  await resetToolSurface()
  const first = (await rpc('tools/list')).result as { tools: unknown[]; nextCursor?: string }
  assert.equal(first.tools.length, PAGE_SIZE)
  assert.ok(first.nextCursor, 'a single-page surface would let a paging bug ship undetected')

  const { tools } = await surfaceOf('baseline')
  assert.equal(tools.length, BASELINE_TOOL_COUNT)
  assert.ok(BASELINE_TOOL_COUNT > PAGE_SIZE)
})

test('a cursor this server did not issue is invalid params, not an empty page', async () => {
  const body = await rpc('tools/list', { cursor: 'not-a-cursor' })
  assert.equal((body.error as { code: number }).code, -32602)
})

test('drifted changes the tool count and the fingerprint, and the round trip restores both', async () => {
  const baseline = await surfaceOf('baseline')
  const drifted = await surfaceOf('drifted')
  const restored = await surfaceOf('baseline')

  assert.equal(baseline.tools.length, BASELINE_TOOL_COUNT)
  assert.equal(drifted.tools.length, DRIFTED_TOOL_COUNT)
  assert.notEqual(drifted.fingerprint, baseline.fingerprint)
  assert.equal(restored.fingerprint, baseline.fingerprint, 'byte for byte, or drift means nothing')
  assert.ok(drifted.tools.some((tool) => tool.name === 'transfer_funds'))
})

test('two reads of the same variant fingerprint identically', async () => {
  const one = await surfaceOf('baseline')
  const two = await surfaceOf('baseline')
  assert.equal(one.fingerprint, two.fingerprint)
})

test('poisoned keeps baseline\'s list exactly, and moves only the output', async () => {
  const baseline = await surfaceOf('baseline')
  const poisoned = await surfaceOf('poisoned')
  assert.deepEqual(poisoned.tools, baseline.tools)
  assert.equal(
    poisoned.fingerprint,
    baseline.fingerprint,
    'a poisoned list would make the gate refuse on drift and never reach the injection',
  )

  const called = (await rpc('tools/call', { name: POISONED_TOOL, arguments: { ids: 'src-1' } }))
    .result as { content: { type: string; text: string }[] }
  assert.equal(called.content[0].text, POISONED_OUTPUT)
  // Asserted through the detector rather than the wording: the payload is tuned to what the engine's
  // C-01 scanners actually catch, so a string assertion here would break every time it is tuned.
  assert.equal(checkToolOutput(called.content[0].text).hostile, true)

  await setToolSurface('baseline')
  const clean = (await rpc('tools/call', { name: POISONED_TOOL, arguments: { ids: 'src-1' } }))
    .result as { content: { text: string }[] }
  assert.equal(checkToolOutput(clean.content[0].text).hostile, false)
})

test('only the poisoned tool turns hostile, and only on that variant', async () => {
  await setToolSurface('poisoned')
  const other = (await rpc('tools/call', { name: 'search_sources', arguments: { query: 'x' } }))
    .result as { content: { text: string }[] }
  assert.equal(checkToolOutput(other.content[0].text).hostile, false)
  await resetToolSurface()
})

test('calling a tool the current variant does not carry is refused', async () => {
  await resetToolSurface()
  const body = await rpc('tools/call', { name: 'transfer_funds', arguments: {} })
  assert.equal((body.error as { code: number }).code, -32602)
})

test('the flip is idempotent, and readable before a run', async () => {
  await setToolSurface('drifted')
  await setToolSurface('drifted')
  assert.equal(await currentToolSurface(), 'drifted')
  await resetToolSurface()
  assert.equal(await currentToolSurface(), 'baseline')
})

// --- the control plane -----------------------------------------------------

async function control(method: 'GET' | 'POST', body?: unknown, token?: string): Promise<Response> {
  return handleControlRequest(
    new Request('https://demo.invalid/variant', {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

test('reading the variant is open, so state is confirmed rather than inferred', async () => {
  await resetToolSurface()
  const response = await control('GET')
  assert.equal(response.status, 200)
  const state = (await response.json()) as Record<string, unknown>
  assert.equal(state.variant, 'baseline')
  assert.equal(state.toolCount, BASELINE_TOOL_COUNT)
  assert.equal(state.driftedToolCount, DRIFTED_TOOL_COUNT)
})

test('a flip with no configured token is refused, and the surface does not move', async () => {
  const previous = process.env.DEMO_CONTROL_TOKEN
  delete process.env.DEMO_CONTROL_TOKEN
  try {
    const response = await control('POST', { variant: 'drifted' })
    assert.equal(response.status, 503)
    assert.match(String(((await response.json()) as { error: string }).error), /DEMO_CONTROL_TOKEN/)
    assert.equal(await currentToolSurface(), 'baseline')
  } finally {
    if (previous === undefined) delete process.env.DEMO_CONTROL_TOKEN
    else process.env.DEMO_CONTROL_TOKEN = previous
  }
})

test('a flip with the wrong token is refused, with the right one it lands', async () => {
  const previous = process.env.DEMO_CONTROL_TOKEN
  process.env.DEMO_CONTROL_TOKEN = 'stage-token'
  try {
    assert.equal((await control('POST', { variant: 'drifted' }, 'guess')).status, 401)
    assert.equal(await currentToolSurface(), 'baseline')

    const ok = await control('POST', { variant: 'drifted' }, 'stage-token')
    assert.equal(ok.status, 200)
    assert.equal(((await ok.json()) as { variant: string }).variant, 'drifted')
    assert.equal(await currentToolSurface(), 'drifted')

    assert.equal((await control('POST', { variant: 'sideways' }, 'stage-token')).status, 400)
  } finally {
    await resetToolSurface()
    if (previous === undefined) delete process.env.DEMO_CONTROL_TOKEN
    else process.env.DEMO_CONTROL_TOKEN = previous
  }
})

test('a surface named in the URL is served without touching the flippable state', async () => {
  await resetToolSurface()
  const call = async (query: string, method: string, params: unknown = {}) => {
    const response = await handleMcpRequest(
      new Request(`https://demo.invalid/mcp${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    )
    return (await response.json()) as { result: Record<string, unknown> }
  }

  // The store says baseline throughout; the URL decides per request.
  const drifted = await call('?surface=drifted', 'tools/list', { cursor: undefined })
  const baseline = await call('', 'tools/list', {})
  assert.equal((drifted.result.tools as unknown[]).length, PAGE_SIZE)
  assert.ok(drifted.result.nextCursor)
  assert.equal(await currentToolSurface(), 'baseline', 'the URL override leaves the state alone')

  const poisonedCall = await call('?surface=poisoned', 'tools/call', {
    name: POISONED_TOOL,
    arguments: { ids: 'src-1' },
  })
  const text = (poisonedCall.result.content as { text: string }[])[0].text
  assert.equal(checkToolOutput(text).hostile, true, 'the named surface is hostile without any flip')

  const cleanCall = await call('', 'tools/call', { name: POISONED_TOOL, arguments: { ids: 'src-1' } })
  const cleanText = (cleanCall.result.content as { text: string }[])[0].text
  assert.equal(checkToolOutput(cleanText).hostile, false)
  assert.equal((baseline.result.tools as unknown[]).length, PAGE_SIZE)

  // An unknown surface name is ignored rather than guessed at, so a typo cannot silently change a grade.
  const typo = await call('?surface=poisonned', 'tools/call', { name: POISONED_TOOL, arguments: {} })
  assert.equal(checkToolOutput((typo.result.content as { text: string }[])[0].text).hostile, false)
})
