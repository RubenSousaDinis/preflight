# Lane 1 verification log: E1, the controllable demo MCP server

Run 2026-07-25. The planning repo's task docs are read-only from a lane, so this is the evidence the
operator pastes from.

```
deployed url:                 pending the two route files (see README.md) and a deploy.
                              Deterministic once added: https://<deploy>/api/demo-agent/mcp
local url used for every
measurement below:            http://127.0.0.1:8787/mcp

baseline (tool count, fp):    21 tools, three pages at ten per page
                              0x3abd339e617a39fdf35d3461cc0fafa3f53cf99f0b67c05a97b43d26c007d551
drifted (tool count, fp):     24 tools, three pages
                              0x7efafa38a6e7b5291ef5d600b21f24933d31f6db6382d05660b435ba5dbe063e
                              adds transfer_funds, read_env, post_webhook
round trip restores baseline: yes, byte for byte. baseline, drifted, baseline read back as
                              0x3abd339e…d551, 0x7efafa38…063e, 0x3abd339e…d551, both in process and
                              over a real socket.
poisoned fingerprint:         0x3abd339e…d551, identical to baseline. A poisoned list would make the
                              gate refuse on drift and never reach the injection.
poisoned output reaches the
client intact:                yes, through a stock client over a real socket. The MCP Inspector CLI
                              called summarize_sources and returned the full injected note, including
                              the "previous instructions are cancelled" line and the recipient
                              address, unsanitized by the transport.

stock client connection:      npx @modelcontextprotocol/inspector --cli http://127.0.0.1:8787/mcp
                              --method tools/list connected and listed the surface. It returns the
                              first page of ten and does not auto-paginate, which is the behavior the
                              multi-page requirement exists to catch.
pagination, via the engine:   the engine's own enumerateTools walked all three pages to 21 and 24
                              tools. That is the code B1's live recheck runs, so pagination is proven
                              against the enumerator that matters rather than a hand-rolled loop.
engine grade of baseline:     B. Injection checks passed; egress not verified.
                              C-01 pass, C-02 skipped (no sandbox, Docker unavailable),
                              C-03 skipped (no canary could be planted on a remote target),
                              C-04 pass. Fingerprint from the graded run matches the value above
                              exactly, so the surface the engine graded is the surface the gate will
                              recheck.

suite: 13 tests for this task, all passing, offline.
```

## What this settles about the A-versus-B question

A3a's log raised it from a third-party server. This closes it against our own: **an http or https MCP
endpoint caps at B, and it is not a Docker problem.** C-03 skipped with "no canary could be planted on
a remote target", which is inherent to any URL target, local or deployed. Docker would only address
C-02, and one unverified category still caps the letter at B.

So reaching an A on stage means grading a stdio target: E1 shipped as an npm package, launched by the
engine under Docker isolation, with an agent card declaring a package ref rather than a URL. That is
option 2 in `src/validator/VERIFICATION.md`, and it now has a measurement behind it rather than a
reading of the engine's types.

## Notes for the runbook

- Assert the variant before every run: `curl -s <url>/api/demo-agent/variant`. A run that starts
  already drifted produces a refusal nobody can explain.
- Warm the endpoint before going on stage. A cold start reads as a hang in front of the room.
- The flip is per variant, not per session: an open MCP session keeps the surface it started with, and
  the next `tools/list` reflects the change.
