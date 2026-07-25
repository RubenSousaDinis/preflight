/**
 * B8's rehearsal: land two transactions on Base Sepolia and compare each against what was predicted.
 *
 * Run it: `npm run b8`
 *
 * The first is expected to match. The second is a **deliberately forced divergence**: the check runs
 * against the market as it stands, then somebody else trades before the transaction lands, and the
 * amount that comes back is not the amount that was predicted. That is the disclosed limit doing
 * exactly what the UI says it does, and seeing it here means nobody meets it for the first time on
 * stage.
 *
 * This one sends real transactions from the funded Base Sepolia wallet, unlike `npm run d4`, which
 * only reads. It also moves the clean pair's price by design, which is the whole point of the second
 * case and is worth knowing before a rehearsal that expects untouched reserves.
 */

import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { requireEnv, rpcUrlFor } from '../../../shared/config.ts'
import type { Address, Hex, PendingTx, TxVerdict } from '../../../shared/types.ts'
import { divergence, divergenceRows, type LandedTransaction } from '../divergence.ts'
import { baseSepoliaFixtures } from '../fixtures.ts'
import { clearGradedCode } from '../graded.ts'
import { txGuard } from '../txguard.ts'

const BASE_SEPOLIA = 84532
const set = baseSepoliaFixtures()
const market = set.market

const QUOTE_ABI = parseAbi(['function mint(address to, uint256 value)'])
const ROUTER_ABI = parseAbi([
  'function buy(address tokenIn, address tokenOut, uint256 amountIn, address to) returns (uint256)',
])

const rpc = rpcUrlFor(BASE_SEPOLIA)
const account = privateKeyToAccount(
  requireEnv(
    process.env.FIXTURE_DEPLOYER_PRIVATE_KEY === undefined
      ? 'VALIDATOR_PRIVATE_KEY'
      : 'FIXTURE_DEPLOYER_PRIVATE_KEY',
    'landing the divergence rehearsal transactions',
  ) as Hex,
)
const publicClient = createPublicClient({ transport: http(rpc) })
const wallet = createWalletClient({ account, transport: http(rpc) })

/** Send a transaction and read back what actually landed, in the shape the comparison takes. */
async function land(tx: PendingTx): Promise<LandedTransaction> {
  const hash = await wallet.sendTransaction({
    to: tx.to,
    data: tx.calldata,
    value: tx.value,
    chain: null,
    // Explicit, so no gas estimate runs against a pending state that is about to change. Without
    // this the second send can be estimated before the first has landed and revert on gas, which
    // would show up in the panel as state drift when it was nothing of the sort.
    gas: 3_000_000n,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  const sent = await publicClient.getTransaction({ hash })
  return {
    hash,
    from: sent.from as Address,
    to: (sent.to ?? null) as Address | null,
    value: sent.value,
    input: sent.input,
    status: receipt.status === 'success' ? 'success' : 'reverted',
    blockNumber: receipt.blockNumber,
    logs: receipt.logs.map((log) => ({
      address: log.address as Hex,
      topics: log.topics as Hex[],
      data: log.data as Hex,
    })),
  }
}

function report(title: string, verdict: TxVerdict, result: Awaited<ReturnType<typeof divergence>>): void {
  console.log(`\n=== ${title}`)
  console.log(`    checked at block ${verdict.reproducibleFrom.block}, verdict ${verdict.verdict}`)
  console.log(`    ${result.matched ? 'PREDICTED = LANDED' : 'PREDICTED != LANDED'}`)
  console.log(`    ${result.notes}`)
  console.log(`    ${'asset'.padEnd(44)} ${'owner'.padEnd(44)} ${'predicted'.padEnd(26)} landed`)
  for (const row of divergenceRows(result)) {
    const mark = row.differs ? ' <- differs' : ''
    console.log(
      `    ${row.asset.padEnd(44)} ${row.owner.padEnd(44)} ${row.predicted.padEnd(26)} ${row.landed}${mark}`,
    )
  }
}

function buy(amountIn: bigint): PendingTx {
  return {
    chainId: BASE_SEPOLIA,
    from: account.address,
    to: market.router,
    calldata: encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: 'buy',
      args: [market.quoteToken, market.cleanToken, amountIn, account.address],
    }),
    value: 0n,
  }
}

async function main(): Promise<void> {
  console.log(`B8 rehearsal on Base Sepolia. Sending from ${account.address}.`)

  // Case 1: nothing moves in between, so prediction and outcome should agree exactly.
  clearGradedCode()
  const mint: PendingTx = {
    chainId: BASE_SEPOLIA,
    from: account.address,
    to: market.quoteToken,
    calldata: encodeFunctionData({
      abi: QUOTE_ABI,
      functionName: 'mint',
      args: [account.address, 100n * 10n ** 18n],
    }),
    value: 0n,
  }
  const mintVerdict = await txGuard(mint)
  const mintLanded = await land(mint)
  report(
    'the quiet case: nothing moved in between',
    mintVerdict,
    await divergence(mintVerdict.reproducibleFrom, mintVerdict.deltas, mintLanded),
  )

  // Case 2: the check runs, then somebody else trades, then the transaction lands. This is the
  // divergence, forced on purpose. Nothing about the check changed; the market did.
  clearGradedCode()
  const ours = buy(1_000n * 10n ** 18n)
  const buyVerdict = await txGuard(ours)
  console.log('\n    moving the market before the checked transaction lands...')
  await land(buy(20_000n * 10n ** 18n))
  const buyLanded = await land(ours)
  report(
    'the forced divergence: the market moved between the check and the landing',
    buyVerdict,
    await divergence(buyVerdict.reproducibleFrom, buyVerdict.deltas, buyLanded),
  )

  console.log(
    '\nA difference here is the disclosed limit, not a fault: a verdict is reproducible for a block\nand a state, not a prediction of what lands. Say that out loud and leave the panel up.',
  )
}

await main()
