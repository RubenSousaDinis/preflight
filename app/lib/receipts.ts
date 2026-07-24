import { verifyChain } from "@/src/receipts/receipt-chain";
import type { ChainVerification, Receipt } from "@/src/shared";
import { FIXTURE_RECEIPT_CHAIN } from "@/src/shared/fixtures";
import { toRenderableError } from "./errors";

export type ReceiptLog = {
  receipts: Receipt[];
  /**
   * What the verifier said, or null when it has not run.
   *
   * null is not "fine". It renders as unverified, the same way an absent
   * validation record renders as a refusal. There is no state in this panel where
   * the absence of a check reads as a passed check.
   */
  verification: ChainVerification | null;
};

/*
  B2's verifyChain runs against whatever is on screen, and what it says is what the
  panel renders, intact or broken.

  The chain it runs against today is still the fixture chain, whose hashes and
  signatures are labelled stand-ins rather than Ed25519 output, so the verifier is
  expected to reject it. That is the correct outcome and the panel shows it: a
  chain that does not verify renders as a chain that does not verify, which is a
  more useful thing for this screen to be able to do than always agreeing.

  TODO-INTEGRATE: the receipts themselves come from the live gates once beat 1 runs
  end to end. Nothing above this line changes when they do.
*/
export async function loadReceipts(): Promise<ReceiptLog> {
  const receipts = FIXTURE_RECEIPT_CHAIN;
  try {
    return { receipts, verification: await verifyChain(receipts) };
  } catch (thrown) {
    // A verifier that could not run leaves the chain unverified, never verified.
    const failure = toRenderableError(thrown);
    return {
      receipts,
      verification: { ok: false, brokenAt: null, reason: failure.reason },
    };
  }
}

/**
 * Whether each receipt's prevHash matches the hash of the receipt before it.
 *
 * This is a statement about two values that are both on screen, not a verdict: a
 * reader can check it by eye. It is deliberately not a signature check, which is
 * B2's to make and this panel's to display.
 */
export function linksToPrevious(receipts: Receipt[], index: number): boolean {
  if (index === 0) return receipts[index].prevHash === null;
  return receipts[index].prevHash === receipts[index - 1].hash;
}
