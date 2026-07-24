import { test } from 'node:test'
import assert from 'node:assert/strict'
import { METHODOLOGY_VERSION } from '@polygraphso/litmus'

import type { Receipt } from '../shared/types.ts'
import {
  FIXTURE_DECISION_BELOW_POLICY,
  FIXTURE_DECISION_DRIFT,
  FIXTURE_DECISION_HIRE,
  FIXTURE_DECISION_NO_RECORD,
  FIXTURE_VERDICT_ALLOW,
  FIXTURE_VERDICT_BLOCK_DRAINER,
} from '../shared/fixtures/index.ts'
import { ReceiptChain, emitReceipt, verifyChain } from './receipt-chain.ts'
import { createSigner, verifySignature } from './signer.ts'

/** Five receipts: three agent decisions, two transaction verdicts, one chain. */
async function fullChain(): Promise<ReceiptChain> {
  const chain = new ReceiptChain(createSigner())
  await chain.emit(FIXTURE_DECISION_HIRE)
  await chain.emit(FIXTURE_DECISION_BELOW_POLICY)
  await chain.emit(FIXTURE_VERDICT_BLOCK_DRAINER)
  await chain.emit(FIXTURE_DECISION_DRIFT)
  await chain.emit(FIXTURE_VERDICT_ALLOW)
  return chain
}

function clone(receipts: Receipt[]): Receipt[] {
  return receipts.map((receipt) => structuredClone(receipt))
}

test('a chain over a hire, two refusals and two tx verdicts verifies', async () => {
  const chain = await fullChain()
  assert.equal(chain.length, 5)
  const verified = await chain.verify()
  assert.deepEqual(verified, { ok: true, brokenAt: null, reason: null })
})

test('each receipt links to the one before it, and only the first opens the chain', async () => {
  const receipts = (await fullChain()).all()
  assert.equal(receipts[0].prevHash, null)
  for (let i = 1; i < receipts.length; i += 1) {
    assert.equal(receipts[i].prevHash, receipts[i - 1].hash)
  }
  assert.deepEqual(
    receipts.map((r) => r.id),
    ['receipt-0001', 'receipt-0002', 'receipt-0003', 'receipt-0004', 'receipt-0005'],
  )
})

test('a byte altered in a subject breaks the chain at that index', async () => {
  const receipts = clone((await fullChain()).all())
  const subject = receipts[2].subject as { reason: string }
  subject.reason = `${subject.reason}.`

  const verified = await verifyChain(receipts)
  assert.equal(verified.ok, false)
  assert.equal(verified.brokenAt, 2)
  assert.match(String(verified.reason), /subject does not hash to its responseHash/)
})

test('a receipt removed from the middle breaks the chain', async () => {
  const receipts = clone((await fullChain()).all())
  receipts.splice(2, 1)

  const verified = await verifyChain(receipts)
  assert.equal(verified.ok, false)
  assert.equal(verified.brokenAt, 2, 'the break is where the missing link was')
  assert.match(String(verified.reason), /points at .* but the receipt before it hashes to/)
})

test('a signature verifies against the public key alone, with nothing else loaded', async () => {
  const receipts = (await fullChain()).all()
  for (const receipt of receipts) {
    assert.equal(verifySignature(receipt.hash, receipt.sig, receipt.signerPubKey), true)
  }
  // A different signer's key must not verify it, and neither must a mangled signature.
  const other = createSigner()
  assert.equal(verifySignature(receipts[0].hash, receipts[0].sig, other.publicKey), false)
  assert.equal(verifySignature(receipts[0].hash, other.sign(receipts[0].hash), receipts[0].signerPubKey), false)
  assert.equal(verifySignature(receipts[0].hash, '0xdeadbeef', receipts[0].signerPubKey), false)
  assert.equal(verifySignature(receipts[0].hash, receipts[0].sig, '0x1234'), false)
})

