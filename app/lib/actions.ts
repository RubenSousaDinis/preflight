"use server";

import { getAddress, isAddress } from "viem";
import { txGuard } from "@/src/gates/tx/txguard";
import type { Address, Hex, PendingTx } from "@/src/shared";
import { toRenderableError, type RenderableError } from "./errors";
import { chainLabel } from "./flags";
import { toVerdictView, type VerdictView } from "./verdict-view";

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
      verdict: VerdictView;
    };

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
      verdict: toVerdictView(verdict),
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
