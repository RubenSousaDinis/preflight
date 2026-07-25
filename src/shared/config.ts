/**
 * The per-chain configuration surface, read from the environment.
 *
 * Config is per chain from the first commit (A1's invariant): txGuard is chainId-parameterized per
 * 02-DECISIONS §3, so there is no default network and no default RPC anywhere in this file. A
 * missing value throws `ConfigError` rather than falling back, because a gate that silently reads
 * the wrong chain produces a verdict about a contract that is not the one under test.
 *
 * Server side only. Nothing here is exported to the browser.
 */

import { ConfigError } from './errors.ts'
import type { Address, ChainId } from './types.ts'

export type ChainKey = 'base-mainnet' | 'base-sepolia' | 'hedera-testnet'

export interface ChainConfig {
  key: ChainKey
  chainId: ChainId
  label: string
  /** Environment variable holding the RPC URL. There is no default endpoint. */
  rpcEnv: string
  /** Environment variable holding the explorer API key, where one applies. */
  explorerKeyEnv: string | null
  /**
   * ERC-8004 IdentityRegistry, from 02-DECISIONS §4. Deployed by the standard's authors at the same
   * address across 40+ chains. Normalize with `getAddress` at the call boundary before use.
   */
  identityRegistry: Address | null
  /** What this chain is for, so a misconfiguration reads as a sentence rather than a variable name. */
  role: string
}

export const CHAINS: Record<ChainKey, ChainConfig> = {
  'base-mainnet': {
    key: 'base-mainnet',
    chainId: 8453,
    label: 'Base mainnet',
    rpcEnv: 'BASE_MAINNET_RPC_URL',
    explorerKeyEnv: 'BASE_MAINNET_EXPLORER_API_KEY',
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    role: 'validator attestations, and the unseen-run fork',
  },
  'base-sepolia': {
    key: 'base-sepolia',
    chainId: 84532,
    label: 'Base Sepolia',
    rpcEnv: 'BASE_SEPOLIA_RPC_URL',
    explorerKeyEnv: 'BASE_SEPOLIA_EXPLORER_API_KEY',
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    role: 'staged fixtures, and the staged fork',
  },
  'hedera-testnet': {
    key: 'hedera-testnet',
    chainId: 296,
    label: 'Hedera Testnet',
    rpcEnv: 'HEDERA_TESTNET_RPC_URL',
    explorerKeyEnv: null,
    identityRegistry: null,
    role: 'the x402 payment rail, never an input to a verdict',
  },
}

export const CHAIN_KEYS: readonly ChainKey[] = ['base-mainnet', 'base-sepolia', 'hedera-testnet']

