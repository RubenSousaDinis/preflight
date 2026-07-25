/**
 * D5b and D5d: registering an agent's subname and writing the records that mirror its grade.
 *
 * Dry run first, everywhere. `planSubname` and `assembleTextCalls` read the chain and assemble exact
 * arguments without a key in the process; `ensureSubname` and `writeRecords` are the only functions
 * that sign, and they load the key inside themselves the way `publishValidation` does. The operator
 * reads what is about to be sent before anything is sent.
 *
 * Three things about the reads are deliberate:
 *
 * 1. **Resolution goes through the configured registry, never through viem's `getEnsText`.** That
 *    helper routes through the Universal Resolver on L1 mainnet, so against a Basenames fork on Base
 *    it would either fail or answer about a different name. Here the registry is asked for the
 *    resolver of the node, and that resolver is asked for the text, which is the resolution these
 *    records actually live under.
 * 2. **A subname is created with `setSubnodeRecord`,** which sets owner, resolver and ttl in one
 *    transaction. `setSubnodeOwner` followed by `setResolver` would leave a window where the name
 *    exists and resolves to nothing.
 * 3. **A name owned by somebody else is refused, never overwritten.** If the label we derive is
 *    already held by another account, the honest outcome is a refusal that names the owner.
 *
 * Nothing here is in a verdict path. The records are a mirror of the ValidationRegistry and the
 * registry stays the source.
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { ConfigError, EnsMirrorError } from '../../shared/errors.ts'
import {
  ENV,
  ensConfig,
  ensRpcUrl,
  requireEnv,
  validatorAddress,
  type EnsConfig,
} from '../../shared/config.ts'
import type { Address, AgentId, ChainId, Hex } from '../../shared/types.ts'
import { agentEnsName, labelHashFor, nodeFor, subnameLabelFor } from './names.ts'
import { ENS_KEYS, type EnsKey } from './records.ts'

export const ENS_REGISTRY_ABI = parseAbi([
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
  'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)',
])

export const ENS_RESOLVER_ABI = parseAbi([
  'function text(bytes32 node, string key) view returns (string)',
  'function setText(bytes32 node, string key, string value)',
  'function multicall(bytes[] data) returns (bytes[] results)',
])

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

export interface EnsTarget extends EnsConfig {
  parentNode: Hex
}

/**
 * The configured target, or null when the mirror is switched off.
 *
 * Null is an ordinary answer and every caller handles it by doing nothing. A partially configured
 * mirror throws, because that is a mistake rather than a choice.
 */
export function ensTargetFromEnv(): EnsTarget | null {
  const config = ensConfig()
  if (config === null) return null
  return { ...config, parentNode: nodeFor(config.parent) }
}

function requireTarget(target?: EnsTarget | null): EnsTarget {
  const resolved = target ?? ensTargetFromEnv()
  if (resolved === null) {
    throw new ConfigError(
      `the ENS mirror is not configured, so set ${ENV.ensChainId}, ${ENV.ensRegistryAddress} and ${ENV.ensParentName} before asking it to run`,
    )
  }
  return resolved
}

export interface EnsClientOptions {
  target?: EnsTarget | null
  client?: PublicClient
  /** Short by default. Nothing waits on this, and a render path waits on it least of all. */
  timeoutMs?: number
}

function readerFor(target: EnsTarget, options: EnsClientOptions = {}): PublicClient {
  return (
    options.client ??
    createPublicClient({
      transport: http(ensRpcUrl(target.chainId), { timeout: options.timeoutMs ?? 10_000 }),
    })
  )
}

async function registryRead(
  client: PublicClient,
  target: EnsTarget,
  functionName: 'owner' | 'resolver',
  node: Hex,
): Promise<Address> {
  const value = await client.readContract({
    address: getAddress(target.registry),
    abi: ENS_REGISTRY_ABI,
    functionName,
    args: [node],
  })
  return getAddress(value)
}

export interface SubnamePlan {
  agentId: AgentId
  name: string
  label: string
  labelHash: Hex
  node: Hex
  parent: string
  parentNode: Hex
  registry: Address
  chainId: ChainId
  /** Who holds the parent, which is who is allowed to create the subname. */
  parentOwner: Address
  /** Zero when the subname does not exist yet. */
  currentOwner: Address
  currentResolver: Address
  /** Who the subname would be owned by, and what would resolve it. */
  intendedOwner: Address
  intendedResolver: Address
  /** What `ensureSubname` would do, in one word. */
  action: 'create' | 'repoint' | 'unchanged'
  /** Set when the plan cannot be carried out, and why. */
  refusal: string | null
}

