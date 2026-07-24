/**
 * B5c's rules, offline.
 *
 * Almost every test here asserts an empty result, which is the point. This detector's failure mode
 * is not missing a trap, it is calling every thin token a trap: no market, no buy, no position, a
 * buy that failed on its own. Each of those has to come back empty, and check 3 in the task doc
 * says to ship the no-pool case before the positive one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionResult, getAddress, parseAbi } from 'viem'
import type { Address, PendingTx, SimulationResult } from '../../../shared/types.ts'
import type { DexConfig } from '../dex.ts'
import type { ForkHandle } from '../fork.ts'
import { amountOut, honeypotWith, type HoneypotDeps } from './honeypot.ts'

const TOKEN = getAddress('0x00000000000000000000000000000000000000a1')
const QUOTE = getAddress('0x00000000000000000000000000000000000000b1')
const PAIR = getAddress('0x00000000000000000000000000000000000000c1')
const FACTORY = getAddress('0x00000000000000000000000000000000000000d1')
const ROUTER = getAddress('0x00000000000000000000000000000000000000e1')
const BUYER = '0x1111111111111111111111111111111111111111' as Address
const ZERO = '0x0000000000000000000000000000000000000000' as Address

const RESERVE = 100_000n * 10n ** 18n
const ACQUIRED = 990n * 10n ** 18n

const DEX: DexConfig = { factory: FACTORY, quoteAssets: [QUOTE] }

const TX: PendingTx = {
  chainId: 84532,
  from: BUYER,
  to: ROUTER,
  calldata: '0xabcdef01',
  value: 0n,
}

const CODE = {
  fingerprint: `0x${'11'.repeat(32)}` as const,
  proxyKind: 'none' as const,
  resolved: [],
  observedBlock: 500n,
}

function boughtSim(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    block: 500n,
    reverted: false,
    balanceDeltas: [{ token: TOKEN, owner: BUYER, delta: ACQUIRED }],
    approvalDeltas: [],
    callGraph: [],
    raw: null,
    ...overrides,
  }
}

function result(reverted: boolean, reason?: string): SimulationResult {
  return {
    block: 500n,
    reverted,
    balanceDeltas: [],
    approvalDeltas: [],
    callGraph: [],
    raw: reverted ? { callTrace: { error: 'execution reverted', revertReason: reason } } : {},
  }
}

interface ForkPlan {
  pair?: Address
  reserves?: [bigint, bigint]
  /** Outcomes for the legs after the buy, in order: the transfer, then the swap. */
  legs?: SimulationResult[]
  buy?: SimulationResult
}

function stubFork(plan: ForkPlan): { fork: ForkHandle; runs: PendingTx[] } {
  const runs: PendingTx[] = []
  const legs = [...(plan.legs ?? [])]
  const fork: ForkHandle = {
    block: 500n,
    async run(tx) {
      runs.push(tx)
      if (runs.length === 1) return plan.buy ?? boughtSim()
      return legs.shift() ?? result(false)
    },
    async storageAt() {
      return `0x${'00'.repeat(32)}`
    },
    async call(to, data) {
      if (to === FACTORY) {
        return encodeFunctionResult({
          abi: parseAbi(['function getPair(address,address) view returns (address)']),
          functionName: 'getPair',
          result: plan.pair ?? PAIR,
        })
      }
      if (data.startsWith('0x0902f1ac')) {
        const [a, b] = plan.reserves ?? [RESERVE, RESERVE]
        return encodeFunctionResult({
          abi: parseAbi([
            'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
          ]),
          functionName: 'getReserves',
          result: [a, b, 0],
        })
      }
      return encodeFunctionResult({
        abi: parseAbi(['function token0() view returns (address)']),
        functionName: 'token0',
        result: TOKEN,
      })
    },
    async release() {
      return undefined
    },
  }
  return { fork, runs }
}

function deps(plan: ForkPlan, dex: DexConfig | null = DEX): HoneypotDeps {
  return {
    forkAt: async () => stubFork(plan).fork,
    dexFor: () => dex,
  }
}

