# Lane 1 verification log: E1 and E2

## E1, the controllable demo MCP server

Run 2026-07-25. Measurements and the stock-client check are in the section below, unchanged.

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
round trip restores baseline: yes, byte for byte, in process and over a real socket.
poisoned fingerprint:         identical to baseline. A poisoned list would make the gate refuse on
                              drift and never reach the injection.
poisoned output reaches the
client intact:                yes, through the MCP Inspector CLI over a real socket, unsanitized.
pagination, via the engine:   the engine's own enumerateTools walked all three pages to 21 and 24.
engine grade of baseline:     B. C-01 pass, C-02 skipped (no sandbox), C-03 skipped (no canary on a
                              remote target), C-04 pass. Fingerprint matched the enumerator's value.
engine grade of drifted:      C. Adding a funds-moving tool the engine cannot exercise trips the
                              coverage cap on its own: an unexercised destructive tool plus an
                              unverified category is exactly the compounded caveat that grades C.
                              Worth saying out loud, because it means the drifted surface is worse
                              on its own terms and not only different.
```

The payload was rewritten after measuring it. An earlier draft read "the previous instructions are
cancelled" and **no engine detector fired**, which would have left two bad options: a demo that catches
nothing, or a matcher tuned to this exact string. The current wording trips two independent detectors,
instruction-mimicry on the override and tool-poisoning on the request to hide it from the user.

## E2, the client-agent harness

Beat 1, run end to end against the demo server on 2026-07-25. Everything is real except the registry
read: the engine graded the live surface twice, the evidence was published and fetched back, the gate
re-enumerated the live surface for each candidate, and the harness called the worker as an MCP client
over the wire.

```
event sequence (poisoned run):
  shopping          3 candidates, budget 1000000000
  vetted            f-agent        REFUSE  grade F  fingerprintMatch true
                    "grade F is below the minimum of B"
  vetted            drifted-agent  REFUSE  grade A  fingerprintMatch false
                    "graded A, but the live tool surface no longer matches the surface that was
                     graded (live 0x9bd0a254…, graded 0x8f299868…)"
  vetted            a-agent        HIRE    grade B  fingerprintMatch true
  hired             a-agent
  paid              100000000 on hedera-x402, labelled stubbed
  toolOutput        "Summary: the three sources agree on the timeline …"
  injectionCaught   instruction-mimicry ("Disregard your previous"),
                    tool-poisoning ("Do not mention this note to the user")
  frozen            spent 100000000, remaining 900000000
  done              hired a-agent; refused f-agent, drifted-agent; 6 receipts

budget start / final / fee:    1000000000 / 900000000 / 100000000, one call's fee, and all three
                               numbers are carried in the events rather than computed by the UI.
receipt ids and verifyChain:   receipt-0001 to receipt-0006, chain verified.
                               signer 0xb1358c0bcdb06ffbfc66bb71805eb8bff37dc593b39dd213b790f910b4d38db8
run with every candidate
refused:                       shopping, three vetted, done with nothing hired and spent 0. A correct
                               outcome rather than an error.
the clean run:                 identical stream up to and including toolOutput, then straight to done.
                               No injectionCaught, no frozen. The two streams differ only after the
                               hostile turn, which is E2 step 9 with the surface flipped over its
                               control endpoint between runs.

