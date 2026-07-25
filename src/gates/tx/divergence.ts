/**
 * B8: the post-transaction divergence check.
 *
 * After an ALLOW lands, what actually happened is compared against what was predicted, and both
 * columns are shown. This is reporting, never a gate: the transaction has landed, there is nothing
 * left to block, and implying otherwise would misdescribe what this does. It writes nothing back
 * into the receipt chain either, because amending a landed decision after the fact breaks the chain
 * and the claim the chain carries.
 *
 * **A mismatch is the disclosed limit demonstrating itself.** A verdict is reproducible for a given
 * block and state, not a prediction of the landed outcome, and state moves between the fork block
 * and the landed block. So a difference here is a finding rather than a failure, and it is written
 * as one. There is no tolerance band: a band that hides small drift hides exactly the honesty this
 * exists to show.
 *
 * Signature note: `01-INTERFACES.md` section 11 spells this `divergence(tuple, landedReceipt)`, but
 * the frozen `Divergence` shape requires `simulated`, and neither the tuple (which carries a hash of
 * the calldata, not the calldata) nor the receipt carries it. The simulated deltas are therefore an
 * explicit argument rather than something re-derived, which would mean simulating at a different
 * block and comparing against a third answer.
 */

import { getAddress, keccak256 } from 'viem'
import type { Address, BalanceDelta, Divergence, Hex, TxTuple } from '../../shared/types.ts'
import { TRANSFER_TOPIC } from './trace.ts'

/**
 * What landed, as read off the chain.
 *
 * `unknown` in and validated here, per section 11's own typing: the caller may hand this straight
 * from a viem receipt plus its transaction, and a shape this code cannot read is reported as not
 * compared rather than assumed to agree.
 */
export interface LandedTransaction {
  hash: Hex
  from: Address
  to: Address | null
  value: bigint
  /** The calldata as sent, so identity is checked on bytes rather than on trust. */
  input: Hex
  status: 'success' | 'reverted'
  blockNumber: bigint
  logs: { address: Hex; topics: Hex[]; data: Hex }[]
}

function notCompared(simulated: BalanceDelta[], notes: string): Divergence {
  // Never render an uncompared state as a match. An empty comparison that looks green is the worst
  // output this can produce.
  return { matched: false, simulated, landed: [], notes }
}

/** Sorted, zero entries dropped, so the comparison is on values rather than on collection order. */
export function normalize(deltas: BalanceDelta[]): BalanceDelta[] {
  const totals = new Map<string, BalanceDelta>()
  for (const delta of deltas) {
    if (delta.delta === 0n) continue
    const token = delta.token === 'native' ? 'native' : getAddress(delta.token)
    const owner = getAddress(delta.owner)
    const key = `${token}:${owner}`
    const existing = totals.get(key)
    if (existing === undefined) totals.set(key, { token, owner, delta: delta.delta })
    else existing.delta += delta.delta
  }
  return [...totals.values()]
    .filter((entry) => entry.delta !== 0n)
    .sort((a, b) => `${a.token}:${a.owner}`.localeCompare(`${b.token}:${b.owner}`))
}

function readLanded(value: unknown): LandedTransaction | null {
  if (value === null || typeof value !== 'object') return null
  const landed = value as Partial<LandedTransaction>
  if (typeof landed.input !== 'string' || typeof landed.from !== 'string') return null
  if (typeof landed.value !== 'bigint' || !Array.isArray(landed.logs)) return null
  if (landed.status !== 'success' && landed.status !== 'reverted') return null
  return landed as LandedTransaction
}

/**
 * Balance movement the landed transaction actually caused.
 *
 * Token movement comes from `Transfer` logs and native movement from the value sent. Gas is
 * deliberately excluded, because the simulated side never included it: the fork runs at a zero gas
 * price precisely so a delta on screen is value the transaction moved rather than the cost of
 * running it. Comparing like with like is the point; the exclusion is stated in the notes.
 */
export function landedDeltas(landed: LandedTransaction): BalanceDelta[] {
  const deltas: BalanceDelta[] = []

  if (landed.value > 0n && landed.to !== null) {
    deltas.push({ token: 'native', owner: getAddress(landed.from), delta: -landed.value })
    deltas.push({ token: 'native', owner: getAddress(landed.to), delta: landed.value })
  }

  for (const log of landed.logs) {
    if (log.topics.length !== 3) continue
    if (log.topics[0].toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) continue
    const token = getAddress(log.address)
    const from = getAddress(`0x${log.topics[1].slice(-40)}`)
    const to = getAddress(`0x${log.topics[2].slice(-40)}`)
    const amount = log.data === '0x' ? 0n : BigInt(log.data)
    deltas.push({ token, owner: from, delta: -amount })
    deltas.push({ token, owner: to, delta: amount })
  }

  return normalize(deltas)
}