test('a chain with no configured market reports nothing, rather than a trap', async () => {
  const flags = await honeypotWith(deps({}, null))(boughtSim(), TX, CODE)
  assert.deepEqual(flags, [])
})

test('check 3: a token with no pair at all is not a honeypot', async () => {
  const flags = await honeypotWith(deps({ pair: ZERO }))(boughtSim(), TX, CODE)
  assert.deepEqual(flags, [])
})

test('a pair that exists with no reserves is not a honeypot either', async () => {
  const flags = await honeypotWith(deps({ reserves: [0n, 0n] }))(boughtSim(), TX, CODE)
  assert.deepEqual(flags, [])
})

test('a buy that reverted on its own is a failed transaction, not a trap', async () => {
  const flags = await honeypotWith(deps({}))(boughtSim({ reverted: true }), TX, CODE)
  assert.deepEqual(flags, [])
})

test('a buy that reverts on the second fork is not a trap either', async () => {
  const flags = await honeypotWith(deps({ buy: result(true, 'whatever') }))(boughtSim(), TX, CODE)
  assert.deepEqual(flags, [])
})

test('a transaction that acquires no token is not this detector s business', async () => {
  const flags = await honeypotWith(deps({}))(boughtSim({ balanceDeltas: [] }), TX, CODE)
  assert.deepEqual(flags, [])
})

test('a token the sender only sent is not an acquisition', async () => {
  const flags = await honeypotWith(deps({}))(
    boughtSim({ balanceDeltas: [{ token: TOKEN, owner: BUYER, delta: -ACQUIRED }] }),
    TX,
    CODE,
  )
  assert.deepEqual(flags, [])
})

test('a sell whose legs both succeed is clean', async () => {
  const flags = await honeypotWith(deps({ legs: [result(false), result(false)] }))(
    boughtSim(),
    TX,
    CODE,
  )
  assert.deepEqual(flags, [])
})

test('a position that cannot be moved into the pool blocks, quoting the revert', async () => {
  const flags = await honeypotWith(
    deps({ legs: [result(true, 'HNY: holders cannot sell'), result(false)] }),
  )(boughtSim(), TX, CODE)

  assert.equal(flags.length, 1)
  assert.equal(flags[0].id, 'honeypot')
  assert.equal(flags[0].severity, 'block')
  assert.equal(flags[0].confirmedBy, 'simulation')
  assert.match(flags[0].detail, /HNY: holders cannot sell/)
  assert.match(flags[0].detail, /moving the position into the pool/)
})

test('a pool that will not pay the proceeds out blocks too', async () => {
  // The transfer went in and the swap failed, which is what a proceeds-crushing transfer tax looks
  // like from outside: the exit is closed by arithmetic rather than by a revert on the way in.
  const flags = await honeypotWith(deps({ legs: [result(false), result(true, 'K')] }))(
    boughtSim(),
    TX,
    CODE,
  )

  assert.equal(flags.length, 1)
  assert.match(flags[0].detail, /taking the proceeds out of the pool/)
  assert.match(flags[0].detail, /"K"/)
})

test('the probe sells the whole acquired position, back to the pair', async () => {
  const plan: ForkPlan = { legs: [result(false), result(false)] }
  const stub = stubFork(plan)
  await honeypotWith({ forkAt: async () => stub.fork, dexFor: () => DEX })(boughtSim(), TX, CODE)

  assert.equal(stub.runs.length, 3, 'the buy, the transfer in, and the swap out')
  assert.equal(stub.runs[1].to, TOKEN)
  assert.equal(stub.runs[2].to, PAIR)
  assert.equal(stub.runs[2].from, BUYER)
})

test('the quote asks for less than the reserves imply, so price impact is not a trap', () => {
  const out = amountOut(1000n * 10n ** 18n, RESERVE, RESERVE)
  assert.ok(out > 0n)
  // The constant product with a 0.3% fee, so slightly under the naive one-for-one.
  assert.ok(out < 1000n * 10n ** 18n)
  assert.equal(amountOut(0n, RESERVE, RESERVE), 0n)
  assert.equal(amountOut(1n, 0n, RESERVE), 0n)
})
