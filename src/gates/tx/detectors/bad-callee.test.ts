/**
 * B5d's rules, offline.
 *
 * The two that keep this detector shippable are the ones that must not fire: a payment to a wallet
 * is not a call to an unverified contract, and a zero value call is not a value route. Without
 * those, this flag fires on the honest path and stops meaning anything.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAddress } from 'viem'
import { SimulationError } from '../../../shared/errors.ts'
import type {
  Address,
  CallGraphEntry,
  CodeFingerprint,
  PendingTx,
  SimulationResult,
} from '../../../shared/types.ts'
import { badCalleeWith, calleesOf, type CalleeLookups } from './bad-callee.ts'
import { KNOWN_BAD } from './known-bad.ts'

const ROUTER = getAddress('0x00000000000000000000000000000000000000a1')
const SINK = getAddress('0x00000000000000000000000000000000000000b1')
const VERIFIED_POOL = getAddress('0x00000000000000000000000000000000000000c1')
const PROXY_STUB = getAddress('0x00000000000000000000000000000000000000d1')
const HIDDEN_IMPL = getAddress('0x00000000000000000000000000000000000000d2')
const WALLET = '0x1111111111111111111111111111111111111111' as Address
const EOA = getAddress('0x00000000000000000000000000000000000000e1')

const ONE = 10n ** 18n

const CODE: CodeFingerprint = {
  fingerprint: `0x${'11'.repeat(32)}`,
  proxyKind: 'none',
  resolved: [],
  observedBlock: 500n,
}

function tx(to: Address, value = ONE): PendingTx {
  return { chainId: 84532, from: WALLET, to, calldata: '0xd0e30db0', value }
}

function sim(callGraph: CallGraphEntry[], balanceMoved = true): SimulationResult {
  return {
    block: 500n,
    reverted: false,
    balanceDeltas: balanceMoved ? [{ token: 'native', owner: WALLET, delta: -ONE }] : [],
    approvalDeltas: [],
    callGraph,
    raw: null,
  }
}

const withCode = new Set<string>([
  ROUTER,
  SINK,
  VERIFIED_POOL,
  PROXY_STUB,
  HIDDEN_IMPL,
  KNOWN_BAD[0].address,
])
const isVerified = new Set<string>([ROUTER, VERIFIED_POOL, PROXY_STUB])

const lookups: CalleeLookups = {
  hasCode: async (_chain, address) => withCode.has(address),
  resolve: async (_chain, address) =>
    address === PROXY_STUB
      ? {
          ...CODE,
          proxyKind: 'eip1967',
          resolved: [
            { address: PROXY_STUB, codeHash: `0x${'22'.repeat(32)}` },
            { address: HIDDEN_IMPL, codeHash: `0x${'33'.repeat(32)}` },
          ],
        }
      : { ...CODE, resolved: [{ address, codeHash: `0x${'22'.repeat(32)}` }] },
  verified: async (_chain, address) =>
    isVerified.has(address)
      ? { verified: true, determinate: true, note: 'source verified, exact_match' }
      : { verified: false, determinate: true, note: 'source not verified' },
}

const detect = badCalleeWith(lookups)

test('done-when 1: a verified callee routing value to an unverified one blocks', async () => {
  const flags = await detect(
    sim([
      { from: WALLET, to: ROUTER, selector: '0xd0e30db0', value: ONE },
      { from: ROUTER, to: SINK, selector: '0x', value: ONE },
    ]),
    tx(ROUTER),
    CODE,
  )

  assert.equal(flags.length, 1)
  assert.equal(flags[0].id, 'bad-callee')
  assert.equal(flags[0].severity, 'block')
  assert.equal(flags[0].confirmedBy, 'simulation')
})

test('done-when 5: the detail names the edge, not just the address', async () => {
  const flags = await detect(
    sim([
      { from: WALLET, to: ROUTER, selector: '0xd0e30db0', value: ONE },
      { from: ROUTER, to: SINK, selector: '0xabcdef01', value: ONE },
    ]),
    tx(ROUTER),
    CODE,
  )

  assert.match(flags[0].detail, new RegExp(ROUTER))
  assert.match(flags[0].detail, new RegExp(SINK))
  assert.match(flags[0].detail, /0xabcdef01/)
  assert.match(flags[0].detail, /1 ETH/)
})

test('done-when 2: a path where every callee is verified returns nothing', async () => {
  const flags = await detect(
    sim([
      { from: WALLET, to: ROUTER, selector: '0xd0e30db0', value: ONE },
      { from: ROUTER, to: VERIFIED_POOL, selector: '0x', value: ONE },
    ]),
    tx(ROUTER),
    CODE,
  )
  assert.deepEqual(flags, [])
})

test('done-when 3: a plain transfer to a wallet is not an unverified contract', async () => {
  const flags = await detect(
    sim([{ from: WALLET, to: EOA, selector: '0x', value: ONE }]),
    tx(EOA),
    CODE,
  )
  assert.deepEqual(flags, [])
})

test('done-when 4: a listed address flags whatever its verified status says', async () => {
  const listed = KNOWN_BAD[0]
  const flags = await detect(
    sim([{ from: WALLET, to: listed.address, selector: '0x', value: ONE }]),
    { chainId: listed.chainId, from: WALLET, to: listed.address, calldata: '0x', value: ONE },
    CODE,
  )

  assert.equal(flags.length, 1)
  assert.equal(flags[0].confirmedBy, 'static')
  assert.match(flags[0].detail, new RegExp(listed.source))
  assert.match(flags[0].detail, /re-derived from the repo alone/)
})

test('the same address on another chain is not the listed one', async () => {
  const listed = KNOWN_BAD[0]
  const flags = await detect(
    sim([{ from: WALLET, to: listed.address, selector: '0x', value: ONE }]),
    { chainId: 84532, from: WALLET, to: listed.address, calldata: '0x', value: ONE },
    CODE,
  )
  // Unverified on this chain in the stub, so it still blocks, but as a simulation finding rather
  // than a listed one. The point is that the list is keyed by chain.
  assert.equal(flags[0].confirmedBy, 'simulation')
})

test('a zero value call to an unverified contract is not this flag', async () => {
  const flags = await detect(
    sim(
      [
        { from: WALLET, to: ROUTER, selector: '0xd0e30db0', value: 0n },
        { from: ROUTER, to: SINK, selector: '0x70a08231', value: 0n },
      ],
      false,
    ),
    tx(ROUTER, 0n),
    CODE,
  )
  assert.deepEqual(flags, [])
})

test('a verified proxy in front of an unverified implementation still blocks', async () => {
  const flags = await detect(
    sim([
      { from: WALLET, to: ROUTER, selector: '0xd0e30db0', value: ONE },
      { from: ROUTER, to: PROXY_STUB, selector: '0x', value: ONE },
    ]),
    tx(ROUTER),
    CODE,
  )

  assert.equal(flags.length, 1)
  assert.match(flags[0].title, new RegExp(HIDDEN_IMPL))
  assert.match(flags[0].detail, new RegExp(`reached through ${PROXY_STUB}`))
})

test('one contract called five times is one finding', async () => {
  const edges: CallGraphEntry[] = [
    { from: WALLET, to: ROUTER, selector: '0xd0e30db0', value: ONE },
    ...Array.from(
      { length: 5 },
      (): CallGraphEntry => ({ from: ROUTER, to: SINK, selector: '0x', value: 1n }),
    ),
  ]
  const flags = await detect(sim(edges), tx(ROUTER), CODE)
  assert.equal(flags.length, 1)
})

test('an explorer that will not answer throws, so the gate blocks structurally', async () => {
  const failing: CalleeLookups = {
    ...lookups,
    verified: async () => ({
      verified: false,
      determinate: false,
      note: 'source status unavailable',
    }),
  }
  await assert.rejects(
    () =>
      badCalleeWith(failing)(
        sim([
          { from: WALLET, to: ROUTER, selector: '0xd0e30db0', value: ONE },
          { from: ROUTER, to: SINK, selector: '0x', value: ONE },
        ]),
        tx(ROUTER),
        CODE,
      ),
    (err: unknown) => err instanceof SimulationError,
  )
})

test('a transaction that moved value with no call graph throws', async () => {
  await assert.rejects(
    () => detect(sim([]), tx(ROUTER), CODE),
    (err: unknown) => err instanceof SimulationError && /no call graph/.test((err as Error).message),
  )
})

test('the direct callee is always judged, even before any value moves onward', () => {
  const callees = calleesOf(sim([], false), tx(ROUTER, 0n))
  assert.deepEqual([...callees.keys()], [ROUTER])
})