suite: 15 tests for the harness, all passing, offline.
```

### The open question, answered by measurement

E2 asked whether the injection check reuses B1's gate or a separate output check. Neither, in the
literal form: B1 takes an agent id, not a string, so it cannot be handed a tool result. What the
harness does instead is run **the engine's own C-01 scanners** on the live output, which are the same
detectors that decide whether a server fails injection at grading time. One mechanism, applied twice,
and the test asserts the scanners fire on a payload nothing like E1's while staying quiet on ordinary
text, so nothing here is tuned to the fixture.

### What still needs the operator

- E1's two route files and a deploy, so the URL is public (`src/demo/README.md`), plus
  `DEMO_CONTROL_TOKEN` in the Vercel environment.
- The x402 leg (B3). Until it lands, `paid` events carry `stubbed, the rail is not wired` in the
  txRef and the receipt subject records `stubbed: true`. The event is never omitted: a stream missing
  its payment events reads as if payment never happened.
- The registry read, once D1 and A3b land, replacing the per-candidate stub with the real record.

## B3 prep, the [claude] steps, ready ahead of the operator drive

Steps 3, 4 and 5 are done. Steps 1, 2, 6, 7 and 8 need the funded payer and a decision about the
facilitator, and are prepared to copy-paste level below.

### Step 3, the budget with an irreversible freeze

`src/demo/budget.ts`. Total, spent, remaining and frozen, with the arithmetic in the object rather than
in the loop that reads it. Once frozen it refuses every spend, including a zero one, and freezing twice
keeps the first reason because that is the one that stopped the run. An overspend throws rather than
clamping, since a clamped budget keeps a run going with numbers that no longer describe it. A clearable
freeze would be a pause, and a pause is not what beat 1 claims.

### Step 4, the screener

Already shipped with E2: `src/demo/output-check.ts` runs the engine's own C-01 scanners over live tool
output. It is the same mechanism that grades a server for injection, so there is no second opinion to
diverge, and the tests assert it fires on payloads nothing like E1's while staying quiet on ordinary
text. B3's estimate calls this the hour hiding inside the task; it is spent.

### Step 5, freeze then refuse

Also shipped with E2, and now backed by the budget object: a hit emits `injectionCaught`, then `frozen`
with the spend and what is left, then a chained receipt for each, and the loop refuses to spend again.
Fifteen harness tests cover it, including that no `paid` event appears after the hostile turn with four
calls allowed.

### The rail, ready for step 1

`src/demo/payment-rail.ts` carries three implementations behind one interface, and the difference
between them is labelled rather than hidden:

| Rail | What settles | Where it is used |
|---|---|---|
| `stub` | nothing, and every event says so | the default, and every rehearsal so far |
| `hedera-transfer` | a real HBAR transfer, waiting for consensus | proving the rail, and the 02-DECISIONS §12 minimal-payment keep if the x402 leg is cut |
| `hedera-x402` | the full 402 challenge, signed payment, facilitator settlement | beat 1 once a resource server and facilitator are up |

A failed settlement never retries, because retrying against an unknown settlement state is how one call
pays twice. The x402 rail refuses without a resource URL rather than falling back to an unpaid call.

### Read-only proof that the rail is reachable, run 2026-07-25

```
node --env-file-if-exists=.env.local src/demo/cli.ts rail-status --to 0.0.9695674 --amount 100000000

payer        0.0.9695674
balance      939.61271387 HBAR (93961271387 tinybars)
dry run      100000000 tinybars (1 HBAR) to 0.0.9695674
             dry-run 0.0.9695674@1784935865.050866010
```

The ECDSA key parses, testnet answered, and the transfer built and froze with a real transaction id
assigned. Nothing was submitted: moving funds is a `[human]` step and stays one.

### The commands for your drive

```
# step 1, prove the rail. The first moves nothing; the second sends one fee and prints both balances.
node --env-file-if-exists=.env.local src/demo/cli.ts rail-status --to <recipient> --amount 100000000
node --env-file-if-exists=.env.local src/demo/cli.ts settle      --to <recipient> --amount 100000000

# steps 6 and 7, the beat with a real rail. --poisoned is the hostile run, without it the control run.
DEMO_CONTROL_TOKEN=… node --env-file-if-exists=.env.local src/demo/cli.ts beat1 <mcp url> \
  --rail hedera-transfer --pay-to <recipient> --poisoned
DEMO_CONTROL_TOKEN=… node --env-file-if-exists=.env.local src/demo/cli.ts beat1 <mcp url> \
  --rail hedera-transfer --pay-to <recipient>
```

`settle` prints the balance before, the settled transaction id, the balance after, and the difference
including fees, which is the evidence done-when 3 asks for. Run it once before the loop, then read the
balance again at the end of the run: the only movement should be the one call's fee.

### What is still open, and it is a decision rather than work

The x402 leg needs a resource server that answers 402. E1 does not, and adding that to E1 plus running
the self-hosted facilitator is the remaining half of B3. Two ways to go:

1. **`hedera-transfer` for beat 1.** Real settlement on Hedera Testnet, a real transaction id on screen,
   and the honest line stays exactly true: one call's fee moved, nothing after the hostile turn. What it
   is not is an x402 challenge-response, so the track claim would rest on the Agent Kit style payment
   rather than the protocol.
2. **`hedera-x402` end to end.** E1 gains a 402 on `tools/call` and the facilitator runs in Docker. It is
   the stronger claim for the x402 track and it is the part with the most moving pieces on stage.

The rail interface means this is a flag at run time, not a rewrite, and the floor is committed either
way.

## B3, the rail decision and the beat on real settlement, 2026-07-25

**Decided by the operator: `hedera-transfer`.** Real HBAR settlement on Hedera Testnet, waiting for
consensus. The x402 rail stays implemented and unused: it is a runtime flag, so it costs nothing to keep
and needs a 402 resource plus a facilitator to switch on. Nothing on stage claims a challenge-response.

```
payer:                     0.0.9695674 (ECDSA)
payee:                     0.0.9737723, created for this from the A agent's own key so the fee lands in
                           an account the demo agent controls rather than back in the client's
                           create tx 0.0.9695674@1784942230.119772313, funded with 1 HBAR
