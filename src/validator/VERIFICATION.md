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
   showing an A we did not earn. **Taken 2026-07-25:** spoken and rendered copy, and
   `02-DECISIONS` §8/§10, state the grade floor as B or above.
2. **Ship E1 as an npm package and grade it over stdio under Docker**, where C-02 and C-03 both run
   and A is reachable. Costs packaging work, a Docker daemon on the stage machine, and an agent card
   whose declared surface is a package ref rather than a URL, which A2's extraction and D1's cards
   would both have to accept.
3. Both: grade the local variant for the A row, the remote one for everything else. Most work, most
   moving parts on stage.

Recommendation: option 1. It is free, it is true, and the disclosed-limits framing is the project's
own thesis rather than a concession.

## A3b prep, the [claude] steps, ready ahead of the operator slot

Steps 4, 7 and 10 are done, plus the publish path from commit point 1. Steps 2, 5, 6, 8 and 9 need the
key and are prepared to copy-paste level below.

### What the reference contract actually does, and the three things that differ from the plan

Read from `erc-8004/erc-8004-contracts@master/contracts/ValidationRegistryUpgradeable.sol`, which is
the contract A4 deploys. Each of these changes behavior, so none is a footnote:

1. **There is no expiry onchain.** `validationResponse(bytes32 requestHash, uint8 response, string
   responseURI, bytes32 responseHash, string tag)` takes no `expirationTime`, and `ValidationStatus`
   holds no expiry field, only `lastUpdate`. `01-INTERFACES` §3 and A3b's invariant both assume one,
   which is an EAS property, not an ERC-8004 one. `expiresAt` is therefore derived as
   `lastUpdate + 86400` and enforced by the reader, so an expired record is still treated as absent.
   **This is an interface-semantics change and it needs your call**: the frozen field keeps its name
   and type, and what moves is where the bound lives. The UI must say the expiry is enforced by the
   reader rather than implying the chain carries it.
2. **Publishing is two transactions, and the first is permissioned.** `validationResponse` reverts with
   "unknown" unless the `requestHash` already exists, and `validationRequest` may only be sent by
   `ownerOf(agentId)` or an approved operator in the IdentityRegistry. So leg 1 is sent by whoever owns
   the demo agents and leg 2 by the validator. If D1 registers the agents from the validator wallet,
   one key does both; if not, leg 1 needs the owner's key and the runbook needs two signers.
3. **`getValidationStatus` reverts for an unknown hash** and does not return `hasResponse`. A request
   with no response reads back as `response: 0` with a zero `responseHash`, and `response: 0` is also a
   legitimate grade F. Presence is therefore decided by the responseHash. A reader that tested the
   score would treat every F as an absent record, which is the quietest possible way to lose the F row
   of beat 1.

**The trap worth naming before A4 runs:** the ValidationRegistry is initialized against one
IdentityRegistry, and leg 1 calls `ownerOf(agentId)` on it. The agents and the registry have to be on
the same chain. If A4 deploys to Base Sepolia while D1 registers on Base mainnet, every publish
reverts on a line that looks unrelated.

### The 0G Storage path, verified for real

```
provider:      0G Storage, @0gfoundation/0g-storage-ts-sdk 1.2.10, uploaded from memory
0G chain:      chainId 16602, storage fee paid 122934579848 wei
upload tx:     0x52f967cde67bb08be6554c38aba41f2ee24fc80a40e384f07212790ddb5bb2d6
merkle root:   0x64dacb7e6cc40898dc7f0e561ff4b6a620edb0c2ac024982179afa6846059521
retrieval uri: https://indexer-storage-testnet-turbo.0g.ai/file?root=0x64dacb7e…9521
bundle:        961 bytes of canonical evidence, keccak256
               0xaea2b7758fd871ea27bae33e02a678cd5682f43f66a0cc2db277d15006c29972
third-party
re-derivation: MATCHES. Fetched back over HTTP, reparsed, re-canonicalized, re-hashed to the same
               value. That is A3b check 3, on the real provider, before the slot.
```

The bytes uploaded are the bytes that were canonicalized: the hash and the upload read the same string,
computed once. The data-URI degrade is implemented and tested alongside it, so a provider outage costs
the content-addressed property and nothing else.

### The commands for your slot

