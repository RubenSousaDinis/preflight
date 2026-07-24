/**
 * The known-bad list: short, checked in, and readable in full.
 *
 * 02-DECISIONS section 6 keeps third-party reputation and threat feeds out of the verdict path. A
 * fetched score makes a verdict depend on someone else's server at that moment, which breaks "same
 * input, same verdict, falsifiable by re-run" and leaves nothing to re-run against. This file is
 * the alternative: every entry carries its provenance, so a reader can check the claim at its
 * source and re-derive the verdict from the repo alone.
 *
 * It stays short on purpose. One entry with clean provenance is defensible. Twenty scraped entries
 * are a reputation feed with extra steps, and shipping one would give away the property this whole
 * design exists to keep.
 */

import { getAddress } from 'viem'
import type { Address, ChainId } from '../../../shared/types.ts'

export interface KnownBadEntry {
  chainId: ChainId
  address: Address
  /** What happened, in one line, in the past tense. */
  what: string
  /** Where the claim comes from, specifically enough to check. */
  source: string
}

export const KNOWN_BAD: KnownBadEntry[] = [
  {
    chainId: 8453,
    address: getAddress('0x1f1d37a3Bf840e35c6a860c7C2dA71Fe555123ca'),
    what:
      'Safe module drainer, May 2026: a module that was meant to check its caller did not, and an ' +
      'impersonator forced swaps through attacker pools at amountOutMin zero. 88 Safes drained for ' +
      '$3.98M, of which Base was roughly 71%.',
    source: 'rekt.news, "New Market Trading"',
  },
]

const index = new Map(KNOWN_BAD.map((entry) => [`${entry.chainId}:${entry.address}`, entry]))

export function knownBad(chainId: ChainId, address: Address): KnownBadEntry | null {
  return index.get(`${chainId}:${getAddress(address)}`) ?? null
}
