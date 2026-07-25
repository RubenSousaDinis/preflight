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

## Not run here, and why

Everything that spends a key or a fee is the operator's, in his own session. None of it is claimed
above and none of it is claimed on the site.

- registering the parent name, on either Basenames target, and the `register()` and `registerPrice`
  signature check that precedes funding
- `ens subname <id> --send`, `ens sync <id> --send`, and the `ens verify <id>` exit-0 pass for the
  four demo agents, which is D5d check 2
- one `publish <id> --send` showing the auto-hook move `preflight.updatedAt` on chain
- the independent third-party read of a record, so the claim does not rest on our own reader
- the deck slide flip in `app/components/deck/ens.tsx`, which stays as it is until the live
  `ens verify` pass and happens on the operator's word

Prepared to copy-paste level for that session, with env set first:

```
node --env-file-if-exists=.env.local --import tsx src/validator/cli.ts ens status 8427 8428 8429 8430
node --env-file-if-exists=.env.local --import tsx src/validator/cli.ts ens subname 8427
node --env-file-if-exists=.env.local --import tsx src/validator/cli.ts ens subname 8427 --send
node --env-file-if-exists=.env.local --import tsx src/validator/cli.ts ens sync 8427 --send
node --env-file-if-exists=.env.local --import tsx src/validator/cli.ts ens verify 8427   # exit 0
node --env-file-if-exists=.env.local --import tsx src/validator/cli.ts publish 8427 --send
```

Two notes for that run. `ens verify` compares every key a sync would write now, so pass the same
`--receipts-head` and `--receipts-count` values that the sync used or those two keys will read as a
disagreement. And the runbook's rule against a concurrent `ens sync --send` during a publish stands:
the hook fires after the publish receipts and the mirror drains serially, so the only way to get
nonce contention is to run both by hand at once.

## Fill at execution

```
target registered (parent / chain / tx):
resolver on the parent:
subname per agent (name / tx):
records set per agent (tx):
ens verify exit code, per agent:
publish auto-hook: updatedAt before / after / tx:
independent read (tool, and what it answered):
console rendering: names in sub-lines, mirror line labelled, no-record agent clean:
regrade-to-record lag, if beat 4 ran:
```
