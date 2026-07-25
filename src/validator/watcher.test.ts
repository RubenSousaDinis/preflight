import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fingerprintToolDefs, METHODOLOGY_VERSION } from '@polygraphso/litmus'

import type { GradeResult, Hex } from '../shared/types.ts'
import { FIXTURE_GRADE_A, FIXTURE_GRADE_F } from '../shared/fixtures/index.ts'
import { toolsFor } from '../demo/tool-surface.ts'
import { AgentWatcher, describeFlip } from './watcher.ts'

const BASELINE = fingerprintToolDefs(
  toolsFor('baseline').map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
).fingerprint as Hex

const DRIFTED = fingerprintToolDefs(
  toolsFor('drifted').map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
).fingerprint as Hex

function scriptedWatcher(script: ({ declaredVersion: string | null; fingerprint: Hex } | Error)[], regrades: GradeResult[] = []) {
  let index = 0
  let regradeIndex = 0
  const changes: { result: GradeResult; kind: string | null }[] = []
  let clock = 1_785_060_000
  const watcher = new AgentWatcher('42', {
    now: () => (clock += 10),
    observe: async () => {
      const step = script[Math.min(index++, script.length - 1)]
      if (step instanceof Error) throw step
      return step
    },
    regrade: async () => regrades[Math.min(regradeIndex++, regrades.length - 1)] ?? FIXTURE_GRADE_F,
    onChange: (result, observation) => {
      changes.push({ result, kind: observation.changeKind })
    },
  })
  return { watcher, changes }
}

test('the first observation establishes a baseline rather than reporting a change', async () => {
  const { watcher, changes } = scriptedWatcher([{ declaredVersion: '1.0.0', fingerprint: BASELINE }])
  const first = await watcher.check()
  assert.equal(first.changed, false)
  assert.equal(first.changeKind, null)
  assert.equal(first.fingerprint, BASELINE)
  assert.deepEqual(changes, [])
})

test('a fingerprint that moves triggers a re-grade, with no version bump needed', async () => {
  const { watcher, changes } = scriptedWatcher(
    [
      { declaredVersion: '1.0.0', fingerprint: BASELINE },
      { declaredVersion: '1.0.0', fingerprint: DRIFTED },
    ],
    [FIXTURE_GRADE_F],
  )
  await watcher.check()
  const second = await watcher.check()

  assert.equal(second.changed, true)
  assert.equal(second.changeKind, 'fingerprint', 'the version never moved, and it still fired')
  assert.equal(changes.length, 1)
  assert.equal(changes[0].result.grade, 'F')
})

test('a declared version that moves triggers on its own', async () => {
  const { watcher, changes } = scriptedWatcher([
    { declaredVersion: '1.0.0', fingerprint: BASELINE },
    { declaredVersion: '1.1.0', fingerprint: BASELINE },
  ])
  await watcher.check()
  const second = await watcher.check()
  assert.equal(second.changeKind, 'version')
  assert.equal(changes.length, 1)
})

test('both moving at once is reported as both', async () => {
  const { watcher } = scriptedWatcher([
    { declaredVersion: '1.0.0', fingerprint: BASELINE },
    { declaredVersion: '2.0.0', fingerprint: DRIFTED },
  ])
  await watcher.check()
  assert.equal((await watcher.check()).changeKind, 'both')
})

test('a surface that goes back to what it was fires again, because that is also a change', async () => {
  const { watcher, changes } = scriptedWatcher([
    { declaredVersion: '1.0.0', fingerprint: BASELINE },
    { declaredVersion: '1.0.0', fingerprint: DRIFTED },
    { declaredVersion: '1.0.0', fingerprint: BASELINE },
  ])
  await watcher.check()
  await watcher.check()
  const third = await watcher.check()
  assert.equal(third.changed, true)
  assert.equal(changes.length, 2)
})

test('an unreadable target is a failed observation, never a quiet "no change"', async () => {
  const { watcher, changes } = scriptedWatcher([
    { declaredVersion: '1.0.0', fingerprint: BASELINE },
    new Error('connection closed'),
  ])
  await watcher.check()
  const failed = await watcher.check()

  assert.equal(failed.error, 'connection closed')
  assert.equal(failed.changed, false)
  assert.equal(failed.fingerprint, null)
  assert.equal(watcher.state().failures, 1)
  assert.equal(
    watcher.state().fingerprint,
    BASELINE,
    'the last known value stays put: an unreadable target is not evidence it is unchanged',
  )
  assert.deepEqual(changes, [], 'a failure does not trigger a re-grade')
})

test('a failure between two identical reads does not manufacture a change', async () => {
  const { watcher, changes } = scriptedWatcher([
    { declaredVersion: '1.0.0', fingerprint: BASELINE },
    new Error('rpc down'),
    { declaredVersion: '1.0.0', fingerprint: BASELINE },
  ])
  await watcher.check()
  await watcher.check()
  const third = await watcher.check()
  assert.equal(third.changed, false)
  assert.equal(watcher.state().failures, 0, 'the failure count clears once a read succeeds')
  assert.deepEqual(changes, [])
})

test('every observation is recorded with its timestamp, so the sequence reads back', async () => {
  const { watcher } = scriptedWatcher([
    { declaredVersion: '1.0.0', fingerprint: BASELINE },
    { declaredVersion: '1.0.0', fingerprint: DRIFTED },
  ])
  await watcher.check()
  await watcher.check()
  const observations = watcher.state().observations
  assert.equal(observations.length, 2)
  assert.ok(observations[1].at > observations[0].at)
  for (const observation of observations) {
    assert.equal(observation.agentId, '42')
    assert.equal(typeof observation.at, 'number')
  }
})

test('a re-grade that throws is recorded and does not stop the watcher', async () => {
  let clock = 1_785_060_000
  const watcher = new AgentWatcher('42', {
    now: () => (clock += 10),
    observe: async () => ({
      declaredVersion: null,
      fingerprint: clock > 1_785_060_010 ? DRIFTED : BASELINE,
    }),
    regrade: async () => {
      throw new Error('the engine timed out')
    },
  })
  await watcher.check()
  await watcher.check()
  const recorded = watcher.state().observations
  assert.ok(recorded.some((observation) => observation.error?.includes('the re-grade did not complete')))
  const next = await watcher.check()
  assert.equal(next.error, null, 'the watcher kept going')
})

test('the flip reads as a sentence, and an unchanged re-grade says so', () => {
  assert.equal(describeFlip('A', 'F'), 're-graded A to F')
  assert.equal(describeFlip('A', 'A'), 're-graded A, unchanged')
  assert.equal(describeFlip(null, 'B'), 'graded B')
})

test('the grade that lands is the engine s, not a diff of the old one', async () => {
  const { watcher, changes } = scriptedWatcher(
    [
      { declaredVersion: '1.0.0', fingerprint: BASELINE },
      { declaredVersion: '1.0.0', fingerprint: DRIFTED },
    ],
    [{ ...FIXTURE_GRADE_F, methodologyVersion: METHODOLOGY_VERSION }],
  )
  await watcher.check()
  await watcher.check()
  assert.equal(changes[0].result.grade, 'F')
  assert.equal(changes[0].result.score, 0)
  assert.equal(changes[0].result.methodologyVersion, METHODOLOGY_VERSION)
  assert.notEqual(changes[0].result.evidenceHash, FIXTURE_GRADE_A.evidenceHash)
})
