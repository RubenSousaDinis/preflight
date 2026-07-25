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

import { ConfigError, PublishError, ValidationReadError, oneLineReason } from '../shared/errors.ts'
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
  /**
   * Return an expired record instead of null.
   *
   * Off by default, so every ordinary caller gets the fail-closed behavior. B1 turns it on because it
   * has to say "expired" rather than "absent" in a refusal reason, and it applies the bound itself.
   */
  includeExpired?: boolean
  /** Backoff between retries of a throttled call. Zero in tests, so they do not sleep. */
  retryDelayMs?: number
}

/** A record plus the two values the registry has and 01-INTERFACES §3 does not name. */
export type ReadRecord = ValidationRecord & { lastUpdate: number; requestHash: Hex }

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
  options: { retryDelayMs?: number } = {},
): Promise<RawStatus | null> {
  try {
    const [validator, agentId, response, responseHash, tag, lastUpdate] = await withThrottleRetry(
      () =>
        client.readContract({
          address: registry,
          abi: VALIDATION_REGISTRY_ABI,
          functionName: 'getValidationStatus',
          args: [requestHash],
        }),
      options,
    )
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
    // null. Anything else is an outage, and an outage must never be returned as an answer. A throttle
    // is checked first: "not available" is the limiter's phrasing, and reading it as absence would
    // turn a rate limit into a missing record.
    if (!isThrottle(err) && /unknown|revert/i.test(message)) return null
    throw new ValidationReadError(
      `could not read validation status ${requestHash}: ${oneLineReason(err)}`,
      { retryable: true, cause: err },
    )
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
): Promise<ReadRecord | null> {
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
    requestHashes = (await withThrottleRetry(
      () =>
        client.readContract({
          address: registry,
          abi: VALIDATION_REGISTRY_ABI,
          functionName: 'getAgentValidations',
          args: [tokenId],
        }),
      options,
    )) as readonly Hex[]
  } catch (err) {
    throw new ValidationReadError(
      `could not list validations for agent ${agentId}: ${oneLineReason(err)}`,
      { retryable: true, cause: err },
    )
  }

  let newest: { status: RawStatus; requestHash: Hex } | null = null
  for (const requestHash of requestHashes) {
    const status = await readStatus(client, registry, requestHash, options)
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
  if (expiresAt <= now && options.includeExpired !== true) return null

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
    lastUpdate,
    requestHash: newest.requestHash,
    // Until the event is read, the only identifier the storage read gives back is the requestHash.
    txHash: newest.requestHash,
  }
}

/**
 * Which other validators have written about this agent.
 *
 * Used only to make a refusal legible: telling the operator that a record exists from someone else is
 * better than reporting a bare absence, and it can never change a decision, because the trusted read
 * has already returned nothing by the time this is called.
 */
