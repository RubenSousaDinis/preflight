/**
 * The control plane for the demo server: read the current variant, or flip it.
 *
 * Kept off the MCP surface deliberately. A flip exposed as an MCP tool would change the tool list,
 * which is the one thing `poisoned` must not do and the one thing `baseline` must never do between
 * two reads.
 *
 * Reads are open, because the operator confirms state before a run and the console renders it. Writes
 * require a token: a public URL whose surface anyone can change is a surface no grade describes.
 */

import { isPreflightError, reasonOf } from '../shared/errors.ts'
import type { JsonValue } from '../shared/types.ts'
import {
  BASELINE_TOOL_COUNT,
  DRIFTED_TOOL_COUNT,
  DRIFT_ADDED_TOOLS,
  PAGE_SIZE,
  isVariant,
  toolsFor,
} from './tool-surface.ts'
import { authorizeControl, currentToolSurface, setToolSurface } from './variant-store.ts'

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' }

async function state(): Promise<JsonValue> {
  const variant = await currentToolSurface()
  return {
    variant,
    toolCount: toolsFor(variant).length,
    baselineToolCount: BASELINE_TOOL_COUNT,
    driftedToolCount: DRIFTED_TOOL_COUNT,
    driftAddedTools: DRIFT_ADDED_TOOLS.map((tool) => tool.name),
    pageSize: PAGE_SIZE,
  }
}

export async function handleControlRequest(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    return new Response(JSON.stringify(await state()), { status: 200, headers: JSON_HEADERS })
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...JSON_HEADERS, allow: 'GET, POST' },
    })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'body is not JSON' }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  const variant = (body as { variant?: unknown } | null)?.variant
  if (!isVariant(variant)) {
    return new Response(
      JSON.stringify({ error: 'variant must be one of baseline, drifted, poisoned' }),
      { status: 400, headers: JSON_HEADERS },
    )
  }

  try {
    authorizeControl(request.headers.get('authorization'))
  } catch (err) {
    // A missing token is a configuration refusal, a wrong one is a rejected flip. Both refuse.
    const status = isPreflightError(err) && err.code === 'CONFIG' ? 503 : 401
    return new Response(JSON.stringify({ error: reasonOf(err) }), { status, headers: JSON_HEADERS })
  }

  await setToolSurface(variant)
  return new Response(JSON.stringify(await state()), { status: 200, headers: JSON_HEADERS })
}
