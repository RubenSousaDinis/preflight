# ENS claim + grade-without-ENS Implementation Plan

> **For agentic workers:** implement task-by-task; checkboxes below.

**Goal:** Grade by registry id without ENS; optional claim gives subname ownership to IdentityRegistry owner.

**Architecture:** `submitAgent` resolves id first (ENS optional). `claimSubname` reads `ownerOf` and calls existing `ensureSubname` with that owner. Catalog lists known agents whether or not mirrored.

**Tech Stack:** existing `src/validator/ens`, Next server actions, Basenames Sepolia.

## Global Constraints

- ENS never in verdict path; mirror never source; Sepolia only; no claim contract this pass.

---

### Task 1: Id-first grade + catalog without ENS requirement

- [x] Restore `submitAgent` to accept registry id; optional ENS name
- [x] Catalog shows known agents by id/label; ENS sub-line if present
- [x] Update console lede
- [x] Tests + commit

### Task 2: `claimSubname` + CLI `ens claim`

- [x] `claimSubname(agentId)` → `ownerOf` → `ensureSubname(..., { owner })`
- [x] CLI `ens claim <id> [--send]`
- [x] Offline tests for claim planning
- [x] Commit

### Task 3: Claim UI + deck note

- [x] Server action + claim control on grade form
- [x] Deck slide: optional name, owner-held after claim
- [ ] Commit, PR, merge, deploy
