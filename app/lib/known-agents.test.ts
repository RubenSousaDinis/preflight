import assert from "node:assert/strict";
import test from "node:test";
import { KNOWN_AGENT_IDS, KNOWN_AGENTS } from "./known-agents";

test("every known agent is a uint256 id with a label and a note", () => {
  assert.ok(KNOWN_AGENTS.length >= 4);
  for (const agent of KNOWN_AGENTS) {
    assert.match(agent.id, /^[0-9]+$/, `${agent.label} id is not a registry id`);
    assert.ok(agent.label.trim().length > 0, `${agent.id} has no label`);
    assert.ok(agent.note.trim().length > 0, `${agent.id} has no note`);
  }
  assert.deepEqual(
    KNOWN_AGENT_IDS,
    KNOWN_AGENTS.map((agent) => agent.id),
  );
  assert.equal(
    new Set(KNOWN_AGENT_IDS).size,
    KNOWN_AGENT_IDS.length,
    "known agent ids are unique",
  );
});

test("ENSWhois is in the catalog as 8441", () => {
  const whois = KNOWN_AGENTS.find((agent) => agent.id === "8441");
  assert.ok(whois);
  assert.match(whois!.label, /ENSWhois/i);
});
