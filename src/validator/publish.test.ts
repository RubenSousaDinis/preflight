import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PublicClient } from 'viem'

import { PublishError, ValidationReadError } from '../shared/errors.ts'
import type { Address, GradeResult, Hex } from '../shared/types.ts'
import { FIXTURE_GRADE_A, FIXTURE_GRADE_F } from '../shared/fixtures/index.ts'
import {
  dataUriPinner,
  fetchPublishedEvidence,
  pinEvidence,
  verifyPublishedEvidence,
} from './pin-evidence.ts'
import { evidenceHash } from './canonical.ts'
import {
  assemblePublishCall,
  computeRequestHash,
  readCurrentValidation,
  readResponseHistory,
  readValidation,
  VALIDATION_TTL_SECONDS,
} from './validation-registry.ts'

const REGISTRY: Address = '0x1111111111111111111111111111111111111111'
const VALIDATOR: Address = '0xCFad8f21B8469790ADc3922814d1df4E08ECF1c8'
const OTHER: Address = '0x2222222222222222222222222222222222222222'
const CHAIN = 84532
const NOW = 1_785_060_000
const ZERO = `0x${'0'.repeat(64)}` as Hex

interface Status {
  validator: Address
  agentId: bigint
  response: number
  responseHash: Hex
  tag: string
  lastUpdate: number
}

/** A stand-in registry: a map of requestHash to status, plus the per-agent index. */
function stubRegistry(entries: Record<string, Status | 'unknown'>, agentHashes: Hex[]): PublicClient {
  return {
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      if (functionName === 'getAgentValidations') return agentHashes
      if (functionName === 'getValidationStatus') {
        const entry = entries[String(args[0])]
        if (entry === undefined || entry === 'unknown') {
          throw new Error('execution reverted: unknown')
        }
        return [
          entry.validator,
          entry.agentId,
          entry.response,
          entry.responseHash,
          entry.tag,
          BigInt(entry.lastUpdate),
        ]
      }
      throw new Error(`unexpected call ${functionName}`)
    },
  } as unknown as PublicClient
}

const read = (client: PublicClient, validator: Address = VALIDATOR) =>
  readValidation('7', validator, { client, registry: REGISTRY, chainId: CHAIN, now: NOW })

function statusFor(result: GradeResult, overrides: Partial<Status> = {}): Status {
  return {
    validator: VALIDATOR,
    agentId: 7n,
    response: result.score,
    responseHash: result.evidenceHash,
    tag: result.methodologyVersion,
    lastUpdate: NOW - 60,
    ...overrides,
  }
}

// --- the request hash ------------------------------------------------------

test('the request hash is derived from the grade, so a third party can recompute it', () => {
  const base = {
    agentId: '7',
    validator: VALIDATOR,
    evidenceHash: FIXTURE_GRADE_A.evidenceHash,
    ranAt: 1_785_056_400,
    methodologyVersion: 'litmus-v17',
  }
  const hash = computeRequestHash(base)
  assert.match(hash, /^0x[0-9a-f]{64}$/)
  assert.equal(computeRequestHash(base), hash, 'same grade, same hash')
  assert.notEqual(computeRequestHash({ ...base, ranAt: base.ranAt + 1 }), hash)
  assert.notEqual(computeRequestHash({ ...base, agentId: '8' }), hash)
  assert.notEqual(computeRequestHash({ ...base, validator: OTHER }), hash)
})

test('the case of the validator address does not change the request hash', () => {
  const base = {
    agentId: '7',
    validator: VALIDATOR,
    evidenceHash: FIXTURE_GRADE_A.evidenceHash,
    ranAt: 1,
    methodologyVersion: 'litmus-v17',
  }
  assert.equal(
    computeRequestHash({ ...base, validator: VALIDATOR.toLowerCase() as Address }),
    computeRequestHash(base),
  )
})

// --- the assembled call ----------------------------------------------------

