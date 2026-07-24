# H+2 fork spike: the result

**Question** (02-DECISIONS open question 3, B5a step 1): Foundry anvil, or a hosted simulation API?
Decided once, at the event, against the team's actual RPC access. Not revisited.

**Verdict: anvil.** Every check the harness depends on passed on both Base networks, against the
team's own Coinbase Developer Platform RPC. No simulation API is needed, and none is wired.

Re-run it yourself: `./src/gates/tx/spike/fork-spike.sh`.

## What passed

| Check | Base Sepolia (84532) | Base mainnet (8453) |
|---|---|---|
| Fork at head, fork block equals live block | 44580233 | 49069706 |
| Balance injection into an unfunded wallet | 1000000000000000000 wei | same |
| Replay an approve from a wallet nobody controls | status `0x1` | status `0x1` |
| Allowance reads back after the replay | max uint256 | max uint256 |
| `callTracer` returns nested calls | 1 DELEGATECALL, logs inline | 1 DELEGATECALL, logs inline |
| `prestateTracer` diff mode returns storage diffs | token slot `0xd3cdd44d...` | token slot `0xd3cdd44d...` |
| A reverting call returns information, not a crash | `execution reverted: ERC20: transfer amount exceeds balance` plus revert data | same |
| A fork that cannot be established exits non zero | anvil exit code 1 | anvil exit code 1 |

Tooling: anvil and cast 1.7.1 (commit `4072e487`, build 2026-05-08), on PATH at `~/.foundry/bin`.
The approve was replayed against USDC on each chain (`0x036CbD53...` on Sepolia,
`0x833589fC...` on mainnet), from `0x1111...1111`, an address nobody holds a key for.

## What it means for B5a

1. **`callGraph` is free, not costly.** `debug_traceCall` with `callTracer` works on the anvil fork
   and returns the nested call tree, so flag 3 (bad callee) reads its callees out of the trace
   rather than reconstructing them. `tracerConfig.withLog` puts the logs inline in the same
   response, so `Approval` and `Transfer` events arrive with the call that emitted them. That is
   B5a step 8 answered before it starts.
2. **Two independent sources for the deltas.** Logs give the intended effect, `prestateTracer` in
   diff mode gives the storage that actually moved. Approval deltas are read from the logs and
   cross-checked against storage, so a token that moves an allowance without emitting an event is
   still visible. A token that emits an event without moving storage is visible the same way.
3. **A revert is information.** The call comes back as an error response carrying the revert reason
   and the ABI encoded data, so `reverted: true` is derivable without an exception escaping. That
   is what honeypot detection (B5c) is built on.
4. **The fail closed path has a mechanism.** anvil exits 1 rather than starting an empty chain when
   the fork RPC is unreachable, so "cannot establish a fork" is detectable at process start and
   becomes `SimulationError`, which the composed gate turns into `BLOCK`.
5. **A fork per detector is affordable.** 01-INTERFACES section 7 requires each detector to get its
   own fork, because `Fork.run` is stateful. Measured: a cold fork is ready in 1.08 to 1.48 s, and
   four concurrent forks were all ready in 1.46 s. Four detectors on their own forks costs about a
   second and a half of wall clock, not six.
6. **Chain parameterization is a config value, not a code path.** The same script runs both chains
   with the RPC URL as its only difference, which is what B5a step 2 has to hold true.

## Watch items, disclosed rather than discovered later

- **anvil is a local process.** Wherever `txGuard` runs has to be able to spawn a binary. Vercel's
  serverless runtime cannot, so a deployed page that calls `txGuard` server side would fail to
  simulate, and by the fail closed rule that is a `BLOCK` with a structural reason, never an allow.
  The live runs are driven from a machine with Foundry installed. This needs an operator call at
  the H+2 gate, since it shapes how Lane 3's panel and B7's MCP server reach the gate.
- **Trace volume against the RPC.** A deep multi hop trace pulls many storage reads through the
  fork provider on first touch. anvil caches per block, so a rehearsed run is cheap after the first
  pass, but an unrehearsed mainnet target (D4) pays full price once. If the provider throttles, the
  symptom is a slow first run, not a wrong verdict.
- **The fork block is read back from the fork, never assumed.** In one earlier run the live read and
  the fork landed one block apart. `SimulationResult.block` is whatever the fork reports, which is
  the value that goes into `reproducibleFrom`.

## Toolchain, separately

`contracts/` builds with `solc 0.8.24` under the committed `foundry.toml`, and two clean rebuilds of
the same source produced the same deployed bytecode (sha256 `0d1fcf117a5db01985e8547413a28bf5...`),
which is what `bytecode_hash = "none"` buys. There is no Solidity dependency: `forge soldeer` could
not reach its registry from this machine, and rather than depend on that, the fixtures are plain
Solidity with no imports and no submodules.
