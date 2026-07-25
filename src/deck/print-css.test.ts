import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/*
  Download PDF is the browser print dialog. A stylesheet that only flips
  display leaves slides stacked at inset:0, so the PDF is one sheet of the
  last slide. These rules are the contract that unwraps the stage.
*/

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const css = readFileSync(join(root, "app/globals.css"), "utf8");
const stage = readFileSync(
  join(root, "app/components/deck/deck-stage.tsx"),
  "utf8",
);

const printBlock = css.match(/@media print\s*\{[\s\S]*\}$/m)?.[0] ?? "";

test("print CSS takes slides out of the absolute stack", () => {
  assert.match(printBlock, /\.deck-slide\s*\{[^}]*position:\s*relative\s*!important/s);
  assert.match(printBlock, /\.deck-slide\s*\{[^}]*width:\s*1920px\s*!important/s);
  assert.match(printBlock, /\.deck-slide\s*\{[^}]*height:\s*1080px\s*!important/s);
  assert.match(printBlock, /\.deck-slide\s*\{[^}]*break-after:\s*page/s);
});

test("print CSS unwraps the fixed stage so the document can grow", () => {
  assert.match(printBlock, /\.deck-root[\s\S]*?position:\s*static\s*!important/);
  assert.match(printBlock, /\.deck-canvas\s*\{[^}]*position:\s*static\s*!important/s);
});

test("stage hides inactive slides with visibility, not display:none", () => {
  assert.doesNotMatch(
    stage,
    /display:\s*position\s*===\s*index\s*\?\s*"flex"\s*:\s*"none"/,
  );
  assert.match(stage, /visibility:\s*active\s*\?\s*"visible"\s*:\s*"hidden"/);
  assert.match(stage, /setPrinting\(true\)/);
  assert.match(stage, /beforeprint/);
});
