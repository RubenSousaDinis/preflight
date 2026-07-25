/**
 * D5d: the text records kept current in the background, after a grade lands.
 *
 * Modeled on `HcsReceiptMirror`, and for the same reason: nothing here may delay, block or fail a
 * publish. `submit` returns immediately and never throws, failures are counted rather than raised,
 * and a job that keeps failing is dropped so it cannot stall every later one. A cosmetic mirror that
 * can stall a verdict path would be a bug against the product thesis, not a rough edge.
 *
 * One thing diverges from the receipt mirror, and it matters. **The queue coalesces by agent, newest
 * wins.** Receipts are a log, where every entry has to arrive; text records are state, where only the
 * last write is visible. If an agent is regraded while an earlier sync is still queued, publishing
 * the earlier one afterwards would leave a superseded grade on the name: not a lag, a lie. So a
 * pending job for the same agent is replaced rather than followed, and a job that is older than the
 * one already queued is discarded.
 */

import { EnsMirrorError, reasonOf } from '../../shared/errors.ts'
import { gradeForScore } from '../../shared/grade.ts'
import { configuredTopicId } from '../../receipts/hcs-mirror.ts'
import type { Address, AgentId, ChainId, Hex } from '../../shared/types.ts'
import { ensTargetFromEnv, ensureSubname, writeRecords, type EnsTarget } from './client.ts'
import { buildTextRecords, type EnsKey } from './records.ts'

export interface EnsMirrorJob {
  agentId: AgentId
  records: Record<EnsKey, string>
  /**
   * The registry's `lastUpdate` for the grade this job carries, in unix seconds.
   *
   * It is the ordering, which is why it comes from the registry rather than from a local clock: two
   * jobs for one agent are compared on what the source says, not on which one reached the queue.
   */
  updatedAt: number
}

export interface EnsMirrorState {
  parent: string | null
  chainId: ChainId | null
  /** Written and read back. */
  mirrored: number
  pending: number
  /** Attempts that failed, counted rather than raised. */
  failed: number
  /** Jobs replaced by a newer grade for the same agent before they were sent. */
  superseded: number
  lastError: string | null
  lastTx: Hex | null
}

export class EnsTextMirror {
  readonly target: EnsTarget
  #queue: EnsMirrorJob[] = []
  #mirrored = 0
  #failed = 0
  #superseded = 0
  #lastError: string | null = null
  #lastTx: Hex | null = null
  #draining = false
  #closed = false
  #retryDelayMs: number
  #writeImpl: ((job: EnsMirrorJob) => Promise<Hex>) | null

  constructor(
    target: EnsTarget,
    options: {
      retryDelayMs?: number
      /** Injected writer, for tests. Defaults to the subname check plus one resolver multicall. */
      write?: (job: EnsMirrorJob) => Promise<Hex>
    } = {},
  ) {
    this.target = target
    this.#retryDelayMs = options.retryDelayMs ?? 2_000
    this.#writeImpl = options.write ?? null
  }

