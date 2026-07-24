import { verifyChain } from "@/src/receipts/receipt-chain";
import type { ChainVerification, Receipt } from "@/src/shared";

/*
  Verify a receipt chain the browser is holding.

  A live run streams its receipts to the client, and the claim being made about
  them is that the signatures hold and each one carries the hash of the one
  before it. Checking that has to happen against B2's verifier rather than by the
  panel eyeballing its own data, so the chain goes back to the server and what
  comes back is whatever the verifier said.

  Nothing here can answer ok on a chain it did not check: a verifier that throws
  becomes a rejection, not a pass.
*/
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let receipts: Receipt[];
  try {
    const body = (await request.json()) as { receipts?: unknown };
    if (!Array.isArray(body.receipts)) throw new Error("no receipts");
    receipts = body.receipts as Receipt[];
  } catch {
    const rejected: ChainVerification = {
      ok: false,
      brokenAt: null,
      reason: "No receipt chain was submitted, so nothing was verified.",
    };
    return Response.json(rejected, { status: 400 });
  }

  try {
    return Response.json(await verifyChain(receipts));
  } catch (thrown) {
    const rejected: ChainVerification = {
      ok: false,
      brokenAt: null,
      reason:
        thrown instanceof Error
          ? `the verifier could not run: ${thrown.message}`
          : "the verifier could not run",
    };
    return Response.json(rejected);
  }
}
