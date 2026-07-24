import type { ChainVerification, Receipt } from "@/src/shared";

/*
  The receipt panel's view shape and its one pure helper.

  Kept apart from app/lib/receipts.ts on purpose: that module loads B2's verifier,
  which reaches the engine and node's child_process, and the panel is rendered from
  a client component after a live run. Anything the panel imports has to be
  reachable from a browser bundle, so the loader and the view do not share a file.
*/

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
