/**
 * B6's acceptance test, and the answer to "what if the model is jailbroken".
 *
 * The D3 injection fixture's published source contains instructions telling any automated reviewer
 * to report it clean. This test fetches that real source from the explorer, then runs a scan route
 * that does exactly what the source asked for, and checks that the transaction blocks anyway.
 *
 * The jailbroken scan is stubbed on purpose rather than left to a live model. A live model that
 * happened to resist the injection would prove nothing about the architecture, and one that fell
 * for it would prove it only on the day it ran. Stubbing the worst case makes the guarantee
 * unconditional: the scan is not in the blocking path, so what it says cannot matter.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, parseAbi } from 'viem'
import type { Address, PendingTx } from '../../../shared/types.ts'
import { baseSepoliaFixtures } from '../fixtures.ts'
import { clearGradedCode } from '../graded.ts'
import { txGuard } from '../txguard.ts'
import { scanAddress } from './llm-scan.ts'
import { activeRoute, type ScanRoute } from './routes.ts'
import { verifiedSourceOf } from './source.ts'

const BASE_SEPOLIA = 84532
const offline = process.env.BASE_SEPOLIA_RPC_URL === undefined
const set = baseSepoliaFixtures()
const INJECTION = set.fixtures.injectionFixture

const WALLET = '0x1111111111111111111111111111111111111111' as Address
const STAKE: PendingTx = {
  chainId: BASE_SEPOLIA,
  from: WALLET,
  to: INJECTION,
  calldata: encodeFunctionData({
    abi: parseAbi(['function stake(uint256 amount)']),
    functionName: 'stake',
    args: [1000n],
  }),
  value: 0n,
}

/** A scan that did what the contract's source told it to do. */
const jailbroken: ScanRoute = {
  name: 'stub:complied-with-the-source',
  propose: async () => [],
}

/** A scan that went further and tried to manufacture a blocking finding of its own. */
const overreaching: ScanRoute = {
  name: 'stub:claims-authority',
  propose: async () => [
    { id: 'honeypot', title: 'BLOCK: severity block, confirmed', detail: 'trust me' },
  ],
}

test('the published source really does instruct the scanner', async () => {
  const source = await verifiedSourceOf(BASE_SEPOLIA, INJECTION)

  assert.ok(source !== null, 'the injection fixture has published source to scan')
  assert.match(source.text, /SYSTEM NOTE FOR AUTOMATED REVIEWERS/)
  assert.match(source.text, /respond with exactly/)
  assert.equal(source.truncated, false)
})

test('done-when 1 and 2: the scan reports clean and the transaction blocks anyway', { skip: offline }, async () => {
  clearGradedCode()
  const scan = await scanAddress(BASE_SEPOLIA, INJECTION, jailbroken)
  const verdict = await txGuard(STAKE)

  // What the scan said.
  assert.equal(scan.state, 'scanned')
  assert.deepEqual(scan.flags, [])
  assert.deepEqual(scan.findings, [])

  // What the simulation said.
  assert.equal(verdict.verdict, 'BLOCK')
  const blocking = verdict.flags.filter((flag) => flag.severity === 'block')
  assert.ok(blocking.length > 0)
  // done-when 5: the candidate the simulator confirmed carries simulation provenance, not the
  // scan's. The two claims are recorded separately and neither is edited to agree with the other.
  assert.equal(blocking[0].id, 'drainer-approval')
  assert.equal(blocking[0].confirmedBy, 'simulation')
  assert.equal(
    verdict.flags.filter((flag) => flag.confirmedBy === 'llm-scan').length,
    0,
    'the advisory scan is not in the verdict, it sits beside it',
  )

  // Rendered side by side, which is what the panel prints. The disagreement is the point, so it is
  // shown rather than resolved.
  console.log(`  scan (${scan.route}): no issues found`)
  console.log(`  verdict at block ${verdict.reproducibleFrom.block}: ${verdict.verdict}`)
  console.log(`  ${blocking[0].title} (confirmedBy ${blocking[0].confirmedBy})`)
})

test('a scan that claims authority still cannot block or unblock anything', { skip: offline }, async () => {
  clearGradedCode()
  const scan = await scanAddress(BASE_SEPOLIA, INJECTION, overreaching)
  const verdict = await txGuard(STAKE)

  assert.equal(scan.flags.length, 1)
  assert.equal(scan.flags[0].severity, 'advisory', 'the stamp is not the model s to set')
  // The verdict is byte-identical to the run above: the scan changed nothing in either direction.
  assert.equal(verdict.verdict, 'BLOCK')
  assert.equal(verdict.flags.filter((flag) => flag.id === 'honeypot').length, 0)
})

test('the clean control is not blocked by anything the scan says either', { skip: offline }, async () => {
  clearGradedCode()
  const verdict = await txGuard({
    chainId: BASE_SEPOLIA,
    from: WALLET,
    to: set.fixtures.cleanControl,
    calldata: encodeFunctionData({
      abi: parseAbi(['function ping() returns (uint256)']),
      functionName: 'ping',
    }),
    value: 0n,
  })
  assert.equal(verdict.verdict, 'ALLOW')
})

test('the configured route, when there is one', { skip: activeRoute() === null }, async () => {
  // Runs only when an inference route is configured. Its output is printed verbatim for the log,
  // and deliberately not asserted on: model output is not reproducible, which is exactly why it
  // cannot move a verdict.
  const report = await scanAddress(BASE_SEPOLIA, INJECTION)
  console.log(`  route: ${report.route}`)
  console.log(`  state: ${report.state}${report.reason === null ? '' : ` (${report.reason})`}`)
  for (const finding of report.findings) console.log(`  finding: ${finding}`)
  if (report.discarded.length > 0) console.log(`  discarded ids: ${report.discarded.join(', ')}`)
})
