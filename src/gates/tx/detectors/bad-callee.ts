/**
 * B5d, flag 3 of 4: bad callee.
 *
 * Value routed to an unverified contract, or to an address on the checked-in known-bad list, blocks.
 * The check runs across the resolved call graph rather than the direct callee, because a clean and
 * well known contract forwarding value to a malicious one is the whole attack, and reading `to`
 * alone passes it.
 *
 * Narrow on purpose. Only value-bearing edges plus the direct callee are considered: a zero value
 * call to an unverified contract is not this flag, and widening it is how a firewall turns into a
 * general auditor.
 */

import { formatEther } from 'viem'
import { SimulationError } from '../../../shared/errors.ts'
import type {
  Address,
  CallGraphEntry,
  ChainId,
  CodeFingerprint,
  Detector,
  Flag,
  PendingTx,
  SimulationResult,
} from '../../../shared/types.ts'
import { verifiedSource, type VerifiedStatus } from '../explorer.ts'
import { codeFingerprint } from '../fingerprint.ts'
import { readerFor } from '../rpc.ts'
import { knownBad, type KnownBadEntry } from './known-bad.ts'

/** The outside facts this detector reads, injectable so its rules can be tested offline. */
export interface CalleeLookups {
  hasCode: (chainId: ChainId, address: Address, atBlock: bigint) => Promise<boolean>
  /** B4's resolution, so a verified proxy stub does not launder an unverified implementation. */
  resolve: (chainId: ChainId, address: Address, atBlock: bigint) => Promise<CodeFingerprint>
  verified: (chainId: ChainId, address: Address) => Promise<VerifiedStatus>
}

const liveLookups: CalleeLookups = {
  hasCode: async (chainId, address, atBlock) =>
    (await readerFor(chainId).code(address, atBlock)).length > 2,
  resolve: codeFingerprint,
  verified: verifiedSource,
}

/**
 * Every callee worth judging: the direct one, plus everything that received value.
 *
 * Deduplicated by address, so a contract called five times is classified once, and each address
 * keeps the first edge that reached it for the flag to quote.
 */
export function calleesOf(sim: SimulationResult, tx: PendingTx): Map<Address, CallGraphEntry> {
  const callees = new Map<Address, CallGraphEntry>()

  const root = sim.callGraph[0]
  callees.set(tx.to, root ?? { from: tx.from, to: tx.to, selector: '0x', value: tx.value })

  for (const edge of sim.callGraph) {
    if (edge.value === 0n) continue
    if (callees.has(edge.to)) continue
    callees.set(edge.to, edge)
  }

  return callees
}

function edgeText(edge: CallGraphEntry): string {
  const selector = edge.selector === '0x' ? 'a plain transfer' : `selector ${edge.selector}`
  return `${edge.from} calls ${edge.to} with ${selector} carrying ${formatEther(edge.value)} ETH`
}

function listedFlag(edge: CallGraphEntry, entry: KnownBadEntry): Flag {
  return {
    id: 'bad-callee',
    severity: 'block',
    title: `${entry.address} is on the known-bad list`,
    detail:
      `${edgeText(edge)}. That address is recorded in this repo's known-bad list: ${entry.what} ` +
      `Source: ${entry.source}. The list is checked in rather than fetched, so this verdict can be ` +
      `re-derived from the repo alone.`,
    confirmedBy: 'static',
  }
}

function unverifiedFlag(edge: CallGraphEntry, at: Address, via: Address, note: string): Flag {
  const through = at === via ? '' : ` It is reached through ${via}, whose own source is published.`
  return {
    id: 'bad-callee',
    severity: 'block',
    title: `value reaches ${at}, which has no published source`,
    detail:
      `${edgeText(edge)}. ${at} has code but ${note}, so what it does with the value cannot be ` +
      `read by anyone.${through}`,
    confirmedBy: 'simulation',
  }
}

export function badCalleeWith(lookups: CalleeLookups): Detector {
  return async (sim, tx) => {
    const movedValue = tx.value > 0n || sim.balanceDeltas.length > 0
    if (movedValue && sim.callGraph.length === 0) {
      // An empty graph on a transaction that moved value is a broken trace, not a clean one, and
      // treating it as clean is the silent fail open case.
      throw new SimulationError(
        'this transaction moved value but produced no call graph, so where it went cannot be answered',
      )
    }

    const flags: Flag[] = []

    for (const [callee, edge] of calleesOf(sim, tx)) {
      const listed = knownBad(tx.chainId, callee)
      if (listed !== null) {
        flags.push(listedFlag(edge, listed))
        continue
      }

      // An address with no code has no source to publish, so it is not an unverified contract.
      // Flagging every payment to a wallet would fire on the honest path.
      if (!(await lookups.hasCode(tx.chainId, callee, sim.block))) continue

      // Classify at the fork block only. Re-reading at head can verify a different contract than
      // the one that was simulated.
      const code = await lookups.resolve(tx.chainId, callee, sim.block)
      // The stub and everything it resolves to. A verified proxy in front of an unverified
      // implementation is exactly the laundering this closes.
      for (const resolved of code.resolved) {
        const status = await lookups.verified(tx.chainId, resolved.address)
        if (!status.determinate) {
          throw new SimulationError(
            `the verified status of ${resolved.address} could not be resolved, so this callee cannot be classified`,
          )
        }
        if (status.verified) continue
        flags.push(unverifiedFlag(edge, resolved.address, callee, status.note))
        break
      }
    }

    return flags
  }
}

export const badCallee: Detector = badCalleeWith(liveLookups)
