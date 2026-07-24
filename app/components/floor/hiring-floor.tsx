import type { FloorRow } from "../../lib/floor";
import { EmptyState } from "../states";
import { AgentRow, ROW_GRID } from "./agent-row";

const HEADINGS = [
  "agent",
  "attested grade",
  "live recheck",
  "verdict",
  "reason",
];

export function HiringFloor({ rows }: { rows: FloorRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        No agents are registered yet. Each one that is will appear here with its
        attested grade, the result of rechecking its live tool surface, and the
        verdict the gate reached.
      </EmptyState>
    );
  }

  return (
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
        {rows.map((row) => (
          <li key={row.agentId}>
            <AgentRow row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}
