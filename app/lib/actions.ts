"use server";

import { getAddress, isAddress } from "viem";
import type { RenderableError } from "./errors";
import { chainLabel } from "./flags";
import type { VerdictView } from "./verdict-view";

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

/*
  The unseen slot's check.

  TODO-INTEGRATE: this calls txGuard once Lane 2's section 9 composition merges,
  with the pasted address as the callee and the chain the operator picked. Until
  then it returns a typed failure and no verdict.

  There is deliberately no path here that returns an ALLOW without a completed
  simulation. A slot that answered "looks fine" while the gate was unwired would be
  the exact failure this product exists to prevent, rendered by its own UI.
*/
export async function checkUnseenAddress(
  _previous: UnseenResult | null,
  formData: FormData,
): Promise<UnseenResult> {
  const pasted = String(formData.get("address") ?? "").trim();
  const chainId = Number(formData.get("chainId") ?? 8453);

  if (!isAddress(pasted)) {
    return {
      kind: "invalid",
      message:
        "That is not an address. Paste 0x followed by 40 hexadecimal characters.",
    };
  }

  // Normalized at the boundary rather than hand-checksummed, per 01-INTERFACES.
  const address = getAddress(pasted);

  return {
    kind: "error",
    address,
    chainLabel: chainLabel(chainId),
    error: {
      code: "CONFIG",
      reason:
        "The transaction gate is not wired to this surface yet, so this address was not checked. Nothing is allowed on this path until it is.",
      retryable: false,
    },
  };
}
