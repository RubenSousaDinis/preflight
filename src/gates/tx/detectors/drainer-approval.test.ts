/**
 * B5b's rules, offline.
 *
 * The interesting cases are the ones that must NOT flag. A detector that blocks an ordinary
 * bounded approval to the contract you are calling is a detector nobody ships, and one that blocks
 * a revocation teaches its reader to ignore it. Those are checked here alongside the drainer case.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAddress } from 'viem'
import type { ApprovalDelta, CodeFingerprint, PendingTx, SimulationResult } from '../../../shared/types.ts'
import {
  MAX_UINT160,
  MAX_UINT256,
  drainerApprovalWith,
  isUnlimited,
  type ApprovalLookups,
} from './drainer-approval.ts'

const TOKEN = getAddress('0x00000000000000000000000000000000000000a1')
const CALLEE = getAddress('0x00000000000000000000000000000000000000c1')
const OWNER = getAddress('0x1111111111111111111111111111111111111111')
const VERIFIED = getAddress('0x00000000000000000000000000000000000000v1'.replace('v', 'e'))
const UNVERIFIED = getAddress('0x00000000000000000000000000000000000000f1')
const EOA = getAddress('0x00000000000000000000000000000000BaDc0dE0')

const TX: PendingTx = {
  chainId: 84532,
  from: OWNER,
  to: CALLEE,
  calldata: '0xdeadbeef',
  value: 0n,
}

const CODE: CodeFingerprint = {
  fingerprint: `0x${'11'.repeat(32)}`,
  proxyKind: 'none',
  resolved: [],
  observedBlock: 500n,
}

function sim(approvals: ApprovalDelta[]): SimulationResult {
  return {
    block: 500n,
    reverted: false,
    balanceDeltas: [],
    approvalDeltas: approvals,
    callGraph: [],
    raw: null,
  }
}

function approval(spender: string, amount: bigint): ApprovalDelta {
  return { token: TOKEN, owner: OWNER, spender: getAddress(spender), amount }
}

const lookups: ApprovalLookups = {
  hasCode: async (_chain, address) => address !== EOA,
  verified: async (_chain, address) =>
    address === VERIFIED
      ? { verified: true, note: 'source verified, exact_match' }
      : { verified: false, note: 'source not verified' },
}

const detect = drainerApprovalWith(lookups)

test('an unlimited allowance blocks, whoever holds it', async () => {
  const flags = await detect(sim([approval(VERIFIED, MAX_UINT256)]), TX, CODE)

  assert.equal(flags.length, 1)
  assert.equal(flags[0].id, 'drainer-approval')
  assert.equal(flags[0].severity, 'block')
  assert.equal(flags[0].confirmedBy, 'simulation')
  assert.match(flags[0].detail, /unlimited amount \(uint256 max\)/)
})

test('the Permit2 uint160 sentinel counts as unlimited too', async () => {
  const flags = await detect(sim([approval(VERIFIED, MAX_UINT160)]), TX, CODE)
  assert.equal(flags.length, 1)
  assert.match(flags[0].detail, /Permit2 sentinel/)
  assert.equal(isUnlimited(MAX_UINT160 - 1n), false)
})

test('a bounded allowance to a verified spender is not a finding', async () => {
  assert.deepEqual(await detect(sim([approval(VERIFIED, 1000n)]), TX, CODE), [])
})

test('a bounded allowance to the contract being called is the ordinary path', async () => {
  assert.deepEqual(await detect(sim([approval(CALLEE, 1000n)]), TX, CODE), [])
})

test('a bounded allowance to an unverified contract blocks, and says why', async () => {
  const flags = await detect(sim([approval(UNVERIFIED, 1000n)]), TX, CODE)

  assert.equal(flags.length, 1)
  assert.equal(flags[0].severity, 'block')
  assert.match(flags[0].detail, /source not verified/)
})

test('an allowance to an address with no code is the strongest case', async () => {
  const flags = await detect(sim([approval(EOA, 5n)]), TX, CODE)

  assert.equal(flags.length, 1)
  assert.match(flags[0].detail, /no code/)
})

test('revoking to zero is remediation, not a finding', async () => {
  assert.deepEqual(await detect(sim([approval(EOA, 0n)]), TX, CODE), [])
})

test('no approvals at all is a legitimate empty result', async () => {
  assert.deepEqual(await detect(sim([]), TX, CODE), [])
})

test('an explorer that will not answer leaves the spender unknown, which blocks', async () => {
  const failing: ApprovalLookups = {
    hasCode: async () => true,
    verified: async () => ({ verified: false, note: 'source status unavailable, treating as not verified' }),
  }
  const flags = await drainerApprovalWith(failing)(sim([approval(UNVERIFIED, 1n)]), TX, CODE)

  assert.equal(flags.length, 1)
  assert.match(flags[0].detail, /unavailable/)
})

test('a code read that throws leaves the spender unknown, which blocks', async () => {
  const failing: ApprovalLookups = {
    hasCode: async () => {
      throw new Error('socket hang up')
    },
    verified: async () => ({ verified: true, note: 'source verified' }),
  }
  const flags = await drainerApprovalWith(failing)(sim([approval(UNVERIFIED, 1n)]), TX, CODE)

  assert.equal(flags.length, 1)
  assert.match(flags[0].detail, /could not be read/)
})

test('the detail names token, spender, owner, and amount, in words a reader can follow', async () => {
  const flags = await detect(sim([approval(EOA, MAX_UINT256)]), TX, CODE)

  assert.match(flags[0].detail, new RegExp(EOA))
  assert.match(flags[0].detail, new RegExp(TOKEN))
  assert.match(flags[0].detail, new RegExp(OWNER))
  assert.equal(flags[0].title, `unlimited allowance to ${EOA}`)
})

test('two bad approvals in one transaction are two findings', async () => {
  const flags = await detect(sim([approval(EOA, 1n), approval(UNVERIFIED, MAX_UINT256)]), TX, CODE)
  assert.equal(flags.length, 2)
})
