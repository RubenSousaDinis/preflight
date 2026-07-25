/**
 * E2: the client-agent loop that drives beat 1.
 *
 * An agent shops for a worker, hires the one the gate allows, pays for a call, gets an answer, and stops
 * when that answer turns on it. What it returns is a stream of events, not a summary: the transcript the
 * UI renders is this stream, so there is no version of the run the screen and the loop could disagree
 * about.
 *
 * Three rules are enforced here rather than trusted to ordering:
 *
 * - **Every event carries its justification.** A `vetted` without its GateDecision, or a `paid` without
 *   its Receipt, is narration.
 * - **A refusal is not a downgrade.** The loop hires the best-graded candidate the gate allows and never
 *   substitutes a worse one after a refusal. An agent that quietly downgrades converts a refusal into a
 *   delay, which is the failure the gate exists to prevent.
 * - **`frozen` is terminal for spending.** The flag is checked before any payment, so no later event can
 *   move value. Beat 1 asserts this, so it is a condition in the loop and not a property of the order
 *   things happen to be written in.
 *
 * The worker is re-vetted before every call, not only at hire time. That is what makes beat 4 the same
 * loop: a worker hired minutes ago is refused on the next call when its surface has moved.
 */

import { reasonOf } from '../shared/errors.ts'
import { gradeRank } from '../shared/grade.ts'
import type { AgentId, GateDecision, GatePolicy, HarnessEvent, JsonValue, TaskSpec } from '../shared/types.ts'
import { ReceiptChain } from '../receipts/receipt-chain.ts'
import { DEFAULT_POLICY, vetAgent, type VetAgentOptions } from '../gates/vet/vet-agent.ts'
import { resolveAgent } from '../validator/resolve-agent.ts'
import { checkToolOutput, textOfToolResult } from './output-check.ts'
import { openWorker, type WorkerSession } from './mcp-call.ts'
import { Budget } from './budget.ts'
import { stubbedRail, type PaymentRail } from './payment-rail.ts'

export interface PaymentResult {
  /** Identifier on the payment rail, for the receipt panel. */
  txRef: string
  /**
   * True while the rail is not wired.
   *
   * A stubbed payment is labelled, never omitted: a stream missing its payment events reads as if
   * payment never happened, and an unlabelled stub in a beat whose claim is real money is the one
   * shortcut that would not survive a question.
   */
  stubbed: boolean
}

export interface RunTaskOptions {
  policy?: GatePolicy
  /** Per-call fee, in the rail's smallest unit. */
  fee?: bigint
  /** How many calls a clean run makes. One keeps the arithmetic on screen legible. */
  calls?: number
  receipts?: ReceiptChain
  vet?: (agentId: AgentId, policy: GatePolicy) => Promise<GateDecision>
  vetOptions?: VetAgentOptions
  endpointsOf?: (agentId: AgentId) => Promise<string[]>
  openWorkerImpl?: (endpoint: string) => Promise<WorkerSession>
  /**
   * The rail that settles a call fee. Defaults to the labelled stub.
   *
   * B3 passes a real one, and `stubbed` turns false in the event and in the receipt subject.
   */
  rail?: PaymentRail
  /** The account or resource the fee is paid to, which the rail interprets. */
  payTo?: string
  pay?: (agentId: AgentId, amount: bigint) => Promise<PaymentResult>
  toolName?: string
  callTimeoutMs?: number
  now?: () => number
}

export const DEFAULT_FEE = 100_000_000n

async function refusalFor(err: unknown, agentId: AgentId): Promise<GateDecision> {
  // A gate error is a refusal per §4, not a crash of the loop: the run moves to the next candidate.
  return {
    verdict: 'REFUSE',
    reason: `the gate could not reach a verdict for agent ${agentId}: ${reasonOf(err)}`,
    grade: null,
    score: null,
    fingerprintMatch: null,
    record: null,
  }
}

