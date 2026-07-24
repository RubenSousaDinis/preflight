/**
 * B5c's acceptance test, on the staged Base Sepolia market (route 1, 02-DECISIONS 13.4).
 *
 * Both pairs are real pairs on the chain's own UniswapV2Factory, seeded with equal reserves, and
 * the two tokens differ in exactly one line of code. That is what makes the comparison mean
 * something: the honeypot blocks and the clean token does not, with the market held constant.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, parseAbi } from 'viem'
import type { Address, PendingTx } from '../../../shared/types.ts'
import { baseSepoliaFixtures } from '../fixtures.ts'
import { clearGradedCode } from '../graded.ts'
import { txGuard } from '../txguard.ts'

const BASE_SEPOLIA = 84532
const offline = process.env.BASE_SEPOLIA_RPC_URL === undefined
const set = baseSepoliaFixtures()
const market = set.market
const BUYER = set.deployer

const ROUTER_ABI = parseAbi([
  'function buy(address tokenIn, address tokenOut, uint256 amountIn, address to) returns (uint256)',
])
const TOKEN_ABI = parseAbi(['function mint(address to, uint256 value)'])

const AMOUNT_IN = 1_000n * 10n ** 18n

function buy(token: Address): PendingTx {
  return {
    chainId: BASE_SEPOLIA,
    from: BUYER,
    to: market.router,
    calldata: encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: 'buy',
      args: [market.quoteToken, token, AMOUNT_IN, BUYER],
    }),
    value: 0n,
  }
}

test('done-when 1: buying the honeypot blocks, with the sell leg quoted', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard(buy(market.honeypotToken))

  assert.equal(verdict.verdict, 'BLOCK')
  const flag = verdict.flags.find((entry) => entry.id === 'honeypot')
  assert.ok(flag !== undefined, 'the honeypot flag fired')
  assert.equal(flag.severity, 'block')
  assert.equal(flag.confirmedBy, 'simulation')
  // done-when 4: the sell leg outcome in specifics, not "it failed".
  assert.match(flag.detail, /holders cannot sell/)
  assert.match(flag.detail, new RegExp(market.honeypotPair))
  console.log(`  block ${verdict.reproducibleFrom.block}: ${flag.title}`)
  console.log(`  ${flag.detail}`)
})

test('done-when 2: buying the clean token on the same market passes', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard(buy(market.cleanToken))

  assert.equal(verdict.verdict, 'ALLOW')
  assert.deepEqual(verdict.flags, [])
  console.log(`  clean token allowed at block ${verdict.reproducibleFrom.block}`)
})

test('done-when 3: a token with no pool at all is not a honeypot', { skip: offline }, async () => {
  clearGradedCode()
  // Acquiring a token that has no market anywhere. Absence of an exit is not a closed exit, and
  // conflating them would make every fresh token on this chain a trap.
  const verdict = await txGuard({
    chainId: BASE_SEPOLIA,
    from: BUYER,
    to: set.fixtures.drainableToken,
    calldata: encodeFunctionData({
      abi: TOKEN_ABI,
      functionName: 'mint',
      args: [BUYER, AMOUNT_IN],
    }),
    value: 0n,
  })

  assert.equal(verdict.verdict, 'ALLOW')
  assert.equal(verdict.flags.filter((flag) => flag.id === 'honeypot').length, 0)
  console.log(`  no-pool token allowed at block ${verdict.reproducibleFrom.block}`)
})

test('done-when 5: the same input at the same block gives the same flags twice', { skip: offline }, async () => {
  clearGradedCode()
  const first = await txGuard(buy(market.honeypotToken))
  const second = await txGuard(buy(market.honeypotToken), { atBlock: first.reproducibleFrom.block })

  assert.equal(second.reproducibleFrom.block, first.reproducibleFrom.block)
  assert.deepEqual(
    second.flags.map((flag) => `${flag.id}:${flag.severity}`),
    first.flags.map((flag) => `${flag.id}:${flag.severity}`),
  )
  assert.equal(second.codeFingerprint, first.codeFingerprint)
  console.log(`  same verdict twice at block ${first.reproducibleFrom.block}`)
})
