import { readerFor } from "@/src/gates/tx/rpc";
import { validationRegistry, validatorAddress } from "@/src/shared/config";
import { gradeForScore } from "@/src/shared";
import type { AgentId, Grade, ValidationRecord } from "@/src/shared";
import { readValidation } from "@/src/validator/validation-registry";
import { ensNameFor } from "./ens";
import { toRenderableError, type RenderableError } from "./errors";

/**
 * The one registry read module.
 *
 * Every list on this surface reads through here and nothing else in app/ calls
 * readValidation. That is an acceptance test rather than a preference: open the
 * network tab on the stage build and the reads have to be uniform, which they
 * cannot be if three views each grow their own path.
 *
 * There is no indexer between this and the chain. The subgraph left the board with
 * the 7/24 partner swap, so the board reads the registry direct.
 */

export type BoardEntry = {
  agentId: AgentId;
  record: ValidationRecord;
  grade: Grade;
  /**
   * The agent's ENS name, when one is derivable. Cosmetic and always optional:
   * null renders exactly as this board did before names existed, which is the
   * state every row is in until a name is registered.
   */
  ensName: string | null;
};

export type BoardRead = {
  entries: BoardEntry[];
  /** Ids asked for that the registry had nothing listable for. */
  unlisted: AgentId[];
  /** The height the board was read at. Rendered, so a stale board says so. */
  readAtBlock: string | null;
  chainId: number | null;
  validator: string | null;
  error: RenderableError | null;
};

const GRADE_ORDER: Grade[] = ["A", "B", "C", "D", "F"];

/**
 * A record this surface will list, per 01-INTERFACES section 3.
 *
 * readValidation already applies both rules below the caller, so on the live path
 * this only ever re-states what it returned. It stays because it is also the
 * statement of the rule: absent, expired, and written by another validator are the
 * same answer, which is not listed. An expired A on a projector is a claim the
 * system does not make, and a foreign record is a grade nobody here stands behind.
 */
export function isListable(
  record: ValidationRecord,
  validator: string,
  now: number,
): boolean {
  if (record.validator.toLowerCase() !== validator.toLowerCase()) return false;
  if (record.expiresAt <= now) return false;
  return true;
}

function entryFor(record: ValidationRecord): BoardEntry | null {
  // The letter comes back from the onchain score and is never recomputed here. A
  // score off the 25 point scale did not come from this methodology, and guessing
  // a letter for it would put an unearned grade on a big screen.
  const grade = gradeForScore(record.score);
  if (grade === null) return null;
  return {
    agentId: record.agentId,
    record,
    grade,
    ensName: ensNameFor(record.agentId),
  };
}

/**
 * Read the board for a given set of subjects.
 *
 * The registry has no enumeration: a record is found by agent id, so the caller
 * says which agents the board is about. On stage that list comes from the URL,
 * which also means the operator can add one mid-demo without a deploy.
 *
 * One failed read fails the whole board rather than quietly listing the rest. A
 * board missing a row for a reason nobody can see is worse than a board that says
 * it could not read the chain.
 */
export async function readBoard(agentIds: AgentId[]): Promise<BoardRead> {
  const empty = {
    entries: [],
    unlisted: [],
    readAtBlock: null,
    chainId: null,
    validator: null,
  };

  const wanted = [...new Set(agentIds.map((id) => id.trim()).filter(Boolean))];
  if (wanted.length === 0) {
    return { ...empty, error: null };
  }

  try {
    const { chainId } = validationRegistry();
    const validator = validatorAddress();
    const [block, records] = await Promise.all([
      readerFor(chainId).blockNumber(),
      Promise.all(wanted.map((id) => readValidation(id, validator))),
    ]);

    const entries: BoardEntry[] = [];
    const unlisted: AgentId[] = [];
    for (let index = 0; index < wanted.length; index += 1) {
      const record = records[index];
      const entry = record === null ? null : entryFor(record);
      if (entry === null) {
        unlisted.push(wanted[index]);
        continue;
      }
      entries.push(entry);
    }

    entries.sort(
      (left, right) =>
        GRADE_ORDER.indexOf(left.grade) - GRADE_ORDER.indexOf(right.grade),
    );

    return {
      entries,
      unlisted,
      readAtBlock: block.toString(),
      chainId,
      validator,
      error: null,
    };
  } catch (thrown) {
    return { ...empty, error: toRenderableError(thrown) };
  }
}

/**
 * The subjects the board is about: the URL first, then a configured default.
 *
 * Read from process.env directly rather than through the shared config, because
 * this is which rows a screen shows and not a value any verdict depends on.
 */
export function boardSubjects(fromUrl: string | undefined): AgentId[] {
  const raw = fromUrl ?? process.env.PREFLIGHT_BOARD_AGENT_IDS ?? "";
  return raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= 100)
    .slice(0, 25);
}
