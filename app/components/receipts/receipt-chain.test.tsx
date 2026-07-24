import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Receipt } from "@/src/shared";
import { linksToPrevious } from "../../lib/receipt-view";
import { loadReceipts } from "../../lib/receipts";
import { ReceiptChain } from "./receipt-chain";

/*
  The receipt panel's one way of being dangerously wrong is letting a chain nobody
  checked look like a chain that passed.
*/

function stripTags(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

test("a chain the verifier has not run against never renders as verified", async () => {
  const log = await loadReceipts();

  // The component's null branch, exercised directly: absence of a check is
  // rendered as absence of a check, never as a check that passed.
  const text = stripTags(
    renderToStaticMarkup(<ReceiptChain log={{ ...log, verification: null }} />),
  );
  assert.match(text, /not verified/);
  assert.doesNotMatch(text, /chain verified/);
  assert.match(text, /nothing here claims the signatures hold/);
});

test("the verifier rejects the stand-in fixtures, and the panel says so", async () => {
  const log = await loadReceipts();

  // The fixture hashes and signatures are labelled stand-ins rather than Ed25519
  // output, so a verifier that accepted them would be the broken thing here.
  assert.ok(log.verification, "verifyChain has to have produced a verdict");
  assert.equal(log.verification.ok, false);
  assert.ok(
    log.verification.reason && log.verification.reason.length > 0,
    "a rejection has to say which two values disagree",
  );

  const text = stripTags(renderToStaticMarkup(<ReceiptChain log={log} />));
  assert.match(text, /chain broken/);
  assert.doesNotMatch(text, /chain verified/);
});

test("a broken chain renders the break and where it happened", async () => {
  const log = await loadReceipts();
  const text = stripTags(
    renderToStaticMarkup(
      <ReceiptChain
        log={{
          ...log,
          verification: {
            ok: false,
            brokenAt: 2,
            reason: "receipt 3 does not carry the hash of receipt 2",
          },
        }}
      />,
    ),
  );

  assert.match(text, /chain broken at receipt 3/);
  assert.match(text, /does not carry the hash of receipt 2/);
  assert.doesNotMatch(text, /chain verified/);
});

test("every receipt renders its hash, its prevHash, and its signer in full", async () => {
  const log = await loadReceipts();
  const markup = renderToStaticMarkup(<ReceiptChain log={log} />);

  assert.ok(log.receipts.length > 1);
  for (const receipt of log.receipts) {
    assert.ok(markup.includes(receipt.hash), `${receipt.id} hash must render`);
    assert.ok(markup.includes(receipt.responseHash));
    assert.ok(markup.includes(receipt.sig));
    assert.ok(markup.includes(receipt.signerPubKey));
    if (receipt.prevHash !== null) {
      assert.ok(markup.includes(receipt.prevHash));
    }
  }
});

test("the fixture chain links, and a tampered link reads as a break", async () => {
  const log = await loadReceipts();
  for (let index = 0; index < log.receipts.length; index += 1) {
    assert.ok(
      linksToPrevious(log.receipts, index),
      `receipt ${index + 1} should link to the one before it`,
    );
  }

  const tampered: Receipt[] = log.receipts.map((receipt, index) =>
    index === 2 ? { ...receipt, prevHash: receipt.hash } : receipt,
  );
  assert.equal(linksToPrevious(tampered, 2), false);

  const text = stripTags(
    renderToStaticMarkup(<ReceiptChain log={{ ...log, receipts: tampered }} />),
  );
  assert.match(text, /prevHash does not match the hash above/);
});
