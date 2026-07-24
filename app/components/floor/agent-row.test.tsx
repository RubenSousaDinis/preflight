import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadFloor, type FloorRow } from "../../lib/floor";
import { grade as gradeTokens, surface } from "../../lib/tokens";
import { AgentRow } from "./agent-row";

/*
  These are the rendering rules that fail closed. Each one has a way of being wrong
  that looks fine on screen, which is exactly why they are pinned here rather than
  left to a visual pass.
*/

function render(row: FloorRow): string {
  return renderToStaticMarkup(<AgentRow row={row} />);
}

function stripTags(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

async function rowFor(agentId: string): Promise<FloorRow> {
  const rows = await loadFloor();
  const row = rows.find((candidate) => candidate.agentId === agentId);
  assert.ok(row, `expected a row for ${agentId}`);
  return row;
}

test("the drifted agent keeps its A and still refuses", async () => {
  const row = await rowFor("fixture-agent-drifted");

  assert.equal(row.decision?.grade, "A");
  assert.equal(row.decision?.verdict, "REFUSE");
  assert.equal(row.decision?.fingerprintMatch, false);

  const text = stripTags(render(row));
  // Both have to be on screen at once. Hiding the A to make the refusal look
  // tidier would delete the whole point of the row.
  assert.match(text, /\bA\b/);
  assert.match(text, /REFUSE/);
  assert.match(text, /moved since grading/);
  assert.match(text, /no longer matches the surface that was graded/);
});

test("a null fingerprint result renders as a refusal cause, never as a blank", async () => {
  const row = await rowFor("fixture-agent-a");
  const withNullMatch: FloorRow = {
    ...row,
    decision: { ...row.decision!, fingerprintMatch: null },
  };

  const text = stripTags(render(withNullMatch));
  assert.match(text, /could not be checked/);
});

test("a null grade renders as not attested and takes no grade colour", async () => {
  const row = await rowFor("fixture-agent-a");
  const unattested: FloorRow = {
    ...row,
    decision: {
      ...row.decision!,
      grade: null,
      score: null,
      verdict: "REFUSE",
      reason: "no validation record from this validator",
    },
  };

  const markup = render(unattested);
  assert.match(stripTags(markup), /not attested/);
  // The neutral rule colour, never one of the five grade colours. Read from the
  // token module so this keeps checking the rule rather than a copied value.
  assert.ok(markup.includes(`background-color:${surface.rule}`));
  for (const colour of Object.values(gradeTokens)) {
    assert.ok(
      !markup.includes(colour),
      `an unattested row must not carry the grade colour ${colour}`,
    );
  }
});

test("a row the gate could not clear renders no verdict at all", async () => {
  const row = await rowFor("fixture-agent-a");
  const failed: FloorRow = {
    ...row,
    decision: null,
    error: {
      code: "FINGERPRINT",
      reason: "the live tool surface could not be enumerated",
      retryable: true,
    },
  };

  const text = stripTags(render(failed));
  assert.match(text, /could not be enumerated/);
  assert.doesNotMatch(text, /HIRE/);
  assert.doesNotMatch(text, /REFUSE/);
});

test("every row on the floor carries a decision or an error, never both", async () => {
  const rows = await loadFloor();
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.ok(
      (row.decision === null) !== (row.error === null),
      `${row.agentId} must carry exactly one of decision or error`,
    );
  }
});
