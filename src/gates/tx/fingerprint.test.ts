/**
 * B4's acceptance tests, run against a stub reader.
 *
 * The stub is not a convenience. Checks 1 and 2 are "the same value twice at one block" and "a
 * different value after an implementation swap", and the second one cannot be produced on demand
 * against a live chain before D3's proxy exists. The stub also reaches the paths a real chain will
 * not hand over politely: a slot pointing at an address with no code, a Diamond answering with zero
 * facets, an RPC that dies mid resolution.
 *
 * The live counterpart, against real Base proxies, is `fingerprint.live.test.ts`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, getAddress, parseAbiParameters } from 'viem'
import { FingerprintError } from '../../shared/errors.ts'
import type { Address, Hex } from '../../shared/types.ts'
import {
  EIP1822_PROXIABLE_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  codeFingerprint,
  contractRef,
  delegatesExecution,
  minimalProxyTarget,
} from './fingerprint.ts'
import type { ChainReader } from './rpc.ts'

const PROXY = getAddress('0x00000000000000000000000000000000000000a1')
const IMPL_A = getAddress('0x00000000000000000000000000000000000000b1')
const IMPL_B = getAddress('0x00000000000000000000000000000000000000b2')
const BEACON = getAddress('0x00000000000000000000000000000000000000c1')
const FACET_1 = getAddress('0x00000000000000000000000000000000000000d1')
const FACET_2 = getAddress('0x00000000000000000000000000000000000000d2')
const PLAIN = getAddress('0x00000000000000000000000000000000000000e1')

const ZERO_WORD = `0x${'00'.repeat(32)}` as Hex

/** Runtime code with no DELEGATECALL: PUSH1 0x01, PUSH1 0x00, MSTORE, STOP. */
const PLAIN_CODE = '0x6001600052' as Hex
/** The same, plus a trailing DELEGATECALL. */
const DELEGATING_CODE = '0x6001600052f4' as Hex

function word(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
}

interface StubState {
  code: Record<string, Hex>
  storage: Record<string, Record<string, Hex>>
  calls: Record<string, Hex | Error>
}

