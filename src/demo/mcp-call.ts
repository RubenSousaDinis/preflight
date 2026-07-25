/**
 * A minimal MCP client, enough to hire a worker and call one of its tools.
 *
 * The harness has to be a real client, not a caller of our own server's internals: beat 1's claim is
 * that an ordinary agent speaking this protocol gets the hostile output and the gate catches it. So this
 * does the handshake and the call over Streamable HTTP the way any client would.
 *
 * Fingerprinting deliberately does not go through here. That runs on the engine's own connect and
 * enumerate path, so the surface the gate compares is read by the same code that graded it.
 */

import { HarnessError } from '../shared/errors.ts'
import type { JsonValue } from '../shared/types.ts'

const PROTOCOL_VERSION = '2025-06-18'

interface JsonRpcResponse {
  result?: unknown
  error?: { code?: number; message?: string }
}

async function rpc(
  endpoint: string,
  method: string,
  params: JsonValue,
  timeoutMs: number,
  id: number,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new HarnessError(`${method} on ${endpoint} did not answer within ${timeoutMs}ms`, {
      retryable: true,
      cause: err,
    })
  }
  if (!response.ok) {
    throw new HarnessError(`${method} on ${endpoint} answered HTTP ${response.status}`)
  }
  const body = (await response.json()) as JsonRpcResponse
  if (body.error !== undefined) {
    throw new HarnessError(`${method} on ${endpoint} failed: ${body.error.message ?? 'unknown error'}`)
  }
  return body.result
}

export interface WorkerSession {
  endpoint: string
  serverName: string
  /** What the server declared about itself in the handshake. */
  serverVersion: string
  tools: { name: string; description: string }[]
  callTool(name: string, args: JsonValue): Promise<unknown>
}

/** Connects, handshakes, and enumerates the first page of tools so a caller can pick one. */
export async function openWorker(endpoint: string, timeoutMs = 15_000): Promise<WorkerSession> {
  let id = 1
  const initialized = (await rpc(
    endpoint,
    'initialize',
    {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'preflight-client-agent', version: '1.0.0' },
    },
    timeoutMs,
    id++,
  )) as { serverInfo?: { name?: string; version?: string } }

  // The notification carries no id and expects no response body.
  await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => undefined)

  const listed = (await rpc(endpoint, 'tools/list', {}, timeoutMs, id++)) as {
    tools?: { name?: string; description?: string }[]
  }

  return {
    endpoint,
    serverName: initialized.serverInfo?.name ?? '',
    serverVersion: initialized.serverInfo?.version ?? '',
    tools: (listed.tools ?? []).map((tool) => ({
      name: String(tool.name ?? ''),
      description: String(tool.description ?? ''),
    })),
    async callTool(name: string, args: JsonValue): Promise<unknown> {
      return rpc(endpoint, 'tools/call', { name, arguments: args }, timeoutMs, id++)
    },
  }
}
