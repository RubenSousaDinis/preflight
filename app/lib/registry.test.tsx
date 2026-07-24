import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FIXTURE_RECORD_A,
  FIXTURE_RECORD_EXPIRED,
  FIXTURE_RECORD_WRONG_VALIDATOR,
  FIXTURE_RAN_AT,
  FIXTURE_VALIDATOR,
} from "@/src/shared/fixtures";
import { Leaderboard } from "../components/board/leaderboard";
import { isListable, readBoard } from "./registry";
import { submitAgent } from "./submit";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

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
  assert.equal(
    isListable(FIXTURE_RECORD_A, FIXTURE_VALIDATOR, FIXTURE_RAN_AT),
    true,
  );
  assert.equal(
    isListable(FIXTURE_RECORD_EXPIRED, FIXTURE_VALIDATOR, FIXTURE_RAN_AT),
    false,
    "an expired record is absent, not a stale grade",
  );
  assert.equal(
    isListable(FIXTURE_RECORD_WRONG_VALIDATOR, FIXTURE_VALIDATOR, FIXTURE_RAN_AT),
    false,
    "a record from another validator is ignored, not trusted",
  );
});

test("the board lists only listable records, sorted with A first", async () => {
  const board = await readBoard();

  assert.equal(board.error, null);
  assert.deepEqual(
    board.entries.map((entry) => entry.grade),
    ["A", "A", "F"],
  );

  const ids = board.entries.map((entry) => entry.agentId);
  assert.ok(!ids.includes(FIXTURE_RECORD_EXPIRED.agentId + "-expired"));
  assert.equal(board.entries.length, 3);
});

test("the board always renders the validator behind every row", async () => {
  const board = await readBoard();
  const markup = renderToStaticMarkup(<Leaderboard board={board} />);

  for (const entry of board.entries) {
    assert.ok(
      markup.includes(entry.record.validator),
      `${entry.agentId} must render the validator that attested it`,
    );
    assert.ok(markup.includes(String(entry.record.score)));
  }
});

test("a malformed submission is refused and creates no row", async () => {
  const before = (await readBoard()).entries.length;

  const empty = await submitAgent(null, new FormData());
  assert.equal(empty.kind, "invalid");

  const hostile = new FormData();
  hostile.set("ref", "<script>alert(1)</script>");
  const rejected = await submitAgent(null, hostile);
  assert.equal(rejected.kind, "invalid");

  const wellFormed = new FormData();
  wellFormed.set("ref", "npm/@scope/server");
  const unwired = await submitAgent(null, wellFormed);
  // Well formed and still not a grade: the pipeline is not wired, and an
  // unwired pipeline is an answer rather than a letter.
  assert.equal(unwired.kind, "error");

  assert.equal((await readBoard()).entries.length, before);
});
