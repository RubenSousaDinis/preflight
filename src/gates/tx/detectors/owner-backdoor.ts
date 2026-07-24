/**
 * B5e, flag 2 of 4: owner or upgrade backdoor.
 *
 * A pending transaction that fires a hidden owner or upgrade path blocks, evidenced by a storage
 * slot that changed during the simulation.
 *
 * The slot delta is the evidence and the selector scan is corroboration, never the other way round.
 * A selector can sit in the calldata without firing, and a backdoor can fire through a path whose
 * selector nobody recognizes. State changed or it did not.
 *
 * The slot constants come from B4 rather than being re-derived. Two independent slot tables diverge
 * eventually, and the divergence shows up as a flag that quietly stops firing.
 */

import { toFunctionSelector } from 'viem'
import { FingerprintError } from '../../../shared/errors.ts'
import type { Address, Detector, Flag, Hex } from '../../../shared/types.ts'
import {
  EIP1967_ADMIN_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
} from '../fingerprint.ts'
import { storageWritesFrom, type PrestateDiff } from '../trace.ts'

interface NamedSlot {
  slot: Hex
  what: string
}

const UPGRADE_SLOTS: NamedSlot[] = [
  { slot: EIP1967_IMPLEMENTATION_SLOT, what: 'the EIP-1967 implementation slot' },
  { slot: EIP1967_BEACON_SLOT, what: 'the EIP-1967 beacon slot' },
  { slot: EIP1967_ADMIN_SLOT, what: 'the EIP-1967 admin slot' },
]

/**
 * The ownership and upgrade surface, computed rather than copied.
 *
 * Corroboration only. A hit here decides whose storage writes count as an owner path firing; it
 * never produces a flag on its own.
 */
export const OWNER_SELECTORS: Record<string, string> = {
  [toFunctionSelector('transferOwnership(address)')]: 'transferOwnership',
  [toFunctionSelector('upgradeTo(address)')]: 'upgradeTo',
  [toFunctionSelector('upgradeToAndCall(address,bytes)')]: 'upgradeToAndCall',
  [toFunctionSelector('changeAdmin(address)')]: 'changeAdmin',
}

function asAddress(word: Hex): string {
  const body = word.slice(-40)
  return /^0+$/.test(body) ? 'nobody' : `0x${body}`
}

function flagFor(
  address: Address,
  slot: Hex,
  before: Hex,
  after: Hex,
  what: string,
  corroboration: string | null,
): Flag {
  const via = corroboration === null ? '' : ` The call graph shows ${corroboration} firing.`
  return {
    id: 'owner-backdoor',
    severity: 'block',
    title: `${what} at ${address} changes during this call`,
    detail:
      `${address} writes ${slot} during this transaction, moving it from ${before} to ${after} ` +
      `(${asAddress(before)} to ${asAddress(after)}). ${what} decides which code runs at that ` +
      `address, or who may replace it, and this call was not a request to change either.${via}`,
    confirmedBy: 'simulation',
  }
}

export const ownerBackdoor: Detector = async (sim, tx, code) => {
  // 01-INTERFACES section 6 already says an unresolved proxy forces the caller to fail closed.
  // Treating it as a plain contract here would be the fail open case wearing a clean verdict: the
  // slots below are the ones this code knows how to read, and an unrecognized proxy keeps its
  // upgrade path somewhere else.
  if (code.proxyKind === 'unknown') {
    throw new FingerprintError(
      `what executes at ${tx.to} could not be resolved, so whether this call changes it cannot be answered`,
    )
  }

  const prestate = (sim.raw as { prestate?: PrestateDiff } | null)?.prestate
  if (prestate === undefined) {
    // A before value with no after value reads exactly like an unchanged slot, which is the fail
    // open case. Refusing is the only honest answer.
    throw new FingerprintError(
      'the simulation carried no storage diff, so an upgrade during this call could not be ruled out',
    )
  }

  const writes = storageWritesFrom(prestate)
  const flags: Flag[] = []
  const seen = new Set<string>()

  // Signal 1, sufficient on its own: a known upgrade slot moved, at any address and any depth.
  for (const write of writes) {
    const named = UPGRADE_SLOTS.find((s) => s.slot.toLowerCase() === write.slot.toLowerCase())
    if (named === undefined) continue
    const key = `${write.address}:${write.slot}`
    if (seen.has(key)) continue
    seen.add(key)
    flags.push(flagFor(write.address, write.slot, write.before, write.after, named.what, null))
  }

  // Signal 2: an ownership or upgrade selector fired somewhere in the call graph, and the contract
  // it fired on changed its storage. Both halves come from the simulation, so this stays evidence
  // rather than suspicion, and it catches ownership on a plain contract whose owner slot is not a
  // constant anyone can look up. Depth does not matter: the backdoor worth catching is the one that
  // never appears in the top level selector.
  for (const entry of sim.callGraph) {
    const named = OWNER_SELECTORS[entry.selector.toLowerCase()]
    if (named === undefined) continue
    const write = writes.find((w) => w.address === entry.to)
    if (write === undefined) continue
    const key = `${write.address}:${write.slot}`
    if (seen.has(key)) continue
    seen.add(key)
    flags.push(
      flagFor(write.address, write.slot, write.before, write.after, 'an owner controlled slot', named),
    )
  }

  return flags
}
