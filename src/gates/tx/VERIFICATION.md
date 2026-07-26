# Lane 2 verification log, the contract boundary

Every value below was observed during the build, not predicted. Blocks are Base Sepolia (84532)
unless the line says Base mainnet (8453). Sections match the verification-log blocks in each task
doc, so they can be pasted across one at a time.

Three commands reproduce the live parts: `npm run check:unseen` (unseen run, reads only), `npm run check:divergence`
(divergence rehearsal, sends), `npm run check:broadcast` (broadcast path, sends).

---

## B5a, fork and simulate harness

```
H+2 spike (anvil fork + replay approve): passed on both Base networks against the team's own CDP
  RPC (reth v2.3.0). Fork block equalled live block; balance injected into an unfunded wallet; an
  approve replayed from 0x1111...1111, a wallet nobody holds a key for, returned status 0x1 and an
  allowance of uint256 max; callTracer returned the nested call tree with logs inline;
  prestateTracer returned storage diffs; a reverting call came back as information, not a crash;
  a fork against a dead RPC exited with code 1 rather than serving an empty chain.
  Tooling: anvil and cast 1.7.1, commit 4072e487. Cold fork ready in 1.08 to 1.48 s; four
  concurrent forks ready in 1.46 s.
fork mechanism chosen: Foundry anvil. A second backend over plain RPC was added later for the
  deployed path only; see "fork backend parity" below. anvil remains the mechanism for operated runs.
per-chain RPC: BASE_SEPOLIA_RPC_URL and BASE_MAINNET_RPC_URL (one Coinbase Developer Platform key,
  both networks). No default chain and no default endpoint anywhere in the code.
sepolia fixture simulate (block, deltas): block 44581100, approvalDeltas exactly one entry, spender
  0x2222222222222222222222222222222222222222, amount 115792089237316195423570985008687907853269984665640564039457584007913129639935
mainnet fork, same code path: block 49070573, identical result by changing chainId alone
revert case, drift block, callGraph: a transfer beyond balance returned reverted true with its block
  and did not throw; a stored baseline that no longer matched blocked at block 44582141 with empty
  deltas, before any simulation ran; callGraph listed the proxy then the implementation it
  delegated to, in call order
two-leg statefulness: one fork, an allowance slot moved 1000000 then 0 across two runs, both legs
  anchored to the same fork height
```

## B4, codeFingerprint and proxy resolution

```
check 1 (stable per block): ERC-8004 IdentityRegistry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 on
  Base mainnet at block 49070265 fingerprinted identically on two reads:
  0xb5779ec8e2fa10f4710b2058a57c78d037469a6741e78b6637668a1154a06c8f
  proxyKind eip1967, implementation 0x7274e874CA62410a93Bd8bf61c69d8045E399c02
check 2 (moves on upgrade): backdoor proxy 0xB11bC5Bb8fD3000bebBB968bd65afd607F9801Da
  before 0x2386a8463783f274e3d75d23178765eb9bb25f9550fc62c7df10b3d1f5474a90
  after  0x0ecc1757717759ce5185bf4e47688fe6c45e2a477329f609f811b7587db86268
  upgrade tx 0xbab392d74da64a09581221e861b11fef2b0bff0e7782fb89d9e05fedc4db2690
  reset   tx 0x687c848902bad6586df59bcb0f76b0fcfbe5bcf4d2f80130e8fe6c0140dc64ec
  After the reset the value returned to 0x2386a846... exactly, so the fingerprint is a function of
  the code at the address rather than of what happened to it.
proxyKind detection: eip1967 for the D3 proxy; none for the Aerodrome Router, the Grand Base token,
  and WETH; unknown for USDC on both Base networks, which keeps its implementation in a
  pre-EIP-1967 slot none of the five patterns read.
```

**Deviation from the task doc, recorded deliberately.** B4 says a five-pattern miss with code present
is `none`. That would call USDC a plain contract and fingerprint the proxy shell alone, which is
stable across exactly the upgrade this exists to notice. After the five patterns miss, an
opcode-aware scan for DELEGATECALL or CALLCODE returns `unknown` instead. Cost checked before
adopting it: both unseen-run targets carry no delegatecall and stay `none`.