function stub(state: Partial<StubState>): ChainReader & { reads: number } {
  const code = state.code ?? {}
  const storage = state.storage ?? {}
  const calls = state.calls ?? {}
  const reader = {
    chainId: 84532,
    reads: 0,
    async blockNumber() {
      return 100n
    },
    async code(address: Address) {
      reader.reads += 1
      return code[address.toLowerCase()] ?? '0x'
    },
    async storageAt(address: Address, slot: Hex) {
      return storage[address.toLowerCase()]?.[slot.toLowerCase()] ?? ZERO_WORD
    },
    async call(to: Address) {
      const answer = calls[to.toLowerCase()]
      if (answer === undefined) throw new Error('no function at that selector')
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  return reader
}

function eip1967Stub(implCode: Hex) {
  return stub({
    code: { [PROXY.toLowerCase()]: DELEGATING_CODE, [IMPL_A.toLowerCase()]: implCode },
    storage: {
      [PROXY.toLowerCase()]: { [EIP1967_IMPLEMENTATION_SLOT.toLowerCase()]: word(IMPL_A) },
    },
  })
}

test('check 1: two reads of the same address at the same block agree', async () => {
  const reader = eip1967Stub('0x60016002')
  const first = await codeFingerprint(84532, PROXY, 42n, reader)
  const second = await codeFingerprint(84532, PROXY, 42n, reader)
  assert.equal(first.fingerprint, second.fingerprint)
  assert.equal(first.observedBlock, 42n)
  assert.equal(second.observedBlock, 42n)
})

test('check 2: the fingerprint moves when the implementation code changes', async () => {
  const before = await codeFingerprint(84532, PROXY, 42n, eip1967Stub('0x60016002'))
  const after = await codeFingerprint(84532, PROXY, 43n, eip1967Stub('0x60016003'))
  assert.notEqual(before.fingerprint, after.fingerprint)
})

test('the proxy shell alone does not decide the fingerprint', async () => {
  // The rug pull this exists to catch: identical proxy bytecode, different implementation. A
  // fingerprint over the shell would report these as the same contract.
  const a = await codeFingerprint(84532, PROXY, 42n, eip1967Stub('0x6001'))
  const b = await codeFingerprint(84532, PROXY, 42n, eip1967Stub('0x6002'))
  assert.equal(a.resolved[0].codeHash, b.resolved[0].codeHash)
  assert.notEqual(a.fingerprint, b.fingerprint)
})

test('a repoint to byte identical code is not drift', async () => {
  const one = await codeFingerprint(84532, PROXY, 42n, eip1967Stub('0x6001'))
  const two = await codeFingerprint(
    84532,
    PROXY,
    42n,
    stub({
      code: { [PROXY.toLowerCase()]: DELEGATING_CODE, [IMPL_B.toLowerCase()]: '0x6001' },
      storage: {
        [PROXY.toLowerCase()]: { [EIP1967_IMPLEMENTATION_SLOT.toLowerCase()]: word(IMPL_B) },
      },
    }),
  )
  assert.equal(one.fingerprint, two.fingerprint)
  assert.notEqual(one.resolved[1].address, two.resolved[1].address)
})

test('check 3: proxyKind is eip1967 for the proxy and none for a plain contract', async () => {
  const proxy = await codeFingerprint(84532, PROXY, 42n, eip1967Stub('0x6001'))
  assert.equal(proxy.proxyKind, 'eip1967')
  assert.deepEqual(
    proxy.resolved.map((r) => r.address),
    [PROXY, IMPL_A],
  )

  const plain = await codeFingerprint(
    84532,
    PLAIN,
    42n,
    stub({ code: { [PLAIN.toLowerCase()]: PLAIN_CODE } }),
  )
  assert.equal(plain.proxyKind, 'none')
  assert.equal(plain.resolved.length, 1)
})

test('check 4: an address with no code throws rather than hashing empty bytes', async () => {
  await assert.rejects(
    () => codeFingerprint(84532, PLAIN, 42n, stub({})),
    (err: unknown) => err instanceof FingerprintError && /holds no code/.test((err as Error).message),
  )
})

test('check 5: observedBlock comes from the read, and reads at two blocks may differ', async () => {
  const early = await codeFingerprint(84532, PROXY, 10n, eip1967Stub('0x6001'))
  const late = await codeFingerprint(84532, PROXY, 999n, eip1967Stub('0x6002'))
  assert.equal(early.observedBlock, 10n)
  assert.equal(late.observedBlock, 999n)
  assert.notEqual(early.fingerprint, late.fingerprint)
})

test('a slot pointing at an address with no code is unknown, never none', async () => {
  const result = await codeFingerprint(
    84532,
    PROXY,
    42n,
    stub({
      code: { [PROXY.toLowerCase()]: DELEGATING_CODE },
      storage: {
        [PROXY.toLowerCase()]: { [EIP1967_IMPLEMENTATION_SLOT.toLowerCase()]: word(IMPL_A) },
      },
    }),
  )
  assert.equal(result.proxyKind, 'unknown')
})

test('code that delegates with no recognized pattern is unknown, never none', async () => {
  const result = await codeFingerprint(
    84532,
    PLAIN,
    42n,
    stub({ code: { [PLAIN.toLowerCase()]: DELEGATING_CODE } }),
  )
  assert.equal(result.proxyKind, 'unknown')
})

test('a beacon resolves through to its implementation, and both are composed', async () => {
  const reader = stub({
    code: {
      [PROXY.toLowerCase()]: DELEGATING_CODE,
      [BEACON.toLowerCase()]: PLAIN_CODE,
      [IMPL_A.toLowerCase()]: '0x6001',
    },
    storage: { [PROXY.toLowerCase()]: { [EIP1967_BEACON_SLOT.toLowerCase()]: word(BEACON) } },
    calls: { [BEACON.toLowerCase()]: word(IMPL_A) },
  })
  const result = await codeFingerprint(84532, PROXY, 42n, reader)
  assert.equal(result.proxyKind, 'beacon')
  assert.deepEqual(
    result.resolved.map((r) => r.address),
    [PROXY, BEACON, IMPL_A],
  )
})

test('a beacon that will not answer is unknown', async () => {
  const reader = stub({
    code: { [PROXY.toLowerCase()]: DELEGATING_CODE, [BEACON.toLowerCase()]: PLAIN_CODE },
    storage: { [PROXY.toLowerCase()]: { [EIP1967_BEACON_SLOT.toLowerCase()]: word(BEACON) } },
    calls: { [BEACON.toLowerCase()]: new Error('reverted') },
  })
  assert.equal((await codeFingerprint(84532, PROXY, 42n, reader)).proxyKind, 'unknown')
})

test('the EIP-1822 proxiable slot resolves as uups', async () => {
  const reader = stub({
    code: { [PROXY.toLowerCase()]: DELEGATING_CODE, [IMPL_A.toLowerCase()]: '0x6001' },
    storage: { [PROXY.toLowerCase()]: { [EIP1822_PROXIABLE_SLOT.toLowerCase()]: word(IMPL_A) } },
  })
  const result = await codeFingerprint(84532, PROXY, 42n, reader)
  assert.equal(result.proxyKind, 'uups')
})

test('an EIP-1167 minimal proxy resolves out of its own bytecode', async () => {
  const clone =
    `0x363d3d373d3d3d363d73${IMPL_A.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3` as Hex
  assert.equal(minimalProxyTarget(clone), IMPL_A)
  const reader = stub({
    code: { [PROXY.toLowerCase()]: clone, [IMPL_A.toLowerCase()]: '0x6001' },
  })
  const result = await codeFingerprint(84532, PROXY, 42n, reader)
  assert.equal(result.proxyKind, 'eip1167')
  assert.deepEqual(
    result.resolved.map((r) => r.address),
    [PROXY, IMPL_A],
  )
})

test('a Diamond enumerates its facets in loupe order', async () => {
  const facets = encodeAbiParameters(
    parseAbiParameters('(address facetAddress, bytes4[] functionSelectors)[]'),
    [
      [
        { facetAddress: FACET_1, functionSelectors: ['0xaabbccdd'] },
        { facetAddress: FACET_2, functionSelectors: ['0x11223344'] },
      ],
    ],
  )
  const reader = stub({
    code: {
      [PROXY.toLowerCase()]: DELEGATING_CODE,
      [FACET_1.toLowerCase()]: '0x6001',
      [FACET_2.toLowerCase()]: '0x6002',
    },
    calls: { [PROXY.toLowerCase()]: facets },
  })
  const result = await codeFingerprint(84532, PROXY, 42n, reader)
  assert.equal(result.proxyKind, 'diamond')
  assert.deepEqual(
    result.resolved.map((r) => r.address),
    [PROXY, FACET_1, FACET_2],
  )
})

test('facet order is part of the identity', async () => {
  const build = (first: Address, second: Address) =>
    encodeAbiParameters(parseAbiParameters('(address facetAddress, bytes4[] functionSelectors)[]'), [
      [
        { facetAddress: first, functionSelectors: ['0xaabbccdd'] },
        { facetAddress: second, functionSelectors: ['0x11223344'] },
      ],
    ])
  const code = {
    [PROXY.toLowerCase()]: DELEGATING_CODE,
    [FACET_1.toLowerCase()]: '0x6001' as Hex,
    [FACET_2.toLowerCase()]: '0x6002' as Hex,
  }
  const forward = await codeFingerprint(
    84532,
    PROXY,
    42n,
    stub({ code, calls: { [PROXY.toLowerCase()]: build(FACET_1, FACET_2) } }),
  )
  const reversed = await codeFingerprint(
    84532,
    PROXY,
    42n,
    stub({ code, calls: { [PROXY.toLowerCase()]: build(FACET_2, FACET_1) } }),
  )
  assert.notEqual(forward.fingerprint, reversed.fingerprint)
})

test('a Diamond with zero facets throws rather than returning an empty resolution', async () => {
  const empty = encodeAbiParameters(
    parseAbiParameters('(address facetAddress, bytes4[] functionSelectors)[]'),
    [[]],
  )
  await assert.rejects(
    () =>
      codeFingerprint(
        84532,
        PROXY,
        42n,
        stub({
          code: { [PROXY.toLowerCase()]: DELEGATING_CODE },
          calls: { [PROXY.toLowerCase()]: empty },
        }),
      ),
    (err: unknown) => err instanceof FingerprintError && /zero facets/.test((err as Error).message),
  )
})

test('an RPC that dies mid resolution throws FingerprintError, never a partial hash', async () => {
  const failing: ChainReader = {
    chainId: 84532,
    async blockNumber() {
      return 1n
    },
    async code(address) {
      if (address === PROXY) return DELEGATING_CODE
      throw new Error('socket hang up')
    },
    async storageAt() {
      return word(IMPL_A)
    },
    async call() {
      return '0x'
    },
  }
  await assert.rejects(
    () => codeFingerprint(84532, PROXY, 42n, failing),
    (err: unknown) => err instanceof FingerprintError,
  )
})

test('delegatesExecution skips PUSH immediates rather than counting them as opcodes', () => {
  // PUSH1 0xf4: the 0xf4 is data. Counting it would flag most of the chain as a proxy.
  assert.equal(delegatesExecution('0x60f4'), false)
  // PUSH32 covering a 0xf4, then STOP.
  assert.equal(delegatesExecution(`0x7f${'f4'.repeat(32)}00`), false)
  assert.equal(delegatesExecution('0xf4'), true)
  // CALLCODE counts too: it is the same hazard with an older opcode.
  assert.equal(delegatesExecution('0xf2'), true)
  assert.equal(delegatesExecution('0x'), false)
})

test('minimalProxyTarget rejects anything that is not the canonical 45 byte clone', () => {
  assert.equal(minimalProxyTarget(PLAIN_CODE), null)
  assert.equal(minimalProxyTarget(`0x363d3d373d3d3d363d73${IMPL_A.slice(2)}` as Hex), null)
})

test('contractRef is eip155 and checksummed, whatever case it was handed', () => {
  assert.equal(
    contractRef(8453, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address),
    'eip155:8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  )
})

test('an address that is not an address throws rather than being read', async () => {
  await assert.rejects(
    () => codeFingerprint(84532, 'not-an-address' as Address, 42n, stub({})),
    (err: unknown) => err instanceof FingerprintError,
  )
})
