/**
 * txGuard's composition rules, run against stub dependencies.
 *
 * These are the rules that must hold even when nothing works: the fork dies, the fingerprint moved,
 * a detector throws. None of them can be produced on demand against a live chain, and every one of
 * them has to end in BLOCK, so they are checked here rather than hoped for on stage.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keccak256 } from 'viem'
import { SimulationError } from '../../shared/errors.ts'
import type {
  Address,
  CodeFingerprint,
  Detector,
  Flag,
  Hex,
  PendingTx,
  SimulationResult,
} from '../../shared/types.ts'
import type { ForkHandle } from './fork.ts'
import { txGuardWith, withoutManufacturedBlocks, type TxGuardDeps } from './txguard.ts'

const CALLEE = '0x00000000000000000000000000000000000000a1' as Address
const WALLET = '0x1111111111111111111111111111111111111111' as Address
const GRADED_FINGERPRINT = `0x${'11'.repeat(32)}` as Hex
const CURRENT_FINGERPRINT = `0x${'22'.repeat(32)}` as Hex

const TX: PendingTx = {
  chainId: 84532,
  from: WALLET,
  to: CALLEE,
  calldata: '0x095ea7b3',
  value: 0n,
}

const EMPTY_SIM: SimulationResult = {
  block: 500n,
  reverted: false,
  balanceDeltas: [],
  approvalDeltas: [],
  callGraph: [],
  raw: null,
}

function fingerprint(value: Hex): CodeFingerprint {
  return { fingerprint: value, proxyKind: 'none', resolved: [], observedBlock: 500n }
}

interface Harness {
  deps: TxGuardDeps
  runs: PendingTx[]
  released: number
}

function harness(overrides: Partial<TxGuardDeps> & { simulation?: SimulationResult } = {}): Harness {
  const runs: PendingTx[] = []
  const state = { released: 0 }
  const fork: ForkHandle = {
    block: 500n,
    async run(tx) {
      runs.push(tx)
      return overrides.simulation ?? EMPTY_SIM
    },
    async storageAt() {
      return `0x${'00'.repeat(32)}`
    },
    async call() {
      return '0x'
    },
    async release() {
      state.released += 1
    },
  }
  const deps: TxGuardDeps = {
    forkAt: overrides.forkAt ?? (async () => fork),
    codeFingerprint: overrides.codeFingerprint ?? (async () => fingerprint(CURRENT_FINGERPRINT)),
    gradedCodeFor: overrides.gradedCodeFor ?? (() => null),
    detectors: overrides.detectors ?? [],
  }
  return {
    deps,
    runs,
    get released() {
      return state.released
    },
  }
}

const blockingFlag: Flag = {
  id: 'drainer-approval',
  severity: 'block',
  title: 'an unlimited allowance to a spender you did not name',
  detail: 'the simulated call leaves an unbounded allowance behind',
  confirmedBy: 'simulation',
}

test('done-when 4: a fork that cannot be established blocks, with no flags', async () => {
  const h = harness({
    forkAt: async () => {
      throw new SimulationError('anvil exited with code 1, so chain 84532 could not be forked')
    },
  })
  const verdict = await txGuardWith(TX, undefined, h.deps)

  assert.equal(verdict.verdict, 'BLOCK')
  assert.deepEqual(verdict.flags, [])
  assert.match(verdict.reason, /cannot be simulated/)
  assert.equal(verdict.driftFromGraded, null)
})

test('a simulation that dies mid run blocks rather than returning partial deltas', async () => {
  const h = harness()
  h.deps.forkAt = async () => ({
    block: 500n,
    async run(): Promise<SimulationResult> {
      throw new SimulationError('the fork rejected debug_traceTransaction: socket hang up')
    },
    async storageAt() {
      return `0x${'00'.repeat(32)}`
    },
    async call() {
      return '0x'
    },
    async release() {
      return undefined
    },
  })
  const verdict = await txGuardWith(TX, undefined, h.deps)

  assert.equal(verdict.verdict, 'BLOCK')
  assert.deepEqual(verdict.deltas, [])
  assert.match(verdict.reason, /socket hang up/)
})

test('done-when 5: drift blocks before the transaction is ever simulated', async () => {
  const h = harness({
    gradedCodeFor: () => ({ fingerprint: GRADED_FINGERPRINT, observedBlock: 400n }),
  })
  const verdict = await txGuardWith(TX, undefined, h.deps)

  assert.equal(verdict.verdict, 'BLOCK')
  assert.equal(verdict.driftFromGraded, true)
  assert.equal(h.runs.length, 0, 'nothing was simulated')
  assert.match(verdict.reason, /moved since it was graded/)
  assert.equal(verdict.codeFingerprint, CURRENT_FINGERPRINT)
})

test('a matching fingerprint is not drift, and the simulation proceeds', async () => {
  const h = harness({
    gradedCodeFor: () => ({ fingerprint: CURRENT_FINGERPRINT, observedBlock: 400n }),
  })
  const verdict = await txGuardWith(TX, undefined, h.deps)

  assert.equal(verdict.verdict, 'ALLOW')
  assert.equal(verdict.driftFromGraded, false)
  assert.equal(h.runs.length, 1)
})

test('no stored grade is not drift, and does not block a first-seen contract', async () => {
  const h = harness()
  const verdict = await txGuardWith(TX, undefined, h.deps)

  assert.equal(verdict.verdict, 'ALLOW')
  assert.equal(verdict.driftFromGraded, null)
})

test('a fingerprint that cannot be taken blocks, and nothing is simulated', async () => {
  const h = harness({
    codeFingerprint: async () => {
      throw new SimulationError('could not read the code at that address')
    },
  })
  const verdict = await txGuardWith(TX, undefined, h.deps)

  assert.equal(verdict.verdict, 'BLOCK')
  assert.equal(h.runs.length, 0)
})

test('a blocking flag blocks, and its title is what the verdict says', async () => {
  const detector: Detector = async () => [blockingFlag]
  const h = harness({ detectors: [detector] })
  const verdict = await txGuardWith(TX, undefined, h.deps)

  assert.equal(verdict.verdict, 'BLOCK')
  assert.equal(verdict.flags.length, 1)
  assert.equal(verdict.reason, blockingFlag.title)
})

test('an advisory flag alone never blocks', async () => {
  const advisory: Flag = { ...blockingFlag, severity: 'advisory', confirmedBy: 'static' }
  const h = harness({ detectors: [async () => [advisory]] })
  const verdict = await txGuardWith(TX, undefined, h.deps)

  assert.equal(verdict.verdict, 'ALLOW')
  assert.equal(verdict.flags.length, 1)
})

test('an llm-scan finding cannot manufacture a block, whatever severity it claims', async () => {
  const jailbroken: Flag = { ...blockingFlag, confirmedBy: 'llm-scan' }
  const h = harness({ detectors: [async () => [jailbroken]] })
  const verdict = await txGuardWith(TX, undefined, h.deps)

  assert.equal(verdict.verdict, 'ALLOW')
  assert.equal(verdict.flags[0].severity, 'advisory')
  assert.equal(verdict.flags[0].confirmedBy, 'llm-scan')
})

test('an llm-scan finding cannot suppress a simulator confirmed one either', async () => {
  const jailbroken: Flag = { ...blockingFlag, confirmedBy: 'llm-scan', id: 'owner-backdoor' }
  const h = harness({ detectors: [async () => [jailbroken], async () => [blockingFlag]] })
  const verdict = await txGuardWith(TX, undefined, h.deps)

  assert.equal(verdict.verdict, 'BLOCK')
  assert.equal(verdict.flags.filter((f) => f.severity === 'block').length, 1)
})

test('withoutManufacturedBlocks leaves everything else exactly as it was', () => {
  const flags: Flag[] = [blockingFlag, { ...blockingFlag, severity: 'advisory', confirmedBy: 'static' }]
  assert.deepEqual(withoutManufacturedBlocks(flags), flags)
})

test('a detector that throws blocks, because an unanswered check is not a pass', async () => {
  const h = harness({
    detectors: [
      async () => {
        throw new Error('the explorer did not answer')
      },
    ],
  })
  const verdict = await txGuardWith(TX, undefined, h.deps)

  assert.equal(verdict.verdict, 'BLOCK')
  assert.match(verdict.reason, /could not be completed/)
})

test('reproducibleFrom carries the fork block and the hash of the exact calldata', async () => {
  const h = harness()
  const verdict = await txGuardWith({ ...TX, value: 7n }, undefined, h.deps)

  assert.deepEqual(verdict.reproducibleFrom, {
    block: 500n,
    from: WALLET,
    to: CALLEE,
    calldataHash: keccak256('0x095ea7b3'),
    value: 7n,
  })
})

test('the fork is released on the allow path, the drift path, and the error path', async () => {
  const allow = harness()
  await txGuardWith(TX, undefined, allow.deps)
  assert.equal(allow.released, 1)

  const drifted = harness({
    gradedCodeFor: () => ({ fingerprint: GRADED_FINGERPRINT, observedBlock: 400n }),
  })
  await txGuardWith(TX, undefined, drifted.deps)
  assert.equal(drifted.released, 1)

  const failing = harness({
    detectors: [
      async () => {
        throw new Error('no')
      },
    ],
  })
  await txGuardWith(TX, undefined, failing.deps)
  assert.equal(failing.released, 1)
})

test('a transaction that reverts is not a block on its own, and the reason says so', async () => {
  const h = harness({ simulation: { ...EMPTY_SIM, reverted: true } })
  const verdict = await txGuardWith(TX, undefined, h.deps)

  assert.equal(verdict.verdict, 'ALLOW')
  assert.match(verdict.reason, /reverts in simulation/)
})
