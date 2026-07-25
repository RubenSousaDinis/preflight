/**
 * The two backends must agree, or the swap is not honest.
 *
 * This runs the same staged fixtures through the same gate twice, once with anvil executing the EVM
 * locally and once with the provider's node executing it, and compares the verdicts. Anything that
 * differs is a difference a judge could find by clicking the deployed link instead of watching the
 * stage, so it is better found here.
 *
 * Both runs pin the same block, because a verdict is reproducible for a block and a state, and
 * comparing two backends at two different heights would be comparing two different questions.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, parseAbi } from 'viem'
import type { Address, PendingTx, TxVerdict } from '../../shared/types.ts'
import { baseSepoliaFixtures } from './fixtures.ts'
import { anvilForkAt } from './fork.ts'
import { rpcForkAt } from './rpc-fork.ts'
import { clearGradedCode } from './graded.ts'
import { codeFingerprint } from './fingerprint.ts'
import { DETECTORS } from './detectors/index.ts'
import { gradedCodeFor } from './graded.ts'
import { txGuardWith } from './txguard.ts'

const BASE_SEPOLIA = 84532
const offline = process.env.BASE_SEPOLIA_RPC_URL === undefined
const set = baseSepoliaFixtures()
const f = set.fixtures

const WALLET = '0x1111111111111111111111111111111111111111' as Address

const ABI = parseAbi([
  'function swap(uint256 amountIn)',
  'function claim()',
  'function ping() returns (uint256)',
  'function forward() payable',
  'function buy(address tokenIn, address tokenOut, uint256 amountIn, address to) returns (uint256)',
])

function call(to: Address, data: PendingTx['calldata'], value = 0n, from: Address = WALLET): PendingTx {
  return { chainId: BASE_SEPOLIA, from, to, calldata: data, value }
}

const CASES: { label: string; tx: PendingTx }[] = [
  {
    label: 'drainer router',
    tx: call(f.drainerRouter, encodeFunctionData({ abi: ABI, functionName: 'swap', args: [1000n] })),
  },
  {
    label: 'backdoor proxy claim',
    tx: call(f.backdoorProxy, encodeFunctionData({ abi: ABI, functionName: 'claim' })),
  },
  {
    label: 'value router to an unverified sink',
    tx: call(f.valueRouter, encodeFunctionData({ abi: ABI, functionName: 'forward' }), 10n ** 15n),
  },
  {
    label: 'clean control',
    tx: call(f.cleanControl, encodeFunctionData({ abi: ABI, functionName: 'ping' })),
  },
  {
    label: 'honeypot buy, the two-leg case',
    tx: call(
      set.market.router,
      encodeFunctionData({
        abi: ABI,
        functionName: 'buy',
        args: [set.market.quoteToken, set.market.honeypotToken, 1000n * 10n ** 18n, set.deployer],
      }),
      0n,
      set.deployer,
    ),
  },
]

function shape(verdict: TxVerdict): string {
  const flags = verdict.flags
    .map((flag) => `${flag.id}/${flag.severity}/${flag.confirmedBy}`)
    .sort()
    .join(',')
  return `${verdict.verdict} [${flags}] drift=${verdict.driftFromGraded} code=${verdict.codeFingerprint}`
}

async function verdictOn(
  backend: 'anvil' | 'rpc',
  tx: PendingTx,
  atBlock: bigint,
): Promise<TxVerdict> {
  clearGradedCode()
  return txGuardWith(tx, { atBlock }, {
    forkAt: backend === 'anvil' ? anvilForkAt : rpcForkAt,
    codeFingerprint,
    gradedCodeFor,
    detectors: DETECTORS,
  })
}

test('both backends reach the same verdict on every staged fixture', { skip: offline }, async () => {
  // One block for both runs. Pinned, because the comparison is only meaningful at a fixed state.
  const anchor = await anvilForkAt(BASE_SEPOLIA)
  const block = anchor.block
  await anchor.release()
  console.log(`  comparing at block ${block}`)

  for (const testCase of CASES) {
    const viaAnvil = await verdictOn('anvil', testCase.tx, block)
    // Paced on purpose. Our own endpoint rate limits debug_traceCall, which the RPC backend leans
    // on twice per leg, and a test that hammers it measures the throttle rather than the backends.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const viaRpc = await verdictOn('rpc', testCase.tx, block)
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    assert.equal(
      shape(viaRpc),
      shape(viaAnvil),
      `${testCase.label}: the backends disagreed, which a judge could find by opening the deployed link`,
    )
    assert.equal(viaRpc.reproducibleFrom.block, viaAnvil.reproducibleFrom.block)
    console.log(`  ${testCase.label.padEnd(34)} ${viaAnvil.verdict}  (both backends)`)
  }
})

test('the rpc backend keeps legs sequential, so leg two sees leg one', { skip: offline }, async () => {
  const fork = await rpcForkAt(BASE_SEPOLIA)
  try {
    const approve = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
    const spender = '0x2222222222222222222222222222222222222222' as Address
    const allowance = parseAbi([
      'function allowance(address owner, address spender) view returns (uint256)',
    ])

    await fork.run(
      call(
        f.drainableToken,
        encodeFunctionData({ abi: approve, functionName: 'approve', args: [spender, 1_000_000n] }),
      ),
    )
    const after = await fork.call(
      f.drainableToken,
      encodeFunctionData({ abi: allowance, functionName: 'allowance', args: [WALLET, spender] }),
    )

    assert.equal(BigInt(after), 1_000_000n, 'the read observed the leg that ran before it')
    console.log(`  allowance after leg one, read on the same simulated state: ${BigInt(after)}`)
  } finally {
    await fork.release()
  }
})

test('the rpc backend refuses a storage read it cannot answer honestly', { skip: offline }, async () => {
  const fork = await rpcForkAt(BASE_SEPOLIA)
  try {
    // Before any leg, the read is well defined and answered.
    const slot = `0x${'00'.repeat(32)}` as const
    assert.ok((await fork.storageAt(f.cleanControl, slot)).startsWith('0x'))

    await fork.run(call(f.cleanControl, encodeFunctionData({ abi: ABI, functionName: 'ping' })))
    // After one, the honest answer is that it cannot, rather than a value that predates the leg.
    await assert.rejects(() => fork.storageAt(f.cleanControl, slot), /predate the leg/)
  } finally {
    await fork.release()
  }
})
