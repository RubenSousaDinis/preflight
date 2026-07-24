/**
 * A3b: writing a grade to the ERC-8004 Validation Registry, and reading it back.
 *
 * The ABI below is the reference implementation's, read from
 * `erc-8004/erc-8004-contracts/contracts/ValidationRegistryUpgradeable.sol`, which is the contract A4
 * deploys. Three things in it differ from what the plan assumed, and all three change how this module
 * has to behave:
 *
 * 1. **There is no expiry onchain.** `validationResponse` takes no `expirationTime` and
 *    `ValidationStatus` has no expiry field, only `lastUpdate`. So `expiresAt` is derived here as
 *    `lastUpdate + VALIDATION_TTL_SECONDS` and enforced by the reader, which keeps the fail-closed
 *    rule (an expired record is treated as absent) without pretending the chain carries a value it
 *    does not. Say that on screen rather than implying an onchain expiry.
 * 2. **A response needs a prior request.** `validationResponse` reverts with "unknown" unless the
 *    `requestHash` already exists, and `validationRequest` may only be sent by the agent's owner or an
 *    approved operator. Publishing a grade is therefore two transactions, and the first one is
 *    authorized against the IdentityRegistry.
 * 3. **`getValidationStatus` reverts for an unknown hash** and does not return `hasResponse`. A
 *    request with no response reads back as `response: 0` with a zero `responseHash`, and `response: 0`
 *    is also a legitimate grade F. So presence is decided by the responseHash, never by the score: a
 *    reader that tested the score would treat every F as absent.
 */

import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToBytes,
  type Hash,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { ConfigError, PublishError, ValidationReadError } from '../shared/errors.ts'
import {
  ENV,
  optionalEnv,
  requireEnv,
  rpcUrlFor,
  validationRegistry,
  validatorAddress,
} from '../shared/config.ts'
import { gradeForScore } from '../shared/grade.ts'
import type { Address, AgentId, GradeResult, Hex, Score, ValidationRecord } from '../shared/types.ts'
import { canonicalizeValue } from './canonical.ts'
import { toTokenId } from './identity-registry.ts'

export const VALIDATION_REGISTRY_ABI = parseAbi([
  'function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash) external',
  'function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag) external',
  'function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)',
  'function getAgentValidations(uint256 agentId) view returns (bytes32[])',
  'function getValidatorRequests(address validatorAddress) view returns (bytes32[])',
  'function getIdentityRegistry() view returns (address)',
])

/**
 * How long a record is trusted after its last update.
 *
 * A day, which is longer than the event and shorter than "forever". A grade that never goes stale is
 * the failure the expiry exists to prevent, and since the registry stores no expiry the bound has to
 * live here.
 */
export const VALIDATION_TTL_SECONDS = 86_400

/**
 * The request hash, which the caller chooses.
 *
 * Derived from the grade rather than picked at random, so a third party holding the published bundle
 * and the validator address can recompute exactly which onchain record belongs to it. `ranAt` is in
 * the preimage so a re-grade of the same agent gets a new record instead of colliding with the old
 * one, which the contract would reject with "exists".
 */
export function computeRequestHash(input: {
  agentId: AgentId
  validator: Address
  evidenceHash: Hex
  ranAt: number
  methodologyVersion: string
}): Hex {
  return keccak256(
    stringToBytes(
      canonicalizeValue({
        schema: 'preflight-validation-request-v1',
        agentId: input.agentId,
        validator: getAddress(input.validator).toLowerCase(),
        evidenceHash: input.evidenceHash.toLowerCase(),
        ranAt: input.ranAt,
        methodologyVersion: input.methodologyVersion,
      }),
    ),
  )
}

export interface PublishCall {
  requestHash: Hex
  registry: Address
  chainId: number
  /** Sent by the agent's owner or an approved operator, per the contract's own check. */
  request: {
    function: 'validationRequest'
    args: readonly [Address, bigint, string, Hex]
  }
  /** Sent by the validator, and only the validator. */
  response: {
    function: 'validationResponse'
    args: readonly [Hex, number, string, Hex, string]
  }
}

/**
 * Assembles both calls without sending either, so the operator can read the exact arguments before a
 * key is anywhere near them.
 */
