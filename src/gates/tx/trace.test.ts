/**
 * The trace extraction, checked against recorded trace shapes.
 *
 * A live fork proves the extraction works on the one transaction it was handed. These prove the
 * rules: nesting order, what a mint looks like, which allowance wins when a transaction sets two,
 * and what happens to a log that only looks like a Transfer.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAddress } from 'viem'
import type { Address, Hex } from '../../shared/types.ts'
import {
  APPROVAL_TOPIC,
  TRANSFER_TOPIC,
  approvalDeltasFrom,
  balanceDeltasFrom,
  callGraphFrom,
  logsFrom,
  revertedFrom,
  storageWritesFrom,
  type CallFrame,
} from './trace.ts'

const TOKEN = getAddress('0x00000000000000000000000000000000000000a1')
const ALICE = '0x1111111111111111111111111111111111111111' as Address
const BOB = '0x2222222222222222222222222222222222222222' as Address
const ROUTER = '0x3333333333333333333333333333333333333333' as Address
const ZERO = '0x0000000000000000000000000000000000000000' as Address

function topic(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
}

function amount(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, '0')}`
}

function transferLog(token: Address, from: Address, to: Address, value: bigint) {
  return { address: token, topics: [TRANSFER_TOPIC, topic(from), topic(to)] as Hex[], data: amount(value) }
}

function approvalLog(token: Address, owner: Address, spender: Address, value: bigint) {
  return { address: token, topics: [APPROVAL_TOPIC, topic(owner), topic(spender)] as Hex[], data: amount(value) }
}

test('the call graph is pre-order, so a caller precedes the callees it produced', () => {
  const trace: CallFrame = {
    type: 'CALL',
    from: ALICE,
    to: ROUTER,
    input: '0x38ed1739aabbccdd',
    value: '0x0',
    calls: [
      { type: 'CALL', from: ROUTER, to: TOKEN, input: '0x23b872dd', value: '0x0' },
      {
        type: 'CALL',
        from: ROUTER,
        to: BOB,
        input: '0x',
        value: '0xde0b6b3a7640000',
        calls: [{ type: 'STATICCALL', from: BOB, to: TOKEN, input: '0x70a08231', value: '0x0' }],
      },
    ],
  }

  assert.deepEqual(callGraphFrom(trace), [
    { from: ALICE, to: ROUTER, selector: '0x38ed1739', value: 0n },
    { from: ROUTER, to: TOKEN, selector: '0x23b872dd', value: 0n },
    { from: ROUTER, to: BOB, selector: '0x', value: 10n ** 18n },
    { from: BOB, to: TOKEN, selector: '0x70a08231', value: 0n },
  ])
})

test('a contract creation carries no callee, so it is not a call graph entry', () => {
  const trace: CallFrame = {
    type: 'CALL',
    from: ALICE,
    to: ROUTER,
    input: '0x1234abcd',
    calls: [{ type: 'CREATE', from: ROUTER, input: '0x60806040' }],
  }
  assert.equal(callGraphFrom(trace).length, 1)
})

test('logs come back in emission order across the whole tree', () => {
  const trace: CallFrame = {
    from: ALICE,
    to: ROUTER,
    logs: [approvalLog(TOKEN, ALICE, ROUTER, 1n)],
    calls: [{ from: ROUTER, to: TOKEN, logs: [transferLog(TOKEN, ALICE, BOB, 5n)] }],
  }
  const logs = logsFrom(trace)
  assert.equal(logs.length, 2)
  assert.equal(logs[0].topics[0], APPROVAL_TOPIC)
  assert.equal(logs[1].topics[0], TRANSFER_TOPIC)
})

test('token movement nets per owner, and a round trip nets to nothing', () => {
  const trace: CallFrame = {
    from: ALICE,
    to: TOKEN,
    logs: [transferLog(TOKEN, ALICE, BOB, 100n), transferLog(TOKEN, BOB, ALICE, 100n)],
  }
  assert.deepEqual(balanceDeltasFrom(trace, {}), [])
})

test('a mint keeps its zero address counterparty rather than disappearing', () => {
  const trace: CallFrame = { from: ALICE, to: TOKEN, logs: [transferLog(TOKEN, ZERO, ALICE, 32_500_000n)] }
  const deltas = balanceDeltasFrom(trace, {})
  assert.deepEqual(deltas, [
    { token: TOKEN, owner: ZERO, delta: -32_500_000n },
    { token: TOKEN, owner: ALICE, delta: 32_500_000n },
  ])
})

test('native movement is read from the prestate diff, not from logs', () => {
  const deltas = balanceDeltasFrom(
    { from: ALICE, to: BOB },
    {
      pre: { [ALICE.toLowerCase()]: { balance: '0xde0b6b3a7640000' }, [BOB.toLowerCase()]: { balance: '0x0' } },
      post: { [ALICE.toLowerCase()]: { balance: '0x0' }, [BOB.toLowerCase()]: { balance: '0xde0b6b3a7640000' } },
    },
  )
  assert.deepEqual(deltas, [
    { token: 'native', owner: ALICE, delta: -(10n ** 18n) },
    { token: 'native', owner: BOB, delta: 10n ** 18n },
  ])
})

test('an account touched but not moved is not a delta', () => {
  const deltas = balanceDeltasFrom(
    { from: ALICE, to: BOB },
    { pre: { [ALICE.toLowerCase()]: { balance: '0x64' } }, post: { [ALICE.toLowerCase()]: { storage: {} } } },
  )
  assert.deepEqual(deltas, [])
})

test('the resulting allowance wins when a transaction sets two', () => {
  const trace: CallFrame = {
    from: ALICE,
    to: TOKEN,
    logs: [approvalLog(TOKEN, ALICE, ROUTER, 2n ** 256n - 1n), approvalLog(TOKEN, ALICE, ROUTER, 0n)],
  }
  assert.deepEqual(approvalDeltasFrom(trace), [
    { token: TOKEN, owner: ALICE, spender: ROUTER, amount: 0n },
  ])
})

test('two spenders on one token are two allowances', () => {
  const trace: CallFrame = {
    from: ALICE,
    to: TOKEN,
    logs: [approvalLog(TOKEN, ALICE, ROUTER, 5n), approvalLog(TOKEN, ALICE, BOB, 7n)],
  }
  assert.equal(approvalDeltasFrom(trace).length, 2)
})

test('a log that only looks like a Transfer is not counted as one', () => {
  const trace: CallFrame = {
    from: ALICE,
    to: TOKEN,
    // Two topics, not three: this is some other event that happens to share a name shape.
    logs: [{ address: TOKEN, topics: [TRANSFER_TOPIC, topic(ALICE)], data: amount(1n) }],
  }
  assert.deepEqual(balanceDeltasFrom(trace, {}), [])
})

test('storage writes report only slots that changed, with a zero default for an unread slot', () => {
  const slot = `0x${'ab'.repeat(32)}` as Hex
  const unchanged = `0x${'cd'.repeat(32)}` as Hex
  const writes = storageWritesFrom({
    pre: { [TOKEN.toLowerCase()]: { storage: { [unchanged]: amount(1n) } } },
    post: { [TOKEN.toLowerCase()]: { storage: { [slot]: amount(9n), [unchanged]: amount(1n) } } },
  })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].slot, slot)
  assert.equal(BigInt(writes[0].before), 0n)
  assert.equal(BigInt(writes[0].after), 9n)
})

test('a reverted root frame is reported, not thrown', () => {
  assert.equal(revertedFrom({ from: ALICE, to: TOKEN, error: 'execution reverted' }), true)
  assert.equal(revertedFrom({ from: ALICE, to: TOKEN }), false)
})
