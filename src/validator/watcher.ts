/**
 * A5: watching a graded agent for a change worth re-grading.
 *
 * Polling, not subscribing. A subscription that quietly drops on stage is indistinguishable from
 * nothing happening, while a poll that fires visibly every N seconds is legible from the back of the
 * room. Every observation is recorded with its timestamp, so the sequence can be read back afterwards
 * rather than reconstructed from memory.
 *
 * Two triggers, either one alone: the version the agent declares about itself, and the fingerprint of
 * its tool surface. An agent that changes behavior without bumping its version is the interesting case,
 * and a version-only watcher is exactly what that defeats.
 *
 * A failed check is reported as a failed check. It must never render as "no change", because silence
 * that reads as reassurance is the failure this project exists to name.
 */

import { reasonOf } from '../shared/errors.ts'
import type { AgentId, Grade, GradeResult, Hex } from '../shared/types.ts'
import { liveFingerprint } from '../gates/vet/live-fingerprint.ts'
import { openWorker } from '../demo/mcp-call.ts'
import { resolveAgent, type ResolveAgentOptions } from './resolve-agent.ts'
import { gradeAgent, type GradeAgentOptions } from './grade-agent.ts'

export interface Observation {
  at: number
  agentId: AgentId
  /** What the agent says about itself, when its card declares it. */
  declaredVersion: string | null
  /** The live tool-surface fingerprint, or null when it could not be read. */
  fingerprint: Hex | null
  /** Set when this observation could not complete. Never conflated with "nothing changed". */
  error: string | null
  changed: boolean
  changeKind: 'version' | 'fingerprint' | 'both' | null
}

export interface WatchState {
  observations: Observation[]
  declaredVersion: string | null
  fingerprint: Hex | null
  /** Consecutive failed observations, so the screen can say "could not check" rather than "no change". */
  failures: number
}

function declaredVersionOf(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  for (const key of ['version', 'agentVersion', 'revision']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

export interface WatchOptions {
  intervalMs?: number
  resolve?: ResolveAgentOptions
  grade?: GradeAgentOptions
  /** Injected observers, for tests. */
  observe?: (agentId: AgentId) => Promise<{ declaredVersion: string | null; fingerprint: Hex }>
  regrade?: (agentId: AgentId) => Promise<GradeResult>
  onObservation?: (observation: Observation) => void
  /** Called once per detected change, with the fresh grade. Publishing is the operator's step. */
  onChange?: (result: GradeResult, observation: Observation, previous: WatchState) => void | Promise<void>
  now?: () => number
}

export class AgentWatcher {
  readonly agentId: AgentId
  #state: WatchState = { observations: [], declaredVersion: null, fingerprint: null, failures: 0 }
  #options: WatchOptions
  #timer: ReturnType<typeof setInterval> | null = null
  #running = false

  constructor(agentId: AgentId, options: WatchOptions = {}) {
    this.agentId = agentId
    this.#options = options
  }

  state(): WatchState {
    return {
      observations: [...this.#state.observations],
      declaredVersion: this.#state.declaredVersion,
      fingerprint: this.#state.fingerprint,
      failures: this.#state.failures,
    }
  }

  /** One poll. Returns the observation it recorded, and never throws. */
  async check(): Promise<Observation> {
    const now = this.#options.now ?? (() => Math.floor(Date.now() / 1000))
    const at = now()
    const baseline = { declaredVersion: this.#state.declaredVersion, fingerprint: this.#state.fingerprint }

    let declaredVersion: string | null = null
    let fingerprint: Hex | null = null
    let error: string | null = null
    try {
      if (this.#options.observe !== undefined) {
        const seen = await this.#options.observe(this.agentId)
        declaredVersion = seen.declaredVersion
        fingerprint = seen.fingerprint
      } else {
        const card = await resolveAgent(this.agentId, this.#options.resolve)
        fingerprint = await liveFingerprint(card.mcpEndpoints)
        // The version the target asserts in its own handshake, which is a live fact rather than a
        // registry one. The card's declared version is the fallback for a target that reports none.
        const endpoint = card.mcpEndpoints[0]
        if (endpoint !== undefined) {
          const session = await openWorker(endpoint)
          declaredVersion = session.serverVersion.length > 0 ? session.serverVersion : declaredVersionOf(card.raw)
        } else {
          declaredVersion = declaredVersionOf(card.raw)
        }
      }
    } catch (err) {
      error = reasonOf(err)
    }

    const first = baseline.fingerprint === null && baseline.declaredVersion === null
    const versionMoved =
      error === null && !first && baseline.declaredVersion !== declaredVersion
    const fingerprintMoved =
      error === null && baseline.fingerprint !== null && baseline.fingerprint !== fingerprint
    const changed = versionMoved || fingerprintMoved

    const observation: Observation = {
      at,
      agentId: this.agentId,
      declaredVersion,
      fingerprint,
      error,
      changed,
      changeKind: changed
        ? versionMoved && fingerprintMoved
          ? 'both'
          : versionMoved
            ? 'version'
            : 'fingerprint'
        : null,
    }

    this.#state.observations.push(observation)
    this.#options.onObservation?.(observation)

    if (error !== null) {
      // The last known values stay put. An unreadable target is not evidence that it is unchanged.
      this.#state.failures += 1
      return observation
    }
    this.#state.failures = 0

    const previous = this.state()
    this.#state.declaredVersion = declaredVersion
    this.#state.fingerprint = fingerprint

    if (changed) {
      try {
        // A full re-grade, never a diff. A diff-based re-grade is a second grading path, and therefore a
        // second answer to one question.
        const result =
          this.#options.regrade !== undefined
            ? await this.#options.regrade(this.agentId)
            : await gradeAgent(
                await resolveAgent(this.agentId, this.#options.resolve),
                this.#options.grade,
              )
        await this.#options.onChange?.(result, observation, previous)
      } catch (err) {
        this.#state.observations.push({
          ...observation,
          at: now(),
          error: `the re-grade did not complete: ${reasonOf(err)}`,
          changed: false,
          changeKind: null,
        })
      }
    }

    return observation
  }

  /** Starts polling. The first check runs immediately, so a watcher never looks idle for an interval. */
  start(): void {
    if (this.#running) return
    this.#running = true
    const interval = this.#options.intervalMs ?? 10_000
    void this.check()
    this.#timer = setInterval(() => void this.check(), interval)
  }

  stop(): void {
    this.#running = false
    if (this.#timer !== null) clearInterval(this.#timer)
    this.#timer = null
  }
}

/** A one-line summary of a grade flip, for the screen and for the log. */
export function describeFlip(before: Grade | null, after: Grade): string {
  return before === null
    ? `graded ${after}`
    : before === after
      ? `re-graded ${after}, unchanged`
      : `re-graded ${before} to ${after}`
}
