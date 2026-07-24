import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadFirewallQueue, type QueueItem } from "../../lib/firewall";
import { FLAG_NAMES, FLAG_ORDER } from "../../lib/flags";
import { VerdictCard } from "./verdict-card";

/*
  Beat 2's acceptance, pinned. Each staged call renders its own flag from the closed
  set, the clean call allows, and no path renders ALLOW for a call that was never
  simulated.
*/

function stripTags(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

async function itemFor(id: string): Promise<QueueItem & { state: "decided" }> {
  const queue = await loadFirewallQueue();
  const item = queue.find((candidate) => candidate.id === id);
  assert.ok(item, `expected a queue item for ${id}`);
  assert.equal(item.state, "decided");
  return item as QueueItem & { state: "decided" };
}

async function markupFor(id: string): Promise<string> {
  const item = await itemFor(id);
  return renderToStaticMarkup(<VerdictCard verdict={item.verdict} />);
}

test("the unlimited approval blocks and names the drainer approval check", async () => {
  const markup = await markupFor("drainer-approval");
  const text = stripTags(markup);

  assert.match(text, /BLOCK/);
  assert.doesNotMatch(markup, /ALLOW/);
  assert.match(text, new RegExp(FLAG_NAMES["drainer-approval"]));
  assert.match(text, /confirmed by simulation/);
});

test("the owner-gated path blocks, and drift renders above the flags", async () => {
  const item = await itemFor("owner-backdoor");
  const markup = renderToStaticMarkup(<VerdictCard verdict={item.verdict} />);
  const text = stripTags(markup);

  assert.equal(item.verdict.driftFromGraded, true);
  assert.match(text, /BLOCK/);
  assert.match(text, new RegExp(FLAG_NAMES["owner-backdoor"]));
  assert.match(text, /code moved since grading/);
  // Drift is checked before simulation, so it has to read before the flags do.
  assert.ok(
    text.indexOf("code moved since grading") < text.indexOf("the four checks"),
  );
});

test("a call that was never simulated blocks with no flags and cannot read as allow", async () => {
  const markup = await markupFor("fork-unavailable");
  const text = stripTags(markup);

  assert.match(text, /BLOCK/);
  assert.doesNotMatch(markup, /ALLOW/);
  assert.match(text, /the call was never checked/);
  assert.match(text, /blocks rather than passing/);
});

test("the clean call allows, and its advisory finding is marked as advisory", async () => {
  const item = await itemFor("clean-swap");
  const markup = renderToStaticMarkup(<VerdictCard verdict={item.verdict} />);
  const text = stripTags(markup);

  assert.equal(item.verdict.verdict, "ALLOW");
  assert.match(text, /ALLOW/);
  assert.doesNotMatch(markup, /BLOCK/);

  // Every flag on this card is advisory, so nothing here may claim to block.
  assert.ok(item.verdict.flags.every((flag) => flag.severity === "advisory"));
  assert.match(text, /advisory/);
  assert.match(text, /cannot move one on its own/);
});

test("the reproducibility footer renders all five values, in full, on allow too", async () => {
  const item = await itemFor("clean-swap");
  const markup = renderToStaticMarkup(<VerdictCard verdict={item.verdict} />);
  const tuple = item.verdict.reproducibleFrom;

  for (const value of [
    tuple.block,
    tuple.from,
    tuple.to,
    tuple.calldataHash,
    tuple.value,
  ]) {
    assert.ok(
      markup.includes(value),
      `the footer must carry ${value} in full, never truncated`,
    );
  }
  assert.ok(markup.includes(item.verdict.codeFingerprint));
});

test("a null drift reads as no prior grade, never as no drift", async () => {
  const item = await itemFor("drainer-approval");
  assert.equal(item.verdict.driftFromGraded, null);

  const text = stripTags(
    renderToStaticMarkup(<VerdictCard verdict={item.verdict} />),
  );
  assert.match(text, /no prior grade/);
  assert.doesNotMatch(text, /no drift/);
});

test("the panel names exactly four checks and never implies a fifth", async () => {
  const markup = await markupFor("drainer-approval");
  const text = stripTags(markup);

  assert.equal(FLAG_ORDER.length, 4);
  for (const id of FLAG_ORDER) {
    assert.match(text, new RegExp(FLAG_NAMES[id]));
  }
  assert.match(text, /This set is closed/);
});

test("every staged call carries a verdict, and no balance movement is hidden", async () => {
  const queue = await loadFirewallQueue();
  assert.equal(queue.length, 4);

  for (const item of queue) {
    assert.equal(item.state, "decided");
    const decided = item as QueueItem & { state: "decided" };
    const text = stripTags(
      renderToStaticMarkup(<VerdictCard verdict={decided.verdict} />),
    );
    // Zero movement after a block is a rendered result, not an omission.
    if (decided.verdict.deltas.length === 0) {
      assert.match(text, /no balance moved/);
    }
    assert.match(text, /reproducible from/i);
  }
});
