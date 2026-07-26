import { receiptDemonstration } from "@/src/receipts/demonstration";
import { verifyChain } from "@/src/receipts/receipt-chain";
import type { Receipt } from "@/src/shared";
import { toRenderableError } from "./errors";
import type { ReceiptLog } from "./receipt-view";

/*
  B2's verifyChain runs against whatever is on screen, and what it says is what the
  panel renders, intact or broken.

  It now runs against two chains rather than one. The panel used to carry the frozen
  fixture set alone, whose hashes were labelled stand-ins, so the verifier rejected
  it on the opening receipt and stopped there, before it had checked a single link,
  hash or signature. That screen could only ever report a break, which tells a
  reader as little as a screen that could only ever report agreement: either way the
  answer does not depend on what was handed over, so nothing about the verifier was
  being shown.

  Both chains here are real and both are signed on this request. The second is the
  first with one receipt edited after signing, so the difference between the two
  verdicts is that edit and nothing else.

  TODO-INTEGRATE: the receipts themselves come from the live gates once beat 1 runs
  end to end. Nothing above this line changes when they do.
*/

export type ReceiptDemo = {
  /** Signed and linked. The verifier accepts this one. */
  intact: ReceiptLog;
  /** The same receipts with one edited after the fact. The verifier names it. */
  tampered: ReceiptLog;
  /** What was changed, so the page states it rather than leaving it to be inferred. */
  tamperNote: string;
};

async function checked(receipts: Receipt[]): Promise<ReceiptLog> {
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

export async function loadReceipts(): Promise<ReceiptDemo> {
  const { intact, tampered, tamperNote } = await receiptDemonstration();
  const [intactLog, tamperedLog] = await Promise.all([
    checked(intact),
    checked(tampered),
  ]);
  return { intact: intactLog, tampered: tamperedLog, tamperNote };
}
