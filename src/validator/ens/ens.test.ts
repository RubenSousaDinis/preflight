import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeFunctionData, type PublicClient } from 'viem'

import { ENV } from '../../shared/config.ts'
import { isPreflightError } from '../../shared/errors.ts'
import type { Address, Hex } from '../../shared/types.ts'
import { agentEnsName, expandAgentEnsName, labelHashFor, nodeFor, subnameLabelFor } from './names.ts'
import {
  ENS_KEYS,
  EVIDENCE_URI_MAX_CHARS,
  buildTextRecords,
  sourcePointer,
  type TextRecordInput,
} from './records.ts'
import {
  ENS_RESOLVER_ABI,
  ZERO_ADDRESS,
  agentIdForEnsName,
  assembleTextCalls,
  canValidatorWriteMirror,
  claimSubname,
  ensureSubname,
  planSubname,
  readAgentRecords,
  verifyMirror,
  type EnsTarget,
} from './client.ts'
import { EnsTextMirror, mirrorAfterPublish, type EnsMirrorJob } from './mirror.ts'

const VALIDATOR = '0x1111111111111111111111111111111111111111' as Address
const STRANGER = '0x2222222222222222222222222222222222222222' as Address
const AGENT_OWNER = '0x5555555555555555555555555555555555555555' as Address
const RESOLVER = '0x3333333333333333333333333333333333333333' as Address
const REGISTRY = '0x4444444444444444444444444444444444444444' as Address
const EVIDENCE_HASH = `0x${'ab'.repeat(32)}` as Hex

// planSubname compares the parent owner to the configured validator (the signer), not to the
// intended subname owner. Offline fixtures use this fixed address.
process.env[ENV.validatorAddress] = VALIDATOR

const TARGET: EnsTarget = {
  chainId: 84532,
  registry: REGISTRY,
  parent: 'preflight.base.eth',
  resolver: RESOLVER,
  parentNode: nodeFor('preflight.base.eth'),
}

function recordInput(overrides: Partial<TextRecordInput> = {}): TextRecordInput {
  return {
    agentId: '8427',
    grade: 'A',
    score: 100,
    evidenceURI: 'ipfs://bafybeigdyrztest',
    evidenceHash: EVIDENCE_HASH,
    registry: REGISTRY,
    chainId: 84532,
    updatedAt: 1_753_000_000,
    methodology: 'litmus-v16',
    ...overrides,
  }
}

/**
 * A registry and resolver that answer from a plain object.
 *
 * Everything below runs against this: no network, no key, no chain. What is being checked is which
 * call would be made and what would be refused, and both are decidable offline.
 */
function fakeChain(state: {
  parentOwner?: Address
  parentResolver?: Address
  owner?: Address
  resolver?: Address
  text?: Record<string, string>
}): { client: PublicClient; reads: string[] } {
  const reads: string[] = []
  const node = nodeFor(agentEnsName('8427', TARGET.parent))
  const client = {
    readContract: async ({
      functionName,
      args,
    }: {
      functionName: string
      args: readonly unknown[]
    }) => {
      reads.push(functionName)
      const forParent = args[0] === TARGET.parentNode
      if (functionName === 'owner') {
        return forParent ? (state.parentOwner ?? VALIDATOR) : (state.owner ?? ZERO_ADDRESS)
      }
      if (functionName === 'resolver') {
        if (forParent) return state.parentResolver ?? RESOLVER
        return state.resolver ?? ZERO_ADDRESS
      }
      if (functionName === 'text') {
        assert.equal(args[0], node, 'text was read against the agent node')
        return state.text?.[args[1] as string] ?? ''
      }
      throw new Error(`the fake chain was asked for ${functionName}`)
    },
  } as unknown as PublicClient
  return { client, reads }
}

