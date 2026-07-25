/**
 * Reading an agent's tokenURI out of the ERC-8004 IdentityRegistry.
 *
 * The ABI below is the subset this project calls, taken from the verified implementation behind the
 * registry proxy on Base (the proxy is ERC-1967, so the ABI lives at the implementation address).
 * `tokenURI(uint256) -> string` and the uint256 id are facts about the deployed contract, checked
 * against it rather than assumed.
 *
 * Every read is pinned to an explicit block. A resolution that cannot be pinned to a block cannot be
 * re-derived by anyone checking the grade, which is the property the whole project rests on.
 */

import { createPublicClient, http, parseAbi, type PublicClient } from 'viem'

import { AgentResolveError, ConfigError } from '../shared/errors.ts'
import { identityRegistryFor, rpcUrlFor } from '../shared/config.ts'
import type { AgentId, ChainId } from '../shared/types.ts'

export const IDENTITY_REGISTRY_ABI = parseAbi([
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'function register(string agentURI) returns (uint256)',
  'function setAgentURI(uint256 agentId, string newURI)',
])

/**
 * A registration-v1 card as an inline data URI.
 *
 * Inline because the card needs no hosting to be resolvable: the live registry already serves cards this
 * way, and A2 fetches `data:` for exactly this reason. The MCP endpoint goes in a `services` entry whose
 * name reads as MCP, which is where A2 looks first and what nothing in the public registry happens to do
 * by accident.
 */
export function buildAgentCard(input: {
  name: string
  endpoint: string
  description?: string
  version?: string
  skills?: string[]
}): { card: Record<string, unknown>; dataUri: string } {
  const card: Record<string, unknown> = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: input.name,
    description: input.description ?? 'A demo agent graded by Preflight at ETHGlobal Lisbon 2026.',
    services: [{ name: 'MCP', endpoint: input.endpoint }],
  }
  if (input.version !== undefined) card.version = input.version
  if (input.skills !== undefined && input.skills.length > 0) card.skills = input.skills
  const json = JSON.stringify(card)
  return { card, dataUri: `data:application/json;base64,${Buffer.from(json, 'utf8').toString('base64')}` }
}

/**
 * Which chain carries the identity this deployment resolves against.
 *
 * 02-DECISIONS §4 records the registry on Base mainnet as the resolved one, so that is the value
 * here rather than an inferred default. `IDENTITY_REGISTRY_CHAIN_ID` overrides it, which is what
 * D1 sets if the demo agents are registered on Base Sepolia instead.
 */
export const DEFAULT_IDENTITY_CHAIN_ID: ChainId = 8453

/**
 * Which chain the identity is read from.
 *
 * `IDENTITY_REGISTRY_CHAIN_ID` wins. Otherwise it follows the chain the Validation Registry is on,
 * because the two are not independent: a validation request is authorized against `ownerOf(agentId)` in
 * the IdentityRegistry the ValidationRegistry was initialized with, so an agent registered on one chain
 * and attested on another cannot be published at all. A fixed mainnet fallback is what produced
 * "agent 8427 is registered with an empty tokenURI" while its record sat on Sepolia: a confusing failure
 * a long way from its cause.
 */
export function identityChainId(): ChainId {
  const configured = process.env.IDENTITY_REGISTRY_CHAIN_ID?.trim()
  if (configured !== undefined && configured.length > 0) {
    const parsed = Number(configured)
    if (!Number.isInteger(parsed)) {
      throw new ConfigError('IDENTITY_REGISTRY_CHAIN_ID is not an integer chain id')
    }
    return parsed
  }
  const validationChain = process.env.VALIDATION_REGISTRY_CHAIN_ID?.trim()
  if (validationChain !== undefined && validationChain.length > 0) {
    const parsed = Number(validationChain)
    if (Number.isInteger(parsed)) return parsed
  }
  return DEFAULT_IDENTITY_CHAIN_ID
}

export function publicClientFor(chainId: ChainId): PublicClient {
  return createPublicClient({ transport: http(rpcUrlFor(chainId)) })
}

/** The onchain id is a uint256. Anything that is not a non-negative integer never reaches the RPC. */
export function toTokenId(agentId: AgentId): bigint {
  if (!/^[0-9]+$/.test(agentId.trim())) {
    throw new AgentResolveError(
      `agent id ${JSON.stringify(agentId)} is not an ERC-8004 id, which is a uint256`,
    )
  }
  return BigInt(agentId.trim())
}

export interface RegistryReadOptions {
  chainId?: ChainId
  /** Pin the read. Omitted means the head block at call time, which is then recorded. */
  atBlock?: bigint
  client?: PublicClient
}

export interface AgentURIRead {
  agentId: AgentId
  tokenURI: string
  chainId: ChainId
  registry: string
  block: bigint
}

/**
 * Reads `tokenURI(agentId)` at an explicit block.
 *
 * A revert means the id is not registered, and an empty string means it is registered with nothing
 * to fetch. Both are `AgentResolveError`: absence is not permission, and a caller must not be handed
 * something that looks like a card.
 */
export async function readAgentURI(
  agentId: AgentId,
  options: RegistryReadOptions = {},
): Promise<AgentURIRead> {
  const chainId = options.chainId ?? identityChainId()
  const registry = identityRegistryFor(chainId)
  const client = options.client ?? publicClientFor(chainId)
  const tokenId = toTokenId(agentId)

  let block: bigint
  try {
    block = options.atBlock ?? (await client.getBlockNumber())
  } catch (err) {
    throw new AgentResolveError(`could not read the head block on chain ${chainId}`, {
      retryable: true,
      cause: err,
    })
  }

  let tokenURI: string
  try {
    tokenURI = await client.readContract({
      address: registry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'tokenURI',
      args: [tokenId],
      blockNumber: block,
    })
  } catch (err) {
    // A revert here is the unregistered case, which is the common one and is not retryable. Any
    // other read failure is transport and may be retried by a human, never automatically by a gate.
    const message = err instanceof Error ? err.message : String(err)
    const reverted = /revert|ERC721NonexistentToken|nonexistent/i.test(message)
    throw new AgentResolveError(
      reverted
        ? `agent ${agentId} is not registered in the identity registry on chain ${chainId}`
        : `could not read tokenURI for agent ${agentId} on chain ${chainId}`,
      { retryable: !reverted, cause: err },
    )
  }

  if (tokenURI.trim().length === 0) {
    throw new AgentResolveError(`agent ${agentId} is registered with an empty tokenURI`)
  }

  return { agentId, tokenURI, chainId, registry, block }
}