  /** Queues one agent's records. Returns immediately, and never throws. */
  submit(job: EnsMirrorJob): void {
    if (this.#closed) return
    const queued = this.#queue.findIndex((pending) => pending.agentId === job.agentId)
    if (queued >= 0) {
      if (this.#queue[queued].updatedAt > job.updatedAt) {
        // A newer grade for this agent is already waiting. Writing this one after it would put a
        // superseded grade on the name.
        this.#superseded += 1
        return
      }
      this.#queue[queued] = job
      this.#superseded += 1
    } else {
      this.#queue.push(job)
    }
    void this.#drain()
  }

  state(): EnsMirrorState {
    return {
      parent: this.target.parent,
      chainId: this.target.chainId,
      mirrored: this.#mirrored,
      pending: this.#queue.length,
      failed: this.#failed,
      superseded: this.#superseded,
      lastError: this.#lastError,
      lastTx: this.#lastTx,
    }
  }

  /** Waits for the queue to empty, for a verification step. Never used by a gate. */
  async flush(timeoutMs = 60_000): Promise<EnsMirrorState> {
    const deadline = Date.now() + timeoutMs
    while ((this.#queue.length > 0 || this.#draining) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return this.state()
  }

  close(): void {
    this.#closed = true
  }

  async #drain(): Promise<void> {
    if (this.#draining) return
    this.#draining = true
    try {
      while (this.#queue.length > 0 && !this.#closed) {
        const job = this.#queue[0]
        try {
          this.#lastTx = await this.#writeOne(job)
          // Only drop the head if it is still the job that was sent: a newer grade may have replaced
          // it while the transaction was in flight, and that one has not been written yet.
          if (this.#queue[0] === job) this.#queue.shift()
          this.#mirrored += 1
        } catch (err) {
          // Retried in the background and reported as a count. Never raised into the caller.
          this.#failed += 1
          this.#lastError = reasonOf(err)
          await new Promise((resolve) => setTimeout(resolve, this.#retryDelayMs))
          if (this.#failed % 5 === 0 && this.#queue[0] === job) {
            // Enough consecutive failures that draining forever would be its own problem: drop the
            // head so one unwritable agent cannot stall every other one.
            this.#queue.shift()
          }
        }
      }
    } finally {
      this.#draining = false
    }
  }

  async #writeOne(job: EnsMirrorJob): Promise<Hex> {
    if (this.#writeImpl !== null) return await this.#writeImpl(job)
    // Idempotent, and it costs a transaction only the first time an agent is mirrored. Without it a
    // freshly graded agent has no name to write records to.
    await ensureSubname(job.agentId, { target: this.target })
    const written = await writeRecords(job.agentId, job.records, { target: this.target })
    return written.txHash
  }
}

/** A mirror from the environment, or null when no ENS target is configured. */
export function ensMirrorFromEnv(options: { retryDelayMs?: number } = {}): EnsTextMirror | null {
  const target = ensTargetFromEnv()
  return target === null ? null : new EnsTextMirror(target, options)
}

export interface PublishedGrade {
  agentId: AgentId
  score: number
  /** The registry's own values, so the mirror copies rather than recomputes. */
  responseURI: string
  responseHash: Hex
  /** The methodology tag as the registry stored it. */
  tag: string
  lastUpdate: number
  registry: Address
  chainId: ChainId
}

export interface MirrorHookResult {
  /** Null when nothing was queued. */
  mirror: EnsTextMirror | null
  /** Why nothing was queued, when nothing was. Null when a job is on the queue. */
  skipped: string | null
}

/**
 * The one hook a publish calls, and the only call site the repo has.
 *
 * The `publish` command calls it after `publishValidation` has confirmed and read the record back,
 * which is what makes this a mirror: every value written here came from the registry read, none of
 * it from the grading run. Any future re-publish path invokes it exactly the same way, after its own
 * read back, and lets the mirror fail without failing the publish.
 *
 * It never throws. A misconfigured or absent target comes back as `skipped` with the reason, so a
 * caller can print it, and a caller that ignores the result has still lost nothing but a copy.
 */
export function mirrorAfterPublish(
  input: PublishedGrade & {
    receiptsHead?: Hex | null
    receiptsCount?: number | null
    mirror?: EnsTextMirror | null
  },
): MirrorHookResult {
  try {
    const grade = gradeForScore(input.score)
    if (grade === null) {
      // Off the 25-point scale, so it did not come from this methodology. The reader refuses such a
      // record, and mirroring it would put a letter on a name that no grade earns.
      throw new EnsMirrorError(
        `agent ${input.agentId} carries a record scored ${input.score}, which is not a value this methodology writes`,
      )
    }

    const mirror = input.mirror ?? ensMirrorFromEnv()
    if (mirror === null) return { mirror: null, skipped: 'no ENS target is configured' }

    mirror.submit({
      agentId: input.agentId,
      updatedAt: input.lastUpdate,
      records: buildTextRecords({
        agentId: input.agentId,
        grade,
        score: input.score,
        evidenceURI: input.responseURI,
        evidenceHash: input.responseHash,
        registry: input.registry,
        chainId: input.chainId,
        updatedAt: input.lastUpdate,
        methodology: input.tag,
        receiptsHead: input.receiptsHead ?? null,
        receiptsCount: input.receiptsCount ?? null,
        hcsTopic: configuredTopicId(),
      }),
    })
    return { mirror, skipped: null }
  } catch (err) {
    return { mirror: null, skipped: reasonOf(err) }
  }
}