test('both legs are assembled with the arguments the reference contract declares', () => {
  const call = assemblePublishCall({
    result: FIXTURE_GRADE_A,
    agentId: '7',
    responseURI: 'https://evidence.example/7.json',
    validator: VALIDATOR,
    registry: REGISTRY,
    chainId: CHAIN,
  })

  assert.equal(call.request.function, 'validationRequest')
  assert.deepEqual(call.request.args, [
    VALIDATOR,
    7n,
    'https://evidence.example/7.json',
    call.requestHash,
  ])

  assert.equal(call.response.function, 'validationResponse')
  assert.deepEqual(call.response.args, [
    call.requestHash,
    100,
    'https://evidence.example/7.json',
    FIXTURE_GRADE_A.evidenceHash,
    FIXTURE_GRADE_A.methodologyVersion,
  ])
  assert.equal(call.response.args[4], FIXTURE_GRADE_A.methodologyVersion, 'the tag is the methodology')
})

test('an empty evidence URI is refused before a key is anywhere near it', () => {
  assert.throws(
    () =>
      assemblePublishCall({
        result: FIXTURE_GRADE_A,
        agentId: '7',
        responseURI: '  ',
        validator: VALIDATOR,
        registry: REGISTRY,
        chainId: CHAIN,
      }),
    PublishError,
  )
})

test('a grade F publishes a score of zero, which is a value and not an absence', () => {
  const call = assemblePublishCall({
    result: FIXTURE_GRADE_F,
    agentId: '7',
    responseURI: 'https://evidence.example/f.json',
    validator: VALIDATOR,
    registry: REGISTRY,
    chainId: CHAIN,
  })
  assert.equal(call.response.args[1], 0)
})

// --- reading it back -------------------------------------------------------

test('a record from the configured validator reads back with a derived expiry', async () => {
  const hash = '0xaa' as Hex
  const record = await read(stubRegistry({ [hash]: statusFor(FIXTURE_GRADE_A) }, [hash]))
  assert.ok(record !== null)
  assert.equal(record.score, 100)
  assert.equal(record.validator, VALIDATOR)
  assert.equal(record.tag, FIXTURE_GRADE_A.methodologyVersion)
  assert.equal(record.responseHash, FIXTURE_GRADE_A.evidenceHash)
  assert.equal(record.expiresAt, NOW - 60 + VALIDATION_TTL_SECONDS)
  assert.ok(record.expiresAt > NOW, 'a record read as live must expire in the future')
})

test('a grade F is a record, not an absence: score zero still reads back', async () => {
  const hash = '0xbb' as Hex
  const record = await read(stubRegistry({ [hash]: statusFor(FIXTURE_GRADE_F) }, [hash]))
  assert.ok(record !== null, 'testing the score instead of the hash would read every F as absent')
  assert.equal(record.score, 0)
})

test('no request, no response, another validator, or an expired record all read as null', async () => {
  assert.equal(await read(stubRegistry({}, [])), null)

  const requested = '0xcc' as Hex
  assert.equal(
    await read(
      stubRegistry({ [requested]: statusFor(FIXTURE_GRADE_A, { response: 0, responseHash: ZERO }) }, [
        requested,
      ]),
    ),
    null,
    'a request with no response carries a zero hash and is not a record',
  )

  const foreign = '0xdd' as Hex
  assert.equal(
    await read(stubRegistry({ [foreign]: statusFor(FIXTURE_GRADE_A, { validator: OTHER }) }, [foreign])),
    null,
    'a record from another validator is ignored, not trusted',
  )

  const stale = '0xee' as Hex
  assert.equal(
    await read(
      stubRegistry({ [stale]: statusFor(FIXTURE_GRADE_A, { lastUpdate: NOW - VALIDATION_TTL_SECONDS }) }, [
        stale,
      ]),
    ),
    null,
    'an expired record is treated as absent',
  )
})

test('asking for a different validator returns null even when a record exists', async () => {
  const hash = '0xff' as Hex
  const client = stubRegistry({ [hash]: statusFor(FIXTURE_GRADE_A) }, [hash])
  assert.ok((await read(client, VALIDATOR)) !== null)
  assert.equal(await read(client, OTHER), null)
})