export async function readForeignValidators(
  agentId: AgentId,
  ours?: Address,
  options: ReadOptions = {},
): Promise<Address[]> {
  const registryConfig = options.registry === undefined ? validationRegistry() : null
  const registry = getAddress(options.registry ?? registryConfig!.address)
  const chainId = options.chainId ?? registryConfig!.chainId
  const expected = getAddress(ours ?? validatorAddress())
  const client = publicClientFor(chainId, options.client)

  const requestHashes = (await withThrottleRetry(
    () =>
      client.readContract({
        address: registry,
        abi: VALIDATION_REGISTRY_ABI,
        functionName: 'getAgentValidations',
        args: [toTokenId(agentId)],
      }),
    options,
  )) as readonly Hex[]

  const found = new Set<Address>()
  for (const requestHash of requestHashes) {
    const status = await readStatus(client, registry, requestHash, options)
    if (status === null) continue
    if (status.responseHash === ZERO_HASH) continue
    if (status.validatorAddress !== expected) found.add(status.validatorAddress)
  }
  return [...found]
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
 * How wide a single `eth_getLogs` window may be, widest first.
 *
 * An earlier reading of the same endpoint took "Requested resource not available" on a 10000 block
 * window to mean the window was too wide, and chunked to 900 blocks to stay under it. That error is
 * the throttle, not a range refusal: re-measured on 2026-07-25 against the same Base Sepolia
 * endpoint, a 100,000 block window answered in 630ms, while walking the same 90,000 blocks in 900
 * block windows took 15,007ms across 100 calls. The narrow window was therefore not avoiding the
 * limiter, it was feeding it, and the gate that runs this read on every poll of the rug pull beat
 * was refusing on a rate limit rather than on anything about the agent.
 *
 * How wide a window a node will serve is a fact about the provider and not about the chain, so it is
 * asked for wide and narrowed only when a provider actually says no. The last rung is the old width,
 * which is known to be served.
 */
export const LOG_WINDOW_LADDER: readonly bigint[] = [50_000n, 10_000n, 2_000n, 900n]

/** Kept as the narrowest rung's name, since it is the width every provider measured so far serves. */
export const LOG_CHUNK_BLOCKS = 900n

/**
 * A throttle is not an answer about an agent, so it is asked again rather than reported.
 *
 * Bounded on purpose: the retries run out, and when they do the read throws and the gate refuses.
 * There is no path here where waiting long enough turns into permission.
 */
export const RPC_RETRY_ATTEMPTS = 6
export const RPC_RETRY_BASE_MS = 400
/** Past this, doubling only parks the poll. The attempts, not the interval, are what widen the wait. */
export const RPC_RETRY_MAX_STEP_MS = 2_000

/**
 * Backoff for attempt n, spread so that clients throttled together do not return together.
 *
 * Measured on 2026-07-26 with five watch streams open at once, which is twenty clients reading the
 * registry on one poll: the throttled ones all waited the same 400ms and asked again in the same
 * millisecond, so the limiter saw the same burst that had just been refused, and eighteen verdicts
 * came back as failed reads. The spread is what turns a synchronized retry into a queue.
 */
function backoffFor(attempt: number, base: number): number {
  if (base === 0) return 0
  return Math.min(base * 2 ** attempt, RPC_RETRY_MAX_STEP_MS) + Math.floor(Math.random() * base)
}

/**
 * viem retries -1, -32005, -32603 and 429, and this endpoint throttles with -32002, which is not on
 * that list. Reading the whole cause chain because the code the transport reports is wrapped by
 * `readContract` and `getLogs` before a caller ever sees it.
 */
function matchesErrorChain(err: unknown, codes: ReadonlySet<number>, text: RegExp): boolean {
  let current: unknown = err
  for (let depth = 0; current !== undefined && current !== null && depth < 8; depth += 1) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof candidate.code === 'number' && codes.has(candidate.code)) return true
    if (typeof candidate.message === 'string' && text.test(candidate.message)) return true
    current = candidate.cause
  }
  return false
}

const THROTTLE_CODES = new Set([-32002, -32005, 429])
const THROTTLE_TEXT = /rate limit|too many requests|requested resource not available/i

function isThrottle(err: unknown): boolean {
  return matchesErrorChain(err, THROTTLE_CODES, THROTTLE_TEXT)
}

/** Providers phrase a refused range in their own words, so the shapes seen in the wild are listed. */
const RANGE_TEXT =
  /block range|range is too|exceeds max|too many results|query returned more than|response size exceeded|limited to \d+ blocks/i

function isRangeRefusal(err: unknown): boolean {
  return matchesErrorChain(err, new Set<number>(), RANGE_TEXT)
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** One RPC call, retried while the endpoint is throttling and never past the bound. */
async function withThrottleRetry<T>(
  call: () => Promise<T>,
  options: { retryDelayMs?: number } = {},
): Promise<T> {
  const base = options.retryDelayMs ?? RPC_RETRY_BASE_MS
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call()
    } catch (err) {
      if (!isThrottle(err) || attempt >= RPC_RETRY_ATTEMPTS) throw err
      await pause(backoffFor(attempt, base))
    }
  }
}

/**
 * Walk a block range newest first, one `getLogs` window at a time.
 *
 * The width starts at the top of the ladder and steps down when a provider refuses the range, so the
 * wide default still reads a node that caps it. A throttle is retried at the current width, since
 * narrowing would answer a rate limit with more calls.
 *
 * `onLogs` returning true stops the walk, which is how a caller that only wants the newest match
 * avoids reading the whole history.
 */