test('a subname label is derived from the agent id, and nothing else is an agent id', () => {
  assert.equal(subnameLabelFor('8427'), 'agent8427')
  assert.equal(agentEnsName('8427', 'preflight.base.eth'), 'agent8427.preflight.base.eth')
  for (const notAnId of ['0xdeadbeef', 'agent8427', 'https://example.com/mcp', '', '84 27']) {
    assert.throws(() => subnameLabelFor(notAnId), /is not an agent id/, `${notAnId} was accepted`)
  }
})

test('an ENS input expands under the parent, and foreign names are refused', () => {
  assert.equal(
    expandAgentEnsName('agent8427', 'preflight.basetest.eth'),
    'agent8427.preflight.basetest.eth',
  )
  assert.equal(
    expandAgentEnsName('Agent8427.Preflight.Basetest.ETH', 'preflight.basetest.eth'),
    'agent8427.preflight.basetest.eth',
  )
  assert.throws(
    () => expandAgentEnsName('8427', 'preflight.basetest.eth'),
    /not an agent ENS label/,
  )
  assert.throws(
    () => expandAgentEnsName('agent8427.other.eth', 'preflight.basetest.eth'),
    /not a name under/,
  )
})

test('a name is normalized before it is hashed, so one name has one node', () => {
  assert.equal(
    nodeFor('Agent8427.Preflight.Base.ETH'),
    nodeFor('agent8427.preflight.base.eth'),
    'a record written under one casing would be invisible to a reader of the other',
  )
  assert.notEqual(
    labelHashFor('agent8427'),
    nodeFor('agent8427'),
    'the label hash is not the namehash, and passing one for the other creates a subname of nothing',
  )
})

test('every key is written every time, with an empty string where a value is absent', () => {
  const records = buildTextRecords(recordInput())
  assert.deepEqual(Object.keys(records).sort(), [...ENS_KEYS].sort())
  assert.equal(records['preflight.grade'], 'A')
  assert.equal(records['preflight.score'], '100')
  assert.equal(records['preflight.registry'], sourcePointer(84532, REGISTRY))
  assert.equal(records['preflight.updatedAt'], '1753000000')
  // The clears. A sync that skipped these would leave a superseded value on the name.
  assert.equal(records['preflight.receipts.head'], '')
  assert.equal(records['preflight.receipts.count'], '')
  assert.equal(records['preflight.hcsTopic'], '')
  assert.equal(records['preflight.zerog'], '')
  assert.equal(records['preflight.hedera'], '')
  assert.equal(records.url, '')
})

test('url and description point at the Preflight grade page when an origin is given', () => {
  const records = buildTextRecords(
    recordInput({ appUrl: 'https://preflight-bay.vercel.app/a/8427' }),
  )
  assert.equal(records.url, 'https://preflight-bay.vercel.app/a/8427')
  assert.match(
    records.description,
    /Grade and evidence: https:\/\/preflight-bay\.vercel\.app\/a\/8427/,
  )
})

test('partner keys set only when 0G evidence or an HCS topic is present', () => {
  const zerog = buildTextRecords(
    recordInput({
      evidenceURI:
        'https://indexer-storage-testnet-turbo.0g.ai/file?root=0xabc',
    }),
  )
  assert.equal(
    zerog['preflight.zerog'],
    'https://indexer-storage-testnet-turbo.0g.ai/file?root=0xabc',
  )
  assert.equal(zerog['preflight.hedera'], '')

  const hedera = buildTextRecords(recordInput({ hcsTopic: '0.0.12345' }))
  assert.equal(hedera['preflight.zerog'], '')
  assert.equal(
    hedera['preflight.hedera'],
    'https://hashscan.io/testnet/topic/0.0.12345',
  )
  assert.equal(hedera['preflight.hcsTopic'], '0.0.12345')
})

test('the description says which of the two is the source', () => {
  const records = buildTextRecords(recordInput())
  assert.match(records.description, /mirror/)
  assert.match(records.description, /source/)
  assert.ok(
    records.description.includes(sourcePointer(84532, REGISTRY)),
    'someone arriving through a resolver is pointed at the record to check',
  )
})