export function assemblePublishCall(input: {
  result: GradeResult
  agentId: AgentId
  responseURI: string
  validator?: Address
  registry?: Address
  chainId?: number
}): PublishCall {
  const registryConfig = input.registry === undefined ? validationRegistry() : null
  const registry = input.registry ?? registryConfig!.address
  const chainId = input.chainId ?? registryConfig!.chainId
  const validator = getAddress(input.validator ?? validatorAddress())
  const { result } = input

  if (result.score < 0 || result.score > 100) {
    throw new PublishError(`score ${result.score} is outside the 0 to 100 the registry accepts`)
  }
  if (input.responseURI.trim().length === 0) {
    throw new PublishError(
      'responseURI is empty, and a record whose evidence nobody can fetch cannot be checked by anyone',
    )
  }

  const requestHash = computeRequestHash({
    agentId: input.agentId,
    validator,
    evidenceHash: result.evidenceHash,
    ranAt: result.ranAt,
    methodologyVersion: result.methodologyVersion,
  })

  return {
    requestHash,
    registry: getAddress(registry),
    chainId,
    request: {
      function: 'validationRequest',
      args: [validator, toTokenId(input.agentId), input.responseURI, requestHash],
    },
    response: {
      function: 'validationResponse',
      // The tag carries the methodologyVersion as a string, so older records stay readable across a
      // bump instead of being invalidated by it.
      args: [requestHash, result.score, input.responseURI, result.evidenceHash, result.methodologyVersion],
    },
  }
}

function publicClientFor(chainId: number, client?: PublicClient): PublicClient {
  return client ?? createPublicClient({ transport: http(rpcUrlFor(chainId)) })
}

export interface ReadOptions {
  client?: PublicClient
  registry?: Address
  chainId?: number
  /** Unix seconds, injected so a test can pin the clock. */
  now?: number
  ttlSeconds?: number
}

interface RawStatus {
  validatorAddress: Address
  agentId: bigint
  response: number
  responseHash: Hex
  tag: string
  lastUpdate: bigint
}

const ZERO_HASH = `0x${'0'.repeat(64)}`

