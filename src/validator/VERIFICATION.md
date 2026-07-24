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
at the wrong network. `VALIDATOR_ADDRESS` is a real gap, not a naming choice: B1 checks who wrote a
validation record on a read path that must not hold the private key.

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

### Open, for the operator

- `VALIDATOR_ADDRESS` is not set anywhere yet. Needed before B1 reads a record.
- `IDENTITY_REGISTRY_CHAIN_ID` defaults to Base mainnet (8453), per 02-DECISIONS §4. If D1 registers
  the demo agents on Base Sepolia instead, set it to 84532 and nothing else changes.
- D1's cards must declare their MCP endpoint as a `services` entry whose name reads as MCP, for
  example `{ "name": "MCP", "endpoint": "https://<E1 URL>/mcp" }`. Nothing in ids 1 to 70 of the live
  registry does this, so it will not happen by accident.