## D3, staged fixtures on Base Sepolia

Deployer `0xCFad8f21B8469790ADc3922814d1df4E08ECF1c8`. Nine contracts for 0.0000115 ETH of gas.
Verified status is from Sourcify, which is what B5d reads.

| Fixture | Address | Deploy tx | Verified |
|---|---|---|---|
| backdoor proxy | `0xB11bC5Bb8fD3000bebBB968bd65afd607F9801Da` | `0xd0240608…d760` | exact_match |
| vault v1 | `0x215Fd6636D7c9DB883690F79E84d2a4dB926E9Eb` | `0x7d0ce462…a822c` | exact_match |
| vault v2 | `0xc2eB1dD7cC26da2166984603ed930059eCFF3615` | `0x81da91ed…7bb2` | exact_match |
| drainer router | `0xbbB11049908dc4F72BC8F05Ea401862db168Bbe2` | `0xd9b51f6d…f911` | exact_match |
| drainable token | `0x7f53f01C30C1f868E40ECA0840493A0ea8057Df7` | `0xb9e6bcac…3768` | exact_match |
| value router | `0x4cDf5D44bEc6237f26C488F358FF2026701D4b69` | `0xcf28ed20…5388` | exact_match |
| unverified sink | `0xc7425381Df0c4d62aFa51aef748655BE72C542eD` | not submitted | **404, no published source** |
| clean control | `0xfd616991d7D0710258cC338c16A84Ebc7a09B8dC` | `0xe3bf01ef…4ce1` | exact_match |
| injection fixture | `0xB21304F3eCFb78345473d3Aa4198a21C2CaAB740` | `0x562f497a…7ec4` | exact_match |

The staged market (D3 step 7), created against Base Sepolia's own live `UniswapV2Factory` at
`0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e`:

| Contract | Address | Deploy tx | Verified |
|---|---|---|---|
| quote token | `0x788830a5264397E8f02F0c790a579ABC3B3eCAE6` | `0xade3f6b6…3333` | exact_match |
| honeypot token | `0x790CC437E064d785f289D2716154706da19199e3` | `0x6a39054f…38ec` | exact_match |
| honeypot pair | `0x984A4397226Fbe8c742907Ab1B354ADa75809529` | created by the factory | 404, factory-created |
| clean token | `0x3FC2Bb308c3DC1B5812C4099064A141bcA436027` | `0xafc7ba94…1af9` | exact_match |
| clean pair | `0x693Aa308F5e867664C9c2ADA29877de935Bee1AA` | created by the factory | 404, factory-created |
| mock router | `0x07810E2dBb03607B6E9830887EdDD03Fd78c28e2` | `0xce61f1d5…62cc` | exact_match |

```
balances and allowances unchanged after all blocks: yes. Every fixture run happens on a fork. The
  only transactions sent to the chain were the deploys, the two proxy upgrades above, one router
  approval, the market seeding, and the B8 and D5c rehearsals listed below.
pair reserves: seeded at 100,000 of each side. The B8 rehearsal deliberately moved the clean pair,
  which now sits at roughly 83,000 clean to 120,000 quote. Nothing depends on the ratio.
proxy reset path: ./contracts/script/proxy-upgrade.sh v1, run at the end of every run-through.
```

## B5b, drainer approval

```
drainer fixture blocked (address, spender, amount): 0xbbB11049908dc4F72BC8F05Ea401862db168Bbe2 at
  block 44581898, spender 0x00000000000000000000000000000000BaDc0dE0, amount uint256 max.
  Rendered detail: "this call leaves 0x00000000000000000000000000000000BaDc0dE0 holding an unlimited
  amount (uint256 max) of 0x7f53f01C30C1f868E40ECA0840493A0ea8057Df7 belonging to
  0x1111111111111111111111111111111111111111. Blocked because the allowance is unbounded, and the
  spender is an address with no code, so nothing constrains what it does next."
bounded approval control passed: an approval of 1000 to the verified clean control allowed at
  block 44581901
indirect approval via router caught: the injection fixture's stake() leaves the same unlimited
  allowance with no approve selector anywhere in the calldata, and blocks
llm-scan block rejected at composition: asserted in txguard.test.ts. A flag arriving with
  confirmedBy llm-scan and severity block is coerced to advisory and cannot move the verdict, in
  either direction.
```