/**
 * What `ensureSubname` would do, read from the chain and sent nowhere.
 *
 * A refusal is returned rather than thrown so `ens status` can print the state of four agents in one
 * pass, including the ones it cannot act on. `ensureSubname` is the function that turns a refusal
 * into a thrown error, because that is the point at which it stops the caller.
 */
export async function planSubname(
  agentId: AgentId,
  options: EnsClientOptions & { owner?: Address; resolver?: Address } = {},
): Promise<SubnamePlan> {
  const target = requireTarget(options.target)
  const client = readerFor(target, options)
  const label = subnameLabelFor(agentId)
  const name = agentEnsName(agentId, target.parent)
  const node = nodeFor(name)

  const [parentOwner, currentOwner, currentResolver, parentResolver] = await Promise.all([
    registryRead(client, target, 'owner', target.parentNode),
    registryRead(client, target, 'owner', node),
    registryRead(client, target, 'resolver', node),
    registryRead(client, target, 'resolver', target.parentNode),
  ])

  const intendedOwner = getAddress(options.owner ?? validatorAddress())
  const configuredResolver = options.resolver ?? target.resolver
  const intendedResolver = getAddress(configuredResolver ?? parentResolver)

  let refusal: string | null = null
  if (parentOwner === ZERO_ADDRESS) {
    refusal = `${target.parent} has no owner in the registry at ${getAddress(target.registry)} on chain ${target.chainId}, so it is either unregistered or on another chain`
  } else if (parentOwner !== intendedOwner) {
    refusal = `${target.parent} is owned by ${parentOwner}, and the subname would be created by ${intendedOwner}, which the registry will reject`
  } else if (currentOwner !== ZERO_ADDRESS && currentOwner !== intendedOwner) {
    refusal = `${name} is already owned by ${currentOwner}, so this mirror will not overwrite it`
  } else if (intendedResolver === ZERO_ADDRESS) {
    refusal = `neither ${ENV.ensResolverAddress} nor ${target.parent} names a resolver, and a subname with no resolver would answer nothing`
  }

  const action: SubnamePlan['action'] =
    currentOwner === ZERO_ADDRESS
      ? 'create'
      : currentResolver === intendedResolver
        ? 'unchanged'
        : 'repoint'

  return {
    agentId,
    name,
    label,
    labelHash: labelHashFor(label),
    node,
    parent: target.parent,
    parentNode: target.parentNode,
    registry: getAddress(target.registry),
    chainId: target.chainId,
    parentOwner,
    currentOwner,
    currentResolver,
    intendedOwner,
    intendedResolver,
    action,
    refusal,
  }
}

interface SendContext {
  account: ReturnType<typeof privateKeyToAccount>
  wallet: WalletClient
  reader: PublicClient
}

/**
 * Loads the validator key, and only here.
 *
 * Copied from `publishValidation`: the key is read inside the send path rather than at module load,
 * and the address it signs as is checked against the configured validator, because a key that signs
 * as somebody else would write a name nobody expected to exist.
 */
function sendContext(target: EnsTarget, options: { wallet?: WalletClient; client?: PublicClient }): SendContext {
  const key = requireEnv(ENV.validatorPrivateKey, 'writing an ENS record')
  if (!key.startsWith('0x')) {
    throw new ConfigError(`${ENV.validatorPrivateKey} must be a 0x private key`)
  }
  const account = privateKeyToAccount(key as Hex)
  const expected = validatorAddress()
  if (getAddress(account.address) !== getAddress(expected)) {
    throw new EnsMirrorError(
      `the loaded key signs as ${account.address}, but the configured validator is ${expected}`,
    )
  }
  const reader = options.client ?? createPublicClient({ transport: http(ensRpcUrl(target.chainId)) })
  const wallet =
    options.wallet ?? createWalletClient({ account, transport: http(ensRpcUrl(target.chainId)) })
  return { account, wallet, reader }
}

async function sendAndConfirm(
  context: SendContext,
  call: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] },
  what: string,
): Promise<Hex> {
  try {
    // Estimate and add a quarter, the same margin `publishValidation` settled on after two reverts
    // for want of a few hundred gas. Unused gas is not charged, so the margin costs nothing.
    const estimate = await context.reader.estimateContractGas({
      address: call.address,
      abi: call.abi as never,
      functionName: call.functionName as never,
      args: call.args as never,
      account: context.account,
    })
    const hash = await context.wallet.writeContract({
      address: call.address,
      abi: call.abi as never,
      functionName: call.functionName as never,
      args: call.args as never,
      account: context.account,
      chain: null,
      gas: (estimate * 125n) / 100n,
    })
    const receipt = await context.reader.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') {
      throw new EnsMirrorError(`${what} reverted in ${hash}`)
    }
    return hash as Hex
  } catch (err) {
    if (err instanceof EnsMirrorError) throw err
    throw new EnsMirrorError(`${what} did not land`, { retryable: true, cause: err })
  }
}

