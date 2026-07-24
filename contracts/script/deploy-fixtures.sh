#!/usr/bin/env bash
#
# D3: deploy the staged fixtures to Base Sepolia.
#
# Order matters. The backdoor proxy lands first because B4's check 2 and B5e both wait on it, and
# each contract that takes another's address is deployed after it. The honeypot pair is not here:
# it needs a seeded mock pair and it ships with B5c.
#
# Usage:  ./contracts/script/deploy-fixtures.sh
# Reads BASE_SEPOLIA_RPC_URL and the deployer key from .env.local at the repo root.
# Writes every address to contracts/deployments/base-sepolia.json.

set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS="$(dirname "$HERE")"
ROOT="$(dirname "$CONTRACTS")"
set -a; . "$ROOT/.env.local"; set +a

KEY="${FIXTURE_DEPLOYER_PRIVATE_KEY:-$VALIDATOR_PRIVATE_KEY}"
RPC="$BASE_SEPOLIA_RPC_URL"
DEPLOYER=$(cast wallet address --private-key "$KEY")

# The spender and recipient that appear nowhere in what a caller was asked to agree to. Not a
# wallet anyone holds: it only has to be an address the caller never named.
COLLECTOR=0x00000000000000000000000000000000BadC0de0

echo "deployer:  $DEPLOYER"
echo "balance:   $(cast balance "$DEPLOYER" --ether --rpc-url "$RPC") ETH"
echo "chain:     $(cast chain-id --rpc-url "$RPC")"
echo

# Deploys one contract and prints its address on stdout. Everything a human reads goes to stderr,
# so the caller can capture the address without parsing around a log line.
deploy () {
  local label="$1" what="$2"; shift 2
  local out
  out=$(cd "$CONTRACTS" && forge create "$what" \
    --rpc-url "$RPC" --private-key "$KEY" --broadcast --json "$@" 2>&1) || {
      echo "FAILED $label: $out" >&2; exit 1; }
  # forge pretty-prints its JSON and may log ahead of it, so read from the first brace on.
  local parsed
  parsed=$(echo "$out" | python3 -c '
import sys, json
text = sys.stdin.read()
start = text.find("{")
if start < 0:
    sys.exit("no json in forge output: " + text[:400])
record = json.loads(text[start:])
print(record["deployedTo"], record["transactionHash"])
') || { echo "FAILED $label: $out" >&2; exit 1; }
  printf '%-18s %s\n' "$label" "$parsed" >&2
  echo "${parsed%% *}"
}

mkdir -p "$CONTRACTS/deployments"

TOKEN=$(deploy token src/DrainableToken.sol:DrainableToken --constructor-args 1000000000000000000000000)
VAULT_V2=$(deploy vault-v2 src/VaultV2.sol:VaultV2 --constructor-args "$COLLECTOR")
VAULT_V1=$(deploy vault-v1 src/VaultV1.sol:VaultV1 --constructor-args "$VAULT_V2")
PROXY=$(deploy backdoor-proxy src/BackdoorProxy.sol:BackdoorProxy --constructor-args "$VAULT_V1")
DRAINER=$(deploy drainer-router src/DrainerRouter.sol:DrainerRouter --constructor-args "$TOKEN" "$COLLECTOR")
SINK=$(deploy unverified-sink src/UnverifiedSink.sol:UnverifiedSink)
VALUE_ROUTER=$(deploy value-router src/ValueRouter.sol:ValueRouter --constructor-args "$SINK")
CONTROL=$(deploy clean-control src/CleanControl.sol:CleanControl)
INJECTION=$(deploy injection src/InjectionFixture.sol:InjectionFixture --constructor-args "$TOKEN" "$COLLECTOR")

cat > "$CONTRACTS/deployments/base-sepolia.json" <<JSON
{
  "chainId": 84532,
  "deployer": "$DEPLOYER",
  "collector": "$COLLECTOR",
  "fixtures": {
    "backdoorProxy": "$PROXY",
    "vaultV1": "$VAULT_V1",
    "vaultV2": "$VAULT_V2",
    "drainerRouter": "$DRAINER",
    "drainableToken": "$TOKEN",
    "valueRouter": "$VALUE_ROUTER",
    "unverifiedSink": "$SINK",
    "cleanControl": "$CONTROL",
    "injectionFixture": "$INJECTION"
  }
}
JSON

echo
echo "wrote $CONTRACTS/deployments/base-sepolia.json"
echo "balance after: $(cast balance "$DEPLOYER" --ether --rpc-url "$RPC") ETH"
