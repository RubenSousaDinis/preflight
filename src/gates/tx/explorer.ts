/**
 * Verified-source status, which is the one external fact allowed inside a verdict.
 *
 * 02-DECISIONS section 6 draws the line: whether anyone published source for an address is a fact
 * about the chain, reproducible by anyone who asks the same question. A proprietary threat score is
 * not, and none is read here or anywhere else in the verdict path.
 *
 * Sourcify is primary (02-DECISIONS 13.2): no API key, live-checked on both Base networks. Every
 * failure resolves to "not verified", which is the fail closed direction: an unreachable explorer
 * must not be able to upgrade an unknown spender into a trusted one, and a slow explorer must not
 * be cheaper to pass than a fast one.
 */

import { getAddress } from 'viem'
import type { Address, ChainId } from '../../shared/types.ts'

const SOURCIFY = 'https://sourcify.dev/server/v2/contract'
const LOOKUP_TIMEOUT_MS = 5_000

/**
 * Definitive answers only. A 200 or a 404 is what the chain says and is cached for the process; a
 * timeout or a socket error is cached nowhere, so a transient failure cannot poison later lookups
 * into permanently reporting an address as unverified.
 */
const known = new Map<string, boolean>()

export interface VerifiedStatus {
  verified: boolean
  /** What the lookup actually saw, for the flag detail and for the evidence. */
  note: string
}

export function clearVerifiedCache(): void {
  known.clear()
}

export async function verifiedSource(chainId: ChainId, address: Address): Promise<VerifiedStatus> {
  const key = `${chainId}:${getAddress(address)}`
  const cached = known.get(key)
  if (cached !== undefined) {
    return { verified: cached, note: cached ? 'source verified' : 'source not verified' }
  }

  try {
    const response = await fetch(`${SOURCIFY}/${chainId}/${getAddress(address)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })

    if (response.status === 404) {
      known.set(key, false)
      return { verified: false, note: 'source not verified' }
    }
    if (!response.ok) {
      return { verified: false, note: `source status unavailable, explorer answered ${response.status}` }
    }

    const body = (await response.json()) as { match?: string | null }
    const verified = typeof body.match === 'string' && body.match.length > 0
    known.set(key, verified)
    return {
      verified,
      note: verified ? `source verified, ${body.match}` : 'source not verified',
    }
  } catch {
    // Unreachable or too slow. Unverified is the answer that blocks, so this is the direction a
    // failure has to fall.
    return { verified: false, note: 'source status unavailable, treating as not verified' }
  }
}
