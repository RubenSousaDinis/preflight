# 8004scan leaders: mainnet grade + Sepolia mirror publish/claim

> Date: 2026-07-25  
> Status: approved; implementing on `feature/8004scan-mainnet-grade-sepolia-mirror`  
> Repo: `preflight`  
> Extends: `docs/superpowers/specs/2026-07-25-ens-claim-grade-redesign-design.md`  
> Supersedes that doc’s non-goal “Integrating 8004scan mainnet leaderboard agents into this flow.”

## Intent

Let the booth grade real [8004scan leaderboard](https://8004scan.io/leaderboard) agents on **Base mainnet**, while still **claiming ENS** and **publishing grades** on the event’s **Base Sepolia** stack (`preflight.basetest.eth` + Sepolia ValidationRegistry).

ENS text records remain a **mirror of the ValidationRegistry, never a source**. Nothing ENS or 8004scan score sits in a hire/refuse verdict path.

## Decisions (approved)

| Decision | Choice |
|---|---|
| Grade source for leaders | Base mainnet IdentityRegistry (8453) + declared MCP |
| Catalog source | Live 8004scan public API; curated Top-20 Base static fallback |
| Chains in catalog (this pass) | **Base only** (8453). Skip Celo-only / non-Base rows |
| Sepolia identity for publish | On demand: `register(mainnet tokenURI)` as **validator** |
| Sepolia NFT owner | Preflight validator |
| ENS claim owner | Mainnet `ownerOf(mainnetId)` |
| ENS label | `agent{sepoliaId}.preflight.basetest.eth` |
| Publish registry | Sepolia ValidationRegistry, against **sepoliaId** |
| Mainnet Basename / mainnet publish | Out of scope |
| Transfer Sepolia NFT to mainnet owner | Out of scope |

## Section 1 — Catalog + grade

### Catalog

- Merge existing Sepolia demo / known agents with **Top N Base (8453)** agents from the [8004scan public API](https://8004scan.io/developers) (`https://8004scan.io/api/v1/public/…`).
- Each leaderboard row shows: display name, `mainnetId`, optional `sepoliaId` once mirrored, optional ENS sub-line when a resolver exists.
- If the API is unavailable or rate-limited: use an in-repo curated Top-20 Base list (fallback, not the happy path).

### Grade

```
ref (mainnet id | sepolia demo id | optional ENS → agentId)
  → resolve on the correct IdentityRegistry (8453 or 84532)
  → gradeAgent(card)   // litmus on declared MCP
```

- Leaderboard picks resolve on **8453**.
- Existing demos resolve on **84532** (unchanged).
- Refuse bare MCP URLs / npm refs as grade inputs (unchanged).
- No ENS read/write in or before `vetAgent`.

### UI disclosure

- Leaderboard rows labeled as mainnet / 8004scan source.
- Demo rows labeled as Sepolia fixtures.

## Section 2 — Sepolia mirror, publish, claim

### `ensureSepoliaMirror(mainnetId)` (idempotent)

1. If a durable link `mainnetId → sepoliaId` exists, return it.
2. Else read mainnet `tokenURI` / registration card, call Sepolia IdentityRegistry `register(agentURI)` signing as the validator, persist the link.
3. The registered URI is the mainnet card (same MCP surface). Sepolia NFT **owner = validator**.

### Link store

- Durable map `mainnetId → sepoliaId` (Vercel Blob and/or committed JSON maintained by CLI; server may append on successful register).
- Optional recovery: embed a clear mainnet id marker in the Sepolia card description when registering.
- The link map is **not** sourced from ENS.

### Publish

- Call `ensureSepoliaMirror` first when the graded subject was a mainnet leader.
- Publish the evidence against **sepoliaId** on the Sepolia ValidationRegistry.
- ENS mirror sync after publish: registry-sourced only; **do not** auto-create a subname; skip when not validator-writable (unchanged policy).

### Claim ENS

- Name: `agent{sepoliaId}` under `preflight.basetest.eth` (Base Sepolia only).
- Ensures Sepolia mirror exists first (so the label id matches the ValidationRegistry subject).
- Subname owner = mainnet `ownerOf(mainnetId)`.
- Parent remains validator-owned.
- Claim does not create or change a grade.

### Booth order

1. Grade (mainnet card / MCP)  
2. Optional Claim (mirror + ENS to mainnet owner)  
3. Optional Publish (mirror + Sepolia validation row)

## Section 3 — Non-goals, trust, verification

### Non-goals

- Celo / non-Base leaderboard grading in this pass  
- Mainnet Basename or mainnet ValidationRegistry publish  
- Transferring the Sepolia identity NFT to the mainnet owner  
- Using 8004scan scores in hire/refuse  
- ENS as source of truth  
- ENS labels of the form `agent{mainnetId}` when `sepoliaId !== mainnetId`

### Trust disclosure (must appear on claim/publish success)

- The grade evidence comes from the **mainnet** agent card’s MCP endpoint.
- The Sepolia identity is a **validator-owned mirror registration** of that card, not a co-signature by the mainnet owner.
- The ENS subname is owned by the **mainnet** `ownerOf`; the Sepolia identity is owned by the **validator**.

### Verification

- Catalog lists Base leaders from API (or static fallback).  
- Grade a Base top agent (e.g. Clawdia) end-to-end.  
- Claim creates/links `sepoliaId` and an ENS name owned by mainnet `ownerOf`.  
- Publish writes a Sepolia ValidationRegistry row for `sepoliaId`; `ens verify` agrees when the name is writable.  
- Existing Sepolia demos still grade / claim / publish as before.

## Implementation sketch (for the plan)

1. 8004scan client + catalog merge (Base filter, static fallback).  
2. `ensureSepoliaMirror` + durable link store + CLI.  
3. Wire grade path to chain-aware resolve; claim/publish call mirror then Sepolia ENS / ValidationRegistry.  
4. UI labels + trust copy on claim/publish.  
5. Tests: API fallback, mirror idempotency, claim owner = mainnet ownerOf, publish uses sepoliaId.