env recorded:              A_AGENT_HEDERA_ACCOUNT_ID, locally and in all three Vercel environments

step 1, prove the rail:    settled 0.0.9695674@1784942397.260333239
                           balance before 937.75423011 HBAR, after 936.75281877
                           moved 100141134 tinybars, one HBAR plus 141134 in fees

beat 1 on the real rail:   paid 100000000 on hedera-transfer, 0.0.9695674@1784942480.789267915
                           no "stubbed" label, because nothing was stubbed
                           injectionCaught, then frozen, then done. One payment, none after the freeze.
                           receipt chain verified
payee side:                0.0.9737723 holds 300000000 tinybars across 3 received transactions, so the
                           fee is visible from the receiving account, not only from ours
```

### A mislabelled rail, caught by running it

The first real run printed `100000000 on hedera-x402` while the money had moved by native transfer: the
`paid` event hardcoded the x402 literal, and the frozen type only allowed that one value. A field that
names the wrong rail on screen is worse than one that names a plainer rail, so the union was widened by
arbitration and the event now reports whichever rail settled it. The stubbed case says `stub` rather than
implying a protocol that never ran.

## The deployed server, 2026-07-25

Lane 3's two route files landed, so E1 has a public URL.

```
deployed url:                 https://preflight-bay.vercel.app/api/demo-agent/mcp
                              control at /api/demo-agent/variant
stock client over the public
internet:                     the MCP Inspector CLI listed 10 tools on page one with a nextCursor,
                              against the deployed URL. E1 done-when 1, satisfied off localhost.
```

The team-scoped aliases (`preflight-talent-protocol.vercel.app`, and every per-deployment URL) sit behind
Vercel deployment protection and answer 302 to an SSO page, so a judge cannot use them. The
`preflight-bay.vercel.app` alias is public and is the one to put in front of anyone.

### The stateful flip does not survive on serverless, measured

A flip to poisoned answered 200 and read back as poisoned. Twelve consecutive tool calls then all served
**baseline**, and the control endpoint itself read baseline again: the instance holding that state had been
recycled within seconds. The consequence was concrete rather than theoretical. Publishing the F row
against the deployed endpoint graded **B**, because the engine called a clean surface, and that record
superseded the real F record on chain.

The fix needs no infrastructure and no further route files: **the surface can be named in the URL**.
`?surface=poisoned` serves exactly that surface for that request, with no state involved, so a target
that has to be reliably one surface says so in its own URL and the card that points at it records which
surface was graded. Six consecutive calls to `?surface=poisoned` all served poisoned, while the plain URL
served baseline in the same window. The flippable path stays for local runs, where one process holds the
state and it is correct.

### Beat 1's two rows, both public

| Agent | Card endpoint | Grade | Gate | Through a stock MCP client |
|---|---|---|---|---|
| 8427 | `…/mcp?surface=baseline` | B, score 75 | HIRE, fingerprintMatch true | HIRE |
| 8430 | `…/mcp?surface=poisoned` | F, score 0 | REFUSE, "grade F is below the minimum of B" | REFUSE |

```
8427 response tx   0xbf4bbdfaf693acd9c6b65128c713130bc2b91c56d2ad98698778b5df221fc65a
8430 response tx   0x404a0130641196bd9afb59ef50949e5c543b4d662baab4ef14de6a444a9bd5dc
8430 evidence      0G root 0x3ef96ff9157aaf87a29bc4d84129a819fc0eee5218efc2a33b8a89077ec930d6
```

Both rows resolve from the registry, fetch their evidence from 0G, and re-enumerate a public surface, so
neither depends on a process running on anyone's laptop.

### Still open

The hostile turn for the *hired* agent still needs either the durable store or a local run: 8427 is graded
against `?surface=baseline`, and nothing can make that URL turn hostile mid-run by design. The options are
a durable variant store behind `useVariantStore`, or re-pointing 8427's card to `?surface=poisoned` between
grading and the call, which works because poisoned and baseline carry byte-identical tool lists and so the
same fingerprint. The second needs no infrastructure and is one transaction, and it reads honestly as the
agent changing what it points at.
