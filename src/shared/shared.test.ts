import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ConfigError, PreflightError, isPreflightError, reasonOf, AgentResolveError } from './errors.ts'
import { GRADES, gradeForScore, meetsMinGrade, scoreForGrade } from './grade.ts'
import {
  CHAINS,
  chainById,
  ENV,
  identityRegistryFor,
  ipfsGateway,
  requireEnv,
  rpcUrlFor,
  validationRegistry,
  DEFAULT_IPFS_GATEWAY,
} from './config.ts'
import { doctor } from './doctor.ts'
import {
  FIXTURE_DECISIONS,
  FIXTURE_DECISION_DRIFT,
  FIXTURE_HARNESS_EVENTS,
  FIXTURE_RECEIPT_CHAIN,
  FIXTURE_VERDICTS,
  FIXTURE_VERDICT_BLOCK_STRUCTURAL,
  FIXTURE_RECORD_A,
} from './fixtures/index.ts'

function withEnv(values: Record<string, string | undefined>, body: () => void): void {
  const previous: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    body()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

// --- the grade table (02-DECISIONS §5) -------------------------------------

test('every grade maps to its score, including C', () => {
  assert.equal(scoreForGrade('A'), 100)
  assert.equal(scoreForGrade('B'), 75)
  assert.equal(scoreForGrade('C'), 50)
  assert.equal(scoreForGrade('D'), 25)
  assert.equal(scoreForGrade('F'), 0)
})

test('a score off the 25-point scale reads back as no grade, never a nearest letter', () => {
  for (const grade of GRADES) {
    assert.equal(gradeForScore(scoreForGrade(grade)), grade)
  }
  assert.equal(gradeForScore(99), null)
  assert.equal(gradeForScore(-1), null)
  assert.equal(gradeForScore(51), null)
})

test('minGrade compares by rank, and equal passes', () => {
  assert.equal(meetsMinGrade('A', 'B'), true)
  assert.equal(meetsMinGrade('B', 'B'), true)
  assert.equal(meetsMinGrade('C', 'B'), false)
  assert.equal(meetsMinGrade('F', 'F'), true)
})

// --- typed failures --------------------------------------------------------

test('a typed failure carries a code, a renderable reason, and a retry flag', () => {
  const err = new AgentResolveError('the id is not registered', { retryable: false })
  assert.equal(err.code, 'AGENT_RESOLVE')
  assert.equal(err.reason, 'the id is not registered')
  assert.equal(err.retryable, false)
  assert.equal(err.name, 'AgentResolveError')
  assert.ok(err instanceof PreflightError)
  assert.ok(isPreflightError(err))
})

test('a config failure is never retryable, because there is nothing to retry', () => {
  const err = new ConfigError('BASE_MAINNET_RPC_URL is not set', { retryable: true })
  assert.equal(err.retryable, false)
})

test('reasonOf always returns something renderable', () => {
  assert.equal(reasonOf(new AgentResolveError('unreachable card')), 'unreachable card')
  assert.equal(reasonOf(new Error('plain')), 'plain')
  assert.equal(reasonOf('string failure'), 'string failure')
  assert.equal(reasonOf(undefined), 'unknown failure')
  assert.equal(reasonOf(new Error('')), 'unknown failure')
})

// --- the per-chain configuration surface -----------------------------------

test('a missing or blank value throws ConfigError, and there is no default RPC', () => {
  withEnv({ [ENV.baseMainnetRpc]: undefined }, () => {
    assert.throws(() => rpcUrlFor(8453), ConfigError)
  })
  withEnv({ [ENV.baseMainnetRpc]: '   ' }, () => {
    assert.throws(() => rpcUrlFor(8453), ConfigError)
  })
  withEnv({ [ENV.baseMainnetRpc]: 'https://rpc.example/base' }, () => {
    assert.equal(rpcUrlFor(8453), 'https://rpc.example/base')
  })
})

test('an unconfigured chain id throws rather than resolving to a default network', () => {
  assert.equal(chainById(84532).key, 'base-sepolia')
  assert.equal(chainById(8453).key, 'base-mainnet')
  assert.equal(chainById(296).key, 'hedera-testnet')
  assert.throws(() => chainById(1), ConfigError)
})

test('the identity registry is recorded for both Base networks and for no other chain', () => {
  assert.equal(identityRegistryFor(8453), CHAINS['base-mainnet'].identityRegistry)
  assert.equal(identityRegistryFor(84532), CHAINS['base-sepolia'].identityRegistry)
  assert.throws(() => identityRegistryFor(296), ConfigError)
})

test('the validation registry needs both halves or it fails closed', () => {
  withEnv(
    { [ENV.validationRegistryAddress]: '0xabc', [ENV.validationRegistryChainId]: undefined },
    () => {
      assert.throws(() => validationRegistry(), ConfigError)
    },
  )
  withEnv(
    { [ENV.validationRegistryAddress]: undefined, [ENV.validationRegistryChainId]: '84532' },
    () => {
      assert.throws(() => validationRegistry(), ConfigError)
    },
  )
  withEnv(
    { [ENV.validationRegistryAddress]: 'not-an-address', [ENV.validationRegistryChainId]: '84532' },
    () => {
      assert.throws(() => validationRegistry(), ConfigError)
    },
  )
  withEnv(
    { [ENV.validationRegistryAddress]: '0xdead', [ENV.validationRegistryChainId]: '84532' },
    () => {
      assert.deepEqual(validationRegistry(), { address: '0xdead', chainId: 84532 })
    },
  )
})

test('the ipfs gateway is one configured value with a stated default, never a race', () => {
  withEnv({ [ENV.ipfsGateway]: undefined }, () => {
    assert.equal(ipfsGateway(), DEFAULT_IPFS_GATEWAY)
  })
  withEnv({ [ENV.ipfsGateway]: 'https://gateway.example/ipfs/' }, () => {
    assert.equal(ipfsGateway(), 'https://gateway.example/ipfs/')
  })
})

test('requireEnv names the variable and what it blocks', () => {
  withEnv({ PREFLIGHT_TEST_ONLY: undefined }, () => {
    assert.throws(
      () => requireEnv('PREFLIGHT_TEST_ONLY', 'this test'),
      /PREFLIGHT_TEST_ONLY is not set, so this test cannot run/,
    )
  })
})

test('doctor reports a missing required item as missing', () => {
  withEnv({ [ENV.validatorAddress]: undefined }, () => {
    const report = doctor()
    assert.equal(report.ok, false)
    assert.ok(report.missingRequired.includes(ENV.validatorAddress))
  })
  withEnv(
    {
      [ENV.baseMainnetRpc]: 'https://rpc.example/base',
      [ENV.baseSepoliaRpc]: 'https://rpc.example/sepolia',
      [ENV.validatorAddress]: '0xdead',
      [ENV.validatorPrivateKey]: '0xkey',
    },
    () => {
      assert.equal(doctor().ok, true)
    },
  )
})

// --- the fixture set -------------------------------------------------------

test('every fixture refusal carries a reason, and drift outranks the letter', () => {
  for (const decision of FIXTURE_DECISIONS) {
    assert.ok(decision.reason.length > 0, 'a refusal with no reason reads as a gate bug')
    if (decision.verdict === 'REFUSE') {
      assert.notEqual(decision.verdict, 'HIRE')
    }
  }
  assert.equal(FIXTURE_DECISION_DRIFT.verdict, 'REFUSE')
  assert.equal(FIXTURE_DECISION_DRIFT.grade, 'A')
  assert.equal(FIXTURE_DECISION_DRIFT.fingerprintMatch, false)
})

test('a fixture validation record arms expiry with a non-zero time', () => {
  assert.ok(FIXTURE_RECORD_A.expiresAt > 0)
})

test('the fixture receipt chain links by prevHash from a single genesis', () => {
  assert.equal(FIXTURE_RECEIPT_CHAIN[0].prevHash, null)
  for (let i = 1; i < FIXTURE_RECEIPT_CHAIN.length; i += 1) {
    assert.equal(FIXTURE_RECEIPT_CHAIN[i].prevHash, FIXTURE_RECEIPT_CHAIN[i - 1].hash)
  }
})

test('no fixture verdict blocks on an advisory finding alone', () => {
  for (const verdict of FIXTURE_VERDICTS) {
    const blocking = verdict.flags.filter((flag) => flag.severity === 'block')
    for (const flag of blocking) {
      assert.notEqual(flag.confirmedBy, 'llm-scan')
    }
    if (verdict.verdict === 'ALLOW') {
      assert.equal(blocking.length, 0)
    }
  }
  assert.equal(FIXTURE_VERDICT_BLOCK_STRUCTURAL.verdict, 'BLOCK')
  assert.deepEqual(FIXTURE_VERDICT_BLOCK_STRUCTURAL.flags, [])
})

test('the harness stream opens on shopping and closes on done', () => {
  assert.equal(FIXTURE_HARNESS_EVENTS[0].type, 'shopping')
  assert.equal(FIXTURE_HARNESS_EVENTS[FIXTURE_HARNESS_EVENTS.length - 1].type, 'done')
  const paid = FIXTURE_HARNESS_EVENTS.filter((event) => event.type === 'paid')
  assert.equal(paid.length, 1, 'beat 1 pays one honest call, and nothing after the hostile turn')
})