/** Every environment variable this project reads, in one place. */
export const ENV = {
  baseMainnetRpc: 'BASE_MAINNET_RPC_URL',
  baseMainnetExplorerKey: 'BASE_MAINNET_EXPLORER_API_KEY',
  baseSepoliaRpc: 'BASE_SEPOLIA_RPC_URL',
  baseSepoliaExplorerKey: 'BASE_SEPOLIA_EXPLORER_API_KEY',
  hederaRpc: 'HEDERA_TESTNET_RPC_URL',
  hederaAccountId: 'HEDERA_TESTNET_ACCOUNT_ID',
  hederaPrivateKey: 'HEDERA_TESTNET_PRIVATE_KEY',
  /**
   * Which rail a hosted run settles on: `stub`, `hedera-transfer`, or `hedera-x402`.
   *
   * Absent means `stub`, and that default is the point rather than a convenience. Once a settling
   * rail is selected, the Run button on a public page moves funds on every click, so selecting one
   * is a deliberate act by the operator and never something a deployment falls into by omission.
   */
  demoRail: 'PREFLIGHT_DEMO_RAIL',
  /**
   * The account a settled call fee is paid to: the hired agent's own account, not the client's.
   *
   * Named here so the CLI and the hosted run read one variable rather than two spellings of it.
   */
  demoPayee: 'A_AGENT_HEDERA_ACCOUNT_ID',
  zerogStorageKey: 'ZEROG_STORAGE_PRIVATE_KEY',
  zerogComputeKey: 'ZEROG_COMPUTE_ROUTER_API_KEY',
  /** 0G Storage is where evidence is pinned (02-DECISIONS §12). Both halves are needed to upload. */
  zerogRpc: 'ZEROG_RPC_URL',
  zerogIndexer: 'ZEROG_INDEXER_URL',
  /** Ruben-only custody. Present only where a signature is produced. */
  validatorPrivateKey: 'VALIDATOR_PRIVATE_KEY',
  /**
   * The validator's public address. Read paths need it without the key: B1 must reject a record
   * written by any other validator, and it does that in the browser-facing read path.
   */
  validatorAddress: 'VALIDATOR_ADDRESS',
  /** A4's deploy output. Absent until A4 lands; every read of it fails closed until then. */
  validationRegistryAddress: 'VALIDATION_REGISTRY_ADDRESS',
  validationRegistryChainId: 'VALIDATION_REGISTRY_CHAIN_ID',
  /**
   * The block A4's registry was deployed at, optional.
   *
   * The evidence URI lives in an event, and the configured endpoint caps how wide one log query may
   * be, so the reader walks backwards in chunks. Setting this floors that walk at the deploy block
   * instead of a fixed lookback.
   */
  validationRegistryDeployBlock: 'VALIDATION_REGISTRY_DEPLOY_BLOCK',
  /**
   * The throwaway Base Sepolia deployer for the staged fixtures.
   *
   * This key lives in the shared environment by design, unlike the validator and payer keys: it holds
   * faucet funds on a testnet and signs fixture deploys, so the lane that deploys them uses it
   * directly. It is named here so nobody hardcodes the variable name at a call site.
   */
  fixtureDeployerPrivateKey: 'FIXTURE_DEPLOYER_PRIVATE_KEY',
  fixtureDeployerAddress: 'FIXTURE_DEPLOYER_ADDRESS',
  /**
   * The HCS topic the receipt chain is mirrored to, optional.
   *
   * Absent means no mirror runs, which costs nothing: the signed chain is the record either way. The
   * topic is a mirror and never a source, so nothing in a verdict path reads this.
   */
  hcsReceiptTopic: 'HCS_RECEIPT_TOPIC_ID',
  /**
   * Where the grade mirror writes its text records, optional and all three together.
   *
   * The chain of the ENS-compatible registry the subnames live under. There is no default: a mirror
   * that guessed its chain would write records about the right agent under the wrong name, which is
   * the failure this whole file exists to prevent. Absent means no mirror runs, which costs nothing,
   * because the ValidationRegistry is the record either way.
   */
  ensChainId: 'ENS_CHAIN_ID',
  /** The ENS registry, or a fork of it such as the Basenames Registry. */
  ensRegistryAddress: 'ENS_REGISTRY_ADDRESS',
  /**
   * The validator-owned parent the agent subnames hang off.
   *
   * Event target: `preflight.basetest.eth` on Base Sepolia (Basenames testnet TLD). Writes against
   * Base mainnet are refused in the ENS client so this project never spends real ETH on a name.
   */
  ensParentName: 'ENS_PARENT_NAME',
  /**
   * The resolver set on new subnames, optional.
   *
   * Absent means the parent's own resolver is read from the registry and reused, which is what a
   * subname should inherit anyway. It is configurable because a parent with no resolver set has
   * nothing to inherit, and that case has to be nameable rather than silently resolver-less.
   */
  ensResolverAddress: 'ENS_RESOLVER_ADDRESS',
  /**
   * An RPC override for the ENS chain, optional.
   *
   * Defaults to the configured endpoint for `ENS_CHAIN_ID`. It exists so the mirror can point at a
   * chain this project has no ChainKey for, L1 included, without adding one: nothing in a verdict
   * path may resolve through ENS configuration.
   */
  ensRpcUrl: 'ENS_RPC_URL',
  /**
   * Public origin of the Preflight app (no trailing slash), used in ENS `url` text records.
   *
   * Absent falls through to Vercel production URL, then the known event deploy. Cosmetic for
   * discovery only — never read from a verdict path.
   */
  publicUrl: 'PREFLIGHT_PUBLIC_URL',
} as const