```
# step 4 and 5, nothing sent: grade, publish the evidence, print both legs' exact arguments
node --env-file-if-exists=.env.local src/validator/cli.ts publish <agentId> --pin zerog

# step 6 and 9, signs leg 1 and leg 2, then confirms by reading the record back
node --env-file-if-exists=.env.local src/validator/cli.ts publish <agentId> --pin zerog --send

# add --request-exists if leg 1 already landed and only the response needs re-sending

# step 8, an independent path: fetch the published evidence and re-derive its hash
node --env-file-if-exists=.env.local src/validator/cli.ts verify-evidence <uri> <responseHash>

# check 4, the validator filter, from the read side
node --env-file-if-exists=.env.local src/validator/cli.ts read-validation <agentId>
node --env-file-if-exists=.env.local src/validator/cli.ts read-validation <agentId> --validator 0x…other
```

Confirmed already: with `VALIDATION_REGISTRY_ADDRESS` unset, `read-validation` refuses with
"VALIDATION_REGISTRY_ADDRESS is not set, so reading or writing a validation record cannot run" rather
than returning null. An outage is never reported as an answer.

Still blocked on you: A4's registry address and chain id, and which wallet owns the demo agents.

## A3b step 7 and 10, integrated against the live A4 registry

The TODO-INTEGRATE seam is closed. Run 2026-07-25 against the real contract, not a fixture.

```
registry:            0xc0274d5a902c1d03c7f428f0722127868b187393, chain 84532
getIdentityRegistry: 0x8004A818BFB912233c491871b3d84c89A494BD9e, the live Sepolia identity registry
configured validator: 0xCFad8f21B8469790ADc3922814d1df4E08ECF1c8

readValidation("8427") returned the smoke record, all fields from chain state:
  score        100
  tag          "litmus-smoke"   (a throwaway; real records read the tag from the installed package)
  responseHash 0x09f75be291682e71e350b6ec50b93a7f12b2b52a10846d08fbecd750071b4f16
  validator    0xCFad8f21B8469790ADc3922814d1df4E08ECF1c8
  lastUpdate   1784932088, so the derived expiresAt is 1785018488, in the future
  requestHash  0xf494d18267bb95792e4fe3e771f6c53ca442e6c3e74966210c4d9af325bc3627
  txHash       0x3dfae8f6e6de531ce9b7f2886bbb8357bde6bcfe6a98883ffe9da4a6bf3c7f0c
  responseURI  data:application/json,{"evidence":"a4-smoke"}

check 4, the validator filter, both directions:
  read-validation 8427                          -> the record above
  read-validation 8427 --validator 0x2222…2222  -> null, "no usable record from this validator"
  read-validation 9999                          -> null, no record for an agent with none
```

Two findings from the integration, both fixed rather than noted:

1. **The configured endpoint caps `eth_getLogs`.** A 1000 block window answered; 10000 blocks and
   `fromBlock: "earliest"` both came back "Requested resource not available". The evidence URI lives in
   the `ValidationResponse` event, so the reader now walks backwards from the head in 900 block chunks
   and stops at the first hit, with an optional `VALIDATION_REGISTRY_DEPLOY_BLOCK` to floor the walk. A
   record written minutes ago is found in the first call. Not finding one returns null and refuses
   downstream as unreachable evidence; an RPC that fails mid-search throws, because that is an outage
   rather than an answer.
2. **`txHash` now means the transaction.** The storage read returns no transaction, only the
   requestHash, so before this the field carried the requestHash. The event carries
   `transactionHash`, and the reader is already reading that event for the URI, so both now come from
   it and the requestHash is reported alongside rather than in its place.

The mismatch path also demonstrated itself on real onchain data: verifying the smoke record's
`data:` evidence against its own `responseHash` returned **MISMATCH** with the recomputed
`0x6914e915…1ecd`. The record's document and its hash genuinely do not correspond, which is exactly
what a reader should say about them.

### Open, for the operator

- `VALIDATOR_ADDRESS` is not set anywhere yet. Needed before B1 reads a record.
- `IDENTITY_REGISTRY_CHAIN_ID` defaults to Base mainnet (8453), per 02-DECISIONS §4. If D1 registers
  the demo agents on Base Sepolia instead, set it to 84532 and nothing else changes.
- D1's cards must declare their MCP endpoint as a `services` entry whose name reads as MCP, for
  example `{ "name": "MCP", "endpoint": "https://<E1 URL>/mcp" }`. Nothing in ids 1 to 70 of the live
  registry does this, so it will not happen by accident.

## A3b, published for real, 2026-07-25

Run by Lane 1 at the operator's direction, with the validator key from the shared environment.

