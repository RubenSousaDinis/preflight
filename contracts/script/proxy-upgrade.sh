#!/usr/bin/env bash
#
# Swap the backdoor proxy's implementation, and swap it back.
#
# Two jobs. It is how B4's check 2 gets a real upgrade to fingerprint across, and it is the
# documented reset path: a rehearsal that leaves the proxy on v2 makes the next run look like drift
# the audience never saw happen, so the run-through ends by putting it back on v1.
#
# Usage:  ./contracts/script/proxy-upgrade.sh v1|v2

set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"

TARGET="${1:-}"
if [ "$TARGET" != "v1" ] && [ "$TARGET" != "v2" ]; then
  echo "usage: $0 v1|v2" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS="$(dirname "$HERE")"
ROOT="$(dirname "$CONTRACTS")"
set -a; . "$ROOT/.env.local"; set +a

KEY="${FIXTURE_DEPLOYER_PRIVATE_KEY:-$VALIDATOR_PRIVATE_KEY}"
RPC="$BASE_SEPOLIA_RPC_URL"
RECORD="$CONTRACTS/deployments/base-sepolia.json"

get () { python3 -c "import json;print(json.load(open('$RECORD'))['fixtures']['$1'])"; }
PROXY=$(get backdoorProxy)
# Spelled out rather than built with ${TARGET^^}: macOS ships bash 3.2, where that expansion is a
# syntax error, and a deploy script that fails on the demo machine is worse than a verbose one.
case "$TARGET" in
  v1) IMPL=$(get vaultV1) ;;
  v2) IMPL=$(get vaultV2) ;;
esac

echo "proxy:        $PROXY"
echo "implementation now: $(cast call "$PROXY" 'implementation()(address)' --rpc-url "$RPC")"
echo "upgrading to $TARGET: $IMPL"

TX=$(cast send "$PROXY" 'upgradeTo(address)' "$IMPL" \
  --rpc-url "$RPC" --private-key "$KEY" --json | python3 -c 'import sys,json;print(json.load(sys.stdin)["transactionHash"])')

echo "upgrade tx:   $TX"
echo "implementation now: $(cast call "$PROXY" 'implementation()(address)' --rpc-url "$RPC")"
