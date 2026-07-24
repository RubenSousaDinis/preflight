import type { AgentId, Grade, ValidationRecord } from "@/src/shared";
import { gradeForScore } from "@/src/shared";
import {
  FIXTURE_CARD_A,
  FIXTURE_CARD_DRIFTED,
  FIXTURE_CARD_F,
  FIXTURE_RECORD_A,
  FIXTURE_RECORD_DRIFTED,
  FIXTURE_RECORD_EXPIRED,
  FIXTURE_RECORD_F,
  FIXTURE_RECORD_WRONG_VALIDATOR,
  FIXTURE_VALIDATOR,
  FIXTURE_RAN_AT,
} from "@/src/shared/fixtures";
import type { RenderableError } from "./errors";

/**
 * The one registry read module.
 *
 * Every list on this surface reads through here and nothing in app/ calls
 * readValidation directly. That is an acceptance test rather than a preference:
 * open the network tab on the stage build and the reads have to be uniform, which
 * they cannot be if three views each grow their own path.
 */

export type BoardEntry = {
  agentId: AgentId;
  name: string;
  record: ValidationRecord;
  grade: Grade;
};

export type BoardRead = {
  entries: BoardEntry[];
  /** The height the board was read at. Rendered, so a stale board says it is stale. */
  readAtBlock: string | null;
  /** When set, the board renders this and lists nothing. */
  error: RenderableError | null;
};

const GRADE_ORDER: Grade[] = ["A", "B", "C", "D", "F"];

/**
 * A record this surface will list, per 01-INTERFACES section 3.
 *
 * Absent, expired, and written by another validator are the same answer: not
 * listed. An expired A on a projector is a claim the system does not make, and a
 * foreign record is a grade nobody here stands behind.
 *
 * TODO-INTEGRATE: on the live path readValidation applies both rules below the
 * caller, and this function goes away with the fixture path it exists for.
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

function entryFor(
  record: ValidationRecord,
  name: string,
): BoardEntry | null {
  // The letter comes back from the onchain score and is never recomputed here.
  // A score off the 25 point scale did not come from this methodology, and
  // guessing a letter for it would put an unearned grade on a big screen.
  const grade = gradeForScore(record.score);
  if (grade === null) return null;
  return { agentId: record.agentId, name, record, grade };
}

/*
  TODO-INTEGRATE: A3b's readValidation is the live read, and A4 has to deploy the
  ValidationRegistry before it can return anything. Until both are true the board
  reads the frozen fixture records through this same function, so the filtering
  rules above are exercised now rather than discovered on stage.

  When it flips, this function calls readValidation(agentId, validator) per subject
  and reads the head block once, and everything above it stays as it is.
*/
export async function readBoard(): Promise<BoardRead> {
  const now = FIXTURE_RAN_AT;
  const candidates: { record: ValidationRecord; name: string }[] = [
    { record: FIXTURE_RECORD_A, name: FIXTURE_CARD_A.name },
    { record: FIXTURE_RECORD_F, name: FIXTURE_CARD_F.name },
    { record: FIXTURE_RECORD_DRIFTED, name: FIXTURE_CARD_DRIFTED.name },
    { record: FIXTURE_RECORD_EXPIRED, name: "Expired record, not listed" },
    {
      record: FIXTURE_RECORD_WRONG_VALIDATOR,
      name: "Another validator's record, not listed",
    },
  ];

  const entries = candidates
    .filter(({ record }) => isListable(record, FIXTURE_VALIDATOR, now))
    .map(({ record, name }) => entryFor(record, name))
    .filter((entry): entry is BoardEntry => entry !== null)
    .sort(
      (left, right) =>
        GRADE_ORDER.indexOf(left.grade) - GRADE_ORDER.indexOf(right.grade),
    );

  return { entries, readAtBlock: null, error: null };
}
