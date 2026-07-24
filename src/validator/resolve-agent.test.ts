import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { PublicClient } from 'viem'

import { AgentResolveError } from '../shared/errors.ts'
import { classifyScheme, fetchCardDocument } from './fetch-card.ts'
import { extractMcpEndpoints, extractSkillRefs, parseAgentCard } from './agent-card.ts'
import { readAgentURI, toTokenId } from './identity-registry.ts'
import { resolveAgent, resolveAgentDetailed } from './resolve-agent.ts'

/** A registration-v1 card, in the shape the live registry actually serves. */
const CARD = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: 'Demo agent',
  description: 'A card in the shape D1 registers.',
  services: [
    { name: 'web', endpoint: 'https://demo.example/' },
    { name: 'MCP', endpoint: 'https://demo.example/mcp' },
    { name: 'agentWallet', endpoint: 'eip155:8453:0x0000000000000000000000000000000000000001' },
    { name: 'OASF', endpoint: 'https://github.com/agntcy/oasf/', skills: ['a/b/search'] },
  ],
}

function dataUri(value: unknown): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(value)).toString('base64')}`
}

function stubClient(behaviour: {
  block?: bigint
  tokenURI?: string
  readError?: Error
  blockError?: Error
}): PublicClient {
  return {
    getBlockNumber: async () => {
      if (behaviour.blockError) throw behaviour.blockError
      return behaviour.block ?? 1000n
    },
    readContract: async () => {
      if (behaviour.readError) throw behaviour.readError
      return behaviour.tokenURI ?? dataUri(CARD)
    },
  } as unknown as PublicClient
}

/**
 * Runs a real local server and hands back a transport that points every https URL at it.
 *
 * The production code fetches https and nothing else, so the way to exercise a real socket, a real
 * 404, and a real hang without loosening that rule is to inject the transport and leave the scheme
 * check alone.
 */
async function withServer(
  handler: Parameters<typeof createServer>[1],
  body: (transport: typeof fetch) => Promise<void>,
): Promise<void> {
  const server: Server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const transport: typeof fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : String(input))
    return fetch(`http://127.0.0.1:${port}${url.pathname}`, init)
  }
  try {
    await body(transport)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

// --- the registry read -----------------------------------------------------

test('an id that is not a uint256 never reaches the RPC', () => {
  assert.throws(() => toTokenId('not-a-number'), AgentResolveError)
  assert.throws(() => toTokenId('0x01'), AgentResolveError)
  assert.throws(() => toTokenId(''), AgentResolveError)
  assert.equal(toTokenId(' 42 '), 42n)
})

test('an unregistered id throws, and the throw is not retryable', async () => {
  const client = stubClient({ readError: new Error('execution reverted: ERC721NonexistentToken') })
  await assert.rejects(
    () => readAgentURI('7', { client, chainId: 8453 }),
    (err: unknown) => {
      assert.ok(err instanceof AgentResolveError)
      assert.equal(err.retryable, false)
      assert.match(err.reason, /not registered/)
      return true
    },
  )
})

test('an RPC failure throws as retryable, and still refuses', async () => {
  const client = stubClient({ readError: new Error('fetch failed') })
  await assert.rejects(
    () => readAgentURI('7', { client, chainId: 8453 }),
    (err: unknown) => {
      assert.ok(err instanceof AgentResolveError)
      assert.equal(err.retryable, true)
      return true
    },
  )
})

test('a registered id with an empty tokenURI throws rather than returning an empty card', async () => {
  const client = stubClient({ tokenURI: '   ' })
  await assert.rejects(() => readAgentURI('7', { client, chainId: 8453 }), AgentResolveError)
})

test('the read is pinned to an explicit block, and the block is reported', async () => {
  const client = stubClient({ block: 4242n })
  const read = await readAgentURI('7', { client, chainId: 8453 })
  assert.equal(read.block, 4242n)
  const pinned = await readAgentURI('7', { client, chainId: 8453, atBlock: 99n })
  assert.equal(pinned.block, 99n)
})

// --- scheme classification and fetching -------------------------------------

test('https and data are fetched, and every other scheme is a typed failure', () => {
  assert.equal(classifyScheme('https://example.com/card.json'), 'https')
  assert.equal(classifyScheme('data:application/json,{}'), 'data')
  assert.throws(() => classifyScheme('http://example.com/card.json'), AgentResolveError)
  assert.throws(() => classifyScheme('ftp://example.com/card.json'), AgentResolveError)
  assert.throws(() => classifyScheme('example.com/card.json'), AgentResolveError)
})

test('an ipfs tokenURI refuses, and says what this project stores evidence on instead', () => {
  assert.throws(
    () => classifyScheme('ipfs://bafy/card.json'),
    (err: unknown) => {
      assert.ok(err instanceof AgentResolveError)
      assert.match(err.reason, /0G Storage/)
      return true
    },
  )
})

test('a data URI is decoded in process, base64 or percent encoded', async () => {
  const base64 = await fetchCardDocument(dataUri(CARD))
  assert.equal(base64.scheme, 'data')
  assert.deepEqual(JSON.parse(base64.text), CARD)

  const percent = await fetchCardDocument(
    `data:application/json,${encodeURIComponent(JSON.stringify(CARD))}`,
  )
  assert.deepEqual(JSON.parse(percent.text), CARD)
})

test('an oversized document throws instead of being parsed', async () => {
  await assert.rejects(
    () => fetchCardDocument(dataUri({ ...CARD, filler: 'x'.repeat(5_000) }), { maxBytes: 1_000 }),
    AgentResolveError,
  )

  await withServer(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...CARD, filler: 'x'.repeat(5_000) }))
    },
    async (transport) => {
      await assert.rejects(
        () => fetchCardDocument('https://cards.example/card.json', { maxBytes: 100, fetchImpl: transport }),
        AgentResolveError,
      )
    },
  )
})

