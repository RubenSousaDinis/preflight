/**
 * D5c end to end: gate a transaction, then broadcast it through whichever endpoint its chain
 * actually has, and print the label that comes back.
 *
 * Run it: `npm run check:broadcast`
 *
 * It sends one real, zero value transaction from the funded Base Sepolia wallet to itself, which
 * costs gas and moves nothing. The point is the label: on Base there is no protected route
 * configured, so the honest line is that the default endpoint carried it, and this prints that line
 * rather than a badge nobody is backing.
 */

import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { requireEnv, rpcUrlFor } from '../../../shared/config.ts'
import type { Hex, PendingTx } from '../../../shared/types.ts'
import { broadcast, routeFor } from '../broadcast.ts'
import { clearGradedCode } from '../graded.ts'
import { txGuard } from '../txguard.ts'

const BASE_SEPOLIA = 84532

const account = privateKeyToAccount(
  requireEnv(
    process.env.FIXTURE_DEPLOYER_PRIVATE_KEY === undefined
      ? 'VALIDATOR_PRIVATE_KEY'
      : 'FIXTURE_DEPLOYER_PRIVATE_KEY',
    'the broadcast rehearsal',
  ) as Hex,
)
const rpc = rpcUrlFor(BASE_SEPOLIA)
const publicClient = createPublicClient({ transport: http(rpc) })
const wallet = createWalletClient({ account, transport: http(rpc) })

const tx: PendingTx = {
  chainId: BASE_SEPOLIA,
  from: account.address,
  to: account.address,
  calldata: '0x',
  value: 0n,
}

async function main(): Promise<void> {
  const route = routeFor(BASE_SEPOLIA)
  console.log(`D5c on Base Sepolia, from ${account.address}`)
  console.log(`configured route: ${route.kind}`)
  console.log(`label:            ${route.label}\n`)

  clearGradedCode()
  const verdict = await txGuard(tx)
  console.log(`verdict: ${verdict.verdict} at block ${verdict.reproducibleFrom.block}`)
  console.log(`reason:  ${verdict.reason}\n`)

  const request = await wallet.prepareTransactionRequest({
    to: tx.to,
    value: tx.value,
    data: tx.calldata,
    chain: null,
  })
  const signed = (await wallet.signTransaction(request as never)) as Hex

  const result = await broadcast(verdict, signed, BASE_SEPOLIA)
  console.log(`sent:  ${result.sent}`)
  console.log(`hash:  ${result.hash}`)
  console.log(`label: ${result.label}`)
  console.log(`note:  ${result.note}`)

  if (result.hash !== null) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: result.hash })
    console.log(`\nlanded in block ${receipt.blockNumber}, status ${receipt.status}`)
  }

  // The other half of the claim: a blocked verdict contacts nothing at all. Shown rather than
  // asserted, because "we did not send it" is only worth as much as the demonstration.
  const blocked = await broadcast(
    { ...verdict, verdict: 'BLOCK', reason: 'blocked for this demonstration' },
    signed,
    BASE_SEPOLIA,
  )
  console.log(`\non a block: sent=${blocked.sent} route=${blocked.route} label=${blocked.label}`)
}

await main()
