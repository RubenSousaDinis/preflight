/**
 * B5a's done-when list, run against real forks of both Base networks.
 *
 * These spawn anvil and reach the chain, so they skip when no RPC is configured. The D3 fixtures do
 * not exist yet, so the approval case runs against USDC, which is the same code path the fixture
 * will take: exact bytes in, spender and amount out.
 *
 * Run: `node --env-file-if-exists=.env.local --import tsx --test src/gates/tx/fork.live.test.ts`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, parseAbi } from 'viem'
import { SimulationError } from '../../shared/errors.ts'
import type { Address, PendingTx } from '../../shared/types.ts'
import { forkAt, simulate } from './fork.ts'
import { storageWritesFrom, type PrestateDiff } from './trace.ts'

const BASE_SEPOLIA = 84532
const BASE_MAINNET = 8453
const offline = process.env.BASE_SEPOLIA_RPC_URL === undefined

const USDC_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address
const USDC_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const WALLET = '0x1111111111111111111111111111111111111111' as Address
const SPENDER = '0x2222222222222222222222222222222222222222' as Address

const ERC20 = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
])

const UNLIMITED = (2n ** 256n - 1n)

function approveTx(chainId: number, token: Address, amount: bigint): PendingTx {
  return {
    chainId,
    from: WALLET,
    to: token,
    calldata: encodeFunctionData({ abi: ERC20, functionName: 'approve', args: [SPENDER, amount] }),
    value: 0n,
  }
}

test('done-when 1: an approval returns the exact spender and amount', { skip: offline }, async () => {
  const result = await simulate(approveTx(BASE_SEPOLIA, USDC_SEPOLIA, UNLIMITED))

  assert.equal(result.reverted, false)
  assert.ok(result.block > 0n)
  assert.equal(result.approvalDeltas.length, 1)
  assert.deepEqual(result.approvalDeltas[0], {
    token: USDC_SEPOLIA,
    owner: WALLET,
    spender: SPENDER,
    amount: UNLIMITED,
  })
  console.log(
    `  sepolia block ${result.block}, approval ${result.approvalDeltas[0].amount} to ${result.approvalDeltas[0].spender}`,
  )
})

test('done-when 2: the same call runs on a mainnet fork by changing chainId alone', { skip: offline }, async () => {
  const result = await simulate(approveTx(BASE_MAINNET, USDC_MAINNET, UNLIMITED))

  assert.equal(result.reverted, false)
  assert.equal(result.approvalDeltas.length, 1)
  assert.equal(result.approvalDeltas[0].amount, UNLIMITED)
  console.log(`  mainnet block ${result.block}, same code path, no change beyond chainId`)
})

test('done-when 3: a reverting transaction reports reverted, with the block, and does not throw', { skip: offline }, async () => {
  const result = await simulate({
    chainId: BASE_SEPOLIA,
    from: WALLET,
    to: USDC_SEPOLIA,
    // Transferring a balance this wallet does not hold. A revert is information, not an exception.
    calldata: encodeFunctionData({
      abi: ERC20,
      functionName: 'transfer',
      args: [SPENDER, 10n ** 24n],
    }),
    value: 0n,
  })

  assert.equal(result.reverted, true)
  assert.ok(result.block > 0n)
  console.log(`  reverted at block ${result.block}, ${result.callGraph.length} calls traced`)
})

test('done-when 6: the call graph lists resolved callees in call order', { skip: offline }, async () => {
  const result = await simulate(approveTx(BASE_SEPOLIA, USDC_SEPOLIA, 1_000_000n))

  // USDC is a proxy, so the entry call is followed by the delegatecall it resolves to. The caller
  // appears before the callee it produced, which is the order this is read in.
  assert.ok(result.callGraph.length >= 2)
  assert.equal(result.callGraph[0].from, WALLET)
  assert.equal(result.callGraph[0].to, USDC_SEPOLIA)
  assert.equal(result.callGraph[0].selector, '0x095ea7b3')
  assert.equal(result.callGraph[1].from, USDC_SEPOLIA)
  console.log(
    `  ${result.callGraph.map((c) => `${c.to.slice(0, 8)}${c.selector.slice(0, 10)}`).join(' -> ')}`,
  )
})

test('the fork is stateful: leg two observes what leg one left behind', { skip: offline }, async () => {
  const fork = await forkAt(BASE_SEPOLIA)
  try {
    const first = await fork.run(approveTx(BASE_SEPOLIA, USDC_SEPOLIA, 1_000_000n))
    const writes = storageWritesFrom((first.raw as { prestate: PrestateDiff }).prestate)
    const allowanceSlot = writes.find((w) => w.address === USDC_SEPOLIA)
    assert.ok(allowanceSlot !== undefined, 'the approval wrote a storage slot')
    assert.equal(BigInt(await fork.storageAt(USDC_SEPOLIA, allowanceSlot.slot)), 1_000_000n)

    const second = await fork.run(approveTx(BASE_SEPOLIA, USDC_SEPOLIA, 0n))
    assert.equal(second.approvalDeltas[0].amount, 0n)
    assert.equal(BigInt(await fork.storageAt(USDC_SEPOLIA, allowanceSlot.slot)), 0n)
    // Both legs anchor to the same fork height, which is what a reproducible tuple records.
    assert.equal(first.block, second.block)
    console.log(`  slot ${allowanceSlot.slot.slice(0, 12)} went 1000000 then 0 across two legs`)
  } finally {
    await fork.release()
  }
})

test('a transaction for another chain is refused rather than answered', { skip: offline }, async () => {
  const fork = await forkAt(BASE_SEPOLIA)
  try {
    await assert.rejects(
      () => fork.run(approveTx(BASE_MAINNET, USDC_MAINNET, 1n)),
      (err: unknown) => err instanceof SimulationError && /chain 8453/.test((err as Error).message),
    )
  } finally {
    await fork.release()
  }
})

test('a fork that cannot be established throws SimulationError rather than serving an empty chain', async () => {
  const previous = process.env.BASE_SEPOLIA_RPC_URL
  process.env.BASE_SEPOLIA_RPC_URL = 'http://127.0.0.1:9/dead'
  try {
    await assert.rejects(
      () => forkAt(BASE_SEPOLIA),
      (err: unknown) => err instanceof SimulationError,
    )
  } finally {
    if (previous === undefined) delete process.env.BASE_SEPOLIA_RPC_URL
    else process.env.BASE_SEPOLIA_RPC_URL = previous
  }
})
