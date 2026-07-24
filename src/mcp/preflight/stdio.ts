/**
 * The stdio transport, which is what a stock MCP client launches.
 *
 *   node --env-file-if-exists=.env.local src/mcp/preflight/stdio.ts
 *
 * Newline-delimited JSON-RPC on stdin and stdout, and nothing else on stdout: a stray log line there
 * corrupts the stream and the client reports a protocol error that looks like our tools are broken.
 * Diagnostics go to stderr.
 */

import { createInterface } from 'node:readline'

import { reasonOf } from '../../shared/errors.ts'
import { dispatch } from './server.ts'

async function main(): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })
  for await (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let message: unknown
    try {
      message = JSON.parse(trimmed)
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } })}\n`,
      )
      continue
    }
    try {
      const response = await dispatch(message as Record<string, unknown>)
      if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`)
    } catch (err) {
      // The dispatcher already serializes verdict failures. Reaching here means the transport itself
      // broke, and the client is told so rather than left waiting.
      process.stderr.write(`preflight stdio: ${reasonOf(err)}\n`)
      const id = (message as { id?: unknown }).id ?? null
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: reasonOf(err) } })}\n`,
      )
    }
  }
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('preflight/stdio.ts') || entry.endsWith('preflight/stdio.js')) {
  main().catch((err: unknown) => {
    process.stderr.write(`preflight stdio failed: ${reasonOf(err)}\n`)
    process.exitCode = 1
  })
}
