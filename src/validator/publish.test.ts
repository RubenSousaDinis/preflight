import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PublicClient } from 'viem'

import { PublishError, ValidationReadError } from '../shared/errors.ts'
import type { Address, GradeResult, Hex } from '../shared/types.ts'
import { FIXTURE_GRADE_A, FIXTURE_GRADE_F } from '../shared/fixtures/index.ts'
import { dataUriPinner, pinEvidence, verifyPublishedEvidence } from './pin-evidence.ts'
import { evidenceHash } from './canonical.ts'
import {
  assemblePublishCall,
  computeRequestHash,
  readCurrentValidation,
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