async function walkLogWindows(
  head: bigint,
  floor: bigint,
  read: (fromBlock: bigint, toBlock: bigint) => Promise<unknown[]>,
  onLogs: (logs: unknown[]) => boolean,
  options: { retryDelayMs?: number } = {},
): Promise<void> {
  let rung = 0
  let toBlock = head
  while (toBlock >= floor) {
    let width = LOG_WINDOW_LADDER[rung]!
    let fromBlock = toBlock > floor + width ? toBlock - width : floor
    for (;;) {
      try {
        const logs = await withThrottleRetry(() => read(fromBlock, toBlock), options)
        if (onLogs(logs)) return
        break
      } catch (err) {
        if (!isRangeRefusal(err) || rung >= LOG_WINDOW_LADDER.length - 1) throw err
        rung += 1
        width = LOG_WINDOW_LADDER[rung]!
        fromBlock = toBlock > floor + width ? toBlock - width : floor
      }
    }
    if (fromBlock === floor) break
    toBlock = fromBlock - 1n
  }
}

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
    head = await withThrottleRetry(() => client.getBlockNumber(), options)
  } catch (err) {
    throw new ValidationReadError(
      `could not read the head block on chain ${chainId}: ${oneLineReason(err)}`,
      { retryable: true, cause: err },
    )
  }

  const configuredFloor = optionalEnv(ENV.validationRegistryDeployBlock)
  const lookback = options.lookbackBlocks ?? DEFAULT_LOG_LOOKBACK_BLOCKS
  const floor =
    configuredFloor === undefined
      ? head > lookback
        ? head - lookback
        : 0n
      : BigInt(configuredFloor)

  let found: ResponseEvent | null = null
  try {
    await walkLogWindows(
      head,
      floor,
      (fromBlock, toBlock) =>
        client.getLogs({
          address: registry,
          event: VALIDATION_RESPONSE_EVENT,
          args: { requestHash },
          fromBlock,
          toBlock,
        }),
      (logs) => {
        const last = logs.at(-1) as { args?: { responseURI?: string }; transactionHash?: Hex } | undefined
        const uri = last?.args?.responseURI
        if (last !== undefined && typeof uri === 'string' && uri.length > 0) {
          found = { responseURI: uri, txHash: last.transactionHash as Hex }
          return true
        }
        return false
      },
      options,
    )
  } catch (err) {
    throw new ValidationReadError(
      `could not read the response URI for ${requestHash}: ${oneLineReason(err)}`,
      { retryable: true, cause: err },
    )
  }
  return found
}

export interface ResponseHistoryEntry {
  requestHash: Hex
  responseURI: string
  txHash: Hex
  block: bigint
  logIndex: number
  score: number
  tag: string
  responseHash: Hex
  validator: Address
}

/**
 * Every response this validator has written about this agent, ordered oldest to newest **by block**.
 *
 * A5 needs this and `lastUpdate` cannot give it: two transactions can carry the same consensus second,
 * and a wall clock is not a total order, so ordering by timestamp picks the wrong record roughly half
 * the time it matters. `(blockNumber, logIndex)` is a total order, and it comes from the log rather than
 * from storage because storage keeps only the current state per request hash.
 *
 * Supersession therefore happens in the reader. Both records stay readable, which is the point: editing
 * history would remove the evidence that a grade ever flipped.
 */
export async function readResponseHistory(
  agentId: AgentId,
  validator?: Address,
  options: ReadOptions & { lookbackBlocks?: bigint } = {},
): Promise<ResponseHistoryEntry[]> {
  const registryConfig = options.registry === undefined ? validationRegistry() : null
  const registry = getAddress(options.registry ?? registryConfig!.address)
  const chainId = options.chainId ?? registryConfig!.chainId
  const expected = getAddress(validator ?? validatorAddress())
  const client = publicClientFor(chainId, options.client)
  const tokenId = toTokenId(agentId)

  let head: bigint
  try {
    head = await withThrottleRetry(() => client.getBlockNumber(), options)
  } catch (err) {
    throw new ValidationReadError(
      `could not read the head block on chain ${chainId}: ${oneLineReason(err)}`,
      { retryable: true, cause: err },
    )
  }

  const configuredFloor = optionalEnv(ENV.validationRegistryDeployBlock)
  const lookback = options.lookbackBlocks ?? DEFAULT_LOG_LOOKBACK_BLOCKS
  const floor =
    configuredFloor === undefined ? (head > lookback ? head - lookback : 0n) : BigInt(configuredFloor)

  const entries: ResponseHistoryEntry[] = []
  try {
    await walkLogWindows(
      head,
      floor,
      (fromBlock, toBlock) =>
        client.getLogs({
          address: registry,
          event: VALIDATION_RESPONSE_EVENT,
          // Both filters are indexed on the event, so the node does the work rather than the reader.
          args: { validatorAddress: expected, agentId: tokenId },
          fromBlock,
          toBlock,
        }),
      (logs) => {
        for (const entry of logs) {
          const log = entry as {
            args?: {
              requestHash?: Hex
              responseURI?: string
              responseHash?: Hex
              response?: number
              tag?: string
              validatorAddress?: Address
            }
            transactionHash?: Hex
            blockNumber?: bigint
            logIndex?: number
          }
          const args = log.args ?? {}
          if (args.requestHash === undefined) continue
          entries.push({
            requestHash: args.requestHash,
            responseURI: args.responseURI ?? '',
            txHash: log.transactionHash as Hex,
            block: log.blockNumber ?? 0n,
            logIndex: log.logIndex ?? 0,
            score: args.response ?? 0,
            tag: args.tag ?? '',
            responseHash: args.responseHash ?? (ZERO_HASH as Hex),
            validator: getAddress(args.validatorAddress ?? expected),
          })
        }
        // Every window is read: the history is the whole record, not the newest one.
        return false
      },
      options,
    )
  } catch (err) {
    throw new ValidationReadError(
      `could not read the response history for agent ${agentId}: ${oneLineReason(err)}`,
      { retryable: true, cause: err },
    )
  }

  return entries.sort((a, b) =>
    a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1,
  )
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
): Promise<ReadRecord | null> {
  const record = await readValidation(agentId, validator, options)
  if (record === null) return null
  const event = await readResponseEvent(record.requestHash, options)
  return {
    ...record,
    responseURI: event?.responseURI ?? '',
    txHash: event?.txHash ?? record.requestHash,
  }
}

