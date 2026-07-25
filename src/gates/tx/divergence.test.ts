/**
 * B8's rules, offline.
 *
 * The cases that matter most are the ones that must not read as agreement: a transaction that has
 * not landed, a receipt that could not be read, a different transaction entirely. Each of those is
 * a distinct state and none of them is a match, because an empty comparison rendered green is the
 * worst output this can produce.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAddress, keccak256 } from 'viem'
import type { Address, BalanceDelta, Hex, TxTuple } from '../../shared/types.ts'
import { divergence, divergenceRows, landedDeltas, normalize } from './divergence.ts'
import { TRANSFER_TOPIC } from './trace.ts'

const TOKEN = getAddress('0x00000000000000000000000000000000000000a1')
const ALICE = getAddress('0x1111111111111111111111111111111111111111')
const BOB = getAddress('0x2222222222222222222222222222222222222222')
const CALLEE = getAddress('0x00000000000000000000000000000000000000c1')

const CALLDATA = '0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222' as Hex

const TUPLE: TxTuple = {
  block: 500n,
  from: ALICE,
  to: CALLEE,
  calldataHash: keccak256(CALLDATA),
  value: 0n,
}

function word(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
}

function amount(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, '0')}`
}

function landedTx(overrides: Record<string, unknown> = {}) {
  return {
    hash: '0xabc' as Hex,
    from: ALICE,
    to: CALLEE,
    value: 0n,
    input: CALLDATA,
    status: 'success' as const,
    blockNumber: 512n,
    logs: [
      {
        address: TOKEN,
        topics: [TRANSFER_TOPIC, word(ALICE), word(BOB)] as Hex[],
        data: amount(100n),
      },
    ],
    ...overrides,
  }
}

const PREDICTED: BalanceDelta[] = [
  { token: TOKEN, owner: ALICE, delta: -100n },
  { token: TOKEN, owner: BOB, delta: 100n },
]

test('done-when 1: predicted equals landed, with both sides listed', async () => {
  const result = await divergence(TUPLE, PREDICTED, landedTx())

  assert.equal(result.matched, true)
  assert.equal(result.simulated.length, 2)
  assert.equal(result.landed.length, 2)
  assert.match(result.notes, /agree on every balance change/)
  assert.match(result.notes, /Gas is excluded/)
})

test('deltas that match in value but differ in ordering still match', async () => {
  const reversed = [...PREDICTED].reverse()
  assert.equal((await divergence(TUPLE, reversed, landedTx())).matched, true)
})

test('done-when 3: one wei of difference is a mismatch, with no tolerance applied', async () => {
  const result = await divergence(
    TUPLE,
    [
      { token: TOKEN, owner: ALICE, delta: -101n },
      { token: TOKEN, owner: BOB, delta: 101n },
    ],
    landedTx(),
  )

  assert.equal(result.matched, false)
  assert.match(result.notes, /predicted -101, landed -100/)
  assert.match(result.notes, /difference of 1/)
})

test('a delta predicted but not landed is named, and the reverse too', async () => {
  const result = await divergence(TUPLE, PREDICTED, landedTx({ logs: [] }))

  assert.equal(result.matched, false)
  assert.match(result.notes, /landed nothing/)

  const other = await divergence(TUPLE, [], landedTx())
  assert.equal(other.matched, false)
  assert.match(other.notes, /predicted nothing, landed/)
})

test('done-when 4: a different transaction stops the comparison and says which field', async () => {
  const result = await divergence(TUPLE, PREDICTED, landedTx({ input: '0xdeadbeef' as Hex }))

  assert.equal(result.matched, false)
  assert.match(result.notes, /different transaction/)
  assert.match(result.notes, /the calldata/)
  assert.deepEqual(result.landed, [], 'no deltas were compared')
})

test('a different sender, callee, or value also stops the comparison', async () => {
  for (const [field, override] of [
    ['the sender', { from: BOB }],
    ['the callee', { to: TOKEN }],
    ['the value', { value: 5n }],
  ] as const) {
    const result = await divergence(TUPLE, PREDICTED, landedTx(override))
    assert.equal(result.matched, false)
    assert.match(result.notes, new RegExp(field))
  }
})

test('a transaction that has not landed is pending, never a match', async () => {
  const result = await divergence(TUPLE, PREDICTED, null)

  assert.equal(result.matched, false)
  assert.match(result.notes, /has not landed yet/)
  assert.deepEqual(result.landed, [])
  assert.equal(result.simulated.length, 2, 'the prediction is still shown')
})

test('a receipt that cannot be read is not compared, and says so is not agreement', async () => {
  const result = await divergence(TUPLE, PREDICTED, { nonsense: true })

  assert.equal(result.matched, false)
  assert.match(result.notes, /could not be read/)
  assert.match(result.notes, /not agreement/)
})

test('a landed transaction that reverted is a mismatch that names the drift', async () => {
  const result = await divergence(TUPLE, PREDICTED, landedTx({ status: 'reverted', logs: [] }))

  assert.equal(result.matched, false)
  assert.match(result.notes, /reverted after landing/)
  assert.match(result.notes, /block 500/)
  assert.match(result.notes, /block 512/)
  assert.match(result.notes, /not a prediction of what lands/)
})

test('native value moved is on both sides of the comparison', async () => {
  const tuple: TxTuple = { ...TUPLE, value: 10n ** 16n }
  const result = await divergence(
    tuple,
    [
      { token: 'native', owner: ALICE, delta: -(10n ** 16n) },
      { token: 'native', owner: CALLEE, delta: 10n ** 16n },
    ],
    landedTx({ value: 10n ** 16n, logs: [] }),
  )
  assert.equal(result.matched, true)
})

test('landed deltas come from Transfer logs, and a log that is not one is ignored', () => {
  const deltas = landedDeltas(
    landedTx({
      logs: [
        { address: TOKEN, topics: [TRANSFER_TOPIC, word(ALICE), word(BOB)] as Hex[], data: amount(7n) },
        { address: TOKEN, topics: [TRANSFER_TOPIC, word(ALICE)] as Hex[], data: amount(7n) },
      ],
    }) as never,
  )
  assert.equal(deltas.length, 2)
  assert.equal(deltas.find((d) => d.owner === BOB)?.delta, 7n)
})

test('normalize nets an owner out and drops the row when it cancels', () => {
  const netted = normalize([
    { token: TOKEN, owner: ALICE, delta: 5n },
    { token: TOKEN, owner: ALICE, delta: -5n },
    { token: TOKEN, owner: BOB, delta: 3n },
  ])
  assert.deepEqual(netted, [{ token: TOKEN, owner: BOB, delta: 3n }])
})

test('done-when 2: the rows carry both columns, with the differing one marked', async () => {
  const result = await divergence(
    TUPLE,
    [
      { token: TOKEN, owner: ALICE, delta: -100n },
      { token: TOKEN, owner: BOB, delta: 250n },
    ],
    landedTx(),
  )
  const rows = divergenceRows(result)

  assert.equal(rows.length, 2)
  const bob = rows.find((row) => row.owner === BOB)
  assert.ok(bob !== undefined)
  assert.equal(bob.predicted, '250')
  assert.equal(bob.landed, '100')
  assert.equal(bob.differs, true)
  assert.equal(rows.find((row) => row.owner === ALICE)?.differs, false)
})