test('the newest record wins when an agent has been graded twice', async () => {
  const older = '0x01' as Hex
  const newer = '0x02' as Hex
  const record = await read(
    stubRegistry(
      {
        [older]: statusFor(FIXTURE_GRADE_F, { lastUpdate: NOW - 600 }),
        [newer]: statusFor(FIXTURE_GRADE_A, { lastUpdate: NOW - 30 }),
      },
      [older, newer],
    ),
  )
  assert.equal(record?.score, 100)
})

test('a hash the registry has never seen is skipped, not fatal', async () => {
  const missing = '0x03' as Hex
  const present = '0x04' as Hex
  const record = await read(
    stubRegistry({ [missing]: 'unknown', [present]: statusFor(FIXTURE_GRADE_A) }, [missing, present]),
  )
  assert.equal(record?.score, 100)
})

test('a score off the 25-point scale is refused rather than presented as a record', async () => {
  const hash = '0x05' as Hex
  await assert.rejects(
    () => read(stubRegistry({ [hash]: statusFor(FIXTURE_GRADE_A, { response: 42 }) }, [hash])),
    ValidationReadError,
  )
})

test('an RPC failure throws rather than returning null, because null is an answer', async () => {
  const client = {
    readContract: async () => {
      throw new Error('fetch failed')
    },
  } as unknown as PublicClient
  await assert.rejects(
    () => readValidation('7', VALIDATOR, { client, registry: REGISTRY, chainId: CHAIN, now: NOW }),
    (err: unknown) => {
      assert.ok(err instanceof ValidationReadError)
      assert.equal(err.retryable, true)
      return true
    },
  )
})

// --- publishing the evidence ----------------------------------------------

test('the published bytes are the bytes that were hashed', async () => {
  const pinned = await pinEvidence(FIXTURE_GRADE_A.bundle, dataUriPinner)
  assert.equal(pinned.provider, 'data-uri')
  assert.equal(pinned.hash, evidenceHash(FIXTURE_GRADE_A.bundle))

  const check = await verifyPublishedEvidence(pinned.uri, pinned.hash)
  assert.equal(check.ok, true)
  assert.equal(check.hash, pinned.hash)
  assert.equal(check.bytes, pinned.bytes)
})

test('a published document that does not match its hash is caught, not tolerated', async () => {
  const pinned = await pinEvidence(FIXTURE_GRADE_A.bundle, dataUriPinner)
  const tampered = await pinEvidence({ ...FIXTURE_GRADE_A.bundle, ranAt: 1 }, dataUriPinner)
  const check = await verifyPublishedEvidence(tampered.uri, pinned.hash)
  assert.equal(check.ok, false)
  assert.notEqual(check.hash, pinned.hash)
})

test('a provider that returns no URI is a failed publish', async () => {
  await assert.rejects(
    () =>
      pinEvidence(FIXTURE_GRADE_A.bundle, {
        provider: 'data-uri',
        publish: async () => ({ uri: '   ', provider: 'data-uri' as const }),
      }),
    PublishError,
  )
  await assert.rejects(
    () =>
      pinEvidence(FIXTURE_GRADE_A.bundle, {
        provider: 'zerog',
        publish: async () => {
          throw new Error('indexer refused')
        },
      }),
    PublishError,
  )
})

// --- A5: selecting the current record among several, by block --------------

/** A registry that serves both a log history and per-hash storage, the two sources the reader uses. */
function stubWithHistory(
  logs: { requestHash: Hex; block: bigint; logIndex: number; score: number; responseHash: Hex; uri: string }[],
  storage: Record<string, Status>,
): PublicClient {
  return {
    getBlockNumber: async () => 1_000n,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      logs
        .filter((entry) => entry.block >= fromBlock && entry.block <= toBlock)
        .map((entry) => ({
          args: {
            requestHash: entry.requestHash,
            responseURI: entry.uri,
            responseHash: entry.responseHash,
            response: entry.score,
            tag: 'litmus-v17',
            validatorAddress: VALIDATOR,
          },
          blockNumber: entry.block,
          logIndex: entry.logIndex,
          transactionHash: `0xtx${entry.logIndex}`,
        })),
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      if (functionName === 'getAgentValidations') return logs.map((entry) => entry.requestHash)
      if (functionName === 'getValidationStatus') {
        const entry = storage[String(args[0])]
        if (entry === undefined) throw new Error('execution reverted: unknown')
        return [
          entry.validator,
          entry.agentId,
          entry.response,
          entry.responseHash,
          entry.tag,
          BigInt(entry.lastUpdate),
        ]
      }
      throw new Error(`unexpected call ${functionName}`)
    },
  } as unknown as PublicClient
}

