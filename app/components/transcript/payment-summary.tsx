import type { HarnessEvent } from "@/src/shared";
import { formatHbar } from "../../lib/transcript";
import { EmptyState } from "../states";

/*
  What the money did in beat 1, read off the same event stream the transcript
  renders. Amounts moved, never a price list: the illustrative prices for checking
  are post-event product pricing and must not appear here as if they were live.
*/

function sumAmounts(values: string[]): bigint {
  return values.reduce((total, value) => {
    try {
      return total + BigInt(value);
    } catch {
      return total;
    }
  }, 0n);
}

function Field({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="bg-panel px-4 py-3">
      <p className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
        {label}
      </p>
      <p className="mt-1 font-data text-[1rem] break-words">{value}</p>
      <p className="mt-1 text-[0.8rem] leading-snug text-ink/60">{note}</p>
    </div>
  );
}

export function PaymentSummary({ events }: { events: HarnessEvent[] }) {
  const shopping = events.find((event) => event.type === "shopping");
  const done = events.find((event) => event.type === "done");
  const frozen = events.find((event) => event.type === "frozen");
  const paid = events.filter((event) => event.type === "paid");

  const budget = done?.budget ?? shopping?.budget ?? null;
  if (budget === null) {
    return (
      <EmptyState>
        What the client agent was willing to spend, what it paid the agent it
        hired, and what is left once the run stops.
      </EmptyState>
    );
  }

  const spent = sumAmounts(paid.map((event) => event.amount));
  const held = BigInt(budget) - spent;
  const rail = paid[0]?.rail ?? "hedera-x402";

  return (
    <div>
      <dl className="grid gap-px border border-rule bg-rule sm:grid-cols-3">
        <Field
          label="budget"
          value={formatHbar(budget)}
          note="What the client agent was willing to spend on this task."
        />
        <Field
          label="paid out"
          value={formatHbar(spent.toString())}
          note={
            paid.length === 1
              ? "One honest call's fee. Call one ran, returned an answer, and was paid for it."
              : `${paid.length} calls ran and were paid for.`
          }
        />
        <Field
          label="held back"
          value={formatHbar(held.toString())}
          note={
            frozen
              ? "Frozen when the tool output turned hostile. The next call never went out."
              : "Not spent."
          }
        />
      </dl>

      <p className="mt-4 max-w-[46rem] text-[0.9rem] leading-relaxed text-ink/75">
        x402 pays the hired agent on the {rail} rail, gated on grade A plus a live
        fingerprint match. It never pays for a grade, and nobody can pay for one.
      </p>
    </div>
  );
}