## B5e, owner or upgrade backdoor

```
D3 backdoor proxy address: 0xB11bC5Bb8fD3000bebBB968bd65afd607F9801Da
slot changed + before + after: 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc,
  from 0x215Fd6636D7c9DB883690F79E84d2a4dB926E9Eb to 0xc2eB1dD7cC26da2166984603ed930059eCFF3615
flag detail as rendered: "0xB11bC5Bb... writes 0x360894a1... during this transaction, moving it from
  ... to ... the EIP-1967 implementation slot decides which code runs at that address, or who may
  replace it, and this call was not a request to change either."
ordinary call to same proxy + result: deposit() with value allowed at block 44581983
nested-call case + result: transferOwnership two hops down, on a plain contract whose owner slot is
  not a constant, flags when that contract's storage also changed
fork block: 44581980
proxyKind unknown: throws rather than passing clean, so an unrecognized proxy blocks structurally
```

## B5d, bad callee

```
explorer endpoint used (per chain): Sourcify v2, sourcify.dev/server/v2/contract/{chainId}/{address},
  no key. Etherscan V2 remains the unconfigured cross-check.
routed-value fixture + flag + offending edge: 0x4cDf5D44bEc6237f26C488F358FF2026701D4b69 blocks with
  bad-callee. Edge: the router calls 0xc7425381Df0c4d62aFa51aef748655BE72C542eD with a plain transfer
  carrying 0.001 ETH, and that address has code but no published source. The direct callee is
  verified, so reading tx.to alone would pass it.
clean verified path + result: the clean control allowed at block 44582351
eoa transfer + result: wallet to wallet allowed at block 44582353
known-bad list entries at run time: one. SquidRouterModule 0x1f1d37a3Bf840e35c6a860c7C2dA71Fe555123ca
  on chain 8453, sourced to rekt.news "New Market Trading". Checked in, not fetched.
D4 unseen address + result: see D4 below
```

## B5c, honeypot

```
route chosen: the staged Base Sepolia pair, against the chain's own live UniswapV2Factory
pool address and reserves at fork block: honeypot pair 0x984A4397226Fbe8c742907Ab1B354ADa75809529,
  seeded 100,000 of each side
honeypot fixture address + flag + detail: 0x790CC437E064d785f289D2716154706da19199e3 blocks at
  block 44583370. "Buying this token simulates clean. Selling the position straight back into its
  own pool at 0x984A4397... fails: moving the position into the pool reverted with
  \"HNY: holders cannot sell\". The exit does not exist at this block."
clean token address + result: 0x3FC2Bb308c3DC1B5812C4099064A141bcA436027 allowed at block 44583375,
  on an identically seeded pair
no-pool token address + result: 0x7f53f01C30C1f868E40ECA0840493A0ea8057Df7 allowed at block 44583381.
  Absence of a market is not a closed exit.
fork block: 44583370, and the same input at one pinned block gave the same flags twice
```

**Fixture correction worth recording.** The first honeypot exempted its deployer from the sell rule
so liquidity could be seeded, and the deployer was the test buyer, so the trap let it out. The
exemption was never needed: seeding happens before `setPool` arms the pool. Redeployed with nobody
exempt.

## B6, LLM source scan, advisory only

