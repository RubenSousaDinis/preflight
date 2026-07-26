import test from 'node:test'
import assert from 'node:assert/strict'

import { verifyChain } from './receipt-chain.ts'
import { receiptDemonstration } from './demonstration.ts'

/*
  The receipts panel exists to show that the verifier discriminates.

  A chain that can only ever be rejected proves as little as one that can only ever be accepted:
  in both cases the verifier's answer is the same whatever it is handed, so nothing about it has
  been demonstrated. These tests pin the pair the panel needs, one chain that verifies and one
  that does not, and pin that the second is the first with a single receipt edited, because that
  is the whole claim: the edit is what the verifier caught.
*/

test('the demonstration chain is real enough that the verifier accepts it', async () => {
  const { intact } = await receiptDemonstration()

  const verification = await verifyChain(intact)
  assert.equal(verification.ok, true, verification.reason ?? 'no reason given')
  assert.equal(verification.brokenAt, null)
  assert.ok(intact.length >= 2, 'a chain of one cannot show a link to the receipt before it')
  assert.equal(intact[0].prevHash, null, 'the first receipt opens the chain')
  assert.equal(intact[1].prevHash, intact[0].hash, 'and the second carries the first hash')
})

test('editing one receipt after it was signed breaks the chain at that receipt', async () => {
  const { tampered, tamperedAt } = await receiptDemonstration()

  const verification = await verifyChain(tampered)
  assert.equal(verification.ok, false)
  assert.equal(verification.brokenAt, tamperedAt)
  assert.match(String(verification.reason), new RegExp(tampered[tamperedAt].id))
})

test('the break lands past the first receipt, so the link and the signature are exercised', async () => {
  const { tamperedAt } = await receiptDemonstration()

  // The old fixture broke on receipt one, which meant the verifier stopped before it had checked a
  // single prevHash link. A break further in is what makes the earlier receipts evidence.
  assert.ok(tamperedAt > 0, `expected the edit past the opening receipt, got index ${tamperedAt}`)
})

test('the tampered chain is the intact chain with exactly one receipt changed', async () => {
  const { intact, tampered, tamperedAt } = await receiptDemonstration()

  assert.equal(tampered.length, intact.length)
  for (const [index, receipt] of intact.entries()) {
    if (index === tamperedAt) {
      assert.notDeepEqual(receipt, tampered[index], 'the edited receipt has to differ')
      // Only the subject moved. The signature and hashes are the ones that were signed, which is
      // what makes this a forgery rather than a differently built chain.
      assert.equal(tampered[index].hash, receipt.hash)
      assert.equal(tampered[index].sig, receipt.sig)
      assert.equal(tampered[index].responseHash, receipt.responseHash)
      assert.notDeepEqual(tampered[index].subject, receipt.subject)
      continue
    }
    assert.deepEqual(tampered[index], receipt, `receipt ${index} should be untouched`)
  }
})

test('what was edited is stated, so the panel does not have to describe it itself', async () => {
  const { tamperNote } = await receiptDemonstration()
  assert.ok(tamperNote.trim().length > 0)
})
