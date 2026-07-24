import type { ChainVerification, Receipt } from "@/src/shared";
import { FIXTURE_RECEIPT_CHAIN } from "@/src/shared/fixtures";

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
  TODO-INTEGRATE: B2 owns emitReceipt and verifyChain (01-INTERFACES section 5).
  Until it merges, the panel renders the frozen fixture chain, whose hashes and
  signatures are labelled stand-ins rather than Ed25519 output, and `verification`
  stays null so nothing on screen claims they were checked.

  When B2 lands this calls verifyChain(receipts) and renders what it returns,
  including a broken chain as loudly as an intact one.
*/
export async function loadReceipts(): Promise<ReceiptLog> {
  return { receipts: FIXTURE_RECEIPT_CHAIN, verification: null };
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