test('the reader selects the current record by block, and the superseded one stays readable', async () => {
  const oldHash = '0xa1' as Hex
  const newHash = '0xa2' as Hex
  const client = stubWithHistory(
    [
      { requestHash: oldHash, block: 100n, logIndex: 0, score: 100, responseHash: '0xe1' as Hex, uri: 'https://e/1' },
      { requestHash: newHash, block: 200n, logIndex: 0, score: 0, responseHash: '0xe2' as Hex, uri: 'https://e/2' },
    ],
    {
      [oldHash]: statusFor(FIXTURE_GRADE_A, { responseHash: '0xe1' as Hex, response: 100 }),
      [newHash]: statusFor(FIXTURE_GRADE_F, { responseHash: '0xe2' as Hex, response: 0 }),
    },
  )

  const current = await readCurrentValidation('7', VALIDATOR, {
    client,
    registry: REGISTRY,
    chainId: CHAIN,
    now: NOW,
  })
  assert.ok(current !== null)
  assert.equal(current.record.score, 0, 'the F record is the current one')
  assert.equal(current.selected.block, 200n)
  assert.equal(current.history.length, 2, 'both records remain readable')
  assert.deepEqual(
    current.history.map((entry) => entry.score),
    [100, 0],
    'oldest first, so a superseded grade is still visible next to the current one',
  )
})

test('two records in one block are ordered by log index, not by chance', async () => {
  const first = '0xb1' as Hex
  const second = '0xb2' as Hex
  const client = stubWithHistory(
    [
      { requestHash: second, block: 300n, logIndex: 4, score: 0, responseHash: '0xf2' as Hex, uri: 'https://e/b' },
      { requestHash: first, block: 300n, logIndex: 1, score: 100, responseHash: '0xf1' as Hex, uri: 'https://e/a' },
    ],
    {
      [first]: statusFor(FIXTURE_GRADE_A, { responseHash: '0xf1' as Hex, response: 100 }),
      [second]: statusFor(FIXTURE_GRADE_F, { responseHash: '0xf2' as Hex, response: 0 }),
    },
  )
  const current = await readCurrentValidation('7', VALIDATOR, {
    client,
    registry: REGISTRY,
    chainId: CHAIN,
    now: NOW,
  })
  assert.equal(current?.selected.logIndex, 4)
  assert.equal(current?.record.score, 0)
})

test('a record whose storage and event disagree is refused rather than presented', async () => {
  const hash = '0xc1' as Hex
  const client = stubWithHistory(
    [{ requestHash: hash, block: 100n, logIndex: 0, score: 100, responseHash: '0xdead' as Hex, uri: 'https://e/1' }],
    { [hash]: statusFor(FIXTURE_GRADE_A, { responseHash: '0xbeef' as Hex }) },
  )
  await assert.rejects(
    () => readCurrentValidation('7', VALIDATOR, { client, registry: REGISTRY, chainId: CHAIN, now: NOW }),
    /disagrees with its own event/,
  )
})

// --- the cost of a read, and what a throttled endpoint does to it ----------

