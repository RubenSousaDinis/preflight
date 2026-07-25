import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { EnsMirror } from "../../lib/ens";
import { EnsMirrorLine } from "./ens-mirror-line";

/*
  The states this line has to get right are the empty ones. A mirror that renders
  a grade is the easy case; a mirror that is off, unresolvable, or behind the
  registry is where a cosmetic surface starts making claims the system does not.
*/

const UPDATED_AT = 1_753_000_000;

function mirror(overrides: Partial<EnsMirror> = {}): EnsMirror {
  return {
    name: "agent8427.preflight.base.eth",
    grade: "A",
    score: "100",
    evidence: "ipfs://bafyevidence",
    registryPointer: "eip155:84532:0x4444444444444444444444444444444444444444",
    updatedAt: UPDATED_AT,
    off: false,
    error: null,
    ...overrides,
  };
}

function render(value: EnsMirror, at = UPDATED_AT + 60): string {
  return renderToStaticMarkup(<EnsMirrorLine mirror={value} at={at} />)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
}

test("the values are labelled as a mirror of the registry, visibly", () => {
  const markup = render(mirror());
  assert.match(markup, /mirror/i);
  assert.match(markup, /not a source/i);
  assert.ok(
    markup.includes("eip155:84532:0x4444444444444444444444444444444444444444"),
    "the record the values were copied from is named, so it can be checked",
  );
  assert.match(markup, /grade A/);
});

test("an unconfigured mirror is one quiet line and no empty chip", () => {
  const markup = render(mirror({ off: true }));
  assert.match(markup, /no ENS name configured/);
  assert.doesNotMatch(
    markup,
    /grade [A-F]|score \d/,
    "an unconfigured mirror puts no letter and no score on screen",
  );
});

test("a name with no records says the registry is unaffected", () => {
  const markup = render(
    mirror({ grade: null, score: null, evidence: null, updatedAt: null }),
  );
  assert.match(markup, /no grade record yet/);
  assert.match(markup, /registry/i);
});

test("a lookup that failed reports unknown rather than assuming", () => {
  const markup = render(
    mirror({
      grade: null,
      error: { code: "ENS", reason: "the resolver did not answer", retryable: true },
    }),
  );
  assert.match(markup, /could not be resolved/);
  assert.match(markup, /the resolver did not answer/);
  assert.doesNotMatch(markup, /answers grade/);
});

test("a copy older than the reader's bound says so instead of being smoothed over", () => {
  const fresh = render(mirror(), UPDATED_AT + 3_600);
  assert.doesNotMatch(fresh, /more than a day old/);

  const stale = render(mirror(), UPDATED_AT + 86_401);
  assert.match(stale, /more than a day old/);
  assert.match(stale, /Read the registry/);
});
