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

  Its second way, less dangerous and more embarrassing, is only ever reaching one
  verdict. These tests pin both answers, because the page now shows both.
*/

function stripTags(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

test("a chain the verifier has not run against never renders as verified", async () => {
  const { intact } = await loadReceipts();

  // The component's null branch, exercised directly: absence of a check is
  // rendered as absence of a check, never as a check that passed.
  const text = stripTags(
    renderToStaticMarkup(<ReceiptChain log={{ ...intact, verification: null }} />),
  );
  assert.match(text, /not verified/);
  assert.doesNotMatch(text, /chain verified/);
  assert.match(text, /nothing here claims the signatures hold/);
});

test("the signed chain verifies, and the panel says so", async () => {
  const { intact } = await loadReceipts();

  assert.ok(intact.verification, "verifyChain has to have produced a verdict");
  assert.equal(intact.verification.ok, true, intact.verification.reason ?? "");
  assert.equal(intact.verification.brokenAt, null);

  const text = stripTags(renderToStaticMarkup(<ReceiptChain log={intact} />));
  assert.match(text, /chain verified/);
  assert.doesNotMatch(text, /chain broken/);
});

test("the edited copy is rejected, and the panel names the receipt it caught", async () => {
  const { tampered } = await loadReceipts();

  assert.ok(tampered.verification, "verifyChain has to have produced a verdict");
  assert.equal(tampered.verification.ok, false);
  assert.ok(
    tampered.verification.reason && tampered.verification.reason.length > 0,
    "a rejection has to say which two values disagree",
  );
  // Past the opening receipt, so the links and signatures before it were checked
  // and accepted rather than skipped.
  assert.ok(
    tampered.verification.brokenAt !== null && tampered.verification.brokenAt > 0,
  );

  const text = stripTags(renderToStaticMarkup(<ReceiptChain log={tampered} />));
  assert.match(text, /chain broken/);
  assert.doesNotMatch(text, /chain verified/);
});

test("a broken chain renders the break and where it happened", async () => {
  const { intact } = await loadReceipts();
  const text = stripTags(
    renderToStaticMarkup(
      <ReceiptChain
        log={{
          ...intact,
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
  const { intact } = await loadReceipts();
  const markup = renderToStaticMarkup(<ReceiptChain log={intact} />);

  assert.ok(intact.receipts.length > 1);
  for (const receipt of intact.receipts) {
    assert.ok(markup.includes(receipt.hash), `${receipt.id} hash must render`);
    assert.ok(markup.includes(receipt.responseHash));
    assert.ok(markup.includes(receipt.sig));
    assert.ok(markup.includes(receipt.signerPubKey));
    if (receipt.prevHash !== null) {
      assert.ok(markup.includes(receipt.prevHash));
    }
  }
});

test("the signed chain links, and a tampered link reads as a break", async () => {
  const { intact } = await loadReceipts();
  for (let index = 0; index < intact.receipts.length; index += 1) {
    assert.ok(
      linksToPrevious(intact.receipts, index),
      `receipt ${index + 1} should link to the one before it`,
    );
  }

  const tampered: Receipt[] = intact.receipts.map((receipt, index) =>
    index === 2 ? { ...receipt, prevHash: receipt.hash } : receipt,
  );
  assert.equal(linksToPrevious(tampered, 2), false);

  const text = stripTags(
    renderToStaticMarkup(<ReceiptChain log={{ ...intact, receipts: tampered }} />),
  );
  assert.match(text, /prevHash does not match the hash above/);
});