/*
  Measured against the event RPC on Base Sepolia on 2026-07-25: one 100,000 block getLogs window
  came back in 630ms, and the same range walked in 900 block windows took 15,007ms across 100
  calls. The gate runs this read on every poll of the rug pull beat, so those 100 calls are what
  saturated the endpoint's limiter and turned a hire into "the validation registry could not be
  read". The window is a provider question, not a chain question, so it is asked wide and narrowed
  only when a provider says no.
*/
function countingClient(options: {
  logs: { requestHash: Hex; block: bigint; logIndex: number; score: number; responseHash: Hex; uri: string }[]
  storage: Record<string, Status>
  head: bigint
  /** Windows wider than this are refused, the way a capped provider refuses them. */
  maxWindow?: bigint
  /** Fail this many calls with the provider's throttle before answering. */
  throttleFirst?: number
  calls: { getLogs: { fromBlock: bigint; toBlock: bigint }[] }
}): PublicClient {
  let throttled = 0
  return {
    getBlockNumber: async () => options.head,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      if (options.throttleFirst !== undefined && throttled < options.throttleFirst) {
        throttled += 1
        throw Object.assign(new Error('Requested resource not available. Details: rate limited'), {
          code: -32002,
        })
      }
      if (options.maxWindow !== undefined && toBlock - fromBlock > options.maxWindow) {
        throw new Error('query exceeds max block range 10000')
      }
      options.calls.getLogs.push({ fromBlock, toBlock })
      return options.logs
        .filter((entry) => entry.block >= fromBlock && entry.block <= toBlock)
        .map((entry) => ({
          args: {
            requestHash: entry.requestHash,
            responseURI: entry.uri,
            responseHash: entry.responseHash,
            response: entry.score,
            tag: 'litmus-v17',
            validatorAddress: VALIDATOR,
          },
          blockNumber: entry.block,
          logIndex: entry.logIndex,
          transactionHash: `0xtx${entry.logIndex}`,
        }))
    },
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      if (functionName === 'getAgentValidations') return options.logs.map((entry) => entry.requestHash)
      if (functionName === 'getValidationStatus') {
        const entry = options.storage[String(args[0])]
        if (entry === undefined) throw new Error('execution reverted: unknown')
        return [entry.validator, entry.agentId, entry.response, entry.responseHash, entry.tag, BigInt(entry.lastUpdate)]
      }
      throw new Error(`unexpected call ${functionName}`)
    },
  } as unknown as PublicClient
}

const HISTORY_HASH = '0xd1' as Hex

function historyFixture(head: bigint) {
  return {
    logs: [
      {
        requestHash: HISTORY_HASH,
        block: head - 40_000n,
        logIndex: 0,
        score: 100,
        responseHash: '0xe1' as Hex,
        uri: 'https://e/1',
      },
    ],
    storage: {
      [HISTORY_HASH]: statusFor(FIXTURE_GRADE_A, { responseHash: '0xe1' as Hex, response: 100 }),
    },
  }
}

test('the log scan asks for the widest window it can, not a hundred narrow ones', async () => {
  const head = 1_000_000n
  const calls = { getLogs: [] as { fromBlock: bigint; toBlock: bigint }[] }
  const client = countingClient({ ...historyFixture(head), head, calls })

  const history = await readResponseHistory('7', VALIDATOR, {
    client,
    registry: REGISTRY,
    chainId: CHAIN,
    lookbackBlocks: 90_000n,
  })

  assert.equal(history.length, 1, 'the record is found')
  assert.ok(
    calls.getLogs.length <= 2,
    `90,000 blocks should cost at most two calls, took ${calls.getLogs.length}`,
  )
})

test('a provider that caps the window is narrowed to, not failed on', async () => {
  const head = 1_000_000n
  const calls = { getLogs: [] as { fromBlock: bigint; toBlock: bigint }[] }
  const client = countingClient({ ...historyFixture(head), head, maxWindow: 10_000n, calls })

  const history = await readResponseHistory('7', VALIDATOR, {
    client,
    registry: REGISTRY,
    chainId: CHAIN,
    lookbackBlocks: 90_000n,
  })

  assert.equal(history.length, 1, 'the record is still found on a capped provider')
  for (const call of calls.getLogs) {
    assert.ok(
      call.toBlock - call.fromBlock <= 10_000n,
      `the window ${call.fromBlock}..${call.toBlock} is wider than the provider allows`,
    )
  }
})

