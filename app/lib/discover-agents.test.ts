import assert from "node:assert/strict";
import test from "node:test";
import { filterAgentCatalog } from "./filter-agent-catalog";
import type { KnownAgentCatalogEntry } from "./known-agents";
import { CURATED_BASE_LEADERS } from "./curated-base-leaders";

const CATALOG: KnownAgentCatalogEntry[] = [
  {
    id: "8441",
    label: "ENSWhois",
    note: "mcp.enswhois.com",
    ensName: "agent8441.preflight.basetest.eth",
    identityChainId: 84532,
    sepoliaId: null,
    source: "sepolia-demo",
  },
  {
    id: "8427",
    label: "Demo baseline",
    note: "hired path",
    ensName: "agent8427.preflight.basetest.eth",
    identityChainId: 84532,
    sepoliaId: null,
    source: "sepolia-demo",
  },
  {
    id: "22335",
    label: "erni",
    note: "8004scan Base leader, MCP",
    ensName: null,
    identityChainId: 8453,
    sepoliaId: null,
    source: "8004scan",
  },
];

test("an empty query keeps the whole catalog", () => {
  assert.equal(filterAgentCatalog(CATALOG, "").length, 3);
});

test("search matches id, ENS name, label, note, and 8004scan source", () => {
  assert.deepEqual(
    filterAgentCatalog(CATALOG, "erni").map((agent) => agent.id),
    ["22335"],
  );
  assert.deepEqual(
    filterAgentCatalog(CATALOG, "8004scan").map((agent) => agent.id),
    ["22335"],
  );
  assert.deepEqual(
    filterAgentCatalog(CATALOG, "8441").map((agent) => agent.id),
    ["8441"],
  );
});

/*
  The catalog is what the console offers, so membership is a claim that a run reaches a
  letter. These four were checked on 2026-07-25 and cannot: two cards do not resolve,
  and two endpoints answer 404. Any of them can still be graded by typing the id, which
  is where the reason belongs.
*/
test("curated Base leaders exclude ids that were checked and could not be graded", () => {
  const ids = CURATED_BASE_LEADERS.map((agent) => agent.id);
  for (const ungradable of ["2290", "32214", "19506", "22524"]) {
    assert.ok(!ids.includes(ungradable), `${ungradable} cannot be graded`);
  }
  assert.ok(CURATED_BASE_LEADERS.length >= 5);
  assert.equal(new Set(ids).size, ids.length);
});
