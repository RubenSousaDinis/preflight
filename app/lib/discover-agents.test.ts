import assert from "node:assert/strict";
import test from "node:test";
import { filterAgentCatalog } from "./discover-agents";
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
    id: "2290",
    label: "Clawdia",
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
    filterAgentCatalog(CATALOG, "clawdia").map((agent) => agent.id),
    ["2290"],
  );
  assert.deepEqual(
    filterAgentCatalog(CATALOG, "8004scan").map((agent) => agent.id),
    ["2290"],
  );
  assert.deepEqual(
    filterAgentCatalog(CATALOG, "8441").map((agent) => agent.id),
    ["8441"],
  );
});

test("curated Base leaders include Clawdia", () => {
  assert.ok(CURATED_BASE_LEADERS.some((agent) => agent.id === "2290"));
  assert.ok(CURATED_BASE_LEADERS.length >= 5);
});
