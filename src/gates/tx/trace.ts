/**
 * B5a steps 6 to 8: turn a trace into the structured effects a detector reads.
 *
 * Deliberately pure. Everything here takes a trace and returns deltas, with no process, no socket,
 * and no clock, which is what lets the extraction be tested against recorded traces rather than
 * against whatever the chain happened to be doing.
 *
 * Two sources are read, not one, because they fail differently. Logs say what a token claimed
 * happened. The prestate diff says which storage actually moved. A token that moves an allowance
 * without emitting an event is invisible to the first and visible to the second.
 */

import { getAddress, toEventSelector } from 'viem'
import type { ApprovalDelta, Address, BalanceDelta, CallGraphEntry, Hex } from '../../shared/types.ts'

/** `Transfer(address,address,uint256)` and `Approval(address,address,uint256)`, computed not copied. */
export const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)')
export const APPROVAL_TOPIC = toEventSelector('Approval(address,address,uint256)')

export interface TraceLog {
  address: Hex
  topics: Hex[]
  data: Hex
}

/** The shape `callTracer` returns, narrowed to what is read here. */
export interface CallFrame {
  type?: string
  from?: Hex
  to?: Hex
  input?: Hex
  value?: Hex
  logs?: TraceLog[]
  calls?: CallFrame[]
  error?: string
}

/** The shape `prestateTracer` returns in diff mode. */
export interface PrestateDiff {
  pre?: Record<string, { balance?: Hex; storage?: Record<string, Hex> }>
  post?: Record<string, { balance?: Hex; storage?: Record<string, Hex> }>
}

function hexToBig(value: Hex | undefined): bigint {
  if (value === undefined || value === '0x') return 0n
  return BigInt(value)
}

/** A 32 byte topic word carries its address in the low 20 bytes. */
function addressFromTopic(topic: Hex): Address {
  return getAddress(`0x${topic.slice(-40)}`)
}

/**
 * The resolved call graph, in call order.
 *
 * Pre-order, so a caller appears before the callees it produced, which is the order a reader
 * follows when asking where the value went. Contract creations carry no callee and are skipped:
 * flag 3 asks which address received the value, and a creation has no address to judge yet.
 */
export function callGraphFrom(root: CallFrame): CallGraphEntry[] {
  const entries: CallGraphEntry[] = []
  const walk = (frame: CallFrame): void => {
    if (frame.to !== undefined && frame.from !== undefined) {
      const input = frame.input ?? '0x'
      entries.push({
        from: getAddress(frame.from),
        to: getAddress(frame.to),
        selector: (input.length >= 10 ? input.slice(0, 10) : '0x') as Hex,
        value: hexToBig(frame.value),
      })
    }
    for (const child of frame.calls ?? []) walk(child)
  }
  walk(root)
  return entries
}

/** Every log in the trace, in emission order. */
export function logsFrom(root: CallFrame): TraceLog[] {
  const logs: TraceLog[] = []
  const walk = (frame: CallFrame): void => {
    for (const log of frame.logs ?? []) logs.push(log)
    for (const child of frame.calls ?? []) walk(child)
  }
  walk(root)
  return logs
}

function isTransfer(log: TraceLog): boolean {
  return log.topics.length === 3 && log.topics[0].toLowerCase() === TRANSFER_TOPIC.toLowerCase()
}

function isApproval(log: TraceLog): boolean {
  return log.topics.length === 3 && log.topics[0].toLowerCase() === APPROVAL_TOPIC.toLowerCase()
}

/**
 * Net token movement per owner, from `Transfer` logs, plus native movement from the prestate diff.
 *
 * Mints and burns keep their zero address counterparty rather than being dropped: a burn that is
 * not rendered reads as tokens vanishing.
 */
export function balanceDeltasFrom(root: CallFrame, prestate: PrestateDiff): BalanceDelta[] {
  const totals = new Map<string, BalanceDelta>()
  const add = (token: Address | 'native', owner: Address, delta: bigint): void => {
    if (delta === 0n) return
    const key = `${token}:${owner}`
    const existing = totals.get(key)
    if (existing === undefined) totals.set(key, { token, owner, delta })
    else existing.delta += delta
  }

  for (const log of logsFrom(root)) {
    if (!isTransfer(log)) continue
    const token = getAddress(log.address)
    const amount = hexToBig(log.data)
    add(token, addressFromTopic(log.topics[1]), -amount)
    add(token, addressFromTopic(log.topics[2]), amount)
  }

  const pre = prestate.pre ?? {}
  const post = prestate.post ?? {}
  for (const raw of new Set([...Object.keys(pre), ...Object.keys(post)])) {
    const before = hexToBig(pre[raw]?.balance)
    // An account present in `post` without a balance field did not move its balance.
    const after = post[raw]?.balance === undefined ? before : hexToBig(post[raw]?.balance)
    add('native', getAddress(raw), after - before)
  }

  return [...totals.values()].filter((entry) => entry.delta !== 0n)
}

/**
 * Resulting allowances, from `Approval` logs.
 *
 * The last event for a given token, owner, and spender wins, because the field is the resulting
 * allowance rather than a change to one. Two approvals in one transaction leave one allowance.
 */
export function approvalDeltasFrom(root: CallFrame): ApprovalDelta[] {
  const latest = new Map<string, ApprovalDelta>()
  for (const log of logsFrom(root)) {
    if (!isApproval(log)) continue
    const entry: ApprovalDelta = {
      token: getAddress(log.address),
      owner: addressFromTopic(log.topics[1]),
      spender: addressFromTopic(log.topics[2]),
      amount: hexToBig(log.data),
    }
    latest.set(`${entry.token}:${entry.owner}:${entry.spender}`, entry)
  }
  return [...latest.values()]
}

/**
 * Storage words a transaction wrote, per address, read from the prestate diff.
 *
 * B5e reads upgrade slots straight out of this rather than inferring an upgrade from a trace, and
 * it is the cross-check on any allowance a token moved without announcing.
 */
export function storageWritesFrom(prestate: PrestateDiff): { address: Address; slot: Hex; before: Hex; after: Hex }[] {
  const writes: { address: Address; slot: Hex; before: Hex; after: Hex }[] = []
  const pre = prestate.pre ?? {}
  const post = prestate.post ?? {}
  for (const [raw, entry] of Object.entries(post)) {
    for (const [slot, after] of Object.entries(entry.storage ?? {})) {
      const before = pre[raw]?.storage?.[slot] ?? (`0x${'00'.repeat(32)}` as Hex)
      if (before.toLowerCase() === after.toLowerCase()) continue
      writes.push({ address: getAddress(raw), slot: slot as Hex, before, after })
    }
  }
  return writes
}

/** Did the call itself fail? A revert is information, so it is reported rather than thrown. */
export function revertedFrom(root: CallFrame): boolean {
  return root.error !== undefined
}
