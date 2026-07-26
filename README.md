# Preflight

A fail-closed trust layer for two moments agents get wrong: hiring another agent, and sending a
transaction to a contract nobody has verified by hand. An ERC-8004 behavioral validator grades an
agent, two gates (`vetAgent`, `txGuard`) refuse by default, and a Preflight MCP server exposes both
checks to any client.

Built during ETHGlobal Lisbon 2026 (Classic track). This repo's first commit landed at the event
clock.

## Disclosed prior inputs

Stated here, before any feature code, per Classic-track eligibility:

1. [`@polygraphso/litmus`](https://www.npmjs.com/package/@polygraphso/litmus) from npm
   (Apache-2.0), the open behavioral grading engine, consumed as a library like any other
   third-party dependency would be. Its source is not read during this build, only its published
   package and public types.
2. A private planning repo (prose, a judge deck, an explainer) and Claude Design mockups, used to
   plan this build before the event. It carries no project code of its own.

polygraph's published grades and EAS attestations on Base are not an input: this project neither
writes to nor reads from them. Every grade shown here is produced at the event, by this project's
own validator, and read from the ERC-8004 Validation Registry.

## What shipped

Three parts, in the order a caller meets them:

- **The validator.** Grades an agent's live MCP tool surface with the open litmus engine
  (methodology tag `litmus-v17`), canonicalizes the evidence, pins it to 0G Storage, and writes the
  score to the ERC-8004 Validation Registry. A watcher re-checks the live surface and re-grades on
  change.
- **Two gates, both fail closed.** `vetAgent` (`src/gates/vet`) reads the registry before a hire:
  it refuses an agent below the grade floor (B or above), and refuses one whose live tool surface
  no longer matches the fingerprint it was graded on. `txGuard` (`src/gates/tx`) forks the chain at
  the live block, simulates the exact transaction before the signature, and blocks on four red
  flags: an unlimited approval to an unverified spender, a token that buys but cannot sell, value
  routed to an unverified callee, and a hidden upgrade path. An advisory source scan on 0G Compute
  sits beside the verdict and can never move it.
- **A Preflight MCP server.** Two tools, `preflight_agent` and `preflight_tx`, expose both checks
  to any MCP client over stdio. The server wraps the SDK functions and does not reimplement them;
  verdict equivalence against a stock client is recorded field for field in
  `src/mcp/preflight/VERIFICATION.md`.

The live console is at [preflight-bay.vercel.app](https://preflight-bay.vercel.app). Every grade
shown there has a public page at `/a/{agentId}`, for example
[preflight-bay.vercel.app/a/8427](https://preflight-bay.vercel.app/a/8427).

## Run it

```bash
npm install
npm run doctor        # names every required variable and what it is for
npm test              # the offline suite
npm run test:live     # includes the live network tests, serialized
npm run dev           # the console on localhost:3000
npm run check:unseen  # reproduces the unseen mainnet run below, reads only
```

## Evidence

Real values from the verification logs in `src/*/VERIFICATION.md`, which record what was actually
run. Anything not recorded there was not run.

**The registry and the demo agents.** The standard's ValidationRegistry is not deployed on any
chain yet, so this project deployed the reference implementation unmodified to Base Sepolia at
[`0xc0274d5a902c1d03c7f428f0722127868b187393`](https://sepolia.basescan.org/address/0xc0274d5a902c1d03c7f428f0722127868b187393)
(chain 84532, source verified on Sourcify). The identity registry it reads,
`0x8004A818BFB912233c491871b3d84c89A494BD9e`, is the one the standard's authors run. The validator
signs as `0xCFad8f21B8469790ADc3922814d1df4E08ECF1c8`. Demo agents, all graded at the event: 8427
(B, hired), 8430 (F, refused), 8436 (hostile mid-task), 8437 (the updatable surface the rug-pull
beat re-points), 8441.

**0G Storage.** Evidence bundles are pinned from memory and re-derivable: upload transaction
`0x52f967cde67bb08be6554c38aba41f2ee24fc80a40e384f07212790ddb5bb2d6` on the 0G chain (16602),
merkle root `0x64dacb7e6cc40898dc7f0e561ff4b6a620edb0c2ac024982179afa6846059521`. The bundle was
fetched back over HTTP, reparsed, re-canonicalized, and re-hashed to the same keccak256,
`0xaea2b7758fd871ea27bae33e02a678cd5682f43f66a0cc2db277d15006c29972`.

**0G Compute.** The advisory source scan runs on route `0g-compute:0gm-1.0-35b-a3b`. Scanned
against a fixture whose source instructs an automated reviewer to report it clean, it reported the
manipulation attempt instead of complying (`src/gates/tx/VERIFICATION.md`). The scan is advisory
by construction: no code path lets it move a verdict.

**Hedera.** The hired agent is paid per call on the `hedera-transfer` rail; the wiring dry run
settled and reconciled as HashScan transaction `1784934812.779483104` (payee `0.0.9737723`).
Every decision receipt is mirrored fire-and-forget to Hedera Consensus topic
[`0.0.9736592`](https://hashscan.io/testnet/topic/0.0.9736592) through the Hedera Agent Kit's
audit-trail hook. Receipts themselves are Ed25519-signed and hash-chained, and the console
verifies the chain in place.

**ENS.** Grades are mirrored, never sourced, to ENS text records on Base Sepolia: parent
`preflight.basetest.eth`, one subname per agent (`agent8427.preflight.basetest.eth` through
`agent8441`), fifteen keys per name copied from the ValidationRegistry, `ens verify` exit 0 for
all five (`src/validator/ens/VERIFICATION.md`). The console grades an agent by name: the name
resolves to the registry id and the engine runs.

**The firewall, staged.** Nine fixture contracts plus a staged honeypot market deployed to Base
Sepolia (`contracts/deployments/base-sepolia.json`). Sample verdict through the MCP tool: an
unlimited approve of WETH to an unverified spender returns BLOCK, flag `drainer-approval`,
confirmed by simulation, code fingerprint
`0x71ed66767cbff00f4275d16410aa8457f35b228bc9f862042af8e7cbb241391f`, reproducible from block
49072942.

**The firewall, unseen.** Against Base mainnet (8453), addresses this project did not write. The
Grand Base drainer `0x2aF864fb54b55900Cd58d19c7102d9e4FA8D84a3`: `transferOwnership` to an unnamed
address returns BLOCK, flag `owner-backdoor`, confirmed by simulation, block 49073514, calldata
hash `0x6e177eac7747adaf14b9e687678f42abf8f32d0c272b3f02a610149890d6b2f7`; an unlimited approve on
the same token returns BLOCK, flag `drainer-approval`, block 49073525. The clean control, WETH
`0x4200000000000000000000000000000000000006` `deposit()` with 0.01 ETH, returns ALLOW at block
49073529. Every verdict re-ran from its recorded tuple and matched.

## Disclosed limits

- **Evasion.** A target that detects the test context and behaves during the check. The live
  recheck narrows the window and does not close it. What is validated is the capability surface,
  not intent.
- **State-level verdicts.** A per-transaction verdict is reproducible for a given block and the
  state at it, not a prediction of the landed outcome.

Said plainly alongside them: reproducibility means falsifiable, not independent. v1 is self-run
and self-minted, and a false grade can be disproven by re-running the open engine. Nobody else has
re-run it yet. One more bound worth naming: the registry has no onchain expiry; the 24 hour bound
(`lastUpdate + 86400`) lives in this project's reader, which treats an older record as expired and
refuses.

## Set it up in your agent

Adoption is one step: add the Preflight server to your agent's MCP config. This is the literal
entry, with the two paths pointed at your clone:

```json
{
  "mcpServers": {
    "preflight": {
      "command": "node",
      "args": [
        "--env-file-if-exists=/path/to/preflight/.env.local",
        "/path/to/preflight/src/mcp/preflight/stdio.ts"
      ]
    }
  }
}
```

The clone and install beside it, which is also the SDK install (`vetAgent` and `txGuard` import
from `src/gates`):

```bash
git clone https://github.com/RubenSousaDinis/preflight.git && cd preflight && npm install
```

The environment either path needs, named in `.env.local` (the config entry above loads it;
`npm run doctor` reports anything missing):

- `preflight_tx` and `txGuard`: `BASE_MAINNET_RPC_URL` and `BASE_SEPOLIA_RPC_URL`, chosen by the
  `chainId` the call names.
- `preflight_agent` and `vetAgent`: `BASE_SEPOLIA_RPC_URL`, `VALIDATION_REGISTRY_ADDRESS`,
  `VALIDATION_REGISTRY_CHAIN_ID`, `VALIDATOR_ADDRESS`.
- Optional, for the advisory scan only: `ZEROG_COMPUTE_ROUTER_API_KEY`, `ZEROG_COMPUTE_BASE_URL`,
  `ZEROG_COMPUTE_MODEL`. Unset, the scan reports itself not run; it never moves a verdict either
  way.
