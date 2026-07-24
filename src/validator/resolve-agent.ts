/**
 * A2: an ERC-8004 agent id resolves to a parsed AgentCard.
 *
 * Read the tokenURI at an explicit block, fetch the document under a timeout and a size cap, retain
 * the bytes, then parse. Every failure along the way is an `AgentResolveError`, and no partially
 * populated card is ever returned: a half-populated card grades nothing while looking like it
 * graded something, and the caller has no way to tell.
 */

import { readAgentURI, type RegistryReadOptions } from './identity-registry.ts'
import { fetchCardDocument, type FetchCardOptions } from './fetch-card.ts'
import { parseAgentCard } from './agent-card.ts'
import type { AgentCard, AgentId } from '../shared/types.ts'

export interface ResolveAgentOptions extends RegistryReadOptions, FetchCardOptions {}

export interface ResolvedAgent {
  card: AgentCard
  /** The block the tokenURI was read at, so the resolution can be re-derived. */
  block: bigint
  chainId: number
  /** Where the bytes came from, which for ipfs is the gateway rather than the URI. */
  fetchedFrom: string
  bytes: number
}

/** The full resolution, with the anchors A3a records in the evidence bundle. */
export async function resolveAgentDetailed(
  agentId: AgentId,
  options: ResolveAgentOptions = {},
): Promise<ResolvedAgent> {
  const read = await readAgentURI(agentId, options)
  const document = await fetchCardDocument(read.tokenURI, options)
  const card = parseAgentCard(agentId, read.tokenURI, document.text)
  return {
    card,
    block: read.block,
    chainId: read.chainId,
    fetchedFrom: document.fetchedFrom,
    bytes: document.bytes,
  }
}

/** The interface 01-INTERFACES §1 names. */
export async function resolveAgent(
  agentId: AgentId,
  options: ResolveAgentOptions = {},
): Promise<AgentCard> {
  const resolved = await resolveAgentDetailed(agentId, options)
  return resolved.card
}
