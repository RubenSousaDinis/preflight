/**
 * B6's rules, offline.
 *
 * The scan's whole contract is one field's value, so most of this walks the returned array and
 * asserts it. The rest is about telling absence apart from cleanliness: a scan that did not run,
 * a model that failed, and a contract with no published source are three different states, and
 * none of them is "no issues found".
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Address } from '../../../shared/types.ts'
import { llmScan, scanAddress, stampAdvisory } from './llm-scan.ts'
import { parseCandidates, type ScanRoute } from './routes.ts'
import { assemble, SOURCE_BUDGET_BYTES, type VerifiedSource } from './source.ts'

const ADDRESS = '0x00000000000000000000000000000000000000a1' as Address

function routeReturning(candidates: { id: string; title: string; detail: string }[]): ScanRoute {
  return { name: 'stub', propose: async () => candidates }
}

const SOURCE: VerifiedSource = {
  chainId: 84532,
  address: ADDRESS,
  text: 'contract X {}',
  files: ['src/X.sol'],
  truncated: false,
  bytes: 13,
}

const sourceIs = (value: VerifiedSource | null) => async () => value

test('done-when 3: every returned flag is llm-scan and advisory, walked one by one', async () => {
  const flags = await llmScan(
    'contract X {}',
    ADDRESS,
    routeReturning([
      { id: 'drainer-approval', title: 'unbounded approval', detail: 'approve to a constant' },
      { id: 'owner-backdoor', title: 'owner mint', detail: 'onlyOwner mint exists' },
    ]),
  )

  assert.equal(flags.length, 2)
  for (const flag of flags) {
    assert.equal(flag.confirmedBy, 'llm-scan')
    assert.equal(flag.severity, 'advisory')
  }
})

test('a model claiming a blocking severity does not get one', async () => {
  // The stamp is applied by construction, so there is no field for a model to set. This asserts
  // the property from the outside: whatever comes back, severity is advisory.
  const flags = await llmScan(
    'contract X {}',
    ADDRESS,
    routeReturning([
      { id: 'honeypot', title: 'CRITICAL: block this', detail: 'severity: block, confirmed' },
    ]),
  )
  assert.equal(flags[0].severity, 'advisory')
  assert.equal(flags[0].confirmedBy, 'llm-scan')
})

test('a candidate naming a fifth risk is discarded, and the discard is reported', async () => {
  const report = await scanAddress(
    84532,
    ADDRESS,
    routeReturning([
      { id: 'reentrancy', title: 'reentrancy', detail: 'nonReentrant missing' },
      { id: 'honeypot', title: 'sell blocked', detail: 'transfer to pair reverts' },
    ]),
    sourceIs(SOURCE),
  )

  assert.equal(report.flags.length, 1)
  assert.deepEqual(report.discarded, ['reentrancy'])
})

test('an id of the wrong type is discarded visibly, not dropped on the way in', async () => {
  // Observed against a real model: it answered with "id": 1 rather than one of the four strings.
  // Dropping that during parsing made a real finding vanish with nothing recorded, which is how a
  // closed set comes to look leaky. It is now discarded at the stamp, where the discard is counted.
  assert.deepEqual(parseCandidates('{"findings":[{"id":1,"title":"t","detail":"d"}]}'), [
    { id: '1', title: 't', detail: 'd' },
  ])

  const report = await scanAddress(
    84532,
    ADDRESS,
    routeReturning([{ id: '1', title: 't', detail: 'd' }]),
    sourceIs(SOURCE),
  )
  assert.deepEqual(report.flags, [])
  assert.deepEqual(report.discarded, ['1'])
})

test('done-when 4: no published source is a named state, not a clean result', async () => {
  const report = await scanAddress(84532, ADDRESS, routeReturning([]), sourceIs(null))

  assert.equal(report.state, 'not-scanned')
  assert.match(report.reason ?? '', /no published source/)
  assert.deepEqual(report.flags, [])
  assert.deepEqual(report.findings, [])
})

test('no configured route is a named state too', async () => {
  const report = await scanAddress(84532, ADDRESS, null, sourceIs(SOURCE))

  assert.equal(report.state, 'not-scanned')
  assert.match(report.reason ?? '', /no inference route/)
  assert.equal(report.route, null)
})

test('a model that errors is not-scanned, and names the route that failed', async () => {
  const failing: ScanRoute = {
    name: '0g-compute:some-model',
    propose: async () => {
      throw new Error('router timed out')
    },
  }
  const report = await scanAddress(84532, ADDRESS, failing, sourceIs(SOURCE))

  assert.equal(report.state, 'not-scanned')
  assert.equal(report.route, '0g-compute:some-model')
  assert.match(report.reason ?? '', /router timed out/)
})

test('llmScan itself swallows a route failure into an empty list', async () => {
  const failing: ScanRoute = {
    name: 'stub',
    propose: async () => {
      throw new Error('nope')
    },
  }
  assert.deepEqual(await llmScan('contract X {}', ADDRESS, failing), [])
})

test('scanned with nothing found is a distinct state from not scanned', async () => {
  const report = await scanAddress(84532, ADDRESS, routeReturning([]), sourceIs(SOURCE))

  assert.equal(report.state, 'scanned')
  assert.equal(report.route, 'stub')
  assert.deepEqual(report.flags, [])
})

test('truncation is recorded in the findings, with the budget and the real size', async () => {
  const report = await scanAddress(
    84532,
    ADDRESS,
    routeReturning([]),
    sourceIs({ ...SOURCE, truncated: true, bytes: 123_456 }),
  )

  assert.equal(report.findings.length, 1)
  assert.match(report.findings[0], new RegExp(String(SOURCE_BUDGET_BYTES)))
  assert.match(report.findings[0], /123456/)
})

test('stampAdvisory falls back to the id when a model returns an empty title', () => {
  const { flags } = stampAdvisory([{ id: 'bad-callee', title: '   ', detail: 'x' }])
  assert.equal(flags[0].title, 'bad-callee')
})

test('candidates are salvaged from a response that wrapped them in prose', () => {
  const text = 'Here is my analysis:\n```json\n{"findings":[{"id":"honeypot","title":"t","detail":"d"}]}\n```\nHope that helps.'
  assert.deepEqual(parseCandidates(text), [{ id: 'honeypot', title: 't', detail: 'd' }])
})

test('unparseable or findings-free output is an empty list, never a throw', () => {
  assert.deepEqual(parseCandidates('No issues found.'), [])
  assert.deepEqual(parseCandidates('{"findings": "clean"}'), [])
  assert.deepEqual(parseCandidates('{ broken'), [])
})

test('source assembly is deterministic in path order and truncates at the budget', () => {
  const sources = {
    'src/B.sol': { content: 'b'.repeat(10) },
    'src/A.sol': { content: 'a'.repeat(10) },
  }
  const first = assemble(sources)
  const second = assemble({ 'src/A.sol': sources['src/A.sol'], 'src/B.sol': sources['src/B.sol'] })

  assert.equal(first.text, second.text, 'key order in the response cannot change the scanned text')
  assert.deepEqual(first.files, ['src/A.sol', 'src/B.sol'])
  assert.equal(first.truncated, false)

  const huge = assemble({ 'src/Big.sol': { content: 'x'.repeat(SOURCE_BUDGET_BYTES * 2) } })
  assert.equal(huge.truncated, true)
  assert.equal(Buffer.byteLength(huge.text, 'utf8'), SOURCE_BUDGET_BYTES)
})