test('a 404 throws rather than falling back to anything', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(404)
      res.end('not found')
    },
    async (transport) => {
      await assert.rejects(
        () => fetchCardDocument('https://cards.example/card.json', { fetchImpl: transport }),
        (err: unknown) => {
          assert.ok(err instanceof AgentResolveError)
          assert.match(err.reason, /HTTP 404/)
          assert.equal(err.retryable, false)
          return true
        },
      )
    },
  )
})

test('a hanging endpoint throws on the timeout rather than parking the caller', async () => {
  await withServer(
    () => {
      /* never responds */
    },
    async (transport) => {
      await assert.rejects(
        () =>
          fetchCardDocument('https://cards.example/card.json', {
            timeoutMs: 250,
            fetchImpl: transport,
          }),
        (err: unknown) => {
          assert.ok(err instanceof AgentResolveError)
          assert.equal(err.retryable, true)
          return true
        },
      )
    },
  )
})

test('an https card is fetched over a real socket and recorded as the registry gave it', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(CARD))
    },
    async (transport) => {
      const fetched = await fetchCardDocument('https://cards.example/card.json', {
        fetchImpl: transport,
      })
      assert.equal(fetched.scheme, 'https')
      assert.equal(fetched.tokenURI, 'https://cards.example/card.json')
      assert.deepEqual(JSON.parse(fetched.text), CARD)
      assert.equal(fetched.bytes, Buffer.byteLength(JSON.stringify(CARD)))
    },
  )
})

// --- parsing ---------------------------------------------------------------

test('MCP endpoints are read from a registration-v1 services array', () => {
  assert.deepEqual(extractMcpEndpoints(CARD), ['https://demo.example/mcp'])
  assert.deepEqual(extractMcpEndpoints({ endpoints: { mcp: 'https://a.example/mcp' } }), [
    'https://a.example/mcp',
  ])
  assert.deepEqual(extractMcpEndpoints({ mcpEndpoints: ['https://b.example/mcp'] }), [
    'https://b.example/mcp',
  ])
  assert.deepEqual(
    extractMcpEndpoints({ additionalInterfaces: [{ transport: 'MCP', url: 'https://c.example/mcp' }] }),
    ['https://c.example/mcp'],
  )
})

test('a wallet or a web service is not mistaken for a surface to grade', () => {
  assert.deepEqual(
    extractMcpEndpoints({
      services: [
        { name: 'web', endpoint: 'https://demo.example/' },
        { name: 'agentWallet', endpoint: 'eip155:8453:0x0000000000000000000000000000000000000001' },
      ],
    }),
    [],
  )
})

test('a card declaring no MCP endpoint throws, and an empty skill list does not', () => {
  assert.throws(
    () => parseAgentCard('7', 'data:', JSON.stringify({ name: 'No surface', services: [] })),
    (err: unknown) => {
      assert.ok(err instanceof AgentResolveError)
      assert.match(err.reason, /no MCP endpoint/)
      return true
    },
  )

  const card = parseAgentCard(
    '7',
    'data:',
    JSON.stringify({ services: [{ name: 'mcp', endpoint: 'https://d.example/mcp' }] }),
  )
  assert.deepEqual(card.skillRefs, [])
  assert.equal(card.name, '', 'a missing name degrades to an empty string, never null')
})

test('skill references are collected from wherever the card puts them', () => {
  assert.deepEqual(extractSkillRefs(CARD), ['a/b/search'])
  assert.deepEqual(extractSkillRefs({ skills: [{ id: 'summarize' }, 'search'] }), [
    'summarize',
    'search',
  ])
})

test('malformed JSON throws instead of producing a partial card', () => {
  assert.throws(() => parseAgentCard('7', 'data:', '{not json'), AgentResolveError)
  assert.throws(() => parseAgentCard('7', 'data:', '[]'), AgentResolveError)
})

test('raw round trips: the retained document reparses to an identical card', () => {
  const card = parseAgentCard('7', 'data:x', JSON.stringify(CARD))
  const reparsed = parseAgentCard('7', 'data:x', JSON.stringify(card.raw))
  assert.deepEqual(reparsed, card)
  assert.deepEqual(card.raw, CARD, 'nothing is added, removed, or normalized on the way through')
})

// --- end to end ------------------------------------------------------------

test('a registered id resolves to a card carrying its endpoints', async () => {
  const client = stubClient({ block: 777n, tokenURI: dataUri(CARD) })
  const resolved = await resolveAgentDetailed('7', { client, chainId: 8453 })
  assert.equal(resolved.card.agentId, '7')
  assert.equal(resolved.card.name, 'Demo agent')
  assert.deepEqual(resolved.card.mcpEndpoints, ['https://demo.example/mcp'])
  assert.equal(resolved.card.tokenURI.startsWith('data:'), true)
  assert.equal(resolved.block, 777n)

  const card = await resolveAgent('7', { client, chainId: 8453 })
  assert.deepEqual(card, resolved.card)
})
