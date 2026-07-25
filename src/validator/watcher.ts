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
  /**
   * Set when any part of this observation failed. Never conflated with "nothing changed".
   *
   * The two channels fail independently, and so are recorded independently: a version read that fails
   * must not suppress a fingerprint that was read successfully and moved.
   */
  error: string | null
  fingerprintError: string | null
  versionError: string | null
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
  /** Injected observers, for tests. `observe` covers both channels; the others cover one each. */
  observe?: (agentId: AgentId) => Promise<{ declaredVersion: string | null; fingerprint: Hex }>
  observeFingerprint?: (agentId: AgentId) => Promise<Hex>
  observeVersion?: (agentId: AgentId) => Promise<string | null>
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
    let fingerprintError: string | null = null
    let versionError: string | null = null

    // The two channels are read separately and fail separately. Reading them under one try meant a
    // failed version read discarded a fingerprint that had been read successfully and had moved, which
    // is an error path swallowing a drift signal: the gate would keep hiring an agent whose surface it
    // had already seen change.
    if (this.#options.observe !== undefined) {
      try {
        const seen = await this.#options.observe(this.agentId)
        declaredVersion = seen.declaredVersion
        fingerprint = seen.fingerprint
      } catch (err) {
        fingerprintError = reasonOf(err)
        versionError = fingerprintError
      }
    } else {
      // The card is only needed by a channel that has no injected observer of its own.
      const needsCard =
        this.#options.observeFingerprint === undefined || this.#options.observeVersion === undefined
      let card: Awaited<ReturnType<typeof resolveAgent>> | null = null
      if (needsCard) {
        try {
          card = await resolveAgent(this.agentId, this.#options.resolve)
        } catch (err) {
          fingerprintError = reasonOf(err)
          versionError = fingerprintError
        }
      }

      if (card !== null || !needsCard) {
        try {
          fingerprint =
            this.#options.observeFingerprint !== undefined
              ? await this.#options.observeFingerprint(this.agentId)
              : await liveFingerprint(card!.mcpEndpoints)
        } catch (err) {
          fingerprintError = reasonOf(err)
        }

        try {
          if (this.#options.observeVersion !== undefined) {
            declaredVersion = await this.#options.observeVersion(this.agentId)
          } else {
            // The version the target asserts in its own handshake, which is a live fact rather than a
            // registry one. The card's declared version is the fallback for a target reporting none.
            const endpoint = card!.mcpEndpoints[0]
            if (endpoint !== undefined) {
              const session = await openWorker(endpoint)
              declaredVersion =
                session.serverVersion.length > 0 ? session.serverVersion : declaredVersionOf(card!.raw)
            } else {
              declaredVersion = declaredVersionOf(card!.raw)
            }
          }
        } catch (err) {
          versionError = reasonOf(err)
        }
      }
    }

    const error =
      fingerprintError !== null && versionError !== null && fingerprintError === versionError
        ? fingerprintError
        : [
            fingerprintError === null ? null : `fingerprint: ${fingerprintError}`,
            versionError === null ? null : `declared version: ${versionError}`,
          ]
            .filter((part) => part !== null)
            .join('; ') || null

    // Each comparison is gated on its own channel only. A channel with no prior reading cannot have
    // moved, and a channel that failed this time is left out rather than treated as unchanged.
    const versionMoved =
      versionError === null &&
      baseline.declaredVersion !== null &&
      baseline.declaredVersion !== declaredVersion
    const fingerprintMoved =
      fingerprintError === null &&
      baseline.fingerprint !== null &&
      baseline.fingerprint !== fingerprint
    const changed = versionMoved || fingerprintMoved

    const observation: Observation = {
      at,
      agentId: this.agentId,
      declaredVersion,
      fingerprint,
      error,
      fingerprintError,
      versionError,
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

    // A failed channel leaves its last known value alone: an unreadable channel is not evidence that it
    // is unchanged. A channel that read cleanly advances, even when the other one failed.
    const previous = this.state()
    if (fingerprintError === null) this.#state.fingerprint = fingerprint
    if (versionError === null) this.#state.declaredVersion = declaredVersion
    this.#state.failures = error === null ? 0 : this.#state.failures + 1

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
          fingerprintError,
          versionError,
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
