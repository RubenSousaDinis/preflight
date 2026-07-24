# The demo MCP server (E1)

A publicly reachable MCP server whose tool surface changes on command, so drift and tool-output
injection are demonstrable on cue rather than waited for. It exists so B1's acceptance test does not
depend on a third party being live and cooperative on stage.

Three variants, each moving exactly one axis:

| Variant | Tool list | Tool output | Tools | Fingerprint (measured 2026-07-25) |
|---|---|---|---|---|
| `baseline` | the graded surface | ordinary | 21, three pages | `0x3abd339e617a39fdf35d3461cc0fafa3f53cf99f0b67c05a97b43d26c007d551` |
| `drifted` | baseline plus 3 | ordinary | 24, three pages | `0x7efafa38a6e7b5291ef5d600b21f24933d31f6db6382d05660b435ba5dbe063e` |
| `poisoned` | identical to baseline | hostile text | 21, three pages | same as baseline, byte for byte |

`drifted` adds `transfer_funds`, `read_env`, and `post_webhook`. The stage line is that the surface
grew a funds-moving tool after it was graded, and 21 to 24 is a number you can read off the screen.

## What Lane 3 has to add, because `app/` is not Lane 1's to write

Two route files. Both are thin: every behavior is in this directory, tested here, and neither route
should carry logic of its own.

`app/api/demo-agent/mcp/route.ts`

```ts
import { handleMcpRequest } from "@/src/demo/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export async function GET(request: Request) {
  return handleMcpRequest(request);
}
```

`app/api/demo-agent/variant/route.ts`

```ts
import { handleControlRequest } from "@/src/demo/control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleControlRequest(request);
}

export async function POST(request: Request) {
  return handleControlRequest(request);
}
```

That makes the deterministic URLs, which D1's agent cards point at:

- `https://<deploy>/api/demo-agent/mcp` — the MCP endpoint
- `https://<deploy>/api/demo-agent/variant` — read the variant, or flip it

## What the operator has to set

`DEMO_CONTROL_TOKEN`, in the Vercel environment. Without it a flip is refused with 503 and the
surface does not move. Reads stay open, because the console renders the current variant and the
runbook asserts it before a run.

Flipping, from anywhere:

```
curl -s https://<deploy>/api/demo-agent/variant
curl -s -X POST https://<deploy>/api/demo-agent/variant \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $DEMO_CONTROL_TOKEN" \
  -d '{"variant":"drifted"}'
```

## The open item: where the variant lives

`variant-store.ts` keeps the variant in process memory behind a `VariantStore` interface. That is
correct locally and correct on a warm serverless instance, and it is not correct in general: two
requests can land on two instances, and a flip written into one instance's memory is invisible to the
other, so a run could start on the surface nobody selected.

The fix is a durable backend registered through `useVariantStore`, which needs one store provisioned
(Supabase table, Vercel Blob, or anything else with an HTTP read and write). Until then the runbook's
"assert the variant before the run" step is what covers it, and the read endpoint is what makes that
assertion possible.

## Running it locally

```
DEMO_CONTROL_TOKEN=local-test node src/demo/serve.ts 8787
curl -s http://127.0.0.1:8787/variant
npx -y @modelcontextprotocol/inspector --cli http://127.0.0.1:8787/mcp --method tools/list
```

Grading a local instance with the engine needs `POLYGRAPH_ALLOW_PRIVATE_TARGETS=1`: the engine refuses
private and reserved addresses by default, which is its own guard and worth leaving in place.
