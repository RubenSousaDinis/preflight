/**
 * Parsing a fetched document into an AgentCard.
 *
 * Two invariants from A2, and they are not symmetric. Empty `mcpEndpoints` is a hard error, because
 * a behavioral grade needs a surface to exercise and returning an empty array pushes the decision
 * onto a caller that will read it as "graded, nothing found". Empty `skillRefs` is legitimate.
 *
 * Field validation stops at the fields §1 names. Unknown fields ride along inside `raw` and are
 * preserved into the evidence bundle, so nothing is lost by not modelling them.
 */

import { AgentResolveError } from '../shared/errors.ts'
import type { AgentCard, AgentId, JsonValue } from '../shared/types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** An endpoint this project will connect to. Nothing else is treated as a service URL. */
function isConnectableUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://')
}

function looksLikeMcp(value: unknown): boolean {
  const text = asString(value)
  return text !== null && /(^|[^a-z])mcp([^a-z]|$)/i.test(text)
}

/**
 * Where MCP endpoints are read from, in order.
 *
 * The registry's own registration-v1 cards carry a `services` array of `{ name, endpoint }`, which
 * is the first path and the one D1's cards use. The rest are the shapes other card writers use, and
 * accepting them costs nothing: an endpoint that is not there simply is not found, and a card with
 * none throws either way.
 */
export function extractMcpEndpoints(raw: unknown): string[] {
  if (!isRecord(raw)) return []
  const found: string[] = []

  for (const service of asArray(raw.services)) {
    if (!isRecord(service)) continue
    if (!looksLikeMcp(service.name) && !looksLikeMcp(service.type) && !looksLikeMcp(service.protocol))
      continue
    const url = asString(service.endpoint) ?? asString(service.url)
    if (url !== null) found.push(url)
  }

  const endpoints = raw.endpoints
  if (isRecord(endpoints)) {
    const mcp = endpoints.mcp
    const single = asString(mcp)
    if (single !== null) found.push(single)
    for (const entry of asArray(mcp)) {
      const url = asString(entry) ?? (isRecord(entry) ? asString(entry.url) : null)
      if (url !== null) found.push(url)
    }
  }

  for (const entry of asArray(raw.mcpEndpoints)) {
    const url = asString(entry) ?? (isRecord(entry) ? asString(entry.url) : null)
    if (url !== null) found.push(url)
  }

  for (const iface of asArray(raw.additionalInterfaces)) {
    if (!isRecord(iface)) continue
    if (!looksLikeMcp(iface.transport) && !looksLikeMcp(iface.protocol)) continue
    const url = asString(iface.url) ?? asString(iface.endpoint)
    if (url !== null) found.push(url)
  }

  return Array.from(new Set(found.filter(isConnectableUrl)))
}

/** Skill references, wherever the card put them. Empty is legitimate and never throws. */
export function extractSkillRefs(raw: unknown): string[] {
  if (!isRecord(raw)) return []
  const found: string[] = []

  const collect = (value: unknown): void => {
    for (const entry of asArray(value)) {
      const ref =
        asString(entry) ?? (isRecord(entry) ? (asString(entry.id) ?? asString(entry.name)) : null)
      if (ref !== null) found.push(ref)
    }
  }

  collect(raw.skills)
  collect(raw.skillRefs)
  for (const service of asArray(raw.services)) {
    if (isRecord(service)) collect(service.skills)
  }

  return Array.from(new Set(found))
}

/**
 * Parses the fetched text into a card.
 *
 * `raw` is the parsed document with nothing added, removed, or reordered, retained before any field
 * is read: A3a derives the evidence bundle from it, so a normalization applied here would change a
 * hash two tasks downstream.
 */
export function parseAgentCard(agentId: AgentId, tokenURI: string, text: string): AgentCard {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new AgentResolveError(`the card for agent ${agentId} is not valid JSON`, { cause: err })
  }

  if (!isRecord(raw)) {
    throw new AgentResolveError(`the card for agent ${agentId} is not a JSON object`)
  }

  const mcpEndpoints = extractMcpEndpoints(raw)
  if (mcpEndpoints.length === 0) {
    throw new AgentResolveError(
      `agent ${agentId} declares no MCP endpoint, so there is no surface to exercise and nothing to grade`,
    )
  }

  return {
    agentId,
    name: asString(raw.name) ?? '',
    mcpEndpoints,
    skillRefs: extractSkillRefs(raw),
    raw: raw as JsonValue,
    tokenURI,
  }
}
