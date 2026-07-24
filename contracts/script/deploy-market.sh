#!/usr/bin/env bash
#
# D3 step 7, and B5c's precondition: the staged market on Base Sepolia.
#
# Route 1 per 02-DECISIONS 13.4. A verified UniswapV2Factory already lives on Base Sepolia, so no
# AMM stack needs deploying: two pairs get created against it and seeded by transferring both sides
# in and calling mint(). Without this, every sell leg on a Base Sepolia fork reverts for lack of a
# counterparty, and the detector would call every token a honeypot.
#
# Usage:  ./contracts/script/deploy-market.sh
# Appends the market addresses to contracts/deployments/base-sepolia.json.

set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS="$(dirname "$HERE")"
ROOT="$(dirname "$CONTRACTS")"
set -a; . "$ROOT/.env.local"; set +a

KEY="${FIXTURE_DEPLOYER_PRIVATE_KEY:-$VALIDATOR_PRIVATE_KEY}"
RPC="$BASE_SEPOLIA_RPC_URL"
RECORD="$CONTRACTS/deployments/base-sepolia.json"
DEPLOYER=$(cast wallet address --private-key "$KEY")

# Live and verified on Base Sepolia, with recent createPair activity (02-DECISIONS 13.4).
FACTORY=0x7ae58f10f7849ca6f5fb71b7f45cb416c9204b1e

SUPPLY=1000000000000000000000000   # 1,000,000 tokens
SEED=100000000000000000000000      #   100,000 tokens per side

echo "deployer: $DEPLOYER"
echo "factory:  $FACTORY"
echo

deploy () {
  local label="$1" what="$2"; shift 2
  local out
  out=$(cd "$CONTRACTS" && forge create "$what" \
    --rpc-url "$RPC" --private-key "$KEY" --broadcast --json "$@" 2>&1) || {
      echo "FAILED $label: $out" >&2; exit 1; }
  local parsed
  parsed=$(echo "$out" | python3 -c '
import sys, json
text = sys.stdin.read()
start = text.find("{")
if start < 0:
    sys.exit("no json in forge output: " + text[:400])
record = json.loads(text[start:])
print(record["deployedTo"], record["transactionHash"])
')
  printf '%-14s %s\n' "$label" "$parsed" >&2
  echo "${parsed%% *}"
}

send () {
  cast send "$@" --rpc-url "$RPC" --private-key "$KEY" --json \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["transactionHash"])'
}

QUOTE=$(deploy quote src/QuoteToken.sol:QuoteToken)
HONEY=$(deploy honeypot src/HoneypotToken.sol:HoneypotToken --constructor-args "$SUPPLY")
CLEAN=$(deploy clean-token src/CleanToken.sol:CleanToken --constructor-args "$SUPPLY")
ROUTER=$(deploy router src/MockRouter.sol:MockRouter --constructor-args "$FACTORY")

echo
echo "minting quote supply"
send "$QUOTE" 'mint(address,uint256)' "$DEPLOYER" "$SUPPLY" >/dev/null

seed_pair () {
  local token="$1" label="$2"
  # createPair is idempotent from our side only in the sense that it reverts if it exists, so read
  # first and create only when absent.
  local pair
  pair=$(cast call "$FACTORY" 'getPair(address,address)(address)' "$token" "$QUOTE" --rpc-url "$RPC")
  if [ "$pair" = "0x0000000000000000000000000000000000000000" ]; then
    send "$FACTORY" 'createPair(address,address)' "$token" "$QUOTE" >/dev/null
    pair=$(cast call "$FACTORY" 'getPair(address,address)(address)' "$token" "$QUOTE" --rpc-url "$RPC")
  fi
  # Seed both sides, then mint the LP position. Transferring in and calling mint is the whole
  # protocol here: no router is involved in providing liquidity.
  send "$token" 'transfer(address,uint256)' "$pair" "$SEED" >/dev/null
  send "$QUOTE" 'transfer(address,uint256)' "$pair" "$SEED" >/dev/null
  send "$pair" 'mint(address)' "$DEPLOYER" >/dev/null
  printf '%-14s %s\n' "$label" "$pair" >&2
  echo "$pair"
}

echo
HONEY_PAIR=$(seed_pair "$HONEY" honeypot-pair)
CLEAN_PAIR=$(seed_pair "$CLEAN" clean-pair)

# The trap is armed only once the pool exists: before this, the seeding transfers would revert too.
echo
echo "arming the honeypot against its pool"
send "$HONEY" 'setPool(address)' "$HONEY_PAIR" >/dev/null

python3 - "$RECORD" "$FACTORY" "$QUOTE" "$HONEY" "$CLEAN" "$ROUTER" "$HONEY_PAIR" "$CLEAN_PAIR" <<'PY'
import json, sys
record_path, factory, quote, honey, clean, router, honey_pair, clean_pair = sys.argv[1:9]
record = json.load(open(record_path))
record["market"] = {
    "factory": factory,
    "router": router,
    "quoteToken": quote,
    "honeypotToken": honey,
    "honeypotPair": honey_pair,
    "cleanToken": clean,
    "cleanPair": clean_pair,
}
json.dump(record, open(record_path, "w"), indent=2)
open(record_path, "a").write("\n")
PY

echo
echo "wrote $RECORD"
echo "balance after: $(cast balance "$DEPLOYER" --ether --rpc-url "$RPC") ETH"
