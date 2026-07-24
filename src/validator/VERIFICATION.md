# Lane 1 verification log: the validator

What actually happened, with real values. The planning repo's task docs are read-only from a lane, so
this file is the evidence and the operator pastes from it.

## A1 step 10, the doctor command (Lane 1 support)

Run: `npm run doctor -- --probe`, 2026-07-24.

```
configuration (15 items)
  resolved  BASE_MAINNET_RPC_URL
  resolved  BASE_SEPOLIA_RPC_URL
  MISSING   VALIDATOR_ADDRESS
  resolved  VALIDATOR_PRIVATE_KEY
  unset     BASE_MAINNET_EXPLORER_API_KEY   (optional, Sourcify is primary)
  unset     BASE_SEPOLIA_EXPLORER_API_KEY   (optional)
  resolved  HEDERA_TESTNET_RPC_URL
  unset     HEDERA_TESTNET_ACCOUNT_ID       (expected, D2)
  unset     HEDERA_TESTNET_PRIVATE_KEY      (expected, D2)
  unset     ZEROG_STORAGE_PRIVATE_KEY       (expected, A3b)
  unset     ZEROG_RPC_URL                   (expected, A3b)
  unset     ZEROG_INDEXER_URL               (expected, A3b)
  resolved  ZEROG_COMPUTE_ROUTER_API_KEY
  unset     VALIDATION_REGISTRY_ADDRESS     (expected, A4)
  unset     VALIDATION_REGISTRY_CHAIN_ID    (expected, A4)

missing required: VALIDATOR_ADDRESS

rpc probe
  ok       Base mainnet: chain 8453, head block 49069974
  ok       Base Sepolia: chain 84532, head block 44580431
  ok       Hedera Testnet: chain 296, head block 38410019
```

Every RPC answered and reported the chain id it was configured as, so none of the three is pointing
at the wrong network. `VALIDATOR_ADDRESS` was a real gap at that point, not a naming choice: B1 checks
who wrote a validation record on a read path that must not hold the private key.

### Second run, operator machine with the full environment, 2026-07-25

Reported **every required item resolved**, 15 items. The only unset values were the two optional
explorer keys (Sourcify is the primary verified-source path and needs no key) and the two
`VALIDATION_REGISTRY_*` values, which wait on A4 by design, so every registry read fails closed until
it lands. That is the correct state, not a gap.

Provisioned and live-verified between the two runs:

| Item | Value | Verified how |
|---|---|---|
| `VALIDATOR_ADDRESS` | `0xCFad8f21B8469790ADc3922814d1df4E08ECF1c8` | set in the environment; the read path now has a validator to compare against |
| `HEDERA_TESTNET_ACCOUNT_ID` | `0.0.9695674`, ECDSA | confirmed on the mirror node, holding 1000 HBAR |
| `ZEROG_RPC_URL` | `https://evmrpc-testnet.0g.ai` | answered with chain id 16602 |
| `ZEROG_INDEXER_URL` | `https://indexer-storage-testnet-turbo.0g.ai` | answered a JSON-RPC probe |
| `FIXTURE_DEPLOYER_ADDRESS` | `0x38E2F18Bc9c50Dc43B93A8A4BcEF518A0B897bA2` | set in the environment; Base Sepolia funding still pending at the faucet |

The fixture deployer key and address joined the config surface and the doctor checklist as expected
tier, so the lane that deploys the staged fixtures reads them from config rather than naming the
variable at a call site. The key sits in the shared environment deliberately: it holds faucet funds on
a testnet, which is not the custody rule the validator and payer keys follow.

## A2, AgentCard resolution

```
IdentityRegistry address used: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432, Base mainnet (8453)
  proxy kind:            ERC-1967, 130 bytes of code at the proxy
  implementation:        0x7274e874ca62410a93bd8bf61c69d8045e399c02
  ABI source:            sourcify.dev/server/v2/contract/8453/<impl>?fields=abi, HTTP 200, 32 functions
  signature confirmed:   tokenURI(uint256 tokenId) view returns (string)
  id type confirmed:     uint256, so a non-integer agent id never reaches the RPC
  also present, for D1:  register(string agentURI), register(string agentURI, tuple[] metadata),
                         setAgentURI(uint256, string), getMetadata(uint256, string) returns (bytes),
                         getAgentWallet(uint256) returns (address), ownerOf(uint256)

known-A agent id / name / endpoints: pending D1. No agent registered on Base mainnet in ids 1 to 70
  declares an MCP service, so the happy path has no live subject until D1 registers ours. Verified
  offline end to end instead: a stub registry read plus a data: card resolves to endpoints.
known-F agent id / name / endpoints: pending D1, same reason.

https:// card resolved: id 7, https://marketplace.olas.network/erc8004/base/ai-agents/5,
  HTTP 200, 519 bytes, registration-v1, services array present. Read at block 49070023.
  id 2 is the negative case: its host answered HTTP 530 with an HTML error page, and the resolver
  refused instead of parsing it.

data: card resolved: id 1, data:application/json;base64, decoded in process to the ClawNews
  registration-v1 card. This is why data: is a fetched scheme and not a guess.

ipfs:// card resolved: not supported, by operator decision on 2026-07-24. Evidence here goes to 0G
  Storage, so no IPFS gateway is a dependency of this project, and an ipfs:// tokenURI refuses with
  a reason naming that. Measurements behind the call, same day, for a CID pinned elsewhere
  (bafybeiaakdeconw7j5z76fgghfdjmsr6tzejotxcwnvmp3nroaw3glgyve):
    gateway.autonolas.tech  HTTP 200 in 0.33s   (the pinner's own gateway)
    dweb.link               HTTP 301 in 0.23s, then no answer inside 20s
    w3s.link                HTTP 301 in 0.11s
    ipfs.io                 no answer inside 25s, twice

unregistered id error observed: id 999999999 on Base mainnet, live:
  "refused [AGENT_RESOLVE, retryable false] agent 999999999 is not registered in the identity
  registry on chain 8453"

empty-endpoints error observed: live on real cards. Ids 1 and 3 to 70 on Base mainnet all resolved to
  a parseable card that declares no MCP service, and every one of them threw
  "declares no MCP endpoint, so there is no surface to exercise and nothing to grade" rather than
  returning a card with an empty array. Check 3 of the done-when list is therefore verified against
  real documents, not a synthetic one.

raw round trip: tested. The retained document reparses to an identical card, and `raw` equals the
  input document with nothing added, removed, or reordered.

bounds: tested against a real local socket. A 404 refuses and is not retryable, a body over the cap
  refuses while streaming rather than after downloading, and a server that never responds refuses on
  the timeout as retryable.

suite: 36 tests, 36 pass, offline. `tsc --noEmit` clean, `eslint` clean, `next build` green.
```