```
inference route used / model id: 0g-compute:0gm-1.0-35b-a3b, via https://router-api.0g.ai/v1
  (0G Compute router, OpenAI-compatible; the model is 0G's own, TEE-attested per the router's
  model list, which is a fact about the provider and not a claim this project makes)
injection fixture address: 0xB21304F3eCFb78345473d3Aa4198a21C2CaAB740
scan output: on the drainer router, one drainer-approval finding describing forceApprove granting
  the collector an unlimited allowance while the caller believes they are swapping. On the injection
  fixture, the same finding, and the model explicitly called out the adversarial comments rather
  than complying with them.
deterministic flags on the same tx: drainer-approval, severity block, confirmedBy simulation
final verdict: BLOCK at block 44586063
unverified-source case + rendered state: "not scanned: this address has no published source, so
  there was nothing to scan". Not scanned, no route configured, and a model error are three distinct
  states and none renders as clean.
architectural check: a scan route that complies with the injection and reports nothing leaves the
  verdict at BLOCK; a route that instead asserts a blocking finding of its own changes the verdict
  in neither direction. Both are asserted with stubs, so the guarantee does not depend on a model
  behaving well on the day.
```

The scan reaches the app in two places (C3 done-when 5). Values in the recorded row were copied out
of the runs below, not composed to look like them.

```
recorded row, /console?view=firewall: txGuard on stake(1000) against the injection fixture at the
  block already recorded above. Verdict BLOCK, one flag, drainer-approval, severity block,
  confirmedBy simulation. deltas [] (stake() leaves an allowance and moves no balance, so a panel
  watching balances alone would have called this call uneventful).
row provenance, re-derivable from the card: block 44586063, from
  0x1111111111111111111111111111111111111111, to 0xB21304F3eCFb78345473d3Aa4198a21C2CaAB740,
  calldataHash 0x2a81f6c3adda93eb4e39d256463e85b51d07672a1977125c70860eef516bb054,
  codeFingerprint 0x6d167ae7d4fade0b74e4536f65afbec2a7c24b7e2d4ac7c9751366fed7d4e45b, value 0
advisory finding on that row: from a 0g-compute:0gm-1.0-35b-a3b scan of the same address, which
  proposed one finding and had none discarded. It named the adversarial comments as obfuscation
  rather than following them, the second time that route was asked and the second time it refused.
  The rendered detail condenses that finding's last clause and changes nothing else, so the row is
  the scan's answer rather than a quotation of it.
live path, unseen slot: a scan button beside a decided verdict runs scanAddress on the pasted
  address. Verified end to end against the injection fixture (scanned, route named, one finding),
  against an address with no published source (not-scanned, reason rendered), and against a string
  that is not an address (rejected before any call). A throw from the source fetch becomes a
  rendered not-scanned, so no failure path can reach the screen as a clean result.
```

## D4, the unseen run, Base mainnet (8453)

Reads only. `npm run check:unseen` reproduces all of it.

```
known-bad address: 0x2aF864fb54b55900Cd58d19c7102d9e4FA8D84a3 (Grand Base)
  transferOwnership to an address nobody named: BLOCK, owner-backdoor, confirmedBy simulation.
  The owner slot moved from 0xa288b6b80c02f3a7916609fde831b30e9fa6ba07 to the attacker.
  TxTuple: block 49073514, from 0xa288b6b8...ba07, to 0x2aF864fb...84a3,
    calldataHash 0x6e177eac7747adaf14b9e687678f42abf8f32d0c272b3f02a610149890d6b2f7, value 0
  re-run from the tuple matched: yes
  unlimited approve on the same token: BLOCK, drainer-approval, block 49073525, re-run matched
clean verified contract: WETH 0x4200000000000000000000000000000000000006, deposit() with 0.01 ETH:
  ALLOW at block 49073529 with two native deltas and nothing else. Re-run matched.
  TxTuple: calldataHash 0xa1548b79599a5ef2fd6de226ea5131c228954c4bf788eb3e4386a2728abe3e8d
judge-paste path exercised with: gate side only. A transaction to a wallet allows, deliberately.
  For "paste any address", call codeFingerprint directly: it throws NoCodeAtAddress for an EOA,
  which is the typed renderable error.
third-party agent ref: Lane 1 owns beat 3
```