export interface CurrentRecord {
  record: ReadRecord
  /** Every response for this agent, oldest first, so a superseded grade stays visible. */
  history: ResponseHistoryEntry[]
  /** Which entry the reader selected, and why it is the current one. */
  selected: ResponseHistoryEntry
}

/**
 * The current record among several, selected by block.
 *
 * The history comes from the log and the values come from storage: the log is the ordering, storage is
 * the state. When they disagree about the selected record the read refuses rather than presenting
 * either, because a record whose own two sources disagree is not one a gate should act on.
 *
 * Falls back to the storage scan when no history is readable, which keeps a record usable on a node
 * that will not serve logs, at the cost of ordering by `lastUpdate`. That fallback is stated rather
 * than silent: `history` comes back empty, so a caller can see which path answered.
 */
export async function readCurrentValidation(
  agentId: AgentId,
  validator?: Address,
  options: ReadOptions & { lookbackBlocks?: bigint } = {},
): Promise<CurrentRecord | null> {
  const expected = getAddress(validator ?? validatorAddress())
  let history: ResponseHistoryEntry[] = []
  try {
    history = await readResponseHistory(agentId, expected, options)
  } catch {
    history = []
  }

  if (history.length === 0) {
    const fallback = await readValidationWithEvidence(agentId, expected, options)
    if (fallback === null) return null
    const selected: ResponseHistoryEntry = {
      requestHash: fallback.requestHash,
      responseURI: fallback.responseURI,
      txHash: fallback.txHash,
      block: 0n,
      logIndex: 0,
      score: fallback.score,
      tag: fallback.tag,
      responseHash: fallback.responseHash,
      validator: fallback.validator,
    }
    return { record: fallback, history: [], selected }
  }

  const selected = history[history.length - 1]
  const registryConfig = options.registry === undefined ? validationRegistry() : null
  const registry = getAddress(options.registry ?? registryConfig!.address)
  const chainId = options.chainId ?? registryConfig!.chainId
  const client = publicClientFor(chainId, options.client)
  const status = await readStatus(client, registry, selected.requestHash, options)
  if (status === null) return null

  if (status.responseHash.toLowerCase() !== selected.responseHash.toLowerCase()) {
    throw new ValidationReadError(
      `the record for agent ${agentId} disagrees with its own event: storage says ${status.responseHash}, the log says ${selected.responseHash}`,
    )
  }
  if (status.validatorAddress !== expected) return null
  if (status.responseHash === ZERO_HASH) return null

  const lastUpdate = Number(status.lastUpdate)
  const ttl = options.ttlSeconds ?? VALIDATION_TTL_SECONDS
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const expiresAt = lastUpdate + ttl
  if (expiresAt <= now && options.includeExpired !== true) return null

  const score = status.response
  if (gradeForScore(score) === null) {
    throw new ValidationReadError(
      `agent ${agentId} carries a record scored ${score}, which is not a value this methodology writes`,
    )
  }

  return {
    record: {
      agentId,
      score: score as Score,
      responseURI: selected.responseURI,
      responseHash: status.responseHash,
      tag: status.tag,
      validator: status.validatorAddress,
      expiresAt,
      lastUpdate,
      requestHash: selected.requestHash,
      txHash: selected.txHash,
    },
    history,
    selected,
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
): Promise<ReadRecord> {
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
      // Estimate, then add a quarter. viem sends the raw estimate, and this endpoint's estimate is
      // marginally optimistic: a validationResponse that actually costs 133,926 gas was estimated at
      // 133,334 and reverted twice for want of 600 gas. A revert that late has already written the
      // storage, so it costs the same as success and lands nothing, which is the worst of both.
      // Overestimating costs nothing, since unused gas is not charged.
      const estimate = await publicClient.estimateContractGas({
        address: call.registry,
        abi: VALIDATION_REGISTRY_ABI,
        functionName,
        args: args as never,
        account,
      })
      const hash = await wallet.writeContract({
        address: call.registry,
        abi: VALIDATION_REGISTRY_ABI,
        functionName,
        args: args as never,
        account,
        chain: null,
        gas: (estimate * 125n) / 100n,
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
