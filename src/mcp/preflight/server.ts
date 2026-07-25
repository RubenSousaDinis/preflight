/**
 * B7: both gates as MCP tools, so an agent adopts them with no SDK integration.
 *
 * Two rules run through everything here, and both are easy to break quietly.
 *
 * **It wraps, it does not reimplement.** The handlers shape arguments and serialize results. Every
 * decision is made by `vetAgent` and `txGuard`. Logic in a tool handler is a second implementation of
 * one verdict, and two implementations diverge; the divergence then shows up on stage rather than in a
 * test, which is why verdict equivalence is the acceptance test.
 *
 * **`preflight_agent` is the active path.** It connects to the live target, re-enumerates every page of
 * `tools/list`, and recomputes the fingerprint on every call. It is not a cached grade read, and no
 * cache is added here for latency: concurrent callers each get their own recheck.
 *
 * It also ships unmetered. There is no 402 challenge and no price anywhere in this file, per
 * 02-DECISIONS §8: in the demo x402 pays the hired agent, and paying polygraph for the check is the
 * post-event product.
 */

import { isPreflightError, reasonOf } from '../../shared/errors.ts'
import { isGrade } from '../../shared/grade.ts'
import type { Address, GateDecision, Grade, Hex, JsonValue, PendingTx, TxVerdict } from '../../shared/types.ts'
import { DEFAULT_POLICY, vetAgent } from '../../gates/vet/vet-agent.ts'
import { txGuard } from '../../gates/tx/txguard.ts'
import {
  blockedVerdict,
  refusedDecision,
  serializeGateDecision,
  serializeTxVerdict,
  type SerializedTxVerdict,
} from './serialize.ts'

export const SERVER_NAME = 'preflight'
export const SERVER_VERSION = '1.0.0'
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

/** Fixed names. A renamed tool breaks every integration written against it, including a judge's. */
export const AGENT_TOOL = 'preflight_agent'
export const TX_TOOL = 'preflight_tx'

export const TOOL_DEFINITIONS = [
  {
    name: AGENT_TOOL,
    description:
      'Check an agent before hiring it. Reads the validation record for the agent from the ERC-8004 Validation Registry, fetches the evidence behind it, re-enumerates every page of the live tool surface, and compares that surface to the one that was graded. Returns HIRE or REFUSE with the reason. This runs the live check on every call; it is not a cached grade lookup.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The ERC-8004 agent id to check.' },
        minGrade: {
          type: 'string',
          enum: ['A', 'B', 'C', 'D', 'F'],
          description: 'The lowest grade to accept. Defaults to B.',
        },
      },
      required: ['ref'],
      additionalProperties: false,
    },
  },
  {
    name: TX_TOOL,
    description:
      'Check a pending transaction before signing it. Forks the chain at the live block, fingerprints the callee and compares it to what it carried when graded, simulates the exact calldata, and runs the four red-flag checks. Returns ALLOW or BLOCK, the flags found, the balance movements, and the block, sender, callee, calldata hash and value that make the verdict reproducible.',
    inputSchema: {
      type: 'object',
      properties: {
        chainId: { type: 'integer', description: 'Chain the transaction is for. Required; there is no default network.' },
        from: { type: 'string', description: 'The wallet that would sign.' },
        to: { type: 'string', description: 'The direct callee.' },
        calldata: { type: 'string', description: 'Exact calldata bytes, 0x-prefixed.' },
        value: { type: 'string', description: 'Value in wei, as a decimal string so no precision is lost.' },
      },
      required: ['chainId', 'from', 'to', 'calldata', 'value'],
      additionalProperties: false,
    },
  },
] as const

export interface PreflightDeps {
  vet?: (ref: string, minGrade: Grade) => Promise<GateDecision>
  guard?: (tx: PendingTx) => Promise<TxVerdict>
}

const HEX = /^0x[0-9a-fA-F]*$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** Parses the tx input, naming the field that is wrong. A thrown schema error reads as the caller's bug. */
export function parsePendingTx(args: Record<string, unknown>): { tx: PendingTx } | { error: string } {
  const chainId = args.chainId
  if (typeof chainId !== 'number' || !Number.isInteger(chainId)) {
    return { error: 'chainId must be an integer, and there is no default network' }
  }
  for (const field of ['from', 'to'] as const) {
    const value = args[field]
    if (typeof value !== 'string' || !ADDRESS.test(value)) {
      return { error: `${field} must be a 20 byte 0x address` }
    }
  }
  const calldata = args.calldata
  if (typeof calldata !== 'string' || !HEX.test(calldata) || calldata.length % 2 !== 0) {
    return { error: 'calldata must be 0x-prefixed bytes, exactly as they would be signed' }
  }
  const rawValue = args.value
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
    return { error: 'value must be a decimal string in wei, so no precision is lost in transit' }
  }
  let value: bigint
  try {
    value = BigInt(rawValue)
  } catch {
    return { error: `value ${JSON.stringify(rawValue)} is not an integer number of wei` }
  }
  if (value < 0n) return { error: 'value cannot be negative' }

  return {
    tx: {
      chainId,
      from: args.from as Address,
      to: args.to as Address,
      calldata: calldata as Hex,
      value,
    },
  }
}

export interface ToolCallResult {
  content: { type: 'text'; text: string }[]
  structuredContent: JsonValue
  isError: false
}