```
ValidationRegistry used:       0xc0274d5a902C1D03c7F428f0722127868B187393, chain 84532 (A4's deploy)
validator sending address:     0xCFad8f21B8469790ADc3922814d1df4E08ECF1c8, 0.0499 ETH on Base Sepolia
subject agent:                 8427, already registered on Sepolia and owned by the validator, so leg 1
                               was authorized by the same key
card written first:            setAgentURI(8427, <inline registration-v1 card>) in
                               0xdd4714e0585f5281636d977b1bc7ef1d2c89ad7f804f53da85f92f1ee1137a6d
                               endpoint https://mcp.deepwiki.com/mcp, resolved back as preflight-demo-a
pinning path used:             0G Storage, 19757 bytes
                               root 0x75564b197abec87ec1c28a9e3485118be4f26f691e05ed86f70364aee565b0c2

known-B (the hire row):        grade B, score 75, tag litmus-v17
  responseURI                  https://indexer-storage-testnet-turbo.0g.ai/file?root=0x75564b19…b0c2
  responseHash                 0x643ec3ec396198f7000e4b279bbfb1b4c9f4a4ddef7e91fe2161d8a7c1ff9bf7
  requestHash                  0x6b94b95cf28f1a82b1749b6a4eccd4f4aaf477cf572709ea4f4379e416ba9433
  response tx                  0x79538c5c47faccdbc89af28223aca52552dc8a6e1fd33b8e27bfa9ea1ba6151b
expirationTime / expiresAt:    no onchain expiry exists in this contract, so expiresAt is derived:
                               lastUpdate 1784941502 + 86400 = 1785027902, in the future
tag read back onchain:         litmus-v17, equal to the methodologyVersion A3a logged
independent re-derivation:     MATCHES. Fetched the 0G URL over HTTP, reparsed, re-canonicalized,
                               re-hashed to 0x643ec3ec…9bf7, the same value the record carries.
readValidation with a
foreign validator:             null, "no usable record from this validator"
```

### Two failures it cost transactions to find

**The gas estimate on this endpoint is optimistic.** `validationResponse` actually costs 133,926 gas and
was estimated at 133,334, so it reverted twice for want of six hundred gas. viem sends the raw estimate
with no buffer. Worse, that revert happens *after* the storage writes, so it costs as much as success and
lands nothing. The write path now estimates and adds a quarter.

**A mined receipt is not a visible state.** Leg 2 can be built against a node that has not yet seen leg
1's block, so the write path polls for the request it just made before answering it.

Both failures left an orphaned request on chain (`0xec234c74…`, and the first attempt's) with a response
of zero and a zero responseHash. That is exactly the case the reader already handles: a request with no
response is not a record, so those are ignored rather than read as a grade of F.

### The reader on real data, with two records

`current 8427` now shows supersession working on chain rather than in a test:

```
selected: block 44586607, log 125, score 75
history:  2 record(s), oldest first
  block 44581900 log 93   score 100  0xf494d18267bb9579…  (A4's smoke record)
  block 44586607 log 125  score 75   0x6b94b95cf28f1a82…  (this publish)
```

Ordering by wall clock would have been free to pick the score-100 smoke record. Ordering by block picks
the one that superseded it, and both stay readable.

## B1 check 1 and B7 equivalence, unstubbed

```
vet 8427            HIRE, grade B, score 75, fingerprintMatch true
                    "grade B meets the minimum of B, the evidence hashes to the record, and the live
                     tool surface matches the surface that was graded"
preflight_agent
through the stock
MCP client          the same HIRE, the same reason, the same record, isError false
```

One interoperability fix fell out of that last check: the MCP Inspector coerces `ref=8427` to a JSON
number, and the handler required a string, so it refused. Refusing was correct but needlessly brittle, so
an integer id is now accepted and normalized, since it carries the same value losslessly. A non-integer
still refuses.

### The expiry decision, settled

`01-INTERFACES.md` §3 asks for a non-zero `expirationTime` at the first write, and A3b restates it as an
invariant. Neither is implementable against the contract A4 deployed: `ValidationStatus` is
`{validatorAddress, agentId, response, responseHash, tag, lastUpdate, hasResponse}` and
`validationResponse` takes no expiration argument. There is no field to write.

Settled, at the operator's direction: **the bound lives in the reader and is disclosed as such.**
`expiresAt = lastUpdate + 86400`, and the gate enforces the tighter of that and the policy's
`maxAgeSeconds`. On the published record: `lastUpdate 1784941502` gives `expiresAt 1785027902`. The
fail-closed rule §3 actually cares about is unchanged, since an expired record is still treated as
absent; what moved is only where the bound is computed.

Rejected: encoding an expiry in the `tag`. A3b check 6 requires the tag read back onchain to equal the
`methodologyVersion`, so `litmus-v17|exp=…` would fail that check and would not parse for the two
records already published.

E3 should carry this into the README's limits section verbatim: the registry records when a record was
last updated, not when it expires.