export async function* runTask(
  spec: TaskSpec,
  options: RunTaskOptions = {},
): AsyncIterable<HarnessEvent> {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000))
  const policy = options.policy ?? DEFAULT_POLICY
  const fee = options.fee ?? DEFAULT_FEE
  const calls = options.calls ?? 1
  // A fresh chain per run: a second rehearsal continuing the first chain makes the numbers on screen
  // wrong.
  const receipts = options.receipts ?? new ReceiptChain()
  const vet =
    options.vet ?? ((agentId: AgentId, p: GatePolicy) => vetAgent(agentId, p, options.vetOptions))
  const endpointsOf =
    options.endpointsOf ?? (async (agentId: AgentId) => (await resolveAgent(agentId)).mcpEndpoints)
  const open = options.openWorkerImpl ?? ((endpoint: string) => openWorker(endpoint, options.callTimeoutMs))
  const rail = options.rail ?? stubbedRail
  const pay =
    options.pay ??
    (async (agentId: AgentId, amount: bigint): Promise<PaymentResult> => {
      const settled = await rail.pay({
        to: options.payTo ?? agentId,
        amount,
        resource: options.payTo,
      })
      return { txRef: settled.txRef, stubbed: settled.stubbed }
    })

  // The budget owns the arithmetic and the freeze. Once frozen it refuses every further spend, so the
  // rule is a property of the object rather than of the order the loop happens to check things in.
  const budget = new Budget(spec.budget)
  let frozen = false
  const hired: AgentId[] = []
  const refused: AgentId[] = []

  const emitDecision = async (decision: GateDecision) => receipts.emit(decision)

  yield {
    type: 'shopping',
    at: now(),
    candidates: [...spec.candidates],
    task: spec.task,
    budget: spec.budget.toString(),
  }

  // --- shop -----------------------------------------------------------------
  const allowed: { agentId: AgentId; decision: GateDecision }[] = []
  for (const agentId of spec.candidates) {
    let decision: GateDecision
    try {
      decision = await vet(agentId, policy)
    } catch (err) {
      decision = await refusalFor(err, agentId)
    }
    yield { type: 'vetted', at: now(), agentId, decision, receipt: await emitDecision(decision) }
    if (decision.verdict === 'HIRE') allowed.push({ agentId, decision })
    else refused.push(agentId)
  }

  const done = async (reason: 'nothing-hired' | 'complete'): Promise<HarnessEvent> => ({
    type: 'done',
    at: now(),
    hired: [...hired],
    refused: [...refused],
    spent: budget.spent.toString(),
    budget: spec.budget.toString(),
    receiptCount: receipts.length,
    ...(reason === 'nothing-hired' ? {} : {}),
  })

  if (allowed.length === 0) {
    // A correct outcome, not an error. It is also what beat 1 looks like when every candidate is bad.
    yield await done('nothing-hired')
    return
  }

  // The best letter wins, ties by the order the caller listed them. Never a worse grade after a refusal.
  const chosen = allowed.reduce((best, candidate) =>
    gradeRank(candidate.decision.grade ?? 'F') < gradeRank(best.decision.grade ?? 'F') ? candidate : best,
  )
  hired.push(chosen.agentId)
  yield { type: 'hired', at: now(), agentId: chosen.agentId, decision: chosen.decision }

  // --- work -----------------------------------------------------------------
  let session: WorkerSession | null = null
  for (let call = 1; call <= calls && !frozen; call += 1) {
    if (call > 1) {
      // Re-vet before every call. A worker hired a minute ago can have moved since.
      let recheck: GateDecision
      try {
        recheck = await vet(chosen.agentId, policy)
      } catch (err) {
        recheck = await refusalFor(err, chosen.agentId)
      }
      yield {
        type: 'vetted',
        at: now(),
        agentId: chosen.agentId,
        decision: recheck,
        receipt: await emitDecision(recheck),
      }
      if (recheck.verdict !== 'HIRE') {
        frozen = true
        budget.freeze(`the worker was refused on recheck: ${recheck.reason}`)
        const receipt = await receipts.emitSubject({
          kind: 'freeze',
          reason: recheck.reason,
          spent: budget.spent.toString(),
        } satisfies JsonValue)
        yield {
          type: 'frozen',
          at: now(),
          reason: `the worker was refused on recheck: ${recheck.reason}`,
          spentSoFar: budget.spent.toString(),
          remaining: budget.remaining.toString(),
          receipt,
        }
        break
      }
    }

    if (!budget.canSpend(fee)) {
      frozen = true
      budget.freeze('the next call would exceed the budget')
      const receipt = await receipts.emitSubject({
        kind: 'freeze',
        reason: 'the next call would exceed the budget',
        spent: budget.spent.toString(),
      } satisfies JsonValue)
      yield {
        type: 'frozen',
        at: now(),
        reason: 'the next call would exceed the budget, so nothing further was spent',
        spentSoFar: budget.spent.toString(),
        remaining: budget.remaining.toString(),
        receipt,
      }
      break
    }

    // --- pay, then call ----------------------------------------------------
    let payment: PaymentResult
    try {
      payment = await pay(chosen.agentId, fee)
    } catch (err) {
      frozen = true
      budget.freeze(`the payment did not settle: ${reasonOf(err)}`)
      const receipt = await receipts.emitSubject({
        kind: 'freeze',
        reason: `the payment did not settle: ${reasonOf(err)}`,
        spent: budget.spent.toString(),
      } satisfies JsonValue)
      yield {
        type: 'frozen',
        at: now(),
        reason: `the payment did not settle, so the call was not made: ${reasonOf(err)}`,
        spentSoFar: budget.spent.toString(),
        remaining: budget.remaining.toString(),
        receipt,
      }
      break
    }
    budget.spend(fee)
    const paidReceipt = await receipts.emitSubject({
      kind: 'payment',
      agentId: chosen.agentId,
      amount: fee.toString(),
      rail: rail.name,
      txRef: payment.txRef,
      stubbed: payment.stubbed,
    } satisfies JsonValue)
    yield {
      type: 'paid',
      at: now(),
      agentId: chosen.agentId,
      amount: fee.toString(),
      rail: rail.name,
      txRef: payment.stubbed ? `${payment.txRef} (stubbed, the rail is not wired)` : payment.txRef,
      receipt: paidReceipt,
    }

    let result: unknown
    try {
      if (session === null) {
        const endpoints = await endpointsOf(chosen.agentId)
        const endpoint = endpoints[0]
        if (endpoint === undefined) throw new Error('the worker declares no endpoint to call')
        session = await open(endpoint)
      }
      const tool = options.toolName ?? session.tools[0]?.name
      if (tool === undefined) throw new Error('the worker offers no tool to call')
      result = await session.callTool(tool, { ids: spec.task } as JsonValue)
    } catch (err) {
      // A worker that hangs or fails ends the run frozen, never in done with work completed.
      frozen = true
      budget.freeze(`the worker did not answer: ${reasonOf(err)}`)
      const receipt = await receipts.emitSubject({
        kind: 'freeze',
        reason: `the worker did not answer: ${reasonOf(err)}`,
        spent: budget.spent.toString(),
      } satisfies JsonValue)
      yield {
        type: 'frozen',
        at: now(),
        reason: `the worker did not answer, so the run stopped: ${reasonOf(err)}`,
        spentSoFar: budget.spent.toString(),
        remaining: budget.remaining.toString(),
        receipt,
      }
      break
    }

    const text = textOfToolResult(result)
    yield { type: 'toolOutput', at: now(), agentId: chosen.agentId, output: text }

    // --- check what came back ----------------------------------------------
    const checked = checkToolOutput(text)
    if (checked.hostile) {
      const caughtReceipt = await receipts.emitSubject({
        kind: 'injection',
        agentId: chosen.agentId,
        detail: checked.detail,
        findings: checked.findings.map((finding) => ({
          kind: finding.kind,
          severity: finding.severity,
          match: finding.match ?? null,
        })) as JsonValue,
      } satisfies JsonValue)
      yield {
        type: 'injectionCaught',
        at: now(),
        agentId: chosen.agentId,
        detail: checked.detail,
        receipt: caughtReceipt,
      }

      frozen = true
      budget.freeze('the worker turned on the caller')
      const frozenReceipt = await receipts.emitSubject({
        kind: 'freeze',
        reason: 'the worker turned on the caller, so the budget was frozen',
        spent: budget.spent.toString(),
      } satisfies JsonValue)
      yield {
        type: 'frozen',
        at: now(),
        // One honest call ran and was paid for. What is saved is the budget and every call after this.
        reason: 'the budget was frozen after the hostile turn; the one call already made was paid for',
        spentSoFar: budget.spent.toString(),
        remaining: budget.remaining.toString(),
        receipt: frozenReceipt,
      }
      break
    }
  }

  yield await done('complete')
}
