/**
 * B5b's acceptance test: the D3 fixtures through the real gate, on a Base Sepolia fork at head.
 *
 * The lookups are real here. The verified-source answer comes from Sourcify, which is the same
 * endpoint and the same fact a reader could check by hand, which is the point of allowing it inside
 * a verdict at all.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, parseAbi } from 'viem'
import type { Address, PendingTx } from '../../../shared/types.ts'
import { baseSepoliaFixtures } from '../fixtures.ts'
import { clearGradedCode } from '../graded.ts'
import { txGuard } from '../txguard.ts'

const BASE_SEPOLIA = 84532
const offline = process.env.BASE_SEPOLIA_RPC_URL === undefined
const set = baseSepoliaFixtures()
const f = set.fixtures

const WALLET = '0x1111111111111111111111111111111111111111' as Address
const UNLIMITED = 2n ** 256n - 1n

const ABI = parseAbi([
  'function swap(uint256 amountIn)',
  'function stake(uint256 amount)',
  'function ping() returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

function call(to: Address, data: PendingTx['calldata']): PendingTx {
  return { chainId: BASE_SEPOLIA, from: WALLET, to, calldata: data, value: 0n }
}

test('done-when 1: the drainer fixture blocks with one drainer-approval flag', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard(
    call(f.drainerRouter, encodeFunctionData({ abi: ABI, functionName: 'swap', args: [1000n] })),
  )

  assert.equal(verdict.verdict, 'BLOCK')
  assert.equal(verdict.flags.length, 1)
  assert.equal(verdict.flags[0].id, 'drainer-approval')
  assert.equal(verdict.flags[0].severity, 'block')
  assert.equal(verdict.flags[0].confirmedBy, 'simulation')
  assert.match(verdict.flags[0].detail, new RegExp(set.collector))
  console.log(`  block ${verdict.reproducibleFrom.block}: ${verdict.flags[0].title}`)
  console.log(`  ${verdict.flags[0].detail}`)
})

test('done-when 4: an approval reached through a router is caught, with no approve in the calldata', { skip: offline }, async () => {
  clearGradedCode()
  // The caller signs `stake`. There is no approve selector anywhere in what they signed, and the
  // allowance appears anyway, which is why the detector reads deltas rather than calldata.
  const verdict = await txGuard(
    call(f.injectionFixture, encodeFunctionData({ abi: ABI, functionName: 'stake', args: [1000n] })),
  )

  assert.equal(verdict.verdict, 'BLOCK')
  assert.equal(verdict.flags[0].id, 'drainer-approval')
  assert.equal(verdict.flags[0].confirmedBy, 'simulation')
})

test('done-when 2: a bounded approval to a verified spender passes', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard(
    call(
      f.drainableToken,
      encodeFunctionData({ abi: ABI, functionName: 'approve', args: [f.cleanControl, 1000n] }),
    ),
  )

  assert.equal(verdict.verdict, 'ALLOW')
  assert.deepEqual(verdict.flags, [])
  console.log(`  allowed a bounded approval to a verified spender at block ${verdict.reproducibleFrom.block}`)
})

test('an unlimited approval to that same verified spender still blocks', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard(
    call(
      f.drainableToken,
      encodeFunctionData({ abi: ABI, functionName: 'approve', args: [f.cleanControl, UNLIMITED] }),
    ),
  )

  assert.equal(verdict.verdict, 'BLOCK')
  assert.equal(verdict.flags[0].id, 'drainer-approval')
  assert.match(verdict.flags[0].detail, /unbounded/)
})

test('the clean control still passes with the detector registered', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard(
    call(f.cleanControl, encodeFunctionData({ abi: ABI, functionName: 'ping' })),
  )

  assert.equal(verdict.verdict, 'ALLOW')
  assert.deepEqual(verdict.flags, [])
})
