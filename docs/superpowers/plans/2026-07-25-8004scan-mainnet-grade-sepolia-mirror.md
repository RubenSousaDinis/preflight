# 8004scan mainnet grade + Sepolia mirror Implementation Plan

> **For agentic workers:** implement task-by-task.  
> **Spec:** `docs/superpowers/specs/2026-07-25-8004scan-mainnet-grade-sepolia-mirror-design.md`

**Goal:** Catalog Base 8004scan leaders; grade on mainnet; claim/publish via validator-owned Sepolia mirror.

## Tasks

### Task 1: Catalog (8004scan + static fallback)
- `app/lib/scan8004.ts` — fetch `/api/v1/public/agents/8453/{id}`, Base curated ids, MCP filter
- Merge into `discoverAgentsForGrade`
- Tests for fallback + Base filter

### Task 2: Link store + `ensureSepoliaMirror`
- `src/validator/sepolia-mirror.ts` — register mainnet tokenURI on Sepolia as validator
- `data/mainnet-sepolia-links.json` + env overlay `MAINNET_SEPOLIA_LINKS`
- CLI `mirror-from-mainnet <mainnetId> [--send]`

### Task 3: Grade / claim / publish wiring + UI
- `submitAgent` takes `chainId` (8453 vs 84532)
- `claimAgent` for mainnet ids: mirror → claim ENS for sepoliaId with mainnet ownerOf
- Trust copy on claim success; catalog labels
- Commit, PR, deploy
