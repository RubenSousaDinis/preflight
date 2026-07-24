/**
 * Runs the demo server on a local port, so a stock MCP client can be pointed at it before a deploy
 * exists and so the operator can rehearse a flip without the network.
 *
 *   DEMO_CONTROL_TOKEN=… node src/demo/serve.ts [port]
 *
 *   POST http://127.0.0.1:<port>/mcp        the MCP endpoint
 *   GET  http://127.0.0.1:<port>/variant    the current variant
 *   POST http://127.0.0.1:<port>/variant    {"variant":"drifted"} with a bearer token
 */

import { createServer, type IncomingMessage } from 'node:http'

import { reasonOf } from '../shared/errors.ts'
import { handleControlRequest } from './control.ts'
import { handleMcpRequest } from './mcp-server.ts'
import { currentToolSurface } from './variant-store.ts'

async function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(', '))
  }
  return new Request(new URL(req.url ?? '/', origin), {
    method: req.method,
    headers,
    body: body.length > 0 ? body : undefined,
  })
}

export function startDemoServer(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const request = await toWebRequest(req, `http://127.0.0.1:${port}`)
        const path = new URL(request.url).pathname
        const response =
          path === '/variant'
            ? await handleControlRequest(request)
            : path === '/mcp' || path === '/'
              ? await handleMcpRequest(request)
              : new Response(JSON.stringify({ error: 'not found' }), {
                  status: 404,
                  headers: { 'content-type': 'application/json' },
                })
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        const text = await response.text()
        res.end(text.length > 0 ? text : undefined)
      } catch (err) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: reasonOf(err) }))
      }
    })()
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const bound = typeof address === 'object' && address !== null ? address.port : port
      resolve({
        url: `http://127.0.0.1:${bound}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('demo/serve.ts') || entry.endsWith('demo/serve.js')) {
  const port = Number(process.argv[2] ?? 8787)
  const { url } = await startDemoServer(port)
  console.log(`demo mcp server on ${url}/mcp, variant ${await currentToolSurface()}`)
  console.log(`control: ${url}/variant`)
}
