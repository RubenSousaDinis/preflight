# contracts

Foundry project for the staged fixture contracts (D3) that `txGuard` forks against, and for
anything else the contract boundary needs deployed. Every fixture lands on **Base Sepolia**
(`02-DECISIONS.md` section 3): staged runs fork Base Sepolia at head, and only the unseen run
forks Base mainnet.

## Toolchain

Foundry, pinned to `solc 0.8.24` and `evm_version = cancun` in `foundry.toml`. No Solidity
dependency, no `forge-std`, no submodules: fixtures are plain Solidity so a build never waits on
a package registry. `bytecode_hash = "none"` keeps a rebuild of unchanged source byte-identical,
which is what lets a fixture's code fingerprint be checked rather than asserted.

```
cd contracts
forge build
```

Verified on 2026-07-24: `solc 0.8.24` compiles under this config, and two clean rebuilds of the
same source produced the same deployed bytecode (sha256 `0d1fcf11...`).

## Environment

`forge` reads `${...}` out of the process environment, so source the repo root env file first.
Secrets never live in this directory.

```
set -a; . ../.env.local; set +a
forge build
```

Keys used here: `BASE_SEPOLIA_RPC_URL`, `BASE_MAINNET_RPC_URL`,
`BASE_SEPOLIA_EXPLORER_API_KEY`, `BASE_MAINNET_EXPLORER_API_KEY`, and the fixture deployer key
(Base Sepolia, throwaway) once it is provisioned.

## Deploying a fixture

Deploys are single contracts with explicit constructor arguments, so `forge create` is the whole
tool. No deploy script indirection.

```
forge create src/<Fixture>.sol:<Fixture> \
  --rpc-url base_sepolia --private-key "$FIXTURE_DEPLOYER_PRIVATE_KEY" --broadcast \
  --constructor-args <args>
```

Explorer verification, where a fixture is meant to read as verified (the clean control is, the
bad callee deliberately is not):

```
forge verify-contract <address> src/<Fixture>.sol:<Fixture> --chain base_sepolia --watch
```

## Layout

| Path | Holds |
|---|---|
| `src/` | Fixture contracts, one behavior each |
| `test/` | Solidity tests, where a fixture's behavior is worth checking without a fork |
| `script/` | `deploy-fixtures.sh` and `proxy-upgrade.sh` |
| `deployments/` | The addresses that were deployed, read by `src/gates/tx/fixtures.ts` |

## The fixtures

One fixture per detector, no combinations: a fixture that trips two flags cannot tell you which
detector works. Deployed on Base Sepolia by `script/deploy-fixtures.sh`, recorded in
`deployments/base-sepolia.json`.

| Fixture | Demo call | What the simulation shows | Reads |
|---|---|---|---|
| `BackdoorProxy` | `claim()` | The EIP-1967 implementation slot is written during a call that asked for a claim | B5e, and B4's drift check |
| `DrainerRouter` | `swap(amountIn)` | An unbounded allowance from the caller to a spender the caller never named | B5b |
| `ValueRouter` | `forward()` with value | The value reaches an address one hop past the direct callee, and that address has no published source | B5d |
| `InjectionFixture` | `stake(amount)` | The drainer's behavior, under source comments written to talk a scanner into reporting it clean | B6 says clean, B5b still blocks |
| `CleanControl` | `ping()` | No allowance, no onward value, one call and nothing below it | The passing case |

`VaultV1` and `VaultV2` are the two implementations behind the proxy, `DrainableToken` is the token
the drainer operates on, and `UnverifiedSink` is the address value ends up at.

**Verified status is part of the fixture.** Everything above is verified on Sourcify with an
`exact_match`, except `UnverifiedSink`, whose source is deliberately never submitted. B5d reads
that status as a fact about the chain, so the control has to be the thing the bad callee is not.

## Resetting between run-throughs

Fixture state pollutes across rehearsals. The proxy is the one that matters: a run that left it on
v2 makes the next run look like drift nobody watched happen.

```
./script/proxy-upgrade.sh v2    # fire the upgrade, for the drift case
./script/proxy-upgrade.sh v1    # put it back, at the end of every run-through
```

Checked on 2026-07-24: the code fingerprint moved from `0x2386a846...` to `0x0ecc1757...` across
the upgrade, and returned to `0x2386a846...` exactly after the reset, so the value is a function of
the code at the address rather than of what happened to it.
