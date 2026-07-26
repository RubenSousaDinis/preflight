"use server";

import { getAddress, isAddress } from "viem";
import { scanAddress, type ScanReport } from "@/src/gates/tx/scan/llm-scan";
import { DETECTORS, txGuard } from "@/src/gates/tx/txguard";
import type { Address, Hex, PendingTx } from "@/src/shared";
import { toRenderableError, type RenderableError } from "./errors";
import { chainLabel } from "./flags";
import { toVerdictView, type VerdictView } from "./verdict-view";

/**
 * What the run was actually able to check.
 *
 * Both of these change what an ALLOW means, and neither is readable off a TxVerdict,
 * so they travel beside it. Without them an ALLOW produced by an empty detector set
 * is indistinguishable on screen from one produced by four checks that found
 * nothing, and that is the single most expensive thing this panel could imply.
 */
export type RunScope = {
  detectorCount: number;
  calldataWasEmpty: boolean;
};

export type UnseenResult =
  | { kind: "invalid"; message: string }
  | {
      kind: "error";
      address: string;
      chainLabel: string;
      error: RenderableError;
    }
  | {
      kind: "decided";
      address: string;
      chainLabel: string;
      /** Carried so a later scan runs on the chain this verdict was produced for. */
      chainId: number;
      verdict: VerdictView;
      scope: RunScope;
    };

export type ScanResult =
  | { kind: "invalid"; message: string }
  | { kind: "report"; address: string; report: ScanReport };

/**
 * The sender used when the operator does not name one.
 *
 * The zero address rather than a wallet nobody can check: it is visibly nobody in
 * particular, and it renders in the reproducibility footer where anyone can see
 * which sender the verdict was produced for.
 */
const DEFAULT_SENDER = `0x${"00".repeat(20)}` as Address;

const HEX_BYTES = /^0x([0-9a-fA-F]{2})*$/;

/*
  The unseen slot's check, running the same txGuard the staged calls run.

  There is deliberately no path here that returns an ALLOW without a completed
  simulation. txGuard blocks on every error path of its own, and anything it throws
  becomes a rendered failure rather than a verdict. A slot that answered "looks
  fine" with nothing behind it would be this product's own failure mode, rendered
  by its own UI.
*/
export async function checkUnseenAddress(
  _previous: UnseenResult | null,
  formData: FormData,
): Promise<UnseenResult> {
  const pastedAddress = String(formData.get("address") ?? "").trim();
  const pastedSender = String(formData.get("sender") ?? "").trim();
  const pastedCalldata = String(formData.get("calldata") ?? "").trim();
  const chainId = Number(formData.get("chainId") ?? 8453);

  if (!isAddress(pastedAddress)) {
    return {
      kind: "invalid",
      message:
        "That is not an address. Paste 0x followed by 40 hexadecimal characters.",
    };
  }
  if (pastedSender.length > 0 && !isAddress(pastedSender)) {
    return {
      kind: "invalid",
      message: "The sender is not an address. Leave it empty to use the default.",
    };
  }
  if (pastedCalldata.length > 0 && !HEX_BYTES.test(pastedCalldata)) {
    return {
      kind: "invalid",
      message:
        "Calldata has to be whole bytes: 0x followed by an even number of hexadecimal characters.",
    };
  }

  // Normalized at the boundary rather than hand-checksummed, per 01-INTERFACES.
  const to = getAddress(pastedAddress);
  const from = pastedSender.length > 0 ? getAddress(pastedSender) : DEFAULT_SENDER;
  const calldata = (pastedCalldata.length > 0 ? pastedCalldata : "0x") as Hex;

  const tx: PendingTx = { chainId, from, to, calldata, value: 0n };

  try {
    const verdict = await txGuard(tx);
    return {
      kind: "decided",
      address: to,
      chainLabel: chainLabel(chainId),
      chainId,
      verdict: toVerdictView(verdict),
      scope: {
        detectorCount: DETECTORS.length,
        calldataWasEmpty: calldata === "0x",
      },
    };
  } catch (thrown) {
    return {
      kind: "error",
      address: to,
      chainLabel: chainLabel(chainId),
      error: toRenderableError(thrown),
    };
  }
}

/*
  The advisory scan, run on demand against an address the verdict was already produced for.

  Separate from the check above rather than folded into it, for two reasons. The scan reads
  published source and waits on a model, which is tens of seconds next to a verdict that arrives in
  a few, and holding the verdict back until the slow half finishes would make the fast half look
  slow for no gain. And the separation is the architecture made visible: the verdict is complete
  before this runs, so nothing here can be mistaken for something that contributed to it.

  Every failure becomes a rendered not-scanned. `scanAddress` already turns a model error into one;
  this catch covers the source fetch, which throws. Neither path can produce something that reads
  as a clean result, which is the only property this function has to hold.
*/
export async function scanPastedAddress(
  _previous: ScanResult | null,
  formData: FormData,
): Promise<ScanResult> {
  const pastedAddress = String(formData.get("address") ?? "").trim();
  const chainId = Number(formData.get("chainId") ?? 8453);

  if (!isAddress(pastedAddress)) {
    return {
      kind: "invalid",
      message: "That is not an address, so there was nothing to scan.",
    };
  }
  const to = getAddress(pastedAddress);

  try {
    return { kind: "report", address: to, report: await scanAddress(chainId, to) };
  } catch (thrown) {
    return {
      kind: "report",
      address: to,
      report: {
        state: "not-scanned",
        route: null,
        reason: toRenderableError(thrown).reason,
        flags: [],
        findings: [],
        discarded: [],
      },
    };
  }
}
