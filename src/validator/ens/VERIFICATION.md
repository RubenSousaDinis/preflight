# ENS mirror: what was run, and what is still the operator's

D5b and D5d, built 2026-07-25 in the event window. This file records what was actually executed and
measured on this lane. Anything not recorded here was not run, and the live half says so plainly
rather than being implied by the offline half passing.

The governing rule, which everything below serves: **the text records are a mirror of the
ValidationRegistry and never a source.** Nothing ENS sits in or before a verdict path, and every
render-path lookup falls back to the address and the registry-backed rendering.

## The record keys, which this log owns

Twelve keys, written every time, in this order. An absent value is written as an empty string so a
re-sync clears a stale record instead of leaving a superseded one on the name. The spelling lives in
`ENS_KEYS` in `records.ts` and nowhere else.

```
preflight.grade            the letter, derived from the onchain score
preflight.score            the score the registry holds, 0 to 100
preflight.evidence         responseURI, written only at 512 chars or fewer
preflight.evidenceHash     always written
preflight.registry         eip155:{chainId}:{registry}, the record this copies
preflight.agentId
preflight.updatedAt        the registry's lastUpdate, unix seconds
preflight.methodology      the tag as the registry stored it
preflight.receipts.head
preflight.receipts.count
preflight.hcsTopic         when one is configured
description                names the registry record as the source, with the pointer
```

## Offline, run on this lane

```
node --import tsx --test "src/validator/ens/*.test.ts"
  22 tests, 22 pass, 0 fail, 1531 ms

npm test                 379 tests, 332 pass, 0 fail, 47 skipped (the live-only ones), 4777 ms
node --import tsx --test "app/**/*.test.tsx"
                          31 tests, 31 pass, 0 fail (5 of them the ENS mirror line)
npm run typecheck         clean
npm run lint              clean
npm run build             compiled, 13 routes, /console dynamic as before
```

What those 22 cover, and why each one is there rather than as a visual pass:

- a non-numeric agent id is refused as a label, so a caller holding an address cannot derive a name
- `Agent8427.Preflight.Base.ETH` and its lowercase form hash to one node, and the label hash is not
  the namehash (passing one for the other would create a subname of a different name)
- every key is emitted with empty-string clears, and the description carries the registry pointer
- an evidence URI over 512 chars is cleared rather than truncated, and the hash is still written
- the multicall decodes back to one `setText` per key, in order, all against the same node
- plan branches against a fake registry: create, unchanged, a foreign owner, a parent we do not own,
  and a parent with no resolver. The foreign-owner case refuses with code `ENS` before a key loads
- reads go registry-then-resolver, and a cleared record reads as absent rather than as `""`
- verify reports only the keys that disagree
- the mirror coalesces by agent (a queued sync is replaced by a newer grade, an older one is
  discarded), never throws on a failing writer, counts failures, and one unwritable agent does not
  stall another
- the publish hook is quiet and configured-off when no target is set, and refuses to mirror a score
  off the 25-point scale as a letter

## Live, read-only, run on this lane

The registry read path was exercised against a real ENS registry, because the fake registry in the
tests proves the arguments and not the ABI. Chain 1 through `ENS_RPC_URL`, which is also what shows
the override keeps the module chain-agnostic with no new `ChainKey`:

```
ENS_CHAIN_ID=1 ENS_REGISTRY_ADDRESS=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
ENS_PARENT_NAME=ens.eth ENS_RPC_URL=https://ethereum-rpc.publicnode.com \
VALIDATOR_ADDRESS=0x1111111111111111111111111111111111111111 \
node --import tsx src/validator/cli.ts ens status 1

parent        ens.eth on chain 1
registry      0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
node          0x4e34d3a81dc3a20f71bbdf2160492ddaa17ee7e5523757d47153379c13cb46df
agent1.ens.eth
  node        0x7fb5ca87e7204b321d004705f67fc629f43f97c2c33d0f5cbf84934539e446e8
  owner       (not registered)
  resolver    (none)
  action      create
  refused     ens.eth is owned by 0xb6E040C9ECAaE172a89bD561c5F73e1C48d28cd9, and the subname
              would be created by 0x1111111111111111111111111111111111111111, which the registry
              will reject
```

Read as: `registry.owner(namehash(parent))` and `registry.resolver(node)` both answer correctly
against a live ENS registry, an unregistered subname reads as the zero address rather than as an
error, and the ownership refusal fires before anything is sent. Exit code 1.

Configuration refusals, also run:

