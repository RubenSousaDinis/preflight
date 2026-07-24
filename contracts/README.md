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
| `script/` | Reserved. Deploys run through `forge create` unless a fixture needs more than one transaction |