test('an evidence URI too long for a text record leaves only its hash', () => {
  const short = buildTextRecords(recordInput({ evidenceURI: 'ipfs://bafyshort' }))
  assert.equal(short['preflight.evidence'], 'ipfs://bafyshort')

  const inline = `data:application/json;base64,${'A'.repeat(EVIDENCE_URI_MAX_CHARS)}`
  const long = buildTextRecords(recordInput({ evidenceURI: inline }))
  assert.equal(long['preflight.evidence'], '', 'the oversized URI is cleared rather than truncated')
  assert.equal(
    long['preflight.evidenceHash'],
    EVIDENCE_HASH,
    'the hash is always written, so a reader can still check the evidence',
  )
})

test('the multicall decodes back to one setText per key, in order', () => {
  const records = buildTextRecords(recordInput())
  const node = nodeFor(agentEnsName('8427', TARGET.parent))
  const plan = assembleTextCalls(node, records)

  assert.equal(plan.calls.length, ENS_KEYS.length)
  const outer = decodeFunctionData({ abi: ENS_RESOLVER_ABI, data: plan.multicall })
  assert.equal(outer.functionName, 'multicall')
  assert.deepEqual((outer.args as readonly (readonly Hex[])[])[0], plan.calls)

  const decoded = plan.calls.map((data) => decodeFunctionData({ abi: ENS_RESOLVER_ABI, data }))
  assert.deepEqual(
    decoded.map((call) => (call.args as readonly unknown[])[1]),
    [...ENS_KEYS],
  )
  for (const call of decoded) {
    assert.equal(call.functionName, 'setText')
    assert.equal((call.args as readonly unknown[])[0], node, 'every write is against the same node')
  }
  const grade = decoded[0].args as readonly unknown[]
  assert.equal(grade[2], 'A')
})

test('an unregistered subname plans as a create, resolver inherited from the parent', async () => {
  const { client } = fakeChain({ parentResolver: RESOLVER })
  const plan = await planSubname('8427', {
    target: { ...TARGET, resolver: null },
    client,
    owner: VALIDATOR,
  })
  assert.equal(plan.action, 'create')
  assert.equal(plan.refusal, null)
  assert.equal(plan.name, 'agent8427.preflight.base.eth')
  assert.equal(plan.intendedResolver, RESOLVER)
  assert.equal(plan.currentOwner, ZERO_ADDRESS)
})

test('a subname that is already ours and already resolved is planned as unchanged', async () => {
  const { client } = fakeChain({ owner: VALIDATOR, resolver: RESOLVER })
  const plan = await planSubname('8427', { target: TARGET, client, owner: VALIDATOR })
  assert.equal(plan.action, 'unchanged')
  assert.equal(plan.refusal, null)

  const result = await ensureSubname('8427', { target: TARGET, client, owner: VALIDATOR })
  assert.equal(result.txHash, null, 'a re-run during a demo costs no transaction')
  assert.equal(result.owner, VALIDATOR)
})

test('a subname held by somebody else is refused, never overwritten', async () => {
  const { client } = fakeChain({ owner: STRANGER, resolver: RESOLVER })
  const plan = await planSubname('8427', { target: TARGET, client, owner: VALIDATOR })
  assert.match(plan.refusal ?? '', /already owned by 0x2222/)

  await assert.rejects(
    () => ensureSubname('8427', { target: TARGET, client, owner: VALIDATOR }),
    (err: unknown) => isPreflightError(err) && err.code === 'ENS',
    'the refusal is typed, and it happens before a key is loaded',
  )
})

test('claiming for the agent owner is planned as a repoint when the validator holds the name', async () => {
  const { client } = fakeChain({ owner: VALIDATOR, resolver: RESOLVER })
  const plan = await planSubname('8427', { target: TARGET, client, owner: AGENT_OWNER })
  assert.equal(plan.refusal, null)
  assert.equal(plan.action, 'repoint')
  assert.equal(plan.intendedOwner, AGENT_OWNER)
})

