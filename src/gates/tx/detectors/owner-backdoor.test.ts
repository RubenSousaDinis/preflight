/**
 * B5e's rules, offline, against recorded storage diffs.
 *
 * Two of these matter more than the rest. A slot written back to the value it already held is not a
 * backdoor firing, and a selector present without any state change is not either. Both are how a
 * detector like this earns a reputation for crying wolf, and a flag nobody trusts blocks nothing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAddress, toFunctionSelector } from 'viem'
import { FingerprintError } from '../../../shared/errors.ts'
import type {
  Address,
  CallGraphEntry,
  CodeFingerprint,
  Hex,
  PendingTx,
  ProxyKind,
  SimulationResult,
} from '../../../shared/types.ts'
import { EIP1967_ADMIN_SLOT, EIP1967_IMPLEMENTATION_SLOT } from '../fingerprint.ts'
import { ownerBackdoor } from './owner-backdoor.ts'

const PROXY = getAddress('0x00000000000000000000000000000000000000a1')
const OWNABLE = getAddress('0x00000000000000000000000000000000000000b1')
const IMPL_V1 = getAddress('0x00000000000000000000000000000000000000c1')
const IMPL_V2 = getAddress('0x00000000000000000000000000000000000000c2')
const WALLET = '0x1111111111111111111111111111111111111111' as Address

const TX: PendingTx = { chainId: 84532, from: WALLET, to: PROXY, calldata: '0x4e71d92d', value: 0n }

function word(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
}

const ZERO_WORD = `0x${'00'.repeat(32)}` as Hex

function code(proxyKind: ProxyKind = 'eip1967'): CodeFingerprint {
  return { fingerprint: `0x${'11'.repeat(32)}`, proxyKind, resolved: [], observedBlock: 500n }
}

function sim(
  storage: Record<string, Record<string, Hex>>,
  pre: Record<string, Record<string, Hex>> = {},
  callGraph: CallGraphEntry[] = [],
): SimulationResult {
  return {
    block: 500n,
    reverted: false,
    balanceDeltas: [],
    approvalDeltas: [],
    callGraph,
    raw: {
      prestate: {
        pre: Object.fromEntries(Object.entries(pre).map(([a, s]) => [a.toLowerCase(), { storage: s }])),
        post: Object.fromEntries(
          Object.entries(storage).map(([a, s]) => [a.toLowerCase(), { storage: s }]),
        ),
      },
    },
  }
}

test('done-when 1: an implementation slot that moves during the call blocks', async () => {
  const flags = await ownerBackdoor(
    sim(
      { [PROXY]: { [EIP1967_IMPLEMENTATION_SLOT]: word(IMPL_V2) } },
      { [PROXY]: { [EIP1967_IMPLEMENTATION_SLOT]: word(IMPL_V1) } },
    ),
    TX,
    code(),
  )

  assert.equal(flags.length, 1)
  assert.equal(flags[0].id, 'owner-backdoor')
  assert.equal(flags[0].severity, 'block')
  assert.equal(flags[0].confirmedBy, 'simulation')
})

test('done-when 4: the detail quotes the slot, the value before, and the value after', async () => {
  const flags = await ownerBackdoor(
    sim(
      { [PROXY]: { [EIP1967_IMPLEMENTATION_SLOT]: word(IMPL_V2) } },
      { [PROXY]: { [EIP1967_IMPLEMENTATION_SLOT]: word(IMPL_V1) } },
    ),
    TX,
    code(),
  )

  assert.match(flags[0].detail, new RegExp(EIP1967_IMPLEMENTATION_SLOT))
  assert.match(flags[0].detail, new RegExp(IMPL_V1.toLowerCase()))
  assert.match(flags[0].detail, new RegExp(IMPL_V2.toLowerCase()))
})

test('done-when 2: a call that touches neither slot returns nothing', async () => {
  const other = `0x${'ab'.repeat(32)}` as Hex
  const flags = await ownerBackdoor(sim({ [PROXY]: { [other]: word(IMPL_V2) } }), TX, code())
  assert.deepEqual(flags, [])
})

test('the admin slot counts as much as the implementation slot', async () => {
  const flags = await ownerBackdoor(
    sim({ [PROXY]: { [EIP1967_ADMIN_SLOT]: word(IMPL_V2) } }, { [PROXY]: { [EIP1967_ADMIN_SLOT]: word(IMPL_V1) } }),
    TX,
    code(),
  )
  assert.equal(flags.length, 1)
  assert.match(flags[0].title, /admin slot/)
})

test('a slot written back to the value it already held is not a backdoor firing', async () => {
  const flags = await ownerBackdoor(
    sim(
      { [PROXY]: { [EIP1967_IMPLEMENTATION_SLOT]: word(IMPL_V1) } },
      { [PROXY]: { [EIP1967_IMPLEMENTATION_SLOT]: word(IMPL_V1) } },
    ),
    TX,
    code(),
  )
  assert.deepEqual(flags, [])
})

test('done-when 3: transferOwnership firing in a nested call still flags', async () => {
  const ownerSlot = `0x${'00'.repeat(31)}05` as Hex
  const nested: CallGraphEntry[] = [
    { from: WALLET, to: PROXY, selector: '0x4e71d92d', value: 0n },
    // Two hops down, which a top level selector scan would never see.
    { from: PROXY, to: OWNABLE, selector: toFunctionSelector('transferOwnership(address)') as Hex, value: 0n },
  ]
  const flags = await ownerBackdoor(
    sim({ [OWNABLE]: { [ownerSlot]: word(IMPL_V2) } }, { [OWNABLE]: { [ownerSlot]: word(IMPL_V1) } }, nested),
    TX,
    code('none'),
  )

  assert.equal(flags.length, 1)
  assert.match(flags[0].detail, /transferOwnership firing/)
  assert.match(flags[0].detail, new RegExp(ownerSlot))
})

test('an ownership selector that changed nothing is not a finding', async () => {
  const flags = await ownerBackdoor(
    sim({}, {}, [
      { from: WALLET, to: OWNABLE, selector: toFunctionSelector('transferOwnership(address)') as Hex, value: 0n },
    ]),
    TX,
    code('none'),
  )
  assert.deepEqual(flags, [])
})

test('done-when 5: an unresolved proxy throws rather than passing clean', async () => {
  await assert.rejects(
    () => ownerBackdoor(sim({}), TX, code('unknown')),
    (err: unknown) => err instanceof FingerprintError,
  )
})

test('a simulation with no storage diff throws rather than reporting no change', async () => {
  const empty: SimulationResult = {
    block: 500n,
    reverted: false,
    balanceDeltas: [],
    approvalDeltas: [],
    callGraph: [],
    raw: null,
  }
  await assert.rejects(
    () => ownerBackdoor(empty, TX, code()),
    (err: unknown) => err instanceof FingerprintError,
  )
})

test('one slot produces one flag, however many ways it was reached', async () => {
  const flags = await ownerBackdoor(
    sim(
      { [PROXY]: { [EIP1967_IMPLEMENTATION_SLOT]: word(IMPL_V2) } },
      { [PROXY]: { [EIP1967_IMPLEMENTATION_SLOT]: word(IMPL_V1) } },
      [{ from: WALLET, to: PROXY, selector: toFunctionSelector('upgradeTo(address)') as Hex, value: 0n }],
    ),
    TX,
    code(),
  )
  assert.equal(flags.length, 1)
})

test('a slot appearing only in post, with no prior value, is still a change from nothing', async () => {
  const flags = await ownerBackdoor(
    sim({ [PROXY]: { [EIP1967_IMPLEMENTATION_SLOT]: word(IMPL_V2) } }),
    TX,
    code(),
  )
  assert.equal(flags.length, 1)
  assert.match(flags[0].detail, new RegExp(ZERO_WORD))
  assert.match(flags[0].detail, /nobody to/)
})