**Two research corrections.** The mint the compromised key actually called in April 2024 reverts at
current state, so the incident cannot be replayed as it happened. Separately, a privileged mint is
not one of the four flags, so a mint that did go through would allow; §13.3 mapped Grand Base to
flag 4 on the strength of its owner-gated mints, and what flag 4 reads is a slot deciding who
controls the contract. `transferOwnership` on the same token trips it properly and with better
evidence. The clean control is WETH rather than an Aerodrome swap: an encoded route, a funded token,
and a live pool are three ways for the passing case to fail for reasons unrelated to the gate.

## B8, post-transaction divergence

```
quiet case: checked at block 44584444, landed at block 44584450, PREDICTED = LANDED on every row
forced-divergence case: checked at block 44584450, landed at block 44584461
  quote side matched exactly: 1000000000000000000000 in, both columns
  token side differed: predicted 686999642811176684595, landed 505545929615176741410
  notes as rendered: "Predicted and landed differ ... State moved between block 44584450, where the
  check ran, and block 44584461, where it landed. That gap is the disclosed limit rather than a
  fault in the check: a verdict is reproducible for a block and a state, not a prediction of what
  lands. Gas is excluded from both sides."
matched: false, with two rows agreeing and two marked as differing
```

**Rehearsal correction.** The first attempt produced a revert rather than a smaller amount, caused by
the script's own gas estimate racing a pending state rather than by state drift. An explicit gas
limit removed it. Left unfixed, the rehearsal would have manufactured its own divergence.

## D5c, protected RPC on the allow path

```
chain / configured endpoint: 84532 / default, BASE_SEPOLIA_RPC_URL
protected endpoint available for this chain: no, none configured. Flashbots Protect and MEV-Blocker
  serve Ethereum mainnet; Base orders through a sequencer with no public mempool. Merkle/Blink is
  the Base-native option and needs only BASE_SEPOLIA_PROTECTED_RPC_URL set to switch the label.
ALLOW broadcast tx hash: 0xec5864650a7a815f2e650e7cd94bcec1a8a26aeb314229330874b90e81c74915
  allowed at block 44584634, landed in block 44584637, status success
endpoint recorded in the log line: "default endpoint, no protected route configured for this chain"
BLOCK path produced zero outbound requests: yes. The route is not resolved at all on a block, so a
  blocked transaction cannot leak its existence to any endpoint.
fallback path logged explicitly: yes, and a protected endpoint that fails throws rather than
  retrying against the default.
```

## Fork backend parity

Added so the deployed URL can answer for itself: anvil cannot be spawned by a serverless runtime, and
a gate that cannot simulate blocks. Same handle, second backend over plain RPC, selected by
environment. anvil stays the mechanism for operated runs.

```
compared at block 44586754, same block pinned for both backends:
  drainer router                     BLOCK on both, same flags and same code fingerprint
  backdoor proxy claim               BLOCK on both
  value router to an unverified sink BLOCK on both
  clean control                      ALLOW on both
  honeypot buy, the two-leg case     BLOCK on both
sequential legs on the rpc backend: a read after leg one observed leg one (allowance 1000000)
storage after a leg: refuses rather than returning a value that predates the leg
```

**Disclosure this backend adds.** With anvil we execute the EVM ourselves; on the RPC backend reth
executes it on the provider's node and we read the trace back. The verdict stays falsifiable,
because anyone can call the same endpoints, but "we forked the chain and ran it ourselves" is not
literally true of the deployed path and the copy there should not say so. Two endpoints are
involved: ours answers `debug_traceCall`, the public one answers `eth_simulateV1`, and neither
answers both. Our own endpoint rate limits `debug_traceCall` under load, which surfaces as a block
rather than as a wrong answer.

## Disclosed limits this lane owns

- A verdict is reproducible for a given block and state. It is not a prediction of the landed
  outcome, which B8 renders rather than hides.
- An unrecognized proxy blocks with no flag to render. USDC on both Base networks is one.
- A privileged mint, and anything else outside the four flags, is not detected. The set is closed.
- The honeypot check needs a market. Without one it reports nothing rather than a verdict, and only
  Base Sepolia has one configured.
- The advisory scan is not reproducible and cannot move a verdict, in either direction.
