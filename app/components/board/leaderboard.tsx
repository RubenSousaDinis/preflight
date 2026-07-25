import type { BoardEntry, BoardRead } from "../../lib/registry";
import { gradeColor } from "../../lib/tokens";
import { EmptyState, ErrorState } from "../states";

/*
  The board, sorted by grade with A first.

  The validator column is always on screen. Independence here is disclosure based,
  so the one place this surface could imply a neutrality it does not have is by
  hiding whose attestation a row is, and it does not.
*/

const ROW_GRID =
  "grid grid-cols-1 gap-x-5 gap-y-2 md:grid-cols-[minmax(9rem,1fr)_6rem_5rem_minmax(0,1.3fr)_9rem]";

const HEADINGS = ["agent", "grade", "score", "validator", "expires (reader)"];

/**
 * How much of the reader's freshness bound is left.
 *
 * The registry stores no expiry. `ValidationStatus` carries `lastUpdate` and
 * nothing else about time, so this bound is `lastUpdate + 86400` computed and
 * enforced by the reader, and the column says so rather than letting a countdown
 * imply the contract holds it.
 *
 * Rendered as a remaining window rather than a wall clock time: the board is read
 * on one machine and watched on another, and a formatted local time on a projector
 * invites a question about which clock it came from.
 */
function freshnessLabel(expiresAt: number): string {
  const remaining = expiresAt - Math.floor(Date.now() / 1000);
  if (remaining <= 0) return "expired";
  const hours = Math.floor(remaining / 3600);
  if (hours >= 1) return `valid ${hours}h more`;
  return `valid ${Math.max(1, Math.floor(remaining / 60))}m more`;
}

function Row({ entry }: { entry: BoardEntry }) {
  return (
    <article className={`${ROW_GRID} px-4 py-4 sm:px-5`}>
      <div className="min-w-0">
        <p className="font-data text-[0.95rem] break-all">{entry.agentId}</p>
        <p className="mt-0.5 font-data text-[0.68rem] break-all text-ink/45">
          {entry.record.tag}
        </p>
      </div>
      <div>
        <span
          className="font-display text-[1.7rem] leading-none font-semibold"
          style={{ color: gradeColor(entry.grade) }}
        >
          {entry.grade}
        </span>
      </div>
      <p className="font-data text-[0.85rem] text-ink/75">
        {entry.record.score}
      </p>
      <p className="font-data text-[0.72rem] break-all text-ink/60">
        {entry.record.validator}
      </p>
      <p className="font-data text-[0.75rem] text-ink/60">
        {freshnessLabel(entry.record.expiresAt)}
      </p>
    </article>
  );
}

export function Leaderboard({ board }: { board: BoardRead }) {
  if (board.error) {
    return <ErrorState error={board.error} />;
  }

  if (board.entries.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState>
          No listable record for the agents this board was asked about. Submit an
          agent below, or add an id to the address bar as ?agents=, and it appears
          here once its record is published.
        </EmptyState>
        {board.unlisted.length > 0 ? (
          <p className="font-data text-[0.75rem] break-all text-ink/55">
            asked about {board.unlisted.join(", ")} / nothing listable from this
            validator
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className="border border-rule">
        <div
          className={`${ROW_GRID} hidden border-b border-rule bg-band px-4 py-2 sm:px-5 md:grid`}
        >
          {HEADINGS.map((heading) => (
            <p
              key={heading}
              className="font-data text-[0.62rem] uppercase tracking-[0.16em] text-ink/55"
            >
              {heading}
            </p>
          ))}
        </div>
        <ul className="divide-y divide-rule">
          {board.entries.map((entry) => (
            <li key={entry.agentId}>
              <Row entry={entry} />
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 font-data text-[0.72rem] break-all text-ink/50">
        {board.readAtBlock === null
          ? "read height not reported"
          : `read at block ${board.readAtBlock} on chain ${board.chainId}`}
        {board.validator === null ? "" : ` / validator ${board.validator}`}
      </p>
      {board.unlisted.length > 0 ? (
        <p className="mt-1 font-data text-[0.72rem] break-all text-ink/50">
          not listed: {board.unlisted.join(", ")}
        </p>
      ) : null}
      <p className="mt-2 max-w-[46rem] text-[0.85rem] leading-snug text-ink/60">
        A record written by any other validator is not listed here, and neither is
        one past the freshness bound. Both are treated as absent rather than as a
        weaker grade.
      </p>
      <p className="mt-2 max-w-[46rem] text-[0.85rem] leading-snug text-ink/60">
        The registry records when a record was last updated, not when it expires.
        There is no expiry field in the contract, so the bound above is the last
        update plus twenty four hours, computed and enforced by the reader. The gate
        applies the tighter of that and its own policy.
      </p>
    </div>
  );
}
