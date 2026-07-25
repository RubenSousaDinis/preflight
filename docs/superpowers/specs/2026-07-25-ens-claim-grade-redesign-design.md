# ENS claim + grade-without-ENS redesign

> Date: 2026-07-25  
> Status: approved; implemented on `feature/ens-claim-grade-ship`  
> Repo: `preflight`  
> Supersedes the booth UX where grading required an ENS name under `preflight.basetest.eth`

## Intent

Separate two concerns that were wrongly fused:

1. **Grading** an ERC-8004 agent on Base Sepolia.
2. **Optionally claiming** a Preflight ENS subname so the agent’s owner can carry discoverable mirror records.

ENS text records remain a **mirror of the ValidationRegistry, never a source**. Nothing ENS sits in a verdict path (`vetAgent`, hire/refuse).

## Decisions (approved)

| Decision | Choice |
|---|---|
| Grade requires ENS? | **No.** Registry id is the primary input. |
| Who owns a claimed subname? | **IdentityRegistry `ownerOf(agentId)`** after claim. |
| Claim mechanism for the event | **Approach A:** operator-assisted claim (validator creates the subname with owner = agent owner). |
| Claim contract (self-serve) | **Roadmap (approach B),** not required for this pass. |
| Mirror writes | From ValidationRegistry only (existing 12 keys). |
| Chain | Base Sepolia Basenames only (`preflight.basetest.eth`). No mainnet ETH. |
| 8004scan mainnet leaders | Out of scope for this redesign. |

## Section 1 — Grade path

### Inputs

- **Primary:** ERC-8004 agent id (uint256 string), resolved via IdentityRegistry on the configured identity chain (Sepolia for the event stack).
- **Optional:** ENS name under the Preflight parent → read `preflight.agentId` → same resolve/grade path.
- **Refuse:** bare MCP URLs / npm refs as grade inputs (unchanged evidence rule: card must come from the registry).

### Catalog / search

- List **registered** agents (stage-known set + bounded discovery), by id and card name.
- Show an ENS sub-line **only when** a name exists and has a resolver.
- Appearance in the catalog must **not** require a mirrored name.

### Pipeline

```
ref (id | optional ENS)
  → agentId
  → resolveAgent(agentId)   // IdentityRegistry + card
  → gradeAgent(card)        // litmus
  → (optional) publish      // ValidationRegistry
  → (optional) ens sync     // mirror only, if name claimed / writable
```

No ENS read or write may sit before or inside `vetAgent`.

## Section 2 — Claim + ownership

### Claim (approach A)

1. Prove the claimant is `ownerOf(agentId)` on the Sepolia IdentityRegistry (signed message in the UI, or operator-verified owner address for booth demos).
2. Preflight validator calls `setSubnodeRecord` on the Basenames registry for label `agent{id}` under `preflight.basetest.eth`, with:
   - `owner` = agent owner address  
   - `resolver` = configured L2Resolver  
   - `ttl` = 0  
3. Outcomes:
   - name absent → create for owner  
   - name already owned by that owner → success / already claimed  
   - name owned by anyone else → refuse (never overwrite)

Parent name `preflight.basetest.eth` remains validator-owned so subnames can still be created. **Subname** ownership is the agent’s after claim.

### Mirror txt records

- Same key set and builders as today’s `src/validator/ens/records.ts`.
- Values come only from a ValidationRegistry read (plus clears).
- Writers for this pass: validator `ens sync` / publish auto-hook when the name exists and is writable under current rules.
- Later optional: name owner self-sync — still registry-sourced only.
- Unclaimed agent: grade + publish work; board/floor show id without an ENS sub-line.

### UI

- **Grade an agent:** paste id or pick from catalog; ENS optional.
- **Claim ENS:** separate control / post-grade CTA for owners; preview `agent{id}.preflight.basetest.eth`.
- Do not block grade or publish on claim.

## Section 3 — Non-goals

- ENS in any verdict path.
- Claim creating or mutating a grade.
- Agent-authored grade letters as source of truth in txt records.
- Mainnet Basename / spending real ETH for this lane.
- Mandatory claim before grade or publish.
- Deploying a claim contract (approach B) in this pass.
- Integrating 8004scan mainnet leaderboard agents into this flow.

## Migration from current booth UX

| Current | Target |
|---|---|
| Grade form requires ENS name | Grade form accepts registry id; ENS optional |
| Catalog = ENS-mirrored names only | Catalog = registered agents; ENS if present |
| Preflight owns demo subnames | Demo agents may stay as-is; new claims go to owner |
| `submitAgent` refuses bare ids | `submitAgent` resolves ids first |

Existing demo subnames under the validator can remain for the stage; new claims follow owner ownership. Optionally transfer demo subnames later — not required to ship the grade-path fix.

## Implementation sketch (for the plan, not this doc’s job)

1. Restore id-first `submitAgent` + catalog without ENS requirement.  
2. Add `ens claim <id>` (CLI) / claim server action: owner check → `setSubnodeRecord` to owner.  
3. Keep mirror sync; skip quietly when unclaimed.  
4. Update deck copy to match (optional name, owner-held after claim).  
5. Verification: grade without ENS; claim moves ownership; sync still agrees with registry; vet path untouched.

## Open points for the implementation plan

- Exact owner-proof UX for booth (signature vs operator paste of owner address).  
- Whether publish auto-hook should create a name (no — claim is explicit) or only sync if claimed.  
- Whether to transfer existing validator-owned demo subnames to agent owners in one ops pass.
