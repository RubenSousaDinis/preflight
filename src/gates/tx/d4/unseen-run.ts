/**
 * D4: the unseen run, prepared to one command.
 *
 * This forks **Base mainnet** at head, which is the one run that does (02-DECISIONS section 3), and
 * puts code the team did not write through the same gate the staged fixtures went through. Nothing
 * here is a new detector: the four flags are closed, and what changes for this run is the input.
 *
 * Run it: `npm run d4`
 *
 * It prints, per input, the verdict, the flags, the reason, and the reproducible tuple, then
 * re-runs each verdict pinned at the block it first reported and checks the two agree. That last
 * step is D4's done-when 3 and it is the thing that makes the stage run re-derivable afterwards.
 *
 * Reads only. It sends nothing, signs nothing, and needs no key.
 */

import { encodeFunctionData, parseAbi } from 'viem'
import type { Address, PendingTx, TxVerdict } from '../../../shared/types.ts'
import { verifiedSource } from '../explorer.ts'
import { clearGradedCode } from '../graded.ts'
import { readerFor } from '../rpc.ts'
import { txGuard } from '../txguard.ts'

const BASE_MAINNET = 8453

/** Sourced in 02-DECISIONS 13.3, and re-verified morning-of because chain state moves. */
export const TARGETS = {
  /** Grand Base (GB). April 2024: a compromised owner key minted from nothing and dumped. */
  grandBase: '0x2aF864fb54b55900Cd58d19c7102d9e4FA8D84a3' as Address,
  /** SquidRouterModule. May 2026: a Safe module missing its caller check, 88 Safes drained. */
  squidModule: '0x1f1d37a3Bf840e35c6a860c7C2dA71Fe555123ca' as Address,
  /** Aerodrome Finance Router, Base's largest native DEX. The clean, verified, active control. */
  aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43' as Address,
  /** WETH, the OP Stack predeploy. The most ordinary call on the chain. */
  weth: '0x4200000000000000000000000000000000000006' as Address,
}

/** Not a wallet anyone holds. It only has to be an address the caller never named. */
const ATTACKER = '0x00000000000000000000000000000000BaDc0dE0' as Address

const OWNABLE = parseAbi([
  'function owner() view returns (address)',
  'function transferOwnership(address newOwner)',
  'function mintStakingRewards(uint256 amount)',
  'function approve(address spender, uint256 amount) returns (bool)',
])
const WETH_ABI = parseAbi(['function deposit() payable'])

interface Input {
  label: string
  /** Why this input is here, printed with the result so the log explains itself. */
  note: string
  expect: 'BLOCK' | 'ALLOW'
  tx: PendingTx
}

async function inputs(): Promise<Input[]> {
  const reader = readerFor(BASE_MAINNET)
  const head = await reader.blockNumber()
  const ownerWord = await reader.call(
    TARGETS.grandBase,
    encodeFunctionData({ abi: OWNABLE, functionName: 'owner' }),
    head,
  )
  const owner = `0x${ownerWord.slice(-40)}` as Address

  return [
    {
      label: 'known-bad: Grand Base, owner handing the token to someone else',
      note: 'transferOwnership on a real verified mainnet token. The owner slot moves during the call, which is the deterministic signal flag 4 reads.',
      expect: 'BLOCK',
      tx: {
        chainId: BASE_MAINNET,
        from: owner,
        to: TARGETS.grandBase,
        calldata: encodeFunctionData({
          abi: OWNABLE,
          functionName: 'transferOwnership',
          args: [ATTACKER],
        }),
        value: 0n,
      },
    },
    {
      label: 'known-bad: Grand Base, the privileged mint from the incident itself',
      note: 'mintStakingRewards, the function the compromised key actually called in April 2024. Checked 2026-07-25: it reverts at current state, so the incident cannot be replayed as it happened, and this row is recorded rather than demonstrated. Worth knowing either way: a privileged mint is not one of the four flags, so a mint that did go through would allow. The run says that rather than implying coverage.',
      expect: 'ALLOW',
      tx: {
        chainId: BASE_MAINNET,
        from: owner,
        to: TARGETS.grandBase,
        calldata: encodeFunctionData({
          abi: OWNABLE,
          functionName: 'mintStakingRewards',
          args: [32_500_000n * 10n ** 18n],
        }),
        value: 0n,
      },
    },
    {
      label: 'known-bad: Grand Base, unlimited allowance to an address nobody named',
      note: 'The drainer shape on a contract the team did not write, for the flag 1 row.',
      expect: 'BLOCK',
      tx: {
        chainId: BASE_MAINNET,
        from: owner,
        to: TARGETS.grandBase,
        calldata: encodeFunctionData({
          abi: OWNABLE,
          functionName: 'approve',
          args: [ATTACKER, 2n ** 256n - 1n],
        }),
        value: 0n,
      },
    },
    {
      label: 'clean control: WETH deposit, the most ordinary call on Base',
      note: 'A gate that blocks everything is not a gate. This is the passing case that makes the blocking cases mean something.',
      expect: 'ALLOW',
      tx: {
        chainId: BASE_MAINNET,
        from: owner,
        to: TARGETS.weth,
        calldata: encodeFunctionData({ abi: WETH_ABI, functionName: 'deposit' }),
        value: 10n ** 16n,
      },
    },
  ]
}

function render(verdict: TxVerdict, elapsedMs: number): void {
  console.log(`  ${verdict.verdict} in ${elapsedMs}ms`)
  console.log(`  reason: ${verdict.reason}`)
  for (const flag of verdict.flags) {
    console.log(`  flag:   ${flag.id} / ${flag.severity} / confirmedBy ${flag.confirmedBy}`)
    console.log(`          ${flag.detail}`)
  }
  for (const delta of verdict.deltas.slice(0, 5)) {
    console.log(`  delta:  ${delta.owner} ${delta.token} ${delta.delta}`)
  }
  const tuple = verdict.reproducibleFrom
  console.log(
    `  tuple:  block ${tuple.block} from ${tuple.from} to ${tuple.to} calldataHash ${tuple.calldataHash} value ${tuple.value}`,
  )
  console.log(`  code:   ${verdict.codeFingerprint}`)
}

async function main(): Promise<void> {
  console.log('D4, the unseen run. Base mainnet, forked at head, reads only.\n')

  for (const [name, address] of Object.entries(TARGETS)) {
    const status = await verifiedSource(BASE_MAINNET, address)
    console.log(`verified source  ${name.padEnd(16)} ${address}  ${status.note}`)
  }
  console.log()

  for (const input of await inputs()) {
    console.log(`=== ${input.label}`)
    console.log(`    ${input.note}`)

    clearGradedCode()
    const startedAt = Date.now()
    const first = await txGuard(input.tx)
    render(first, Date.now() - startedAt)

    // D4 done-when 3: re-run pinned at the block the first verdict reported, and check they agree.
    clearGradedCode()
    const second = await txGuard(input.tx, { atBlock: first.reproducibleFrom.block })
    const same =
      second.verdict === first.verdict &&
      second.codeFingerprint === first.codeFingerprint &&
      second.flags.map((f) => f.id).join(',') === first.flags.map((f) => f.id).join(',')
    console.log(`  re-run from the tuple: ${same ? 'identical verdict' : 'DIFFERENT, read it out loud'}`)

    if (first.verdict !== input.expect) {
      console.log(`  NOTE: expected ${input.expect}. Chain state moves; say what it does now.`)
    }
    console.log()
  }
}

await main()
