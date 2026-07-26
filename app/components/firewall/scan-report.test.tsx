import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ScanReport } from "@/src/gates/tx/scan/llm-scan";
import { loadFirewallQueue, type QueueItem } from "../../lib/firewall";
import { ScanReportPanel } from "./scan-report";
import { VerdictCard } from "./verdict-card";

/*
  C3 done-when 5, and the property underneath it.

  The injection fixture's published source is an instruction aimed at an automated reviewer, telling
  it to report the contract clean. The row has to show the scan's answer and still block, because
  what blocks was read from a simulation. Every other test here defends the same boundary from the
  other side: no state of this panel may render as a clean result.
*/

function stripTags(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

async function injectionRow(): Promise<QueueItem & { state: "decided" }> {
  const queue = await loadFirewallQueue();
  const item = queue.find((candidate) => candidate.id === "scanner-injection");
  assert.ok(item, "the queue carries the scanner injection row");
  assert.equal(item.state, "decided");
  return item as QueueItem & { state: "decided" };
}

const scanned = (over: Partial<ScanReport> = {}): ScanReport => ({
  state: "scanned",
  route: "0g-compute:0gm-1.0-35b-a3b",
  reason: null,
  flags: [],
  findings: [],
  discarded: [],
  ...over,
});

test("the injection row blocks, and the scan it talked at is on the card beside the block", async () => {
  const item = await injectionRow();
  assert.ok(item.scan, "the row carries the scan that ran against it");

  const markup = renderToStaticMarkup(
    <VerdictCard verdict={item.verdict} scan={item.scan} />,
  );
  const text = stripTags(markup);

  assert.match(text, /BLOCK/);
  assert.doesNotMatch(markup, /ALLOW/);

  // The blocking finding came from the simulation, never from the scan.
  const blocking = item.verdict.flags.filter((flag) => flag.severity === "block");
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].confirmedBy, "simulation");
  assert.match(text, /confirmed by simulation/);

  // The advisory one is on the same card, marked, and named as advisory.
  const advisory = item.verdict.flags.filter(
    (flag) => flag.severity === "advisory",
  );
  assert.equal(advisory.length, 1);
  assert.equal(advisory[0].confirmedBy, "llm-scan");
  assert.match(text, /source scan, advisory only/);
  assert.match(text, /cannot move one on its own/);

  // And the route that produced it is readable, because "an LLM said so" is not evidence.
  assert.match(text, /0g-compute/);
});

test("no flag on the injection row can block on the scan's authority", async () => {
  const item = await injectionRow();
  for (const flag of item.verdict.flags) {
    if (flag.confirmedBy === "llm-scan") assert.equal(flag.severity, "advisory");
    if (flag.severity === "block") assert.notEqual(flag.confirmedBy, "llm-scan");
  }
});

test("the scan section renders after the flags, never above them", async () => {
  const item = await injectionRow();
  const text = stripTags(
    renderToStaticMarkup(<VerdictCard verdict={item.verdict} scan={item.scan} />),
  );

  // Reading order is the argument: the four checks decided this, the scan is a footnote to it.
  assert.ok(text.indexOf("the four checks") < text.indexOf("advisory source scan"));
});

test("a scan that proposed nothing does not render as clean", () => {
  const text = stripTags(
    renderToStaticMarkup(<ScanReportPanel report={scanned()} />),
  );

  assert.match(text, /proposed nothing/);
  assert.match(text, /not a clean bill of health/);
  assert.doesNotMatch(text, /\bno issues\b/i);
});

test("not scanned renders as not scanned, and says it is not a pass", () => {
  const report = scanned({
    state: "not-scanned",
    route: null,
    reason: "this address has no published source, so there was nothing to scan",
  });
  const text = stripTags(renderToStaticMarkup(<ScanReportPanel report={report} />));

  assert.match(text, /not scanned/);
  assert.match(text, /no published source/);
  assert.match(text, /not a pass/);
});

test("a route that failed is a rendered state, not a silent absence", () => {
  const report = scanned({
    state: "not-scanned",
    reason: "the scan did not complete: 0G Compute answered 503",
  });
  const text = stripTags(renderToStaticMarkup(<ScanReportPanel report={report} />));

  assert.match(text, /did not complete/);
  assert.match(text, /503/);
  assert.match(text, /not a pass/);
  // The route still names itself, so a failure is attributable to the thing that failed.
  assert.match(text, /0g-compute/);
});

test("a finding outside the closed four is discarded where a reader can see it", () => {
  const report = scanned({
    findings: ["Something it could name."],
    discarded: ["reentrancy", "5"],
  });
  const text = stripTags(renderToStaticMarkup(<ScanReportPanel report={report} />));

  assert.match(text, /2 proposed findings discarded/);
  assert.match(text, /reentrancy/);
  assert.match(text, /rather than renamed/);
});
