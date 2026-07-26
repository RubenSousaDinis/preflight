import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { Address, Hex } from '../shared/types.ts'
import { ENV } from '../shared/config.ts'
import {
  clearMirrorLinkMemory,
  listMirrorLinks,
  recordMirrorLink,
  sepoliaIdForMainnet,
} from './mirror-links.ts'
import {
  ensureSepoliaMirror,
  mainnetMarker,
  parseMainnetMarker,
  tagAgentUriForMirror,
} from './sepolia-mirror.ts'

const OWNER = '0x5555555555555555555555555555555555555555' as Address
const VALIDATOR = '0x1111111111111111111111111111111111111111' as Address

process.env[ENV.validatorAddress] = VALIDATOR

/*
  Every link write in this file goes to a scratch map.

  Without this the suite wrote `data/mainnet-sepolia-links.json`, which is committed and which the
  gate reads to find a mirrored agent's record. Running the tests emptied it, and the next lookup
  reported a graded agent as one nobody had ever graded.
*/
const LINKS_FILE = join(
  mkdtempSync(join(tmpdir(), 'preflight-mirror-links-')),
  'links.json',
)
process.env.PREFLIGHT_MIRROR_LINKS_FILE = LINKS_FILE

test('mainnet marker round-trips in a description', () => {
  assert.equal(parseMainnetMarker(mainnetMarker('2290')), '2290')
  assert.equal(parseMainnetMarker('hello [preflight:mainnet=19506] world'), '19506')
  assert.equal(parseMainnetMarker('no marker here'), null)
})

test('tagAgentUriForMirror embeds the marker in a data URI card', () => {
  const card = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Clawdia',
    description: 'manager',
    services: [{ name: 'MCP', endpoint: 'https://example.com/mcp' }],
  }
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(card), 'utf8').toString('base64')}`
  const tagged = tagAgentUriForMirror(uri, '2290')
  const json = JSON.parse(
    Buffer.from(tagged.slice('data:application/json;base64,'.length), 'base64').toString('utf8'),
  ) as { description: string }
  assert.match(json.description, /\[preflight:mainnet=2290\]/)
})

test('link writes land on the configured map, never on the committed one', () => {
  clearMirrorLinkMemory()
  recordMirrorLink({ mainnetId: '2290', sepoliaId: '90001', linkedAt: 1 })

  // The scratch file took the write.
  assert.match(readFileSync(LINKS_FILE, 'utf8'), /90001/)

  // And the durable map is untouched by anything this suite did.
  const durable = join(process.cwd(), 'data/mainnet-sepolia-links.json')
  assert.doesNotMatch(readFileSync(durable, 'utf8'), /90001/)
  clearMirrorLinkMemory()
})

test('mirror link memory records and resolves sepolia ids', () => {
  clearMirrorLinkMemory()
  recordMirrorLink({ mainnetId: '2290', sepoliaId: '90001', linkedAt: 1 })
  assert.equal(sepoliaIdForMainnet('2290'), '90001')
  assert.ok(listMirrorLinks().some((link) => link.mainnetId === '2290'))
  clearMirrorLinkMemory()
})

test('ensureSepoliaMirror is idempotent when a link already exists', async () => {
  clearMirrorLinkMemory()
  recordMirrorLink({ mainnetId: '2290', sepoliaId: '90001', linkedAt: 1 })

  const result = await ensureSepoliaMirror('2290', {
    mainnetOwner: OWNER,
    registerImpl: async () => {
      throw new Error('register must not run when a link exists')
    },
  })
  assert.equal(result.sepoliaId, '90001')
  assert.equal(result.created, false)
  assert.equal(result.txHash, null)
  assert.equal(result.mainnetOwner, OWNER)
  clearMirrorLinkMemory()
})

test('ensureSepoliaMirror records a new link through registerImpl', async () => {
  clearMirrorLinkMemory()
  const card = {
    name: 'Clawdia',
    services: [{ name: 'MCP', endpoint: 'https://example.com/mcp' }],
  }
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(card), 'utf8').toString('base64')}`

  const result = await ensureSepoliaMirror('2290', {
    mainnetOwner: OWNER,
    mainnetTokenURI: uri,
    registerImpl: async (agentURI) => {
      const json = JSON.parse(
        Buffer.from(
          agentURI.slice('data:application/json;base64,'.length),
          'base64',
        ).toString('utf8'),
      ) as { description: string }
      assert.match(json.description, /preflight:mainnet=2290/)
      return { sepoliaId: '90002', txHash: `0x${'ab'.repeat(32)}` as Hex }
    },
  })
  assert.equal(result.sepoliaId, '90002')
  assert.equal(result.created, true)
  assert.equal(sepoliaIdForMainnet('2290'), '90002')
  clearMirrorLinkMemory()
})