```
node src/validator/cli.ts ens status 8427        (nothing set)
  the ENS mirror is not configured, so nothing is mirrored and every surface reads the registry as
  before                                                                              exit 1

ENS_CHAIN_ID=84532 node … ens status 8427        (one of three set)
  refused [CONFIG] the ENS grade mirror needs ENS_CHAIN_ID, ENS_REGISTRY_ADDRESS, ENS_PARENT_NAME
  set together, and ENS_REGISTRY_ADDRESS and ENS_PARENT_NAME are missing               exit 1
```

Derived values for the intended primary target, computed offline and recorded so a later read can be
checked against them:

```
agent8427.preflight.base.eth
  namehash  0xde62ac175548268f7160857f91cab95b5ee2f803e5fbf2eac8aaba8a92675932
  labelhash 0x1397faa45bb75a4c5df3290a139835fb81d18136fc61dd8620c41234b8ae97db  (agent8427)
```

## Live pass (2026-07-25, Base Sepolia rehearsal)

Primary target was listed as `preflight.base.eth` on Basenames mainnet; that path is **retired** —
no mainnet ETH. The Sepolia Basenames parent is the live target. On Sepolia the TLD is `basetest.eth`,
not `base.eth`, so the parent string that namehashes correctly is `preflight.basetest.eth`.

```
target registered:   preflight.basetest.eth / chain 84532
                     registry 0x1493b2567056c2181630115660963E13A8E32735
                     node     0x697c2580221ad53eae2367791ea54871b85c96295fff8df3d81d30ceb96ae03b
                     owner    0xCFad8f21B8469790ADc3922814d1df4E08ECF1c8
resolver on parent:  0x6533C94869D28fAA8dF77cc63f9e2b2D6Cf77eBA (L2Resolver)
env:                 ENS_CHAIN_ID=84532
                     ENS_REGISTRY_ADDRESS=0x1493b2567056c2181630115660963E13A8E32735
                     ENS_PARENT_NAME=preflight.basetest.eth
                     ENS_RESOLVER_ADDRESS=0x6533C94869D28fAA8dF77cc63f9e2b2D6Cf77eBA
                     (ENS_RPC_URL left unset → BASE_SEPOLIA_RPC_URL; public sepolia.base.org rate-limits)
```

Also graded and published agent **8441** (ENSWhois MCP, grade B / 75 / litmus-v17) before the mirror
run, so the board subjects are the four demos plus 8441.

```
subname create txs (setSubnodeRecord; immediate post-tx read can lag — retries added in client):
  agent8441  0x9b0353b2434fad0cdccbea533186489a4e32ad8c644414d97f64377b9e5336b4
  agent8427  0xd5204a0ae46a04d7d9c6b1a0522111d934e6abdfbedbef0473381918e0d0e757
  agent8430  0xf618967c38eb90e7f8506b05050a7c9f631aa8c3ee9c4f0860a58e53b378577a
  agent8436  0xcc9f7c362a1450008c34f9078ea9c61f1c5eaec1e816a50550ecdd045385675f
  agent8437  0x13eac0cdf7ed971ea65f8120b98b9ad6f28bd24feebdc36872fc80d05d933a29

records sync txs (resolver multicall):
  8441  0x95ac595404b20e3d216064d2ce847364861eb0d63fe3696b5420c558265ba9a5  grade B
  8427  0xcaf2fd398c05e5d724a084db8099dd1cf567eafc2d78adc58ec37efed7ade02a  grade B
  8430  0xc3b9de1c73dbd0ddd81171d7d8a12eadd22ba0425e2ae4474cf355c7c1689bb9  grade F
  8436  0xc51d32419562fea5a59d70049863b15a3f583f90bb40b7997ba806a989ab9222  grade B
  8437  0x9d632ddb7ffdf6abbaa8201d74ddd7c9c8e87cba53e03cc2e254cdfa2d5a4ca2  grade C

ens verify exit code: 0 for 8441, 8427, 8430, 8436, 8437  (AGREES: every key matches the registry)

independent read (registry.resolver → resolver.text, not the ens CLI):
  agent8441.preflight.basetest.eth
    preflight.grade        "B"
    preflight.score        "75"
    preflight.agentId      "8441"
    preflight.methodology  "litmus-v17"
    description            names eip155:84532:0xc0274d5a…7393 as the source

publish auto-hook: not re-run in this pass (sync wrote the live records directly).
console: Vercel ENS_* + PREFLIGHT_BOARD_AGENT_IDS="8427 8430 8436 8437 8441" set; redeploy required
         for names to render on the board.
```

**Policy (settled):** ENS grade-mirror **writes are Base Sepolia only**. A send against any other
`ENS_CHAIN_ID` is refused in `assertEnsWriteAllowed` so this project never spends mainnet ETH on a
Basename. The console reads the same Sepolia registry the writes hit — a mirror is useless if read
from a chain that was never written. `preflight.base.eth` on 8453 is not a follow-up item.
