# Lane 1 verification log: B7, the Preflight MCP server

Run 2026-07-25.

```
stock client used + version:   @modelcontextprotocol/inspector via npx, CLI mode, launching
                               `node src/mcp/preflight/stdio.ts` over stdio.
tool list output:              preflight_agent and preflight_tx, the two fixed names, with the
                               input schemas from 01-INTERFACES §10. Required fields as frozen:
                               [ref] and [chainId, from, to, calldata, value].

preflight_tx verdict (client) vs txGuard (sdk):
  input                        chainId 8453, an unlimited approve of WETH
                               (0x4200…0006) to 0x00000000000000000000000000000000000000bad,
                               from 0x833589fC…2913, value 0
  through the stock client     BLOCK, flag drainer-approval, confirmedBy simulation
                               reason "unlimited allowance to 0x…0Bad"
                               codeFingerprint 0x71ed66767cbff00f4275d16410aa8457f35b228bc9f862042af8e7cbb241391f
                               reproducibleFrom block 49072942, calldataHash 0x5b5b22b1…659f
  through the sdk directly     BLOCK, drainer-approval, same reason, same fingerprint
                               0x71ed6676…391f, same calldataHash, block 49072951
  equal, field for field       yes. The two blocks differ only in the fork height, because each run
                               forks at the live head nine blocks apart, and that value is recorded
                               in the tuple rather than assumed. Everything a verdict is made of is
                               identical, which is the point of the check: the server wraps txGuard
                               and does not reimplement it.

preflight_agent verdict (client) vs vetAgent (sdk):
  asserted in the suite as a deep equality on every field, for a HIRE and for a drift REFUSE, since
  publishing a record for a live agent needs the validator key. The tool calls vetAgent; there is no
  second decision path to disagree with it.

E1 surface flip: verdict before / after:
  HIRE, then REFUSE with fingerprintMatch false, then HIRE again after flipping back. A cached read
  would have answered HIRE all three times. This is the check that proves the tool is the active
  recheck rather than a grade lookup.

rpc-down case + serialized payload:
  demonstrated by accident first, which is the best kind. The inspector launches the server as a
  child process without the operator's env file, so BASE_MAINNET_RPC_URL was unset and the call came
  back as a payload, not an exception:

    verdict           BLOCK
    flags             []
    reason            "this transaction cannot be simulated, so it is blocked:
                       BASE_MAINNET_RPC_URL is not set, so an RPC call on Base mainnet cannot run"
    reproducibleFrom  the real calldataHash, with block 0 and a zero fingerprint, because neither
                      was ever obtained
    isError           false

  isError stays false on every failure path on purpose. A client that sees a tool error may retry or
  proceed; a serialized BLOCK is something it cannot read as permission.

no 402 challenge, no price string:
  asserted in the suite over the tool definitions, the initialize response, and a verdict payload.
  Nothing here mentions a price, and there is no payment challenge on either tool.

suite: 16 tests, all passing, offline.
```

## A finding for the lane that owns txGuard

The first live target tried was Base mainnet USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), and
txGuard blocked it before simulating:

```
BLOCK, flags [], reason "a check could not be completed, so this is blocked: what executes at
0x833589fC…2913 could not be resolved, so whether this call changes it cannot be answered"
codeFingerprint 0xc3f66a0322b438c89ab2cd347c6d0bccd161555228ce83a17da4522c68c84e67
```

Failing closed on an unresolved proxy is correct behavior, so this is not a bug in the verdict. It is
worth knowing before beat 2 picks its targets: USDC on Base is a FiatTokenProxy, whose implementation
pointer lives in the pre-1967 slot rather than the standard one, so **every transaction whose callee
is USDC currently blocks with an unresolved-code reason**. Any beat-2 or D4 target on a proxy of that
vintage will do the same. WETH, a plain contract, resolves and simulates fine.

## Notes for the runbook

- Launching the server for a stock client:
  `npx @modelcontextprotocol/inspector --cli node src/mcp/preflight/stdio.ts --method tools/list`
- A tool call needs the environment the gates need. The inspector spawns the server as a child, so the
  RPC variables have to be exported in the shell that launches it, or every `preflight_tx` answers
  with the configuration block above. Anvil also needs to be on PATH (`~/.foundry/bin`).
- The same dispatcher serves an HTTP transport (`handlePreflightRequest`), so a judge can point their
  own client at a URL once a route exposes it. That route is Lane 3's to add, and it is a bonus rather
  than a requirement (B7 open question 2).
