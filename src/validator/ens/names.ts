/**
 * D5b: the name an agent gets, derived rather than stored.
 *
 * One label per agent id, computed the same way by the writer and by every reader, so nothing has to
 * keep a table of which agent owns which name. The derivation is the only place the spelling exists.
 *
 * Pure. Nothing here touches a chain, an environment variable, or a key.
 */

import { labelhash, namehash, normalize } from 'viem/ens'

import { ConfigError } from '../../shared/errors.ts'
import type { AgentId, Hex } from '../../shared/types.ts'

/**
 * The subname label for an agent, for example `agent8427`.
 *
 * Prefixed and explicit for the same reason `preflight-demo-${agentId}` is: a bare number reads as a
 * placeholder on a slide, and a label that says what it names survives being read aloud. Numeric ids
 * only, because the ERC-8004 id is a uint256 and anything else here came from a caller that was
 * holding an address or a URL and thought it was an id.
 */
export function subnameLabelFor(agentId: AgentId): string {
  const trimmed = agentId.trim()
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new ConfigError(
      `${JSON.stringify(agentId)} is not an agent id, so no subname can be derived from it`,
    )
  }
  return `agent${trimmed}`
}

/** The full name, for example `agent8427.preflight.base.eth`. */
export function agentEnsName(agentId: AgentId, parent: string): string {
  const trimmedParent = parent.trim().replace(/^\.+|\.+$/g, '')
  if (trimmedParent.length === 0) {
    throw new ConfigError('the parent name is empty, so no subname can be derived from it')
  }
  return `${subnameLabelFor(agentId)}.${trimmedParent}`
}

/**
 * Turns a typed name into the full name under the configured parent.
 *
 * Accepts the full name, or just the `agentNNNN` label. Anything else is refused rather than
 * guessed: a bare number is an ERC-8004 id, not a name, and a foreign TLD is not our mirror.
 */
export function expandAgentEnsName(input: string, parent: string): string {
  const trimmed = input.trim().replace(/^\.+|\.+$/g, '')
  const trimmedParent = parent.trim().replace(/^\.+|\.+$/g, '')
  if (trimmed.length === 0) {
    throw new ConfigError('the ENS name is empty')
  }
  if (trimmedParent.length === 0) {
    throw new ConfigError('the parent name is empty, so no subname can be derived from it')
  }

  const normalizedParent = normalize(trimmedParent)
  if (!trimmed.includes('.')) {
    if (!/^agent[0-9]+$/i.test(trimmed)) {
      throw new ConfigError(
        `${JSON.stringify(input)} is not an agent ENS label under ${trimmedParent}`,
      )
    }
    return `${normalize(trimmed)}.${normalizedParent}`
  }

  const normalized = normalize(trimmed)
  if (normalized === normalizedParent || !normalized.endsWith(`.${normalizedParent}`)) {
    throw new ConfigError(
      `${JSON.stringify(input)} is not a name under ${trimmedParent}, so it is not a Preflight grade mirror`,
    )
  }
  return normalized
}

/**
 * The namehash of a name, normalized first.
 *
 * Normalization is not cosmetic: `Agent8427.Preflight.base.eth` and its lowercase form hash to
 * different nodes, and a record written under one is invisible to a reader of the other.
 */
export function nodeFor(name: string): Hex {
  return namehash(normalize(name.trim()))
}

/**
 * The label hash `setSubnodeRecord` wants, which is not the namehash.
 *
 * The registry takes the parent node and the hash of the single label under it, and hashes the pair
 * itself. Passing `nodeFor(label)` there would create a subname of some other name entirely.
 */
export function labelHashFor(label: string): Hex {
  return labelhash(normalize(label))
}