function describe(delta: BalanceDelta): string {
  const asset = delta.token === 'native' ? 'native' : delta.token
  return `${delta.owner} ${asset}`
}

/**
 * Compare what landed against what was predicted.
 *
 * Identity is checked first. Comparing deltas across two different transactions produces a mismatch
 * with a meaningless explanation, so a transaction that is not the one the verdict was about stops
 * the comparison and says which field disagreed.
 */
export async function divergence(
  tuple: TxTuple,
  simulated: BalanceDelta[],
  landedReceipt: unknown,
): Promise<Divergence> {
  const predicted = normalize(simulated)

  if (landedReceipt === null || landedReceipt === undefined) {
    return notCompared(predicted, 'Not compared: this transaction has not landed yet.')
  }

  const landed = readLanded(landedReceipt)
  if (landed === null) {
    return notCompared(
      predicted,
      'Not compared: the landed transaction could not be read, so nothing was checked. This is not agreement.',
    )
  }

  const calldataHash = keccak256(landed.input)
  const identity: string[] = []
  if (calldataHash.toLowerCase() !== tuple.calldataHash.toLowerCase()) {
    identity.push('the calldata')
  }
  if (getAddress(landed.from) !== getAddress(tuple.from)) identity.push('the sender')
  if (landed.to !== null && getAddress(landed.to) !== getAddress(tuple.to)) {
    identity.push('the callee')
  }
  if (landed.value !== tuple.value) identity.push('the value')

  if (identity.length > 0) {
    return notCompared(
      predicted,
      `This is a different transaction from the one that was checked: ${identity.join(', ')} ${identity.length === 1 ? 'does' : 'do'} not match the recorded tuple, so no deltas were compared.`,
    )
  }

  const actual = landedDeltas(landed)

  if (landed.status === 'reverted') {
    return {
      matched: false,
      simulated: predicted,
      landed: actual,
      notes: `The transaction reverted after landing, and the check expected it to succeed. State moved between block ${tuple.block}, where the check ran, and block ${landed.blockNumber}, where it landed. That gap is the disclosed limit: a verdict is reproducible for a block and a state, not a prediction of what lands.`,
    }
  }

  const differences: string[] = []
  const seen = new Set<string>()
  const index = (deltas: BalanceDelta[]) =>
    new Map(deltas.map((delta) => [`${delta.token}:${delta.owner}`, delta]))
  const predictedBy = index(predicted)
  const actualBy = index(actual)

  for (const key of [...predictedBy.keys(), ...actualBy.keys()]) {
    if (seen.has(key)) continue
    seen.add(key)
    const before = predictedBy.get(key)
    const after = actualBy.get(key)
    if (before !== undefined && after !== undefined) {
      if (before.delta === after.delta) continue
      differences.push(
        `${describe(before)}: predicted ${before.delta}, landed ${after.delta}, a difference of ${after.delta - before.delta}`,
      )
      continue
    }
    if (before !== undefined) {
      differences.push(`${describe(before)}: predicted ${before.delta}, landed nothing`)
    } else if (after !== undefined) {
      differences.push(`${describe(after)}: predicted nothing, landed ${after.delta}`)
    }
  }

  if (differences.length === 0) {
    return {
      matched: true,
      simulated: predicted,
      landed: actual,
      notes: `Predicted and landed agree on every balance change. Checked at block ${tuple.block}, landed at block ${landed.blockNumber}. Gas is excluded from both sides, so these are the values the transaction moved rather than the cost of running it.`,
    }
  }

  return {
    matched: false,
    simulated: predicted,
    landed: actual,
    notes: `Predicted and landed differ. ${differences.join('. ')}. State moved between block ${tuple.block}, where the check ran, and block ${landed.blockNumber}, where it landed. That gap is the disclosed limit rather than a fault in the check: a verdict is reproducible for a block and a state, not a prediction of what lands. Gas is excluded from both sides.`,
  }
}

/** Both columns as plain rows, for a panel or a terminal. A mismatch prints as loudly as a match. */
export function divergenceRows(
  result: Divergence,
): { asset: string; owner: Address; predicted: string; landed: string; differs: boolean }[] {
  const key = (delta: BalanceDelta) => `${delta.token}:${delta.owner}`
  const predicted = new Map(result.simulated.map((delta) => [key(delta), delta]))
  const landed = new Map(result.landed.map((delta) => [key(delta), delta]))

  return [...new Set([...predicted.keys(), ...landed.keys()])].sort().map((id) => {
    const before = predicted.get(id)
    const after = landed.get(id)
    const sample = (before ?? after) as BalanceDelta
    return {
      asset: sample.token === 'native' ? 'native' : sample.token,
      owner: sample.owner,
      predicted: before === undefined ? 'nothing' : String(before.delta),
      landed: after === undefined ? 'nothing' : String(after.delta),
      differs: before?.delta !== after?.delta,
    }
  })
}
