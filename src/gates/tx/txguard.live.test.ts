/**
 * txGuard end to end against a real fork, with the real fingerprint and the real drift store.
 *
 * The stubbed tests prove the composition rules. This proves the wiring: a real chain, a real
 * block, and a tuple a reader can re-run the verdict from.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, keccak256, parseAbi } from 'viem'
import type { Address, PendingTx } from '../../shared/types.ts'
import { baseSepoliaFixtures } from './fixtures.ts'
import { clearGradedCode, recordGradedCode } from './graded.ts'
import { txGuard } from './txguard.ts'

const BASE_SEPOLIA = 84532
const offline = process.env.BASE_SEPOLIA_RPC_URL === undefined

const USDC_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address
const WALLET = '0x1111111111111111111111111111111111111111' as Address
const SPENDER = '0x2222222222222222222222222222222222222222' as Address

/** The clean control's ordinary call: nothing to flag, so it exercises the allow path. */
const PING: PendingTx = {
  chainId: BASE_SEPOLIA,
  from: WALLET,
  to: baseSepoliaFixtures().fixtures.cleanControl,
  calldata: encodeFunctionData({
    abi: parseAbi(['function ping() returns (uint256)']),
    functionName: 'ping',
  }),
  value: 0n,
}

const APPROVE: PendingTx = {
  chainId: BASE_SEPOLIA,
  from: WALLET,
  to: USDC_SEPOLIA,
  calldata: encodeFunctionData({
    abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']),
    functionName: 'approve',
    args: [SPENDER, 2n ** 256n - 1n],
  }),
  value: 0n,
}

test('an ordinary call with no prior grade allows, and reports its tuple', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard(PING)

  assert.equal(verdict.verdict, 'ALLOW')
  assert.deepEqual(verdict.flags, [])
  assert.equal(verdict.driftFromGraded, null)
  assert.ok(verdict.reproducibleFrom.block > 0n)
  assert.equal(verdict.reproducibleFrom.calldataHash, keccak256(PING.calldata))
  assert.notEqual(verdict.codeFingerprint, `0x${'00'.repeat(32)}`)
  console.log(
    `  allow at block ${verdict.reproducibleFrom.block}, fingerprint ${verdict.codeFingerprint.slice(0, 18)}`,
  )
})

test('a callee whose proxy pattern cannot be resolved blocks, with no flags', { skip: offline }, async () => {
  // This test used to assert ALLOW on exactly this transaction, back when no detector was
  // registered. It is kept pointing at the same call on purpose, because the answer it now gives
  // is a consequence worth pinning rather than an accident.
  //
  // USDC on Base Sepolia keeps its implementation in a pre-EIP-1967 slot, so B4 resolves it to
  // 'unknown' and B5e refuses to answer whether the call changes what executes there. The verdict
  // is BLOCK with an empty flag list, which section 9 calls legitimate for a structural failure:
  // no red flag fired, and the gate could not see well enough to say none would.
  clearGradedCode()
  const verdict = await txGuard(APPROVE)

  assert.equal(verdict.verdict, 'BLOCK')
  assert.deepEqual(verdict.flags, [])
  assert.match(verdict.reason, /could not be resolved/)
  assert.equal(verdict.reproducibleFrom.calldataHash, keccak256(APPROVE.calldata))
})

test('a baseline that no longer matches blocks, before anything is simulated', { skip: offline }, async () => {
  clearGradedCode()
  recordGradedCode(BASE_SEPOLIA, USDC_SEPOLIA, {
    fingerprint: `0x${'11'.repeat(32)}`,
    observedBlock: 1n,
  })
  try {
    const verdict = await txGuard(APPROVE)
    assert.equal(verdict.verdict, 'BLOCK')
    assert.equal(verdict.driftFromGraded, true)
    assert.deepEqual(verdict.deltas, [], 'nothing was simulated, so there are no deltas to show')
    assert.match(verdict.reason, /moved since it was graded/)
    console.log(`  blocked on drift at block ${verdict.reproducibleFrom.block}`)
  } finally {
    clearGradedCode()
  }
})

test('a chain with no RPC configured blocks rather than guessing a network', async () => {
  const previous = process.env.BASE_MAINNET_RPC_URL
  delete process.env.BASE_MAINNET_RPC_URL
  try {
    const verdict = await txGuard({ ...APPROVE, chainId: 8453 })
    assert.equal(verdict.verdict, 'BLOCK')
    assert.equal(verdict.reproducibleFrom.block, 0n)
    assert.match(verdict.reason, /BASE_MAINNET_RPC_URL/)
  } finally {
    if (previous !== undefined) process.env.BASE_MAINNET_RPC_URL = previous
  }
})
