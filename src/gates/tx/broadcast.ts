/**
 * D5c: the broadcast seam on the allow path.
 *
 * A transaction that survives the gate goes out through the endpoint configured for its chain, and
 * the label says which one actually carried it. That last clause is the whole task: a badge driven
 * by configuration reads "protected" while the request went somewhere else, and that is the exact
 * overclaim this project's copy rules forbid.
 *
 * **The honest fact about our chains.** Flashbots Protect and MEV-Blocker serve Ethereum mainnet;
 * everything here runs on Base, which orders through a sequencer with no public mempool, so
 * front-running the allow path is not the exposure on this chain. A Base-native option does exist
 * (Merkle/Blink, a routing layer on top of any RPC), so the seam is real and correctly wired. With
 * nothing configured it says so in words rather than showing protection nobody is providing.
 *
 * Strictly downstream of the verdict, with no opinion of its own. A blocked transaction goes
 * nowhere: not to a protected endpoint, not to a default one, nowhere at all.
 */

import { optionalEnv, rpcUrlFor } from '../../shared/config.ts'
import type { ChainId, Hex, TxVerdict } from '../../shared/types.ts'

/** Per chain, the env var naming a protected endpoint. Absent is the normal case, not an error. */
const PROTECTED_ENV: Record<ChainId, string> = {
  8453: 'BASE_MAINNET_PROTECTED_RPC_URL',
  84532: 'BASE_SEPOLIA_PROTECTED_RPC_URL',
}

export interface BroadcastRoute {
  chainId: ChainId
  url: string
  kind: 'protected' | 'default'
  /** What a reader is told, phrased for the case that is actually true. */
  label: string
}

export function routeFor(chainId: ChainId): BroadcastRoute {
  const envName = PROTECTED_ENV[chainId]
  const configured = envName === undefined ? undefined : optionalEnv(envName)
  if (configured !== undefined) {
    return { chainId, url: configured, kind: 'protected', label: `routed through ${configured}` }
  }
  return {
    chainId,
    url: rpcUrlFor(chainId),
    kind: 'default',
    label: 'default endpoint, no protected route configured for this chain',
  }
}

export interface BroadcastResult {
  sent: boolean
  hash: Hex | null
  /** Derived from the path the request actually took, never from configuration intent. */
  label: string
  note: string
  route: BroadcastRoute | null
}

export type RawSender = (url: string, signed: Hex) => Promise<Hex>

const httpSender: RawSender = async (url, signed) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendRawTransaction',
      params: [signed],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = (await response.json()) as { result?: Hex; error?: { message?: string } }
  if (body.error !== undefined || body.result === undefined) {
    throw new Error(body.error?.message ?? `endpoint answered ${response.status} with no result`)
  }
  return body.result
}

/**
 * Broadcast a signed transaction, if and only if the gate allowed it.
 *
 * A protected endpoint that fails throws. It does not quietly retry against the public one:
 * degrading silently while showing a protected label is worse than failing loudly, and a retry
 * against a second endpoint is also how one transaction becomes two.
 */
export async function broadcast(
  verdict: TxVerdict,
  signed: Hex,
  chainId: ChainId,
  send: RawSender = httpSender,
): Promise<BroadcastResult> {
  if (verdict.verdict !== 'ALLOW') {
    // Nothing is selected, nothing is contacted, nothing is sent. The route is not even resolved,
    // so a blocked transaction cannot leak the fact that it existed to any endpoint.
    return {
      sent: false,
      hash: null,
      label: 'not broadcast',
      note: `This transaction was blocked, so it was not sent anywhere: ${verdict.reason}`,
      route: null,
    }
  }

  const route = routeFor(chainId)
  let hash: Hex
  try {
    hash = await send(route.url, signed)
  } catch (cause) {
    throw new Error(
      `the ${route.kind} endpoint for chain ${chainId} did not accept this transaction, and nothing was retried elsewhere: ${cause instanceof Error ? cause.message : 'unknown failure'}`,
      { cause },
    )
  }

  return {
    sent: true,
    hash,
    label: route.label,
    note:
      route.kind === 'protected'
        ? `Sent through the protected endpoint configured for chain ${chainId}.`
        : `Sent through the default endpoint. No protected route is configured for chain ${chainId}, and none was applied. On Base the sequencer orders transactions with no public mempool, so this is a statement about what ran rather than a gap being papered over.`,
    route,
  }
}
