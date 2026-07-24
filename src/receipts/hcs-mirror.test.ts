import { test } from 'node:test'
import assert from 'node:assert/strict'

import { FIXTURE_DECISION_HIRE, FIXTURE_DECISION_DRIFT } from '../shared/fixtures/index.ts'
import { ReceiptChain } from './receipt-chain.ts'
import { createSigner } from './signer.ts'
import { HcsReceiptMirror, type MirrorMessage } from './hcs-mirror.ts'

function recordingMirror(behaviour: { failFirst?: number; alwaysFail?: boolean } = {}) {
  const seen: MirrorMessage[] = []
  let failures = 0
  const mirror = new HcsReceiptMirror('0.0.test', {
    retryDelayMs: 1,
    submit: async (message) => {
      if (behaviour.alwaysFail === true) throw new Error('the topic rejected it')
      if (behaviour.failFirst !== undefined && failures < behaviour.failFirst) {
        failures += 1
        throw new Error('transient')
      }
      seen.push(message)
    },
  })
  return { mirror, seen }
}

test('a receipt is mirrored with its id, hash and index, and nothing else', async () => {
  const { mirror, seen } = recordingMirror()
  const chain = new ReceiptChain(createSigner(), mirror)
  const receipt = await chain.emit(FIXTURE_DECISION_HIRE)
  await mirror.flush(2_000)

  assert.deepEqual(seen, [{ receiptId: receipt.id, receiptHash: receipt.hash, index: 1 }])
  assert.deepEqual(Object.keys(seen[0]).sort(), ['index', 'receiptHash', 'receiptId'])
})

test('emitting does not wait on the mirror', async () => {
  let released: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    released = resolve
  })
  const mirror = new HcsReceiptMirror('0.0.test', { retryDelayMs: 1, submit: () => held })
  const chain = new ReceiptChain(createSigner(), mirror)

  const started = Date.now()
  await chain.emit(FIXTURE_DECISION_HIRE)
  await chain.emit(FIXTURE_DECISION_DRIFT)
  const elapsed = Date.now() - started

  assert.ok(elapsed < 200, `emitting took ${elapsed}ms, so it was waiting on the mirror`)
  assert.equal(chain.length, 2, 'both receipts exist locally while nothing has been mirrored')
  assert.equal(mirror.state().mirrored, 0)
  released()
})

test('a mirror that fails does not fail the chain, and the state says so', async () => {
  const { mirror } = recordingMirror({ alwaysFail: true })
  const chain = new ReceiptChain(createSigner(), mirror)

  const receipt = await chain.emit(FIXTURE_DECISION_HIRE)
  assert.ok(receipt.hash.startsWith('0x'), 'the receipt was produced regardless')
  assert.deepEqual(await chain.verify(), { ok: true, brokenAt: null, reason: null })

  await new Promise((resolve) => setTimeout(resolve, 60))
  const state = mirror.state()
  assert.ok(state.failed > 0)
  assert.equal(state.lastError, 'the topic rejected it')
  mirror.close()
})

test('a transient failure is retried in the background until it lands', async () => {
  const { mirror, seen } = recordingMirror({ failFirst: 2 })
  const chain = new ReceiptChain(createSigner(), mirror)
  await chain.emit(FIXTURE_DECISION_HIRE)
  await mirror.flush(3_000)

  assert.equal(seen.length, 1, 'the message landed after its retries')
  assert.equal(mirror.state().mirrored, 1)
  assert.ok(mirror.state().failed >= 2, 'the failures are counted rather than hidden')
})

test('one message that never lands does not stall every later one', async () => {
  const seen: MirrorMessage[] = []
  let calls = 0
  const mirror = new HcsReceiptMirror('0.0.test', {
    retryDelayMs: 1,
    submit: async (message) => {
      calls += 1
      // The first receipt is poisoned; everything after it is fine.
      if (message.index === 1) throw new Error('poisoned')
      seen.push(message)
    },
  })
  const chain = new ReceiptChain(createSigner(), mirror)
  await chain.emit(FIXTURE_DECISION_HIRE)
  await chain.emit(FIXTURE_DECISION_DRIFT)
  await mirror.flush(3_000)

  assert.ok(calls > 1)
  assert.deepEqual(
    seen.map((message) => message.index),
    [2],
    'the second receipt mirrored even though the first could not',
  )
  assert.equal(mirror.state().mirrored, 1)
})

test('the counts are reported honestly, so a lag reads as a lag', async () => {
  const { mirror } = recordingMirror({ failFirst: 1 })
  const chain = new ReceiptChain(createSigner(), mirror)
  await chain.emit(FIXTURE_DECISION_HIRE)
  await chain.emit(FIXTURE_DECISION_DRIFT)

  const during = mirror.state()
  assert.equal(during.topicId, '0.0.test')
  assert.ok(during.mirrored + during.pending >= chain.length, 'nothing is silently dropped from the count')

  const after = await mirror.flush(3_000)
  assert.equal(after.mirrored, chain.length, `mirrored ${after.mirrored} of ${chain.length}`)
  assert.equal(after.pending, 0)
})

test('a chain with no mirror attached behaves exactly as before', async () => {
  const chain = new ReceiptChain(createSigner())
  await chain.emit(FIXTURE_DECISION_HIRE)
  assert.equal(chain.length, 1)
  assert.deepEqual(await chain.verify(), { ok: true, brokenAt: null, reason: null })
})

test('a closed mirror accepts nothing further', async () => {
  const { mirror, seen } = recordingMirror()
  mirror.close()
  const chain = new ReceiptChain(createSigner(), mirror)
  await chain.emit(FIXTURE_DECISION_HIRE)
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(seen, [])
  assert.equal(chain.length, 1, 'the chain is unaffected either way')
})