function env(name: string): string | undefined {
  const value = process.env[name]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Reads a required value or throws. The throw is the point: there is no default. */
export function requireEnv(name: string, why: string): string {
  const value = env(name)
  if (value === undefined) {
    throw new ConfigError(`${name} is not set, so ${why} cannot run`)
  }
  return value
}

export function optionalEnv(name: string): string | undefined {
  return env(name)
}

export function chainByKey(key: ChainKey): ChainConfig {
  return CHAINS[key]
}

export function chainById(chainId: ChainId): ChainConfig {
  for (const key of CHAIN_KEYS) {
    if (CHAINS[key].chainId === chainId) return CHAINS[key]
  }
  throw new ConfigError(
    `chain ${chainId} is not configured; this project talks to ${CHAIN_KEYS.map((k) => `${CHAINS[k].label} (${CHAINS[k].chainId})`).join(', ')}`,
  )
}

export function rpcUrlFor(chainId: ChainId): string {
  const chain = chainById(chainId)
  return requireEnv(chain.rpcEnv, `an RPC call on ${chain.label}`)
}

export function explorerKeyFor(chainId: ChainId): string {
  const chain = chainById(chainId)
  if (chain.explorerKeyEnv === null) {
    throw new ConfigError(`${chain.label} has no explorer key configured for this project`)
  }
  return requireEnv(chain.explorerKeyEnv, `an explorer lookup on ${chain.label}`)
}

export function identityRegistryFor(chainId: ChainId): Address {
  const chain = chainById(chainId)
  if (chain.identityRegistry === null) {
    throw new ConfigError(`no ERC-8004 IdentityRegistry is recorded for ${chain.label}`)
  }
  return chain.identityRegistry
}

/** Where the Validation Registry lives, once A4 has deployed it. Both halves or neither. */
export function validationRegistry(): { address: Address; chainId: ChainId } {
  const address = requireEnv(ENV.validationRegistryAddress, 'reading or writing a validation record')
  const rawChainId = requireEnv(
    ENV.validationRegistryChainId,
    'reading or writing a validation record',
  )
  const chainId = Number(rawChainId)
  if (!Number.isInteger(chainId)) {
    throw new ConfigError(`${ENV.validationRegistryChainId} is not an integer chain id`)
  }
  if (!address.startsWith('0x')) {
    throw new ConfigError(`${ENV.validationRegistryAddress} is not a 0x address`)
  }
  return { address: address as Address, chainId }
}

/**
 * The validator this deployment trusts. A record from any other validator is ignored, not trusted,
 * so the read path needs this and refuses without it.
 */
export function validatorAddress(): Address {
  const address = requireEnv(ENV.validatorAddress, 'checking who signed a validation record')
  if (!address.startsWith('0x')) {
    throw new ConfigError(`${ENV.validatorAddress} is not a 0x address`)
  }
  return address as Address
}

/** The throwaway deployer that signs the staged fixture deploys on Base Sepolia. */
export function fixtureDeployerPrivateKey(): string {
  return requireEnv(ENV.fixtureDeployerPrivateKey, 'deploying a staged fixture contract')
}

export function fixtureDeployerAddress(): Address {
  const address = requireEnv(ENV.fixtureDeployerAddress, 'attributing a staged fixture deploy')
  if (!address.startsWith('0x')) {
    throw new ConfigError(`${ENV.fixtureDeployerAddress} is not a 0x address`)
  }
  return address as Address
}

export interface EnsConfig {
  chainId: ChainId
  registry: Address
  /** The parent name, normalized by the caller that hashes it. */
  parent: string
  /** Null means "reuse the parent's resolver", which the client reads from the registry. */
  resolver: Address | null
}

/**
 * Where the grade mirror writes, or null when it is switched off.
 *
 * Three variables, all of them or none of them. None is the ordinary state and returns null, the
 * `hcsReceiptTopic` pattern: no mirror runs and nothing is lost, since the registry holds the grade.
 * A partial set throws instead of filling in a default, the `validationRegistry()` pattern: half a
 * target is a target, and it is the wrong one.
 */
export function ensConfig(): EnsConfig | null {
  const rawChainId = optionalEnv(ENV.ensChainId)
  const rawRegistry = optionalEnv(ENV.ensRegistryAddress)
  const parent = optionalEnv(ENV.ensParentName)

  const required = [
    [ENV.ensChainId, rawChainId],
    [ENV.ensRegistryAddress, rawRegistry],
    [ENV.ensParentName, parent],
  ] as const
  const missing = required.filter(([, value]) => value === undefined).map(([name]) => name)
  if (missing.length === required.length) return null
  if (missing.length > 0) {
    throw new ConfigError(
      `the ENS grade mirror needs ${required.map(([name]) => name).join(', ')} set together, and ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing`,
    )
  }

  const chainId = Number(rawChainId)
  if (!Number.isInteger(chainId)) {
    throw new ConfigError(`${ENV.ensChainId} is not an integer chain id`)
  }
  if (!rawRegistry!.startsWith('0x')) {
    throw new ConfigError(`${ENV.ensRegistryAddress} is not a 0x address`)
  }
  if (!parent!.includes('.')) {
    throw new ConfigError(
      `${ENV.ensParentName} is ${JSON.stringify(parent)}, which is a label rather than a name, so no subname could be derived from it`,
    )
  }

  const rawResolver = optionalEnv(ENV.ensResolverAddress)
  if (rawResolver !== undefined && !rawResolver.startsWith('0x')) {
    throw new ConfigError(`${ENV.ensResolverAddress} is not a 0x address`)
  }

  return {
    chainId,
    registry: rawRegistry as Address,
    parent: parent!,
    resolver: (rawResolver as Address | undefined) ?? null,
  }
}

/** The endpoint the mirror talks to. The override keeps the mirror chain-agnostic. */
export function ensRpcUrl(chainId: ChainId): string {
  return optionalEnv(ENV.ensRpcUrl) ?? rpcUrlFor(chainId)
}

/**
 * Origin written into ENS `url` records (and description). Discovery only.
 *
 * Order: `PREFLIGHT_PUBLIC_URL`, then Vercel production/preview host, then the known event
 * deploy so a local claim still points somewhere useful.
 */
export function publicAppOrigin(): string {
  const configured = optionalEnv(ENV.publicUrl)
  if (configured !== undefined) return configured.replace(/\/+$/, '')

  const vercel =
    optionalEnv('VERCEL_PROJECT_PRODUCTION_URL') ?? optionalEnv('VERCEL_URL')
  if (vercel !== undefined) {
    const host = vercel.replace(/\/+$/, '')
    return host.startsWith('http://') || host.startsWith('https://')
      ? host
      : `https://${host}`
  }

  return 'https://preflight-bay.vercel.app'
}
