import { verifyChain } from "@/src/receipts/receipt-chain";
import { FIXTURE_RECEIPT_CHAIN } from "@/src/shared/fixtures";
import { toRenderableError } from "./errors";
import type { ReceiptLog } from "./receipt-view";

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