export interface SubnameResult {
  plan: SubnamePlan
  /** Null when the name was already what it should be and nothing was sent. */
  txHash: Hex | null
  /** Read back from the registry after the send, never taken from the receipt. */
  owner: Address
  resolver: Address
}

/**
 * Creates or repoints the agent's subname, and does nothing when it is already right.
 *
 * Idempotent on purpose: the runbook runs this per agent and a re-run during a demo must not cost a
 * transaction or reset anything. One `setSubnodeRecord` sets owner, resolver and ttl together, so
 * the name never exists in a state where it resolves to nothing.
 */
export async function ensureSubname(
  agentId: AgentId,
  options: EnsClientOptions & {
    owner?: Address
    resolver?: Address
    wallet?: WalletClient
  } = {},
): Promise<SubnameResult> {
  const target = requireTarget(options.target)
  const plan = await planSubname(agentId, options)
  if (plan.refusal !== null) throw new EnsMirrorError(plan.refusal)

  if (plan.action === 'unchanged') {
    return { plan, txHash: null, owner: plan.currentOwner, resolver: plan.currentResolver }
  }

  const context = sendContext(target, options)
  const txHash = await sendAndConfirm(
    context,
    {
      address: plan.registry,
      abi: ENS_REGISTRY_ABI,
      functionName: 'setSubnodeRecord',
      args: [plan.parentNode, plan.labelHash, plan.intendedOwner, plan.intendedResolver, 0n],
    },
    `setSubnodeRecord for ${plan.name}`,
  )

  // A send receipt says a transaction landed, not that the name exists. The read is the proof.
  // Public Base RPCs often answer `latest` a block behind the receipt for a second or two, so
  // a single immediate read falsely reports the zero address. Poll until the registry agrees.
  const confirmed = await waitForSubnameOwner(
    agentId,
    plan.intendedOwner,
    { ...options, client: context.reader },
    txHash,
    plan.name,
  )
  return {
    plan,
    txHash,
    owner: confirmed.currentOwner,
    resolver: confirmed.currentResolver,
  }
}

async function waitForSubnameOwner(
  agentId: AgentId,
  intendedOwner: Address,
  options: EnsClientOptions & { owner?: Address; resolver?: Address },
  txHash: Hex,
  name: string,
): Promise<SubnamePlan> {
  const attempts = 8
  let last: SubnamePlan | null = null
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500 * i))
    last = await planSubname(agentId, options)
    if (last.currentOwner === intendedOwner) return last
  }
  throw new EnsMirrorError(
    `${txHash} landed but ${name} reads back owned by ${last?.currentOwner ?? 'unknown'}, so the name was not created`,
  )
}

export interface TextCallPlan {
  node: Hex
  keys: EnsKey[]
  /** One encoded `setText` per key, in `ENS_KEYS` order. */
  calls: Hex[]
  /** The single `multicall` those go into, so one transaction writes the whole record set. */
  multicall: Hex
}

/**
 * Every `setText` for one name, encoded, plus the multicall that carries them.
 *
 * One transaction rather than twelve: twelve transactions is twelve nonces, twelve confirmations and
 * a window in which a name carries half of one grade and half of another. Pure, so a test can decode
 * these bytes back and check that what would be sent is what the builder produced.
 */
export function assembleTextCalls(
  node: Hex,
  records: Partial<Record<EnsKey, string>>,
): TextCallPlan {
  const keys = ENS_KEYS.filter((key) => key in records)
  const calls = keys.map((key) =>
    encodeFunctionData({
      abi: ENS_RESOLVER_ABI,
      functionName: 'setText',
      args: [node, key, records[key] ?? ''],
    }),
  )
  return {
    node,
    keys: [...keys],
    calls,
    multicall: encodeFunctionData({
      abi: ENS_RESOLVER_ABI,
      functionName: 'multicall',
      args: [calls],
    }),
  }
}

/** The resolver the registry names for a node, or null when it names none. */
export async function resolverFor(
  node: Hex,
  options: EnsClientOptions = {},
): Promise<Address | null> {
  const target = requireTarget(options.target)
  const client = readerFor(target, options)
  const resolver = await registryRead(client, target, 'resolver', node)
  return resolver === ZERO_ADDRESS ? null : resolver
}

export interface WriteRecordsResult {
  name: string
  node: Hex
  resolver: Address
  keys: EnsKey[]
  txHash: Hex
  /** One key read back on a fresh client, which is what says the write is visible. */
  confirmed: { key: EnsKey; value: string }
}