test('claim is a no-op when the agent owner already holds the name', async () => {
  const { client } = fakeChain({ owner: AGENT_OWNER, resolver: RESOLVER })
  const result = await claimSubname('8427', {
    target: TARGET,
    client,
    agentOwner: AGENT_OWNER,
  })
  assert.equal(result.txHash, null)
  assert.equal(result.owner, AGENT_OWNER)
  assert.equal(result.agentOwner, AGENT_OWNER)
  assert.equal(result.recordsSeeded, false)
})

test('parent repoint is refused by default when the agent owner already holds the name', async () => {
  const { client } = fakeChain({ owner: AGENT_OWNER, resolver: RESOLVER })
  const plan = await planSubname('8427', {
    target: TARGET,
    client,
    owner: VALIDATOR,
  })
  assert.match(plan.refusal ?? '', /already owned by/)
})

test('parent repoint is allowed when claim seeds an already-owned empty name', async () => {
  const { client } = fakeChain({ owner: AGENT_OWNER, resolver: RESOLVER })
  const plan = await planSubname('8427', {
    target: TARGET,
    client,
    owner: VALIDATOR,
    allowParentRepoint: true,
  })
  assert.equal(plan.refusal, null)
  assert.equal(plan.action, 'repoint')
  assert.equal(plan.intendedOwner, VALIDATOR)
})

test('an unclaimed name is not writable by the validator mirror path', async () => {
  const { client } = fakeChain({})
  const access = await canValidatorWriteMirror('8427', { target: TARGET, client })
  assert.equal(access.writable, false)
  assert.match(access.reason ?? '', /not claimed yet/)
})

test('a validator-held name is writable; an owner-held name is not', async () => {
  const held = fakeChain({ owner: VALIDATOR, resolver: RESOLVER })
  const writable = await canValidatorWriteMirror('8427', { target: TARGET, client: held.client })
  assert.equal(writable.writable, true)

  const claimed = fakeChain({ owner: AGENT_OWNER, resolver: RESOLVER })
  const blocked = await canValidatorWriteMirror('8427', { target: TARGET, client: claimed.client })
  assert.equal(blocked.writable, false)
  assert.match(blocked.reason ?? '', /owned by 0x5555/)
})

test('a mainnet ENS target is refused before a write key is loaded', async () => {
  const { client } = fakeChain({ parentResolver: RESOLVER })
  await assert.rejects(
    () =>
      ensureSubname('8427', {
        target: { ...TARGET, chainId: 8453, parent: 'preflight.base.eth', parentNode: nodeFor('preflight.base.eth') },
        client,
        owner: VALIDATOR,
      }),
    (err: unknown) =>
      isPreflightError(err) && err.code === 'ENS' && /Base Sepolia only/.test(err.message),
    'mainnet writes would spend real ETH and are refused',
  )
})

test('a parent we do not own is refused before anything is sent', async () => {
  const { client } = fakeChain({ parentOwner: STRANGER })
  const plan = await planSubname('8427', { target: TARGET, client, owner: VALIDATOR })
  assert.match(plan.refusal ?? '', /is owned by 0x2222/)
})

test('a parent with no resolver, and none configured, is refused rather than left answering nothing', async () => {
  const { client } = fakeChain({ parentResolver: ZERO_ADDRESS })
  const plan = await planSubname('8427', {
    target: { ...TARGET, resolver: null },
    client,
    owner: VALIDATOR,
  })
  assert.match(plan.refusal ?? '', /no resolver/)
})

