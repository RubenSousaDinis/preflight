/**
 * B5b, flag 1 of 4: drainer approval.
 *
 * A transaction that grants an unlimited allowance, or any allowance to a spender the caller has no
 * reason to trust, blocks.
 *
 * The input is `approvalDeltas` from the simulation, never the calldata selector. Selector matching
 * would miss every approval granted through a router, a multicall, or an ERC-2612 permit, which is
 * most of the cases worth catching, and it is exactly how the D3 drainer fixture works: the caller
 * signs `swap`, and the allowance appears anyway.
 */

import { isAddressEqual } from 'viem'
import type {
  Address,
  ApprovalDelta,
  ChainId,
  Detector,
  Flag,
  PendingTx,
} from '../../../shared/types.ts'
import { verifiedSource } from '../explorer.ts'
import { readerFor } from '../rpc.ts'

/** The unlimited sentinels. `uint256` max is the ERC-20 convention, `uint160` max is Permit2's. */
export const MAX_UINT256 = 2n ** 256n - 1n
export const MAX_UINT160 = 2n ** 160n - 1n

export function isUnlimited(amount: bigint): boolean {
  return amount === MAX_UINT256 || amount === MAX_UINT160
}

function amountLabel(amount: bigint): string {
  if (amount === MAX_UINT256) return 'an unlimited amount (uint256 max)'
  if (amount === MAX_UINT160) return 'an unlimited amount (uint160 max, the Permit2 sentinel)'
  return `${amount}`
}

interface SpenderStanding {
  trusted: boolean
  note: string
}

/** The two outside facts this detector reads, injectable so the rules can be tested offline. */
export interface ApprovalLookups {
  hasCode: (chainId: ChainId, address: Address, atBlock: bigint) => Promise<boolean>
  verified: (chainId: ChainId, address: Address) => Promise<{ verified: boolean; note: string }>
}

const liveLookups: ApprovalLookups = {
  hasCode: async (chainId, address, atBlock) =>
    (await readerFor(chainId).code(address, atBlock)).length > 2,
  verified: verifiedSource,
}

/**
 * Is this spender one the caller has a reason to trust?
 *
 * Two ways to qualify: it is the contract the caller is transacting with, or it has published
 * source. Everything else is unknown, and an allowance to an address with no code at all is the
 * strongest case of it, since nobody can read what an EOA will do with the allowance.
 */
async function standing(
  lookups: ApprovalLookups,
  chainId: ChainId,
  spender: Address,
  callee: Address,
  atBlock: bigint,
): Promise<SpenderStanding> {
  if (isAddressEqual(spender, callee)) {
    return { trusted: true, note: 'the contract this transaction is calling' }
  }

  let hasCode = false
  try {
    hasCode = await lookups.hasCode(chainId, spender, atBlock)
  } catch {
    // A read that failed is not evidence of code. Unknown is the direction that blocks.
    return { trusted: false, note: 'code presence could not be read, treating as unknown' }
  }
  if (!hasCode) {
    return { trusted: false, note: 'an address with no code, so nothing constrains what it does next' }
  }

  const status = await lookups.verified(chainId, spender)
  return { trusted: status.verified, note: status.note }
}

function flagFor(delta: ApprovalDelta, unlimited: boolean, spender: SpenderStanding): Flag {
  const reasons: string[] = []
  if (unlimited) reasons.push('the allowance is unbounded')
  if (!spender.trusted) reasons.push(`the spender is ${spender.note}`)

  return {
    id: 'drainer-approval',
    severity: 'block',
    title: unlimited
      ? `unlimited allowance to ${delta.spender}`
      : `allowance to ${delta.spender}, which this transaction never named`,
    detail:
      `this call leaves ${delta.spender} holding ${amountLabel(delta.amount)} of ` +
      `${delta.token} belonging to ${delta.owner}. Blocked because ${reasons.join(', and ')}.`,
    // Read from what the transaction did on a fork, not from what its calldata claimed.
    confirmedBy: 'simulation',
  }
}

export function drainerApprovalWith(lookups: ApprovalLookups): Detector {
  return async (sim, tx: PendingTx) => {
    const flags: Flag[] = []

    for (const delta of sim.approvalDeltas) {
      // Zeroing an allowance is the remediation, not the attack. Flagging it teaches a reader to
      // ignore the flag.
      if (delta.amount === 0n) continue

      const unlimited = isUnlimited(delta.amount)
      const spender = await standing(lookups, tx.chainId, delta.spender, tx.to, sim.block)
      if (!unlimited && spender.trusted) continue

      flags.push(flagFor(delta, unlimited, spender))
    }

    return flags
  }
}

export const drainerApproval: Detector = drainerApprovalWith(liveLookups)
