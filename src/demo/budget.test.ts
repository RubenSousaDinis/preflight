import { test } from 'node:test'
import assert from 'node:assert/strict'

import { HarnessError } from '../shared/errors.ts'
import { Budget } from './budget.ts'
import { railByName, stubbedRail, TINYBAR_PER_HBAR } from './payment-rail.ts'

test('a budget tracks total, spent and remaining, and all three are readable', () => {
  const budget = new Budget(1_000n)
  assert.equal(budget.remaining, 1_000n)
  budget.spend(100n)
  assert.equal(budget.spent, 100n)
  assert.equal(budget.remaining, 900n)
  assert.deepEqual(budget.state(), {
    total: '1000',
    spent: '100',
    remaining: '900',
    frozen: false,
    frozenReason: null,
  })
})

test('the freeze is irreversible: nothing spends after it, at any size', () => {
  const budget = new Budget(1_000n)
  budget.spend(100n)
  budget.freeze('the worker turned on the caller')

  assert.equal(budget.frozen, true)
  assert.equal(budget.canSpend(1n), false)
  assert.equal(budget.canSpend(0n), false, 'a zero spend is still a spend on a frozen budget')
  assert.throws(() => budget.spend(1n), HarnessError)
  assert.throws(() => budget.spend(0n), HarnessError)
  assert.equal(budget.spent, 100n, 'the recorded spend did not move')
  assert.equal(budget.remaining, 900n)
})

test('freezing twice keeps the first reason, because that is the one that stopped the run', () => {
  const budget = new Budget(10n)
  budget.freeze('the worker turned on the caller')
  budget.freeze('something later')
  assert.equal(budget.frozenReason, 'the worker turned on the caller')
})

test('an overspend throws rather than clamping, so the numbers keep describing the run', () => {
  const budget = new Budget(100n)
  budget.spend(60n)
  assert.equal(budget.canSpend(41n), false)
  assert.throws(() => budget.spend(41n), HarnessError)
  assert.equal(budget.spent, 60n)
  budget.spend(40n)
  assert.equal(budget.remaining, 0n)
})

test('a negative budget or a negative spend is refused', () => {
  assert.throws(() => new Budget(-1n), HarnessError)
  assert.throws(() => new Budget(0n).spend(-1n), HarnessError)
})

test('the stubbed rail labels itself, so nothing reads as a settlement', async () => {
  const settled = await stubbedRail.pay({ to: '0.0.1', amount: 5n })
  assert.equal(settled.stubbed, true)
  assert.match(settled.txRef, /^stubbed-/)
})

test('the rail is chosen by name, and an unknown name is refused rather than defaulted', () => {
  assert.equal(railByName('stub').name, 'stub')
  assert.equal(railByName('hedera-transfer').name, 'hedera-transfer')
  assert.equal(railByName('hedera-x402').name, 'hedera-x402')
  assert.throws(() => railByName('mock'), HarnessError)
})

test('the x402 rail refuses without a resource, rather than falling back to an unpaid call', async () => {
  await assert.rejects(
    () => railByName('hedera-x402').pay({ to: '0.0.1', amount: 1n }),
    /needs the resource URL/,
  )
})

test('a fee expressed in tinybars converts the way the log reports it', () => {
  assert.equal(TINYBAR_PER_HBAR, 100_000_000n)
  assert.equal(Number(50_000_000n) / Number(TINYBAR_PER_HBAR), 0.5)
})