test('a tx receipt carries reproducibleFrom and an agent receipt carries null, in one chain', async () => {
  const receipts = (await fullChain()).all()
  const agent = receipts[0]
  const tx = receipts[2]

  assert.equal(agent.reproducibleFrom, null)
  assert.ok(agent.evidenceURI !== null, 'an agent decision with a record carries its evidence URI')

  assert.ok(tx.reproducibleFrom !== null)
  assert.deepEqual(Object.keys(tx.reproducibleFrom).sort(), [
    'block',
    'calldataHash',
    'from',
    'to',
    'value',
  ])
  assert.equal(tx.reproducibleFrom.block, FIXTURE_VERDICT_BLOCK_DRAINER.reproducibleFrom.block.toString())
  assert.equal(tx.evidenceURI, null, 'a tx verdict has no evidence bundle to point at')
})

test('a refusal with no record still emits a receipt, with a null evidence URI', async () => {
  const chain = new ReceiptChain(createSigner())
  const receipt = await chain.emit(FIXTURE_DECISION_NO_RECORD)
  assert.equal(receipt.evidenceURI, null)
  assert.equal((receipt.subject as { verdict: string }).verdict, 'REFUSE')
  assert.deepEqual(await chain.verify(), { ok: true, brokenAt: null, reason: null })
})

test('a second receipt opening its own chain is a verification failure', async () => {
  const receipts = clone((await fullChain()).all())
  receipts[3] = { ...receipts[3], prevHash: null }

  const verified = await verifyChain(receipts)
  assert.equal(verified.ok, false)
  assert.equal(verified.brokenAt, 3)
  assert.match(String(verified.reason), /only the first receipt may open a chain/)
})

test('altering the recorded hash, the link, or the order all break', async () => {
  const original = (await fullChain()).all()

  const rehashed = clone(original)
  rehashed[1] = { ...rehashed[1], hash: rehashed[4].hash }
  assert.equal((await verifyChain(rehashed)).brokenAt, 1)

  const relinked = clone(original)
  relinked[2] = { ...relinked[2], prevHash: relinked[0].hash }
  assert.equal((await verifyChain(relinked)).brokenAt, 2)

  const reordered = clone(original)
  ;[reordered[1], reordered[2]] = [reordered[2], reordered[1]]
  assert.equal((await verifyChain(reordered)).ok, false)

  const tamperedField = clone(original)
  tamperedField[3] = { ...tamperedField[3], methodologyVersion: 'litmus-v1' }
  const verified = await verifyChain(tamperedField)
  assert.equal(verified.brokenAt, 3)
  assert.match(String(verified.reason), /fields do not hash to its recorded hash/)
})

test('an empty chain is not a verified chain', async () => {
  assert.deepEqual(await verifyChain([]), {
    ok: false,
    brokenAt: null,
    reason: 'there are no receipts to verify',
  })
})

test('ids are monotonic by counter, so a clock going backwards cannot reorder a chain', async () => {
  const signer = createSigner()
  const first = await emitReceipt(FIXTURE_DECISION_HIRE, null, { signer, index: 1 })
  const second = await emitReceipt(FIXTURE_DECISION_DRIFT, first.hash, { signer, index: 2 })
  assert.ok(second.id > first.id)
  assert.deepEqual(await verifyChain([first, second]), { ok: true, brokenAt: null, reason: null })

  const outOfOrder = await emitReceipt(FIXTURE_DECISION_DRIFT, first.hash, { signer, index: 1 })
  assert.equal((await verifyChain([first, outOfOrder])).ok, false)
})

test('the methodology version on a receipt comes from the installed package', async () => {
  const receipt = await emitReceipt(FIXTURE_DECISION_HIRE, null, { signer: createSigner(), index: 1 })
  assert.equal(receipt.methodologyVersion, METHODOLOGY_VERSION)
})

test('the chain serializes to an array the console can render directly', async () => {
  const chain = await fullChain()
  const asJson = JSON.parse(JSON.stringify(chain)) as Receipt[]
  assert.equal(asJson.length, 5)
  assert.deepEqual(await verifyChain(asJson), { ok: true, brokenAt: null, reason: null })
  assert.equal(chain.head, chain.at(4).hash)
})