async function readStatus(
  client: PublicClient,
  registry: Address,
  requestHash: Hex,
): Promise<RawStatus | null> {
  try {
    const [validator, agentId, response, responseHash, tag, lastUpdate] = await client.readContract({
      address: registry,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: 'getValidationStatus',
      args: [requestHash],
    })
    return {
      validatorAddress: getAddress(validator),
      agentId,
      response,
      responseHash: responseHash as Hex,
      tag,
      lastUpdate,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The contract reverts with "unknown" for a hash it has never seen. That is absence, which is
    // null. Anything else is an outage, and an outage must never be returned as an answer.
    if (/unknown|revert/i.test(message)) return null
    throw new ValidationReadError(`could not read validation status ${requestHash}`, {
      retryable: true,
      cause: err,
    })
  }
}

/**
 * 01-INTERFACES §3. Returns the newest record written by the given validator, or null.
 *
 * The validator filter lives here, below the caller, because a caller that forgets it trusts anyone's
 * attestation about our subject. `null` means refuse, and it is returned only when there genuinely is
 * no usable record: no request for this agent, none from this validator, none carrying a response, or
 * one whose derived expiry has passed.
 */
export async function readValidation(
  agentId: AgentId,
  validator?: Address,
  options: ReadOptions = {},
): Promise<ValidationRecord | null> {
  const registryConfig = options.registry === undefined ? validationRegistry() : null
  const registry = getAddress(options.registry ?? registryConfig!.address)
  const chainId = options.chainId ?? registryConfig!.chainId
  const expected = getAddress(validator ?? validatorAddress())
  const client = publicClientFor(chainId, options.client)
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const ttl = options.ttlSeconds ?? VALIDATION_TTL_SECONDS
  const tokenId = toTokenId(agentId)

  let requestHashes: readonly Hex[]
  try {
    requestHashes = (await client.readContract({
      address: registry,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: 'getAgentValidations',
      args: [tokenId],
    })) as readonly Hex[]
  } catch (err) {
    throw new ValidationReadError(`could not list validations for agent ${agentId}`, {
      retryable: true,
      cause: err,
    })
  }

  let newest: { status: RawStatus; requestHash: Hex } | null = null
  for (const requestHash of requestHashes) {
    const status = await readStatus(client, registry, requestHash)
    if (status === null) continue
    if (status.validatorAddress !== expected) continue
    // A response always carries the evidence hash. Testing the score instead would read every grade F
    // as an absent record, since F writes a zero.
    if (status.responseHash === ZERO_HASH) continue
    if (newest === null || status.lastUpdate > newest.status.lastUpdate) {
      newest = { status, requestHash }
    }
  }

  if (newest === null) return null

  const lastUpdate = Number(newest.status.lastUpdate)
  const expiresAt = lastUpdate + ttl
  if (expiresAt <= now) return null

  const score = newest.status.response
  if (gradeForScore(score) === null) {
    // A score off the 25-point scale did not come from this methodology. Refusing to present it as a
    // record is the same rule as refusing to round it to the nearest letter.
    throw new ValidationReadError(
      `agent ${agentId} carries a record scored ${score}, which is not a value this methodology writes`,
    )
  }

  return {
    agentId,
    score: score as Score,
    responseURI: '',
    responseHash: newest.status.responseHash,
    tag: newest.status.tag,
    validator: newest.status.validatorAddress,
    expiresAt,
    txHash: newest.requestHash,
  }
}

const VALIDATION_RESPONSE_EVENT = {
  type: 'event',
  name: 'ValidationResponse',
  inputs: [
    { name: 'validatorAddress', type: 'address', indexed: true },
    { name: 'agentId', type: 'uint256', indexed: true },
    { name: 'requestHash', type: 'bytes32', indexed: true },
    { name: 'response', type: 'uint8', indexed: false },
    { name: 'responseURI', type: 'string', indexed: false },
    { name: 'responseHash', type: 'bytes32', indexed: false },
    { name: 'tag', type: 'string', indexed: false },
  ],
} as const

/**
 * How wide a single `eth_getLogs` window may be.
 *
 * Measured against the configured Base Sepolia endpoint on 2026-07-25: a 1000 block window answered, a
 * 10000 block window and `fromBlock: 'earliest'` both came back "Requested resource not available".
 * So the search is chunked, and this stays under the observed cap with margin.
 */
export const LOG_CHUNK_BLOCKS = 900n

/** About two days of Base blocks, which is longer than the event and bounded. */
export const DEFAULT_LOG_LOOKBACK_BLOCKS = 90_000n

/**
 * The responseURI is emitted in the event rather than stored, so it is read from the log.
 *
 * Without it a reader holds the hash but not the document, and "re-derive the hash from the published
 * evidence" stops being possible. Not finding it is not an error: it returns null, reaches B1 as an
 * empty URI, and refuses there as unreachable evidence. An RPC that fails mid-search does throw, since
 * that is an outage rather than an answer.
 *
 * The search walks backwards from the head so a record written minutes ago is found in the first call.
 */
export interface ResponseEvent {
  responseURI: string
  /** The transaction that wrote the record, which is what §3's `txHash` means. */
  txHash: Hex
}

export async function readResponseEvent(
  requestHash: Hex,
  options: ReadOptions & { lookbackBlocks?: bigint } = {},
): Promise<ResponseEvent | null> {
  const registryConfig = options.registry === undefined ? validationRegistry() : null
  const registry = getAddress(options.registry ?? registryConfig!.address)
  const chainId = options.chainId ?? registryConfig!.chainId
  const client = publicClientFor(chainId, options.client)

  let head: bigint
  try {
    head = await client.getBlockNumber()
  } catch (err) {
    throw new ValidationReadError(`could not read the head block on chain ${chainId}`, {
      retryable: true,
      cause: err,
    })
  }

  const configuredFloor = optionalEnv(ENV.validationRegistryDeployBlock)
  const lookback = options.lookbackBlocks ?? DEFAULT_LOG_LOOKBACK_BLOCKS
  const floor =
    configuredFloor === undefined
      ? head > lookback
        ? head - lookback
        : 0n
      : BigInt(configuredFloor)

  let toBlock = head
  while (toBlock >= floor) {
    const fromBlock = toBlock > floor + LOG_CHUNK_BLOCKS ? toBlock - LOG_CHUNK_BLOCKS : floor
    let logs
    try {
      logs = await client.getLogs({
        address: registry,
        event: VALIDATION_RESPONSE_EVENT,
        args: { requestHash },
        fromBlock,
        toBlock,
      })
    } catch (err) {
      throw new ValidationReadError(
        `could not read the response URI for ${requestHash} between blocks ${fromBlock} and ${toBlock}`,
        { retryable: true, cause: err },
      )
    }
    const last = logs.at(-1)
    const uri = (last?.args as { responseURI?: string } | undefined)?.responseURI
    if (last !== undefined && typeof uri === 'string' && uri.length > 0) {
      return { responseURI: uri, txHash: last.transactionHash as Hex }
    }
    if (fromBlock === floor) break
    toBlock = fromBlock - 1n
  }
  return null
}

/**
 * Reads a record and fills in the evidence URI and the attesting transaction from the event log.
 *
 * Until the log is read, `txHash` carries the requestHash, because that is the only identifier the
 * storage read returns. The event is where the transaction actually is, so this is the call that makes
 * §3's `txHash` mean what it says.
 */
export async function readValidationWithEvidence(
  agentId: AgentId,
  validator?: Address,
  options: ReadOptions = {},
): Promise<(ValidationRecord & { requestHash: Hex }) | null> {
  const record = await readValidation(agentId, validator, options)
  if (record === null) return null
  const requestHash = record.txHash
  const event = await readResponseEvent(requestHash, options)
  return {
    ...record,
    requestHash,
    responseURI: event?.responseURI ?? '',
    txHash: event?.txHash ?? requestHash,
  }
}

export interface PublishOptions extends ReadOptions {
  wallet?: WalletClient
  /** Skip the request leg when one already exists for this hash. */
  requestExists?: boolean
}

/**
 * Sends both legs and confirms by reading the record back.
 *
 * A send receipt is not evidence that a record exists: a transaction can be replaced or stuck behind a
 * stale nonce. The only proof is the read.
 */
export async function publishValidation(
  result: GradeResult,
  agentId: AgentId,
  responseURI: string,
  options: PublishOptions = {},
): Promise<ValidationRecord> {
  const call = assemblePublishCall({
    result,
    agentId,
    responseURI,
    registry: options.registry,
    chainId: options.chainId,
  })
  const key = requireEnv(ENV.validatorPrivateKey, 'signing a validation response')
  if (!key.startsWith('0x')) {
    throw new ConfigError(`${ENV.validatorPrivateKey} must be a 0x private key`)
  }
  const account = privateKeyToAccount(key as Hex)
  const expected = validatorAddress()
  if (getAddress(account.address) !== getAddress(expected)) {
    throw new PublishError(
      `the loaded key signs as ${account.address}, but the configured validator is ${expected}`,
    )
  }

  const publicClient = publicClientFor(call.chainId, options.client)
  const wallet =
    options.wallet ??
    createWalletClient({ account, transport: http(rpcUrlFor(call.chainId)) })

  const send = async (
    functionName: 'validationRequest' | 'validationResponse',
    args: readonly unknown[],
  ): Promise<Hash> => {
    try {
      const hash = await wallet.writeContract({
        address: call.registry,
        abi: VALIDATION_REGISTRY_ABI,
        functionName,
        args: args as never,
        account,
        chain: null,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') {
        throw new PublishError(`${functionName} reverted in ${hash}`)
      }
      return hash
    } catch (err) {
      if (err instanceof PublishError) throw err
      throw new PublishError(`${functionName} did not land`, { retryable: true, cause: err })
    }
  }

  if (options.requestExists !== true) {
    await send('validationRequest', call.request.args)
  }
  const responseTx = await send('validationResponse', call.response.args)

  const record = await readValidationWithEvidence(agentId, expected, {
    ...options,
    registry: call.registry,
    chainId: call.chainId,
  })
  if (record === null) {
    throw new PublishError(
      `${responseTx} was sent but no record reads back for agent ${agentId}, so nothing was published`,
    )
  }
  return { ...record, txHash: responseTx }
}