function result(payload: GateDecision | SerializedTxVerdict): ToolCallResult {
  // Never isError. An MCP client that sees a tool error may retry or proceed, and a refusal has to be
  // something it cannot read as permission.
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as unknown as JsonValue,
    isError: false,
  }
}

export async function callPreflightAgent(
  args: Record<string, unknown>,
  deps: PreflightDeps = {},
): Promise<ToolCallResult> {
  // A stock client may send an agent id as a JSON number: the MCP Inspector coerces `ref=8427` that
  // way. An id is a decimal string, and an integer carries the same value losslessly, so accepting both
  // costs nothing and avoids a refusal that reads to the caller as this tool being broken. Anything else
  // still refuses.
  const raw = args.ref
  const ref =
    typeof raw === 'string' ? raw : typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : null
  if (ref === null || ref.trim().length === 0) {
    return result(refusedDecision('ref must be the agent id to check, as a string or an integer'))
  }
  const requested = args.minGrade
  if (requested !== undefined && !isGrade(requested)) {
    return result(refusedDecision(`minGrade ${JSON.stringify(requested)} is not a grade`))
  }
  const minGrade: Grade = isGrade(requested) ? requested : DEFAULT_POLICY.minGrade

  try {
    const decision = deps.vet
      ? await deps.vet(ref.trim(), minGrade)
      : await vetAgent(ref.trim(), { minGrade, maxAgeSeconds: DEFAULT_POLICY.maxAgeSeconds })
    return result(serializeGateDecision(decision))
  } catch (err) {
    // vetAgent refuses rather than throwing, so this is a failure below it. It still refuses.
    const code = isPreflightError(err) ? `[${err.code}] ` : ''
    return result(refusedDecision(`${code}the check could not complete, so the agent is refused: ${reasonOf(err)}`))
  }
}

export async function callPreflightTx(
  args: Record<string, unknown>,
  deps: PreflightDeps = {},
): Promise<ToolCallResult> {
  const parsed = parsePendingTx(args)
  if ('error' in parsed) {
    return result(
      blockedVerdict(`blocks this action: ${parsed.error}`, {
        from: typeof args.from === 'string' ? args.from : undefined,
        to: typeof args.to === 'string' ? args.to : undefined,
        value: typeof args.value === 'string' ? args.value : undefined,
      }),
    )
  }
  try {
    const verdict = deps.guard ? await deps.guard(parsed.tx) : await txGuard(parsed.tx)
    return result(serializeTxVerdict(verdict))
  } catch (err) {
    const code = isPreflightError(err) ? `[${err.code}] ` : ''
    return result(
      blockedVerdict(
        `blocks this action: ${code}the check could not complete, so nothing about this call was verified: ${reasonOf(err)}`,
        { from: parsed.tx.from, to: parsed.tx.to, value: parsed.tx.value.toString() },
      ),
    )
  }
}

// --- the protocol ----------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

function ok(id: unknown, value: JsonValue): JsonValue {
  return { jsonrpc: '2.0', id: id as JsonValue, result: value }
}

function fail(id: unknown, code: number, message: string): JsonValue {
  return { jsonrpc: '2.0', id: (id ?? null) as JsonValue, error: { code, message } }
}

/** One dispatcher, shared by both transports, so stdio and HTTP cannot answer differently. */
export async function dispatch(message: JsonRpcRequest, deps: PreflightDeps = {}): Promise<JsonValue | null> {
  const { id, method } = message
  if (typeof method !== 'string') return null
  if (method.startsWith('notifications/')) return null

  const params = (message.params ?? {}) as Record<string, unknown>

  switch (method) {
    case 'initialize': {
      const requested = params.protocolVersion
      return ok(id, {
        protocolVersion: typeof requested === 'string' ? requested : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Two checks an agent can call before it acts: preflight_agent before hiring another agent, preflight_tx before signing a transaction. Both return a verdict with the reason, and both run their checks live on every call.',
      })
    }
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: TOOL_DEFINITIONS as unknown as JsonValue })
    case 'resources/list':
      return ok(id, { resources: [] })
    case 'prompts/list':
      return ok(id, { prompts: [] })
    case 'tools/call': {
      const name = params.name
      const args = (params.arguments ?? {}) as Record<string, unknown>
      if (name === AGENT_TOOL) return ok(id, (await callPreflightAgent(args, deps)) as unknown as JsonValue)
      if (name === TX_TOOL) return ok(id, (await callPreflightTx(args, deps)) as unknown as JsonValue)
      return fail(id, INVALID_PARAMS, `unknown tool ${JSON.stringify(name)}`)
    }
    default:
      return fail(id, METHOD_NOT_FOUND, `unknown method ${JSON.stringify(method)}`)
  }
}

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' }

/** The Streamable HTTP surface, for a judge who wants to point their own client at a URL. */
export async function handlePreflightRequest(
  request: Request,
  deps: PreflightDeps = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...JSON_HEADERS, allow: 'POST' },
    })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify(fail(null, -32700, 'body is not JSON')), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }
  const messages = Array.isArray(body) ? body : [body]
  const responses: JsonValue[] = []
  for (const message of messages) {
    const response = await dispatch(message as JsonRpcRequest, deps)
    if (response !== null) responses.push(response)
  }
  if (responses.length === 0) return new Response(null, { status: 202 })
  return new Response(JSON.stringify(Array.isArray(body) ? responses : responses[0]), {
    status: 200,
    headers: JSON_HEADERS,
  })
}
