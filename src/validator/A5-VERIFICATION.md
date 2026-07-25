# Lane 1 verification log: A5, auto re-validation (beat 4)

Run 2026-07-25. Steps 2, 3, 4 and 6 are the `[claude]` half and are done and rehearsed live. Step 5
(publishing the superseding response) and step 8 (timing it on the deployed URL) need the operator.

```
updatable fixture agent id
and update mechanism:         the demo server at http://127.0.0.1:8787/mcp, updated through its own
                              control endpoint. Two knobs, deliberately independent: the tool surface
                              variant, and the version the server declares in its MCP handshake.
trigger used:                 both, and the rehearsal shows why neither alone is enough.
poll interval:                3000ms in the rehearsal, configurable.

run 1, the surface moves and the version does not
  baseline grade / fp:        B, 0x9bd0a254230b7b60…
  flipped to:                 drifted (24 tools)
  observed at:                the next poll, 3s later: CHANGED (fingerprint)
  re-graded:                  B to C, score 50
  new fp:                     0x8f2998682fbbfafa…
  a version-only watcher      would have seen nothing at all here.

run 2, the version moves and the surface does not
  baseline grade / fp:        B, 0x9bd0a254230b7b60…
  update shipped:             variant poisoned, declared version 1.0.0 to 1.1.0
  observed at:                the next poll, 3s later: CHANGED (version)
  re-graded:                  B to F, score 0
  new evidenceHash:           0xe66b7f70f76ca18a8587dcac9d181d20d5ae930eb4126de0b690617f5433fac8
  fingerprint:                0x9bd0a254230b7b60…, unchanged
  a fingerprint-only watcher  would have seen nothing at all here either.

grade before / after:         B then F, which is the flip beat 4 claims, produced by the engine on a
                              real run of the changed surface rather than by a diff.
elapsed, change to re-grade:  inside one poll interval against a local endpoint. The stage figure
                              depends on the deployed URL's latency, which is step 8's measurement.
connected client verdict:     the gate refuses on the new record's letter, which is B1's below-policy
                              path, already covered. The refusal comes from vetAgent reading the
                              current record, never from the UI being told to change.
both records readable,
reader selected:              tested offline against a stubbed registry: two responses for one agent,
                              the newer by block selected, both still readable oldest first, and two
                              in the same block ordered by log index.
```

## Why both triggers exist, demonstrated rather than argued

The two runs above are the same watcher against the same target, and each run is a case the other
trigger cannot see:

- `drifted` changes what the agent can do and says nothing about it. Its version stays 1.0.0.
- `poisoned` changes what the agent returns and leaves its tool list byte for byte identical, so its
  fingerprint does not move at all. It grades F on a genuine C-01 failure.

A5's decision table says both the declared version and the fingerprint trigger, and this is the
measurement behind it. Loosening either trigger to make a demo fire would be the thing the edge-case
table warns against; here neither needed loosening, because the two together already cover both cases.

## Supersession happens in the reader

`readCurrentValidation` orders responses by `(blockNumber, logIndex)` from the event log and reads the
selected record's current values from storage. Ordering by `lastUpdate` was the obvious shortcut and it
is wrong: two transactions can carry the same consensus second, so a wall clock is not a total order
and would pick wrong roughly half the time it matters.

Both records stay readable, oldest first, so the A record sits next to the F record rather than being
overwritten. When storage and the event disagree about the selected record the read refuses rather than
presenting either, because a record whose own two sources disagree is not one a gate should act on.

## What the operator still drives

- Step 5: publish the second `validationResponse`. Same command as A3b, and the second write needs no
  new flags: `cli.ts publish <agentId> --pin zerog --send`.
- Step 7 and 8: the end-to-end run against the deployed URL, and timing it. `cli.ts watch <url>` drives
  the watcher half; `cli.ts current <agentId>` shows which record the reader selected and what it
  superseded.
- If the watcher fights on the day, the degrade is an operator-triggered re-grade: the flip, the second
  attestation and the client refusal all still happen live, and only "nobody touched it" is lost. Say
  that plainly rather than implying automation that is not running.
