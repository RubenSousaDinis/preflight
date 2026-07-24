/**
 * B5d's acceptance test: the D3 value router through the real gate, on a Base Sepolia fork.
 *
 * The verified status is resolved against Sourcify live here, which is the point of allowing that
 * one fact inside a verdict: the same question, asked the same way, gives any reader the same
 * answer.
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
const ABI = parseAbi(['function forward() payable', 'function ping() returns (uint256)'])

function call(to: Address, data: PendingTx['calldata'], value = 0n): PendingTx {
  return { chainId: BASE_SEPOLIA, from: WALLET, to, calldata: data, value }
}

test('done-when 1: a verified direct callee routing value to an unverified one blocks', { skip: offline }, async () => {
  clearGradedCode()
  const sent = 1_000_000_000_000_000n
  const verdict = await txGuard(
    call(f.valueRouter, encodeFunctionData({ abi: ABI, functionName: 'forward' }), sent),
  )

  assert.equal(verdict.verdict, 'BLOCK')
  const flag = verdict.flags.find((entry) => entry.id === 'bad-callee')
  assert.ok(flag !== undefined, 'the bad-callee flag fired')
  assert.equal(flag.severity, 'block')
  assert.equal(flag.confirmedBy, 'simulation')
  // The offending address is one hop past the direct callee, which is verified.
  assert.match(flag.title, new RegExp(f.unverifiedSink))
  assert.match(flag.detail, new RegExp(f.valueRouter))
  console.log(`  block ${verdict.reproducibleFrom.block}: ${flag.title}`)
  console.log(`  ${flag.detail}`)
})

test('done-when 2: a verified callee with nothing downstream passes', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard(
    call(f.cleanControl, encodeFunctionData({ abi: ABI, functionName: 'ping' })),
  )

  assert.equal(verdict.verdict, 'ALLOW')
  assert.deepEqual(verdict.flags, [])
  console.log(`  clean control allowed at block ${verdict.reproducibleFrom.block}`)
})

test('done-when 3: a plain value transfer to a wallet passes', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard({
    chainId: BASE_SEPOLIA,
    from: WALLET,
    to: '0x2222222222222222222222222222222222222222' as Address,
    calldata: '0x',
    value: 1_000_000_000_000_000n,
  })

  assert.equal(verdict.verdict, 'ALLOW')
  assert.deepEqual(verdict.flags, [])
  console.log(`  wallet to wallet allowed at block ${verdict.reproducibleFrom.block}`)
})