/** Writes the whole record set in one resolver multicall, then reads one key back. */
export async function writeRecords(
  agentId: AgentId,
  records: Partial<Record<EnsKey, string>>,
  options: EnsClientOptions & { wallet?: WalletClient } = {},
): Promise<WriteRecordsResult> {
  const target = requireTarget(options.target)
  const name = agentEnsName(agentId, target.parent)
  const node = nodeFor(name)
  const resolver = await resolverFor(node, options)
  if (resolver === null) {
    throw new EnsMirrorError(
      `${name} has no resolver in the registry, so run the subname step before writing records to it`,
    )
  }

  const plan = assembleTextCalls(node, records)
  if (plan.keys.length === 0) {
    throw new EnsMirrorError(`no known record key was given for ${name}, so there is nothing to write`)
  }
  const context = sendContext(target, options)
  const txHash = await sendAndConfirm(
    context,
    {
      address: resolver,
      abi: ENS_RESOLVER_ABI,
      functionName: 'multicall',
      args: [plan.calls],
    },
    `${plan.keys.length} text records on ${name}`,
  )

  // One key read back on a fresh call, because the receipt says a transaction landed and not that a
  // resolver answers with it.
  const key = plan.keys[0]
  const expected = records[key] ?? ''
  const value = await readText(context.reader, resolver, node, key)
  if (value !== expected) {
    throw new EnsMirrorError(
      `${txHash} landed but ${name} reads back ${key} as ${JSON.stringify(value)} rather than ${JSON.stringify(expected)}`,
    )
  }
  return { name, node, resolver, keys: plan.keys, txHash, confirmed: { key, value } }
}

async function readText(
  client: PublicClient,
  resolver: Address,
  node: Hex,
  key: string,
): Promise<string> {
  return await client.readContract({
    address: resolver,
    abi: ENS_RESOLVER_ABI,
    functionName: 'text',
    args: [node, key],
  })
}

export interface AgentRecords {
  name: string
  node: Hex
  /** Null when the name has no resolver, which is also what an unregistered name reads as. */
  resolver: Address | null
  /** Only the keys that were asked for, and only the ones that came back non-empty. */
  records: Partial<Record<EnsKey, string>>
}

/**
 * Reads an agent's records straight from the configured registry and resolver.
 *
 * Registry for the resolver, resolver for the text. Not `getEnsText`, which resolves through the
 * Universal Resolver on L1 and would answer about a different name entirely on a Basenames fork.
 *
 * An empty value is dropped rather than reported, because the writer clears a record by writing an
 * empty string: a caller asking whether there is a grade wants null, not `""`.
 */
export async function readAgentRecords(
  agentId: AgentId,
  options: EnsClientOptions & { keys?: readonly EnsKey[] } = {},
): Promise<AgentRecords> {
  const target = requireTarget(options.target)
  const client = readerFor(target, options)
  const name = agentEnsName(agentId, target.parent)
  const node = nodeFor(name)

  const resolver = await registryRead(client, target, 'resolver', node)
  if (resolver === ZERO_ADDRESS) {
    return { name, node, resolver: null, records: {} }
  }

  const keys = options.keys ?? ENS_KEYS
  const values = await Promise.all(keys.map((key) => readText(client, resolver, node, key)))
  const records: Partial<Record<EnsKey, string>> = {}
  keys.forEach((key, index) => {
    const value = values[index]
    if (value.length > 0) records[key] = value
  })
  return { name, node, resolver, records }
}

export interface MirrorDiff {
  key: EnsKey
  expected: string
  actual: string
}

export interface MirrorVerification {
  name: string
  node: Hex
  resolver: Address | null
  ok: boolean
  checked: number
  diffs: MirrorDiff[]
}

/**
 * D5d check 2: the records against the registry, key by key.
 *
 * The expected side is built from a fresh registry read by the caller, and the actual side is read
 * from the resolver here. A mirror that disagrees with its source on stage is worse than no mirror,
 * so this exists to be run before the mirror is shown to anyone.
 */
export async function verifyMirror(
  agentId: AgentId,
  expected: Partial<Record<EnsKey, string>>,
  options: EnsClientOptions = {},
): Promise<MirrorVerification> {
  const keys = ENS_KEYS.filter((key) => key in expected)
  const read = await readAgentRecords(agentId, { ...options, keys })
  const diffs: MirrorDiff[] = []
  for (const key of keys) {
    const actual = read.records[key] ?? ''
    const want = expected[key] ?? ''
    if (actual !== want) diffs.push({ key, expected: want, actual })
  }
  return {
    name: read.name,
    node: read.node,
    resolver: read.resolver,
    ok: read.resolver !== null && diffs.length === 0,
    checked: keys.length,
    diffs,
  }
}
