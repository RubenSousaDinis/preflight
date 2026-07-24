/**
 * B7 against the real thing: every detector, through the MCP tool surface, over a real fork of the
 * chain the staged fixtures live on.
 *
 * The offline suite proves the wrapping and the serialization. This proves that what a client receives
 * over the wire is the whole verdict: the flags with their provenance, the deltas, and the tuple a
 * reader re-runs it from. Skipped without an RPC, like every other live test here.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, parseAbi } from 'viem'

import type { Address } from '../../shared/types.ts'
import { baseSepoliaFixtures } from '../../gates/tx/fixtures.ts'
import { clearGradedCode } from '../../gates/tx/graded.ts'
import { callPreflightTx } from './server.ts'
import type { SerializedTxVerdict } from './serialize.ts'

const BASE_SEPOLIA = 84532
const offline = process.env.BASE_SEPOLIA_RPC_URL === undefined
const WALLET = '0x1111111111111111111111111111111111111111' as Address

const ABI = parseAbi([
  'function swap(uint256 amount)',
  'function stake(uint256 amount)',
  'function claim()',
  'function forward() payable',
  'function ping() returns (uint256)',
  'function buy(address tokenIn, address tokenOut, uint256 amountIn, address to) returns (uint256)',
])

async function tool(input: {
  to: Address
  from?: Address
  value?: string
  fn: Parameters<typeof encodeFunctionData>[0]
}): Promise<SerializedTxVerdict> {
  clearGradedCode()
  const { structuredContent, isError } = await callPreflightTx({
    chainId: BASE_SEPOLIA,
    from: input.from ?? WALLET,
    to: input.to,
    calldata: encodeFunctionData(input.fn),
    value: input.value ?? '0',
  })
  // Every path is a payload. A tool error here would be something a client could retry past.
  assert.equal(isError, false)
  return structuredContent as unknown as SerializedTxVerdict
}

function flagIds(verdict: SerializedTxVerdict): string[] {
  return verdict.flags.map((flag) => flag.id)
}

/** Every serialized verdict carries the five values that make it reproducible. */
function assertTuple(verdict: SerializedTxVerdict): void {
  assert.match(verdict.reproducibleFrom.block, /^[1-9][0-9]*$/, 'a real fork height, not a zero')
  assert.match(verdict.reproducibleFrom.calldataHash, /^0x[0-9a-f]{64}$/)
  assert.match(verdict.reproducibleFrom.from, /^0x[0-9a-fA-F]{40}$/)
  assert.match(verdict.reproducibleFrom.to, /^0x[0-9a-fA-F]{40}$/)
  assert.match(verdict.reproducibleFrom.value, /^[0-9]+$/, 'a decimal string, never a coerced number')
  assert.match(verdict.codeFingerprint, /^0x[0-9a-f]{64}$/)
}

test('the drainer approval blocks through the tool, with its provenance intact', { skip: offline }, async () => {
  const set = baseSepoliaFixtures()
  const verdict = await tool({
    to: set.fixtures.drainerRouter,
    fn: { abi: ABI, functionName: 'swap', args: [1000n] },
  })
  assert.equal(verdict.verdict, 'BLOCK')
  assert.ok(flagIds(verdict).includes('drainer-approval'))
  const flag = verdict.flags.find((entry) => entry.id === 'drainer-approval')
  assert.equal(flag?.severity, 'block')
  assert.equal(flag?.confirmedBy, 'simulation', 'the provenance survives serialization')
  assert.ok((flag?.detail.length ?? 0) > 0)
  assertTuple(verdict)
})

test('the owner backdoor blocks through the tool', { skip: offline }, async () => {
  const set = baseSepoliaFixtures()
  const verdict = await tool({
    to: set.fixtures.backdoorProxy,
    fn: { abi: ABI, functionName: 'claim' },
  })
  assert.equal(verdict.verdict, 'BLOCK')
  assert.ok(flagIds(verdict).includes('owner-backdoor'))
  assertTuple(verdict)
})

test('value routed to an unverified callee blocks through the tool', { skip: offline }, async () => {
  const set = baseSepoliaFixtures()
  const verdict = await tool({
    to: set.fixtures.valueRouter,
    fn: { abi: ABI, functionName: 'forward' },
    value: '1000000000000000',
  })
  assert.equal(verdict.verdict, 'BLOCK')
  assert.ok(flagIds(verdict).includes('bad-callee'))
  assert.equal(verdict.reproducibleFrom.value, '1000000000000000', 'the value survives as sent')
  assertTuple(verdict)
})

test('the honeypot blocks through the tool, and the clean pair does not', { skip: offline }, async () => {
  const set = baseSepoliaFixtures()
  const buy = (token: Address) => ({
    to: set.market.router,
    from: set.deployer,
    fn: {
      abi: ABI,
      functionName: 'buy' as const,
      args: [set.market.quoteToken, token, 1000n * 10n ** 18n, set.deployer] as const,
    },
  })

  const trap = await tool(buy(set.market.honeypotToken))
  assert.equal(trap.verdict, 'BLOCK')
  assert.ok(flagIds(trap).includes('honeypot'))
  assertTuple(trap)

  const clean = await tool(buy(set.market.cleanToken))
  assert.equal(clean.verdict, 'ALLOW', 'the same call shape on a tradeable pair is not a trap')
  assert.ok(clean.deltas.length > 0, 'an allow reports what actually moved')
  for (const delta of clean.deltas) {
    assert.match(delta.delta, /^-?[0-9]+$/, 'a delta is a decimal string, so nothing is rounded')
  }
  assertTuple(clean)
})

test('the injection fixture still blocks, so a scan cannot talk a detector out of a flag', { skip: offline }, async () => {
  const set = baseSepoliaFixtures()
  const verdict = await tool({
    to: set.fixtures.injectionFixture,
    fn: { abi: ABI, functionName: 'stake', args: [1000n] },
  })
  assert.equal(verdict.verdict, 'BLOCK')
  // Whatever the contract's own text says about itself, the block came from the simulator.
  const blocking = verdict.flags.filter((flag) => flag.severity === 'block')
  assert.ok(blocking.length > 0)
  for (const flag of blocking) {
    assert.notEqual(flag.confirmedBy, 'llm-scan', 'an advisory finding can never be what blocks')
  }
  assertTuple(verdict)
})

test('the clean control allows through the tool, and reports its tuple', { skip: offline }, async () => {
  const set = baseSepoliaFixtures()
  const verdict = await tool({
    to: set.fixtures.cleanControl,
    fn: { abi: ABI, functionName: 'ping' },
  })
  assert.equal(verdict.verdict, 'ALLOW')
  assert.deepEqual(
    verdict.flags.filter((flag) => flag.severity === 'block'),
    [],
  )
  assertTuple(verdict)
})
