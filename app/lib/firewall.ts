import type { ScanReport } from "@/src/gates/tx/scan/llm-scan";
import type { Address, Hex, PendingTx, TxVerdict } from "@/src/shared";
import {
  FIXTURE_FLAG_INJECTION_SCAN,
  FIXTURE_TX_CLEAN,
  FIXTURE_TX_DRAINER,
  FIXTURE_TX_INJECTION,
  FIXTURE_VERDICT_ALLOW,
  FIXTURE_VERDICT_BLOCK_BACKDOOR,
  FIXTURE_VERDICT_BLOCK_DRAINER,
  FIXTURE_VERDICT_BLOCK_INJECTION,
  FIXTURE_VERDICT_BLOCK_STRUCTURAL,
} from "@/src/shared/fixtures";
import type { RenderableError } from "./errors";
import { chainLabel } from "./flags";
import { toVerdictView, type VerdictView } from "./verdict-view";

export type QueueItem = {
  id: string;
  label: string;
  chainLabel: string;
  /** What the advisory scan said about this address, when a recorded run said anything. */
  scan: ScanReport | null;
  tx: {
    chainId: number;
    to: Address;
    from: Address;
    calldata: Hex;
    value: string;
  };
} & (
  | { state: "queued" }
  | { state: "simulating"; atBlock: string | null }
  | { state: "decided"; verdict: VerdictView }
  | { state: "failed"; error: RenderableError }
);

function pending(tx: PendingTx) {
  return {
    chainId: tx.chainId,
    to: tx.to,
    from: tx.from,
    calldata: tx.calldata,
    value: tx.value.toString(),
  };
}

/*
  TODO-INTEGRATE: Lane 2 owns txGuard (01-INTERFACES section 9) and D3 owns the
  fixture contracts these calls are aimed at. Until the section 9 composition
  merges, the queue renders the frozen fixture verdicts in the same view shape a
  live run produces, and an item moves through queued and simulating for real once
  a fork takes real seconds to establish.

  The property that must survive the swap: nothing here can produce an ALLOW that
  did not come from a completed simulation. A failure becomes a failed item or a
  structural BLOCK, never an absent verdict the panel renders as clear.
*/
/*
  The scan the 0G Compute route returned for the injection fixture, kept as it came back.

  Recorded rather than run on load: this row replays a verdict, and a live call on every page load
  would make the row slower, less repeatable, and dependent on a router being up to render evidence
  about a run that already happened. The unseen slot is where a scan runs live, against an address
  nobody staged.
*/
const RECORDED_INJECTION_SCAN: ScanReport = {
  state: "scanned",
  route: "0g-compute:0gm-1.0-35b-a3b",
  reason: null,
  flags: [FIXTURE_FLAG_INJECTION_SCAN],
  findings: [
    `${FIXTURE_FLAG_INJECTION_SCAN.title}. ${FIXTURE_FLAG_INJECTION_SCAN.detail}`,
  ],
  discarded: [],
};

export async function loadFirewallQueue(): Promise<QueueItem[]> {
  const staged: {
    id: string;
    label: string;
    tx: PendingTx;
    verdict: TxVerdict;
    scan?: ScanReport;
  }[] = [
    {
      id: "clean-swap",
      label: "Swap through a verified router",
      tx: FIXTURE_TX_CLEAN,
      verdict: FIXTURE_VERDICT_ALLOW,
    },
    {
      id: "drainer-approval",
      label: "Unlimited approval to an unknown spender",
      tx: FIXTURE_TX_DRAINER,
      verdict: FIXTURE_VERDICT_BLOCK_DRAINER,
    },
    {
      id: "owner-backdoor",
      label: "Owner-gated mint behind a proxy",
      tx: FIXTURE_TX_DRAINER,
      verdict: FIXTURE_VERDICT_BLOCK_BACKDOOR,
    },
    {
      id: "fork-unavailable",
      label: "Call whose fork could not be established",
      tx: FIXTURE_TX_CLEAN,
      verdict: FIXTURE_VERDICT_BLOCK_STRUCTURAL,
    },
    {
      id: "scanner-injection",
      label: "Contract whose source tells the scanner to report it clean",
      tx: FIXTURE_TX_INJECTION,
      verdict: FIXTURE_VERDICT_BLOCK_INJECTION,
      scan: RECORDED_INJECTION_SCAN,
    },
  ];

  return staged.map((entry) => ({
    id: entry.id,
    label: entry.label,
    chainLabel: chainLabel(entry.tx.chainId),
    scan: entry.scan ?? null,
    tx: pending(entry.tx),
    state: "decided" as const,
    verdict: toVerdictView(entry.verdict),
  }));
}
