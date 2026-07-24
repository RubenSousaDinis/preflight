/**
 * B5e's acceptance test: the D3 backdoor proxy through the real gate, on a Base Sepolia fork.
 *
 * The same fixture appears twice in beat 2. Here the gate catches the backdoor inside a pending
 * transaction; in B4 it catches the code change afterward. Two views of one event.
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

const ABI = parseAbi([
  'function claim()',
  'function deposit() payable',
  'function upgradeTo(address next)',
])

function call(to: Address, data: PendingTx['calldata'], value = 0n, from: Address = WALLET): PendingTx {
  return { chainId: BASE_SEPOLIA, from, to, calldata: data, value }
}

test('done-when 1: the hidden upgrade path fires during claim, and blocks', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard(
    call(f.backdoorProxy, encodeFunctionData({ abi: ABI, functionName: 'claim' })),
  )

  assert.equal(verdict.verdict, 'BLOCK')
  const flag = verdict.flags.find((entry) => entry.id === 'owner-backdoor')
  assert.ok(flag !== undefined, 'the owner-backdoor flag fired')
  assert.equal(flag.severity, 'block')
  assert.equal(flag.confirmedBy, 'simulation')
  assert.match(flag.detail, new RegExp(f.vaultV1.toLowerCase()))
  assert.match(flag.detail, new RegExp(f.vaultV2.toLowerCase()))
  console.log(`  block ${verdict.reproducibleFrom.block}: ${flag.title}`)
  console.log(`  ${flag.detail}`)
})

test('an explicit upgradeTo from the admin blocks the same way', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard(
    call(
      f.backdoorProxy,
      encodeFunctionData({ abi: ABI, functionName: 'upgradeTo', args: [f.vaultV2] }),
      0n,
      set.deployer,
    ),
  )

  assert.equal(verdict.verdict, 'BLOCK')
  assert.ok(verdict.flags.some((entry) => entry.id === 'owner-backdoor'))
})

test('done-when 2: an ordinary call to the same proxy passes', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard(
    call(f.backdoorProxy, encodeFunctionData({ abi: ABI, functionName: 'deposit' }), 1_000_000n),
  )

  assert.equal(verdict.verdict, 'ALLOW')
  assert.deepEqual(verdict.flags, [])
  console.log(`  deposit() on the same proxy allowed at block ${verdict.reproducibleFrom.block}`)
})

test('the clean control passes with both detectors registered', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard(
    call(f.cleanControl, encodeFunctionData({ abi: parseAbi(['function ping() returns (uint256)']), functionName: 'ping' })),
  )

  assert.equal(verdict.verdict, 'ALLOW')
  assert.deepEqual(verdict.flags, [])
})