## A3a, grade, canonicalize, hash

```
methodologyVersion read from package: litmus-v17
litmus package version installed:     0.36.0 (02-DECISIONS §2 recorded 0.35.0 on 7/20, VERIFY fired)
value tracks the package, proven:     installed 0.35.0 with --no-save, no source edit, the CLI
                                      reported litmus-v16; restored 0.36.0, it reported litmus-v17
engine bundle schema version:         1.10.0

live grade, end to end through gradeAgent, 2026-07-25:
  target        https://mcp.deepwiki.com/mcp   (02-DECISIONS §13.3's beat-3 primary)
  grade         B, score 75
  evidenceHash  0x57d7f471f53d377521098adda34f425099c89dc8d44c1eee6580b5cad02aee6a
  fingerprint   0x26dbdfa6386cf3e82b457512d603e682ab0d5b90c8685c95776cc0166c1a6d0e
  tools         3, enumerated in one page: ask_question, read_wiki_contents, read_wiki_structure
  wall clock    62s
  presented as  claude-code 2.1.0 (the engine picks a client identity per litmus-v17)

round trip, same process:     byte identical
round trip, separate process: verified on that real bundle. Written as canonical bytes (19326),
  reloaded by `node src/validator/canonical-roundtrip.ts`, re-canonicalized, re-hashed to
  0x57d7f471...aee6a, equal to the in-process value. The test does the same with the keys
  deliberately reversed on the way to disk, so the child has to sort them back itself.
our canonical form vs the engine's canonicalStringify: byte identical on every fixture, asserted in
  the suite, so a divergence fails a test instead of producing an unverifiable attestation.

known-A / known-F fixtures: pending D1 and E1. The engine integration is proven against a live
  third-party server instead, and the two fixtures grade through the same path once they exist.

suite: 80 tests, 76 pass, 4 skipped (Lane 2's live-network cases), 0 fail.
```

### The finding that changes beat 1's copy

**A remote https MCP server cannot grade A. B is its ceiling.** The engine's own words, from the run
above: `Injection checks passed; egress not verified. Not verified: C-02, C-03 (no sandbox (Docker
unavailable); no canary could be planted on a remote target).` C-01 and C-04 passed.

Two separate causes, and only one is fixable on the day:

- **C-02 skipped: no sandbox, Docker unavailable.** Starting Docker Desktop addresses this one
  (02-DECISIONS §13.6 already recorded the daemon as not running).
- **C-03 skipped: no canary could be planted on a remote target.** Inherent. A canary has to be
  planted in the server's own environment, which a remote operator's server does not offer.

The installed package states the same rule in its own types: `PAYMENT_PASSING` is documented as
"Only a LOCAL A clears it: remote servers cap at B (egress unverified)".

So if D1's demo agents declare https endpoints (E1 on a deploy URL), the hired agent grades B, and
"gated on grade A" is not a line this build can say truthfully. Three ways out:

1. **Set the gate's minGrade to B and say the accurate line.** `01-INTERFACES` §4 already freezes
   `minGrade` default `'B'`, so this is zero code. The three demo rows still work: the injection
   agent grades F and is blocked, the clean agent grades B and is hired, the drifted agent is
   refused on its fingerprint regardless of letter. The caveat becomes part of the pitch: a remote
   target's egress and canary behavior cannot be verified, and we say so on screen instead of
   showing an A we did not earn.
2. **Ship E1 as an npm package and grade it over stdio under Docker**, where C-02 and C-03 both run
   and A is reachable. Costs packaging work, a Docker daemon on the stage machine, and an agent card
   whose declared surface is a package ref rather than a URL, which A2's extraction and D1's cards
   would both have to accept.
3. Both: grade the local variant for the A row, the remote one for everything else. Most work, most
   moving parts on stage.

Recommendation: option 1. It is free, it is true, and the disclosed-limits framing is the project's
own thesis rather than a concession.

### Open, for the operator

- `VALIDATOR_ADDRESS` is not set anywhere yet. Needed before B1 reads a record.
- `IDENTITY_REGISTRY_CHAIN_ID` defaults to Base mainnet (8453), per 02-DECISIONS §4. If D1 registers
  the demo agents on Base Sepolia instead, set it to 84532 and nothing else changes.
- D1's cards must declare their MCP endpoint as a `services` entry whose name reads as MCP, for
  example `{ "name": "MCP", "endpoint": "https://<E1 URL>/mcp" }`. Nothing in ids 1 to 70 of the live
  registry does this, so it will not happen by accident.