test('a throttled call is retried, because a rate limit is not an answer about an agent', async () => {
  const head = 1_000_000n
  const calls = { getLogs: [] as { fromBlock: bigint; toBlock: bigint }[] }
  const client = countingClient({ ...historyFixture(head), head, throttleFirst: 2, calls })

  const history = await readResponseHistory('7', VALIDATOR, {
    client,
    registry: REGISTRY,
    chainId: CHAIN,
    lookbackBlocks: 90_000n,
    retryDelayMs: 0,
  })
  assert.equal(history.length, 1, 'the read survives a throttle that clears')
})

test('a throttle that does not clear fails closed, and says it was a throttle', async () => {
  const head = 1_000_000n
  const calls = { getLogs: [] as { fromBlock: bigint; toBlock: bigint }[] }
  const client = countingClient({ ...historyFixture(head), head, throttleFirst: 99, calls })

  await assert.rejects(
    () =>
      readResponseHistory('7', VALIDATOR, {
        client,
        registry: REGISTRY,
        chainId: CHAIN,
        lookbackBlocks: 90_000n,
        retryDelayMs: 0,
      }),
    (err: unknown) => {
      assert.ok(err instanceof ValidationReadError)
      assert.match(err.reason, /rate limit/i)
      assert.equal(err.retryable, true)
      return true
    },
  )
})

// --- a gateway that answers "again in a moment" ----------------------------

/*
  Measured against the 0G indexer on 2026-07-25: four concurrent fetches of one evidence URI came
  back 600, 600, 200, 200, and the 600 carried {"code":2,"message":"Internal server error","data":
  "...failed to download segment 0"}. Every client on the rug pull beat reads the same URI at the
  same instant, so this lands mid-beat and the gate refuses an agent whose evidence is there. 600 is
  not a status any RFC defines, which is why these stubs are shaped by hand: the Response
  constructor refuses to build one. The gateway means "busy", so it is asked again.
*/
function respondingWith(statuses: number[], body: string): { impl: typeof fetch; calls: () => number } {
  let calls = 0
  const impl = (async () => {
    const status = statuses[Math.min(calls, statuses.length - 1)]!
    calls += 1
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    }
  }) as unknown as typeof fetch
  return { impl, calls: () => calls }
}

test('a gateway that fails transiently is asked again before the evidence is called unreachable', async () => {
  const bundle = JSON.stringify({ schema: 'preflight-evidence-v1' })
  const gateway = respondingWith([600, 600, 200], bundle)

  const text = await fetchPublishedEvidence('https://evidence.example/bundle', {
    fetchImpl: gateway.impl,
    retryDelayMs: 0,
    timeoutMs: 1_000,
  })
  assert.equal(text, bundle)
  assert.equal(gateway.calls(), 3, 'it asked again twice and then read the document')
})

test('a gateway that keeps failing is a refusal, not a wait forever', async () => {
  const gateway = respondingWith([600], 'down')

  await assert.rejects(
    () =>
      fetchPublishedEvidence('https://evidence.example/bundle', {
        fetchImpl: gateway.impl,
        retryDelayMs: 0,
        timeoutMs: 1_000,
      }),
    (err: unknown) => {
      assert.ok(err instanceof PublishError)
      assert.match(err.reason, /answered HTTP 600/)
      assert.equal(err.retryable, true)
      return true
    },
  )
  assert.ok(gateway.calls() > 1 && gateway.calls() <= 5, `bounded attempts, made ${gateway.calls()}`)
})

test('a status that will not change is not retried', async () => {
  const gateway = respondingWith([404], 'no')

  await assert.rejects(
    () =>
      fetchPublishedEvidence('https://evidence.example/bundle', {
        fetchImpl: gateway.impl,
        retryDelayMs: 0,
        timeoutMs: 1_000,
      }),
    (err: unknown) => {
      assert.ok(err instanceof PublishError)
      assert.equal(err.retryable, false)
      return true
    },
  )
  assert.equal(gateway.calls(), 1, 'a 404 is an answer, so it is not asked again')
})
