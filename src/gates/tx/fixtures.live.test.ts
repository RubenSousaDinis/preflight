/**
 * D3 step 8: every staged fixture, through the harness, against a Base Sepolia fork at head.
 *
 * The detectors are not written yet, so these assert the effects the detectors will read rather
 * than the verdicts they will produce. That order is deliberate: if the approval a fixture leaves
 * behind is not in `approvalDeltas` now, B5b would be written against a fixture that does not do
 * what its doc says it does.
 *
 * Run: `node --env-file-if-exists=.env.local --import tsx --test src/gates/tx/fixtures.live.test.ts`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, parseAbi } from 'viem'
import type { Address, PendingTx } from '../../shared/types.ts'
import { EIP1967_IMPLEMENTATION_SLOT } from './fingerprint.ts'
import { simulate } from './fork.ts'
import { baseSepoliaFixtures } from './fixtures.ts'
import { storageWritesFrom, type PrestateDiff } from './trace.ts'

const BASE_SEPOLIA = 84532
const offline = process.env.BASE_SEPOLIA_RPC_URL === undefined
const set = baseSepoliaFixtures()
const f = set.fixtures

const WALLET = '0x1111111111111111111111111111111111111111' as Address
const UNLIMITED = 2n ** 256n - 1n

const ABI = parseAbi([
  'function swap(uint256 amountIn)',
  'function stake(uint256 amount)',
  'function forward() payable',
  'function claim()',
  'function ping() returns (uint256)',
])

function call(to: Address, data: PendingTx['calldata'], value = 0n): PendingTx {
  return { chainId: BASE_SEPOLIA, from: WALLET, to, calldata: data, value }
}

test('the drainer router leaves an unbounded allowance to a spender nobody named', { skip: offline }, async () => {
  const result = await simulate(
    call(f.drainerRouter, encodeFunctionData({ abi: ABI, functionName: 'swap', args: [1000n] })),
  )

  assert.equal(result.reverted, false)
  assert.deepEqual(result.approvalDeltas, [
    { token: f.drainableToken, owner: WALLET, spender: set.collector, amount: UNLIMITED },
  ])
  console.log(`  allowance to ${set.collector} at block ${result.block}`)
})

test('the injection fixture behaves exactly like the drainer, whatever its comments claim', { skip: offline }, async () => {
  const result = await simulate(
    call(f.injectionFixture, encodeFunctionData({ abi: ABI, functionName: 'stake', args: [1000n] })),
  )

  assert.deepEqual(result.approvalDeltas, [
    { token: f.drainableToken, owner: WALLET, spender: set.collector, amount: UNLIMITED },
  ])
})

test('the value router sends the value one hop further, onto the call graph', { skip: offline }, async () => {
  const sent = 1_000_000_000_000_000n
  const result = await simulate(
    call(f.valueRouter, encodeFunctionData({ abi: ABI, functionName: 'forward' }), sent),
  )

  assert.equal(result.reverted, false)
  const onward = result.callGraph.find((entry) => entry.to === f.unverifiedSink)
  assert.ok(onward !== undefined, 'the sink appears on the call graph')
  assert.equal(onward.from, f.valueRouter)
  assert.equal(onward.value, sent)
  // The direct callee is the router, so reading `to` alone would never see the sink at all.
  assert.equal(result.callGraph[0].to, f.valueRouter)
  console.log(`  ${sent} wei reached ${f.unverifiedSink} one hop past the direct callee`)
})

test('the backdoor proxy fires an upgrade during a call that asked for a claim', { skip: offline }, async () => {
  const result = await simulate(
    call(f.backdoorProxy, encodeFunctionData({ abi: ABI, functionName: 'claim' })),
  )

  assert.equal(result.reverted, false)
  const writes = storageWritesFrom((result.raw as { prestate: PrestateDiff }).prestate)
  const upgrade = writes.find(
    (write) =>
      write.address === f.backdoorProxy &&
      write.slot.toLowerCase() === EIP1967_IMPLEMENTATION_SLOT.toLowerCase(),
  )

  assert.ok(upgrade !== undefined, 'the implementation slot was written')
  assert.equal(`0x${upgrade.before.slice(-40)}`.toLowerCase(), f.vaultV1.toLowerCase())
  assert.equal(`0x${upgrade.after.slice(-40)}`.toLowerCase(), f.vaultV2.toLowerCase())
  console.log(`  implementation slot moved ${f.vaultV1} to ${f.vaultV2} inside claim()`)
})

test('the clean control writes no allowance and routes no value onward', { skip: offline }, async () => {
  const result = await simulate(
    call(f.cleanControl, encodeFunctionData({ abi: ABI, functionName: 'ping' })),
  )

  assert.equal(result.reverted, false)
  assert.deepEqual(result.approvalDeltas, [])
  assert.deepEqual(result.balanceDeltas, [])
  assert.equal(result.callGraph.length, 1, 'one call, with nothing downstream of it')
  assert.equal(result.callGraph[0].to, f.cleanControl)
})
