import type { ReactNode } from "react";
import type { Grade, Score } from "@/src/shared";
import type { FloorRow } from "../../lib/floor";
import { gradeColor } from "../../lib/tokens";
import { ErrorState, PulseDots } from "../states";

/*
  One row renders one GateDecision beside its AgentCard.

  Reading order is name, attested grade, live recheck, verdict, reason, and reason
  is the widest column on purpose: "REFUSE" is a word, "graded A, but the live tool
  surface no longer matches the surface that was graded" is evidence, and the second
  one is what a judge repeats to another judge.
*/
export const ROW_GRID =
  "grid grid-cols-1 gap-x-5 gap-y-3 md:grid-cols-[minmax(9rem,1fr)_7rem_10.5rem_7rem_minmax(0,2.2fr)]";

const CELL_LABEL =
  "mb-1 font-data text-[0.6rem] uppercase tracking-[0.16em] text-ink/45 md:hidden";

function Cell({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className={CELL_LABEL}>{label}</p>
      {children}
    </div>
  );
}

/**
 * The attested letter. A null grade never takes a grade colour: an unattested agent
 * tinted green is a false claim rendered in CSS, so it takes the neutral rule
 * colour and says plainly that nothing was attested.
 */
function GradeValue({
  grade,
  score,
}: {
  grade: Grade | null;
  score: Score | null;
}) {
  if (grade === null) {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className="block h-3.5 w-3.5"
          style={{ backgroundColor: gradeColor(null) }}
        />
        <span className="font-data text-[0.8rem] text-ink/65">
          not attested
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-2">
      <span
        className="font-display text-[1.85rem] leading-none font-semibold"
        style={{ color: gradeColor(grade) }}
      >
        {grade}
      </span>
      <span className="font-data text-[0.72rem] text-ink/50">{score}</span>
    </span>
  );
}

/**
 * The live recheck.
 *
 * null means the live surface could not be enumerated, which the contract defines
 * as a refusal cause, so it renders as one. A blank cell here would read as fine,
 * which is the single most expensive way this row can be wrong.
 */
function RecheckValue({ match }: { match: boolean | null }) {
  if (match === true) {
    return (
      <span className="font-data text-[0.88rem] text-accent">
        matches baseline
      </span>
    );
  }
  if (match === false) {
    return (
      <span className="font-data text-[0.88rem] text-grade-f">
        moved since grading
      </span>
    );
  }
  return (
    <span className="font-data text-[0.88rem] text-grade-f">
      could not be checked
    </span>
  );
}

function VerdictValue({ verdict }: { verdict: "HIRE" | "REFUSE" }) {
  const refused = verdict === "REFUSE";
  return (
    <span
      className={`inline-block border px-2.5 py-1 font-data text-[0.88rem] font-medium tracking-[0.1em] ${
        refused ? "border-grade-f text-grade-f" : "border-accent text-accent"
      }`}
    >
      {verdict}
    </span>
  );
}

function AgentName({ row }: { row: FloorRow }) {
  return (
    <div className="min-w-0">
      <p className="font-display text-[1.12rem] leading-tight font-semibold break-words">
        {row.card.name || row.agentId}
      </p>
      <p className="mt-0.5 font-data text-[0.7rem] break-all text-ink/50">
        {row.agentId}
      </p>
      {/*
        The name sits under the id, never instead of it. The id is the thing that
        is verifiable, and a row with no name renders exactly as it did before.
      */}
      {row.ensName ? (
        <p className="mt-0.5 font-data text-[0.68rem] break-all text-ink/45">
          {row.ensName}
        </p>
      ) : null}
    </div>
  );
}

export function AgentRow({ row }: { row: FloorRow }) {
  // A row the gate could not clear shows the typed reason and no verdict at all.
  // Rendering a fallback verdict here would default the gate open on screen even
  // though the logic behind it failed closed.
  if (row.error) {
    return (
      <article className={`${ROW_GRID} px-4 py-5 sm:px-5`}>
        <Cell label="agent">
          <AgentName row={row} />
        </Cell>
        <div className="md:col-span-4">
          <ErrorState error={row.error} />
        </div>
      </article>
    );
  }

  if (row.pending || row.decision === null) {
    return (
      <article className={`${ROW_GRID} px-4 py-5 sm:px-5`}>
        <Cell label="agent">
          <AgentName row={row} />
        </Cell>
        <Cell label="attested grade">
          <PulseDots />
        </Cell>
        <Cell label="live recheck">
          <PulseDots />
        </Cell>
        <Cell label="verdict">
          <PulseDots />
        </Cell>
        <Cell label="reason">
          <p className="font-data text-[0.8rem] text-ink/55">
            awaiting the live tool surface recheck
          </p>
        </Cell>
      </article>
    );
  }

  const { decision } = row;

  return (
    <article className={`${ROW_GRID} px-4 py-5 sm:px-5`}>
      <Cell label="agent">
        <AgentName row={row} />
      </Cell>
      <Cell label="attested grade">
        <GradeValue grade={decision.grade} score={decision.score} />
      </Cell>
      <Cell label="live recheck">
        <RecheckValue match={decision.fingerprintMatch} />
        <p className="mt-1 font-data text-[0.68rem] text-ink/45">
          {row.recheckMs > 0 ? `ran in ${row.recheckMs} ms` : "ran in under 1 ms"}
        </p>
      </Cell>
      <Cell label="verdict">
        <VerdictValue verdict={decision.verdict} />
      </Cell>
      <Cell label="reason">
        <p className="text-[1.075rem] leading-snug text-ink">
          {decision.reason}
        </p>
        {decision.record ? (
          <p className="mt-2 font-data text-[0.7rem] break-all text-ink/50">
            {decision.record.tag} / evidence{" "}
            {decision.record.responseHash.slice(0, 12)}
          </p>
        ) : null}
      </Cell>
    </article>
  );
}
