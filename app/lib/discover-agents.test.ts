import assert from "node:assert/strict";
import test from "node:test";
import { filterAgentCatalog } from "./discover-agents";
import type { KnownAgentCatalogEntry } from "./known-agents";

const CATALOG: KnownAgentCatalogEntry[] = [
  {
    id: "8441",
    label: "ENSWhois",
    note: "mcp.enswhois.com",
    ensName: "agent8441.preflight.basetest.eth",
  },
  {
    id: "8427",
    label: "Demo baseline",
    note: "hired path",
    ensName: "agent8427.preflight.basetest.eth",
  },
];

test("an empty query keeps the whole catalog", () => {
  assert.equal(filterAgentCatalog(CATALOG, "").length, 2);
  assert.equal(filterAgentCatalog(CATALOG, "   ").length, 2);
});

test("search matches id, ENS name, label, and note", () => {
  assert.deepEqual(
    filterAgentCatalog(CATALOG, "enswhois").map((agent) => agent.id),
    ["8441"],
  );
  assert.deepEqual(
    filterAgentCatalog(CATALOG, "8441").map((agent) => agent.id),
    ["8441"],
  );
  assert.deepEqual(
    filterAgentCatalog(CATALOG, "agent8427").map((agent) => agent.id),
    ["8427"],
  );
  assert.deepEqual(
    filterAgentCatalog(CATALOG, "hired").map((agent) => agent.id),
    ["8427"],
  );
  assert.equal(filterAgentCatalog(CATALOG, "nope").length, 0);
});

test("agents without an ENS sub-line still appear in search by id", () => {
  const mixed: KnownAgentCatalogEntry[] = [
    ...CATALOG,
    {
      id: "9001",
      label: "Unmirrored",
      note: "registered only",
      ensName: null,
    },
  ];
  assert.deepEqual(
    filterAgentCatalog(mixed, "9001").map((agent) => agent.id),
    ["9001"],
  );
});
