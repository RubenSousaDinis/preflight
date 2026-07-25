/**
 * Registers a Base mainnet agent's card on Base Sepolia so ValidationRegistry
 * publish and ENS claim can use a Sepolia agent id.
 *
 * The Sepolia NFT is owned by the Preflight validator. The mainnet owner is
 * used only for ENS claim ownership. Idempotent via the durable link map.
 */

import {
  createWalletClient,
  decodeEventLog,
  getAddress,
  http,
  parseAbiItem,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { ConfigError, EnsMirrorError } from '../shared/errors.ts'
import {
  ENV,
  identityRegistryFor,
  requireEnv,
  rpcUrlFor,
  validatorAddress,
} from '../shared/config.ts'
import type { Address, AgentId, ChainId } from '../shared/types.ts'
import {
  IDENTITY_REGISTRY_ABI,
  publicClientFor,
  readAgentOwner,
  readAgentURI,
  toTokenId,
} from './identity-registry.ts'
import {
  recordMirrorLink,
  sepoliaIdForMainnet,
} from './mirror-links.ts'

export const MAINNET_CHAIN_ID: ChainId = 8453
export const SEPOLIA_CHAIN_ID: ChainId = 84532

const MAINNET_MARKER = /\[preflight:mainnet=([0-9]+)\]/

export function mainnetMarker(mainnetId: AgentId): string {
  return `[preflight:mainnet=${mainnetId}]`
}

export function parseMainnetMarker(description: string): string | null {
  const match = MAINNET_MARKER.exec(description)
  return match?.[1] ?? null
}

/**
 * Builds the Sepolia agentURI from the mainnet tokenURI, tagging the description
 * so a later reader can recover the mainnet id without the link file.
 */
export function tagAgentUriForMirror(tokenURI: string, mainnetId: AgentId): string {
  const marker = mainnetMarker(mainnetId)
  if (!tokenURI.startsWith('data:application/json')) {
    // External URI: register as-is; link file remains the source of the mapping.
    return tokenURI
  }
  try {
    const comma = tokenURI.indexOf(',')
    if (comma < 0) return tokenURI
    const meta = tokenURI.slice(0, comma)
    const payload = tokenURI.slice(comma + 1)
    const jsonText = meta.includes(';base64')
      ? Buffer.from(payload, 'base64').toString('utf8')
      : decodeURIComponent(payload)
    const card = JSON.parse(jsonText) as Record<string, unknown>
    const prev =
      typeof card.description === 'string' ? card.description.trim() : ''
    if (!prev.includes(marker)) {
      card.description = prev.length > 0 ? `${prev} ${marker}` : marker
    }
    const next = JSON.stringify(card)
    return `data:application/json;base64,${Buffer.from(next, 'utf8').toString('base64')}`
  } catch {
    return tokenURI
  }
}

export interface SepoliaMirrorResult {
  mainnetId: AgentId
  sepoliaId: AgentId
  /** Null when the link already existed and nothing was sent. */
  txHash: Hex | null
  mainnetOwner: Address
  sepoliaOwner: Address
  created: boolean
}

export async function ensureSepoliaMirror(
  mainnetId: AgentId,
  options: {
    send?: boolean
    /** Injected mainnet owner (skips ownerOf), for tests and claim re-use. */
    mainnetOwner?: Address
    /** Injected for tests. */
    registerImpl?: (agentURI: string) => Promise<{ sepoliaId: AgentId; txHash: Hex }>
    /** Injected mainnet tokenURI, for tests. */
    mainnetTokenURI?: string
  } = {},
): Promise<SepoliaMirrorResult> {
  const existing = sepoliaIdForMainnet(mainnetId)
  const mainnetOwner =
    options.mainnetOwner ??
    (await readAgentOwner(mainnetId, { chainId: MAINNET_CHAIN_ID }))

  if (existing !== null) {
    return {
      mainnetId,
      sepoliaId: existing,
      txHash: null,
      mainnetOwner,
      sepoliaOwner: getAddress(validatorAddress()),
      created: false,
    }
  }

  const tokenURI =
    options.mainnetTokenURI ??
    (await readAgentURI(mainnetId, { chainId: MAINNET_CHAIN_ID })).tokenURI
  const agentURI = tagAgentUriForMirror(tokenURI, mainnetId)

  if (options.send === false) {
    throw new EnsMirrorError(
      `no Sepolia mirror for mainnet agent ${mainnetId} yet; re-run with --send to register`,
    )
  }

  if (options.registerImpl !== undefined) {
    const registered = await options.registerImpl(agentURI)
    recordMirrorLink({
      mainnetId,
      sepoliaId: registered.sepoliaId,
      linkedAt: Math.floor(Date.now() / 1000),
    })
    return {
      mainnetId,
      sepoliaId: registered.sepoliaId,
      txHash: registered.txHash,
      mainnetOwner,
      sepoliaOwner: getAddress(validatorAddress()),
      created: true,
    }
  }

  const registered = await registerOnSepolia(agentURI)
  recordMirrorLink({
    mainnetId,
    sepoliaId: registered.sepoliaId,
    linkedAt: Math.floor(Date.now() / 1000),
  })
  return {
    mainnetId,
    sepoliaId: registered.sepoliaId,
    txHash: registered.txHash,
    mainnetOwner,
    sepoliaOwner: getAddress(validatorAddress()),
    created: true,
  }
}

async function registerOnSepolia(
  agentURI: string,
): Promise<{ sepoliaId: AgentId; txHash: Hex }> {
  const key = requireEnv(ENV.validatorPrivateKey, 'registering a Sepolia mirror agent')
  if (!key.startsWith('0x')) {
    throw new ConfigError(`${ENV.validatorPrivateKey} must be a 0x private key`)
  }
  const account = privateKeyToAccount(key as Hex)
  const expected = getAddress(validatorAddress())
  if (getAddress(account.address) !== expected) {
    throw new EnsMirrorError(
      `the loaded key signs as ${account.address}, but the configured validator is ${expected}`,
    )
  }

  const registry = identityRegistryFor(SEPOLIA_CHAIN_ID)
  const wallet = createWalletClient({
    account,
    transport: http(rpcUrlFor(SEPOLIA_CHAIN_ID)),
  })
  const reader = publicClientFor(SEPOLIA_CHAIN_ID)

  const hash = await wallet.writeContract({
    address: registry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [agentURI],
    account,
    chain: null,
  })
  const receipt = await reader.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    throw new EnsMirrorError(`Sepolia register reverted in ${hash}`)
  }

  const transfer = parseAbiItem(
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  )
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: [transfer],
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'Transfer') {
        const tokenId = (decoded.args as { tokenId: bigint }).tokenId
        return { sepoliaId: String(tokenId), txHash: hash as Hex }
      }
    } catch {
      // not a Transfer
    }
  }
  throw new EnsMirrorError(
    `Sepolia register ${hash} landed but no Transfer tokenId was found in the receipt`,
  )
}

/** Resolve mainnet owner for ENS claim after mirror. */
export async function mainnetOwnerForClaim(mainnetId: AgentId): Promise<Address> {
  return readAgentOwner(mainnetId, { chainId: MAINNET_CHAIN_ID })
}

export function assertAgentId(id: string): AgentId {
  toTokenId(id)
  return id
}