test('records are read through the configured registry, not a universal resolver', async () => {
  const { client, reads } = fakeChain({
    owner: VALIDATOR,
    resolver: RESOLVER,
    text: { 'preflight.grade': 'A', 'preflight.evidence': '' },
  })
  const read = await readAgentRecords('8427', {
    target: TARGET,
    client,
    keys: ['preflight.grade', 'preflight.evidence'],
  })
  assert.equal(reads[0], 'resolver', 'the registry is asked which resolver answers for this node')
  assert.equal(read.resolver, RESOLVER)
  assert.equal(read.records['preflight.grade'], 'A')
  assert.ok(
    !('preflight.evidence' in read.records),
    'a cleared record reads as absent rather than as an empty value',
  )
})

test('a name with no resolver reads as no records at all', async () => {
  const { client } = fakeChain({ resolver: ZERO_ADDRESS })
  const read = await readAgentRecords('8427', { target: TARGET, client })
  assert.equal(read.resolver, null)
  assert.deepEqual(read.records, {})
})

test('an ENS name converts to the agent id via the mirror text record', async () => {
  const { client } = fakeChain({
    resolver: RESOLVER,
    text: { 'preflight.agentId': '8427' },
  })
  const resolved = await agentIdForEnsName('agent8427.preflight.base.eth', {
    target: TARGET,
    client,
  })
  assert.equal(resolved.agentId, '8427')
  assert.equal(resolved.name, 'agent8427.preflight.base.eth')

  const fromLabel = await agentIdForEnsName('agent8427', { target: TARGET, client })
  assert.equal(fromLabel.agentId, '8427')
})

test('verify reports the keys that disagree with the registry, and only those', async () => {
  const expected = buildTextRecords(recordInput())
  const { client } = fakeChain({
    resolver: RESOLVER,
    text: { ...expected, 'preflight.grade': 'F' },
  })
  const verification = await verifyMirror('8427', expected, { target: TARGET, client })
  assert.equal(verification.ok, false)
  assert.deepEqual(verification.diffs, [{ key: 'preflight.grade', expected: 'A', actual: 'F' }])
  assert.equal(verification.checked, ENS_KEYS.length)

  const agreeing = fakeChain({ resolver: RESOLVER, text: expected })
  const clean = await verifyMirror('8427', expected, { target: TARGET, client: agreeing.client })
  assert.equal(clean.ok, true)
  assert.deepEqual(clean.diffs, [])
})

function heldMirror() {
  const seen: EnsMirrorJob[] = []
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const mirror = new EnsTextMirror(TARGET, {
    retryDelayMs: 1,
    write: async (job) => {
      seen.push(job)
      await held
      return `0x${'ee'.repeat(32)}` as Hex
    },
  })
  return { mirror, seen, release: () => release() }
}

function job(updatedAt: number, grade: 'A' | 'F' = 'A'): EnsMirrorJob {
  return {
    agentId: '8427',
    updatedAt,
    records: buildTextRecords(recordInput({ grade, score: grade === 'A' ? 100 : 0, updatedAt })),
  }
}

test('a queued sync is replaced by a newer grade for the same agent, never followed by it', async () => {
  const { mirror, seen, release } = heldMirror()
  mirror.submit(job(1))
  await new Promise((resolve) => setTimeout(resolve, 10))
  mirror.submit(job(2))
  mirror.submit(job(3, 'F'))
  assert.equal(mirror.state().pending, 1, 'one agent is one pending job, whatever was submitted')

  release()
  const state = await mirror.flush(2_000)
  assert.equal(seen.length, 2, 'the in-flight job, then the newest one, and not the one between')
  assert.equal(seen[1].records['preflight.grade'], 'F')
  assert.equal(state.pending, 0)
  assert.equal(state.superseded, 2)
})

test('a sync older than the one already queued is discarded', async () => {
  const { mirror, seen, release } = heldMirror()
  mirror.submit(job(10))
  await new Promise((resolve) => setTimeout(resolve, 10))
  mirror.submit(job(30, 'F'))
  mirror.submit(job(20))
  release()
  await mirror.flush(2_000)
  assert.equal(seen.at(-1)?.updatedAt, 30, 'the newest grade is the one on the name')
})

