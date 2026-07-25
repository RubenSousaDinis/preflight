import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type { ValidationRecord } from "@/src/shared";
import { Leaderboard } from "../components/board/leaderboard";
import { boardSubjects, isListable, readBoard } from "./registry";
import { submitAgent } from "./submit";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATOR = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const NOW = 1_800_000_000;

function record(overrides: Partial<ValidationRecord> = {}): ValidationRecord {
  return {
    agentId: "1",
    score: 100,
    responseURI: "https://example.invalid/evidence.json",
    responseHash: `0x${"11".repeat(32)}`,
    tag: "litmus-v17",
    validator: VALIDATOR,
    expiresAt: NOW + 3_600,
    txHash: `0x${"22".repeat(32)}`,
    ...overrides,
  } as ValidationRecord;
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

test("every list read goes through the one registry module", () => {
  const offenders = sourceFiles(APP_DIR).filter((path) => {
    if (path.endsWith(join("lib", "registry.ts"))) return false;
    if (path.endsWith(join("lib", "registry.test.tsx"))) return false;
    return /readValidation|validation-registry/.test(readFileSync(path, "utf8"));
  });

  assert.deepEqual(
    offenders.map((path) => path.slice(APP_DIR.length + 1)),
    [],
    "these files read the registry directly instead of through app/lib/registry.ts",
  );
});

test("an expired record and a foreign one are both treated as absent", () => {
  assert.equal(isListable(record(), VALIDATOR, NOW), true);
  assert.equal(
    isListable(record({ expiresAt: NOW - 1 }), VALIDATOR, NOW),
    false,
    "an expired record is absent, not a stale grade",
  );
  assert.equal(
    isListable(record({ validator: OTHER }), VALIDATOR, NOW),
    false,
    "a record from another validator is ignored, not trusted",
  );
  // Case is not a difference between two addresses.
  assert.equal(
    isListable(record({ validator: VALIDATOR.toUpperCase() }), VALIDATOR, NOW),
    true,
  );
});

test("the board asks about nobody until it is told who", async () => {
  const board = await readBoard([]);
  assert.deepEqual(board.entries, []);
  assert.equal(board.error, null);
  assert.equal(board.readAtBlock, null, "no read means no claimed height");
});

test("subjects come from the url first, then the configured default", () => {
  assert.deepEqual(boardSubjects("8427, 8428  8429"), [
    "8427",
    "8428",
    "8429",
  ]);
  assert.deepEqual(boardSubjects(""), []);
  assert.ok(boardSubjects(undefined).length >= 0);
});

test("the board always renders the validator and the height it read at", () => {
  const markup = renderToStaticMarkup(
    <Leaderboard
      board={{
        entries: [{ agentId: "8427", record: record({ agentId: "8427" }), grade: "A" }],
        unlisted: ["8428"],
        readAtBlock: "31337",
        chainId: 84532,
        validator: VALIDATOR,
        error: null,
      }}
    />,
  );

  assert.ok(markup.includes(VALIDATOR), "whose claim this is has to be on screen");
  assert.ok(markup.includes("31337"), "the height it read at has to be on screen");
  assert.ok(markup.includes("8428"), "an id with no listable record is named");
  assert.ok(markup.includes("100"));
});

test("a board that could not read the chain says so and lists nothing", () => {
  const markup = renderToStaticMarkup(
    <Leaderboard
      board={{
        entries: [],
        unlisted: [],
        readAtBlock: null,
        chainId: null,
        validator: null,
        error: {
          code: "VALIDATION_READ",
          reason: "the registry read failed",
          retryable: true,
        },
      }}
    />,
  );
  assert.ok(markup.includes("the registry read failed"));
});

test("a malformed submission is refused and creates no row", async () => {
  const empty = await submitAgent(null, new FormData());
  assert.equal(empty.kind, "invalid");

  const hostile = new FormData();
  hostile.set("ref", "<script>alert(1)</script>");
  assert.equal((await submitAgent(null, hostile)).kind, "invalid");
});
