#!/usr/bin/env bash
#
# The H+2 fork spike, re-runnable.
#
# Question it answers (02-DECISIONS open question 3, B5a step 1): against the team's actual Base
# RPC, can Foundry anvil fork at head and replay an approve, or does txGuard need a hosted
# simulation API instead? Decided once, at the event, not revisited.
#
# It checks the six things the harness in B5a depends on, per chain:
#   A  fork at head, and the fork block matches the live block
#   B  balance injection into an unfunded wallet (anvil_setBalance)
#   C  replay an approve from a wallet nobody controls (impersonation), allowance reads back
#   D  debug_traceCall with callTracer, nested calls present, which is where callGraph comes from
#   E  debug_traceCall with prestateTracer in diff mode, which is one source of balance deltas
#   F  a reverting call comes back as information, not as a crash
# and one thing the fail closed rule depends on:
#   G  a fork that cannot be established exits non zero rather than starting an empty chain
#
# Usage:  ./src/gates/tx/spike/fork-spike.sh
# Reads BASE_SEPOLIA_RPC_URL and BASE_MAINNET_RPC_URL from .env.local at the repo root.

set -u
export PATH="$HOME/.foundry/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
set -a; . "$ROOT/.env.local"; set +a

PORT="${SPIKE_PORT:-8555}"
FROM=0x1111111111111111111111111111111111111111
SPENDER=0x2222222222222222222222222222222222222222
MAXU=0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff

run_leg () {
  local label="$1" rpc="$2" token="$3"
  echo
  echo "==================== $label ===================="
  echo "live block:        $(cast block-number --rpc-url "$rpc")"

  anvil --fork-url "$rpc" --port "$PORT" --silent &
  local pid=$! url="http://127.0.0.1:$PORT"
  for _ in $(seq 1 200); do cast chain-id --rpc-url "$url" >/dev/null 2>&1 && break; sleep 0.05; done

  # A
  echo "fork chain-id:     $(cast chain-id --rpc-url "$url")"
  echo "fork block:        $(cast block-number --rpc-url "$url")"
  echo "token symbol:      $(cast call "$token" 'symbol()(string)' --rpc-url "$url" 2>&1 | head -1)"

  # B
  cast rpc anvil_setBalance "$FROM" 0xde0b6b3a7640000 --rpc-url "$url" >/dev/null
  echo "injected balance:  $(cast balance "$FROM" --rpc-url "$url")"

  # C
  echo "allowance before:  $(cast call "$token" 'allowance(address,address)(uint256)' "$FROM" "$SPENDER" --rpc-url "$url")"
  cast rpc anvil_impersonateAccount "$FROM" --rpc-url "$url" >/dev/null
  local sendout
  sendout=$(cast send "$token" 'approve(address,uint256)' "$SPENDER" "$MAXU" \
      --from "$FROM" --unlocked --rpc-url "$url" --json 2>&1)
  echo "approve status:    $(echo "$sendout" | grep -o '"status":"[^"]*"' | head -1)"
  echo "allowance after:   $(cast call "$token" 'allowance(address,address)(uint256)' "$FROM" "$SPENDER" --rpc-url "$url")"

  # The JSON payloads are built into variables before use. Inlined into a command they would be
  # brace expanded by the shell into one argument per field, and cast then rejects each one.
  local calldata call_json trace pre
  calldata=$(cast calldata 'approve(address,uint256)' "$SPENDER" 1000000)
  call_json="{\"from\":\"$FROM\",\"to\":\"$token\",\"data\":\"$calldata\"}"

  # D
  trace=$(cast rpc debug_traceCall "$call_json" latest \
      '{"tracer":"callTracer","tracerConfig":{"withLog":true}}' --rpc-url "$url" 2>&1)
  echo "callTracer:        $(echo "$trace" | head -c 480)"
  echo "nested calls:      $(echo "$trace" | grep -c '"type":"DELEGATECALL"') delegatecall, $(echo "$trace" | grep -c '"logs"') log block"

  # E
  pre=$(cast rpc debug_traceCall "$call_json" latest \
      '{"tracer":"prestateTracer","tracerConfig":{"diffMode":true}}' --rpc-url "$url" 2>&1)
  echo "prestateTracer:    $(echo "$pre" | head -c 300)"

  # F
  echo "revert case:       $(cast call "$token" 'transfer(address,uint256)' "$SPENDER" \
      1000000000000000000000000 --from "$FROM" --rpc-url "$url" 2>&1 | head -c 160)"

  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
}

run_leg "BASE SEPOLIA 84532" "$BASE_SEPOLIA_RPC_URL" 0x036CbD53842c5426634e7929541eC2318f3dCF7e
run_leg "BASE MAINNET 8453"  "$BASE_MAINNET_RPC_URL"  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# G: the fail closed case. A fork that cannot be established must not become an empty chain.
echo
echo "==================== G: dead RPC ===================="
anvil --fork-url "http://127.0.0.1:9/dead" --port "$PORT" >/dev/null 2>&1
echo "anvil exit code:   $?  (non zero is the required outcome)"