test('a mirror that cannot write says so in its state and raises nothing', async () => {
  const mirror = new EnsTextMirror(TARGET, {
    retryDelayMs: 1,
    write: async () => {
      throw new Error('the resolver rejected it')
    },
  })
  assert.doesNotThrow(() => mirror.submit(job(1)))
  await new Promise((resolve) => setTimeout(resolve, 60))
  const state = mirror.state()
  assert.ok(state.failed > 0)
  assert.equal(state.lastError, 'the resolver rejected it')
  assert.equal(state.mirrored, 0, 'nothing is counted as mirrored that did not land')
  mirror.close()
})

test('one agent that cannot be written does not stall the others', async () => {
  const written: string[] = []
  const mirror = new EnsTextMirror(TARGET, {
    retryDelayMs: 1,
    write: async (queued) => {
      if (queued.agentId === '8427') throw new Error('poisoned')
      written.push(queued.agentId)
      return `0x${'ee'.repeat(32)}` as Hex
    },
  })
  mirror.submit(job(1))
  mirror.submit({ ...job(1), agentId: '9001' })
  await mirror.flush(3_000)
  assert.deepEqual(written, ['9001'])
  mirror.close()
})

test('a closed mirror accepts nothing further', async () => {
  const { mirror, seen, release } = heldMirror()
  mirror.close()
  mirror.submit(job(1))
  release()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(seen, [])
})

test('the publish hook is quiet when no ENS target is configured', () => {
  const saved = process.env[ENV.ensChainId]
  delete process.env[ENV.ensChainId]
  try {
    const result = mirrorAfterPublish({
      agentId: '8427',
      score: 100,
      responseURI: 'ipfs://bafy',
      responseHash: EVIDENCE_HASH,
      tag: 'litmus-v16',
      lastUpdate: 1_753_000_000,
      registry: REGISTRY,
      chainId: 84532,
    })
    assert.equal(result.mirror, null)
    assert.match(result.skipped ?? '', /no ENS target|is missing/)
  } finally {
    if (saved !== undefined) process.env[ENV.ensChainId] = saved
  }
})

test('the publish hook queues what the registry read said, and never throws', async () => {
  const seen: EnsMirrorJob[] = []
  const mirror = new EnsTextMirror(TARGET, {
    retryDelayMs: 1,
    write: async (queued) => {
      seen.push(queued)
      return `0x${'ee'.repeat(32)}` as Hex
    },
  })
  const result = mirrorAfterPublish({
    agentId: '8427',
    score: 75,
    responseURI: 'ipfs://bafyevidence',
    responseHash: EVIDENCE_HASH,
    tag: 'litmus-v16',
    lastUpdate: 1_753_000_123,
    registry: REGISTRY,
    chainId: 84532,
    receiptsHead: `0x${'cd'.repeat(32)}` as Hex,
    receiptsCount: 4,
    mirror,
  })
  assert.equal(result.skipped, null)
  await mirror.flush(2_000)

  assert.equal(seen.length, 1)
  assert.equal(seen[0].records['preflight.grade'], 'B', 'the letter follows the score the registry holds')
  assert.equal(seen[0].records['preflight.updatedAt'], '1753000123')
  assert.equal(seen[0].records['preflight.receipts.count'], '4')
  assert.equal(seen[0].records['preflight.evidence'], 'ipfs://bafyevidence')
})

test('a score off the methodology scale is not mirrored as a letter', () => {
  const result = mirrorAfterPublish({
    agentId: '8427',
    score: 42,
    responseURI: 'ipfs://bafy',
    responseHash: EVIDENCE_HASH,
    tag: 'litmus-v16',
    lastUpdate: 1_753_000_000,
    registry: REGISTRY,
    chainId: 84532,
    mirror: new EnsTextMirror(TARGET, { write: async () => `0x${'ee'.repeat(32)}` as Hex }),
  })
  assert.equal(result.mirror, null)
  assert.match(result.skipped ?? '', /not a value this methodology writes/)
})
