import type { Address, Hex, PendingTx, TxVerdict } from "@/src/shared";
import {
  FIXTURE_TX_CLEAN,
  FIXTURE_TX_DRAINER,
  FIXTURE_VERDICT_ALLOW,
  FIXTURE_VERDICT_BLOCK_BACKDOOR,
  FIXTURE_VERDICT_BLOCK_DRAINER,
  FIXTURE_VERDICT_BLOCK_STRUCTURAL,
} from "@/src/shared/fixtures";
import type { RenderableError } from "./errors";
import { chainLabel } from "./flags";
import { toVerdictView, type VerdictView } from "./verdict-view";

export type QueueItem = {
  id: string;
  label: string;
  chainLabel: string;
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
export async function loadFirewallQueue(): Promise<QueueItem[]> {
  const staged: {
    id: string;
    label: string;
    tx: PendingTx;
    verdict: TxVerdict;
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
  ];

  return staged.map((entry) => ({
    id: entry.id,
    label: entry.label,
    chainLabel: chainLabel(entry.tx.chainId),
    tx: pending(entry.tx),
    state: "decided" as const,
    verdict: toVerdictView(entry.verdict),
  }));
}
