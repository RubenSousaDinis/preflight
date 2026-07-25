import type { QueueItem } from "../../lib/firewall";
import { EmptyState, ErrorState, PulseDots } from "../states";
import { VerdictCard } from "./verdict-card";

/*
  The recorded calls, folded.

  Each card is most of a screen of evidence, and four of them open at once buried
  the one control on this view under four screens of replay. So the verdict and the
  call are the row, and the evidence behind that verdict is one click away.

  `details` rather than state: the fold works before hydration, and every word
  inside a closed card is still in the document for find-in-page and for a reader
  that ignores the fold.
*/

function verdictTone(item: QueueItem): string {
  if (item.state === "failed") return "text-grade-f";
  if (item.state !== "decided") return "text-ink/55";
  return item.verdict.verdict === "BLOCK" ? "text-grade-f" : "text-accent";
}

function verdictWord(item: QueueItem): string {
  if (item.state === "decided") return item.verdict.verdict;
  if (item.state === "failed") return "failed";
  return item.state;
}

function Body({ item }: { item: QueueItem }) {
  switch (item.state) {
    case "queued":
      return (
        <p className="font-data text-[0.8rem] text-ink/60">
          queued, waiting for a fork
        </p>
      );
    case "simulating":
      return (
        <div role="status" aria-live="polite">
          <p className="flex items-center gap-2 font-data text-[0.8rem] text-ink/70">
            <PulseDots />
            simulating on a {item.chainLabel} fork
            {item.atBlock ? ` at block ${item.atBlock}` : " at the live block"}
          </p>
          <p className="mt-2 text-[0.85rem] leading-snug text-ink/60">
            The exact calldata is replayed against the forked state. No verdict
            exists until this finishes, and a fork that cannot be established
            blocks rather than passing.
          </p>
        </div>
      );
    case "decided":
      return <VerdictCard verdict={item.verdict} />;
    case "failed":
      return <ErrorState error={item.error} />;
  }
}

function QueueCard({ item }: { item: QueueItem }) {
  return (
    <details
      id={`call-${item.id}`}
      className="group scroll-mt-16 border border-rule bg-panel"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 group-open:border-b group-open:border-rule group-open:bg-band/50 hover:bg-band/40 sm:px-5 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <h3 className="font-display text-[1.05rem] leading-tight font-semibold">
            {item.label}
          </h3>
          <p className="mt-0.5 font-data text-[0.7rem] break-all text-ink/45">
            to {item.tx.to} / value {item.tx.value} / {item.chainLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-baseline gap-3">
          <span
            className={`font-data text-[0.85rem] tracking-[0.1em] ${verdictTone(item)}`}
          >
            {verdictWord(item)}
          </span>
          <span className="font-data text-[0.66rem] tracking-[0.12em] text-ink/45">
            <span className="group-open:hidden">evidence +</span>
            <span className="hidden group-open:inline">evidence -</span>
          </span>
        </div>
      </summary>
      <div className="px-4 py-4 sm:px-5">
        <Body item={item} />
      </div>
    </details>
  );
}

export function PendingQueue({ items }: { items: QueueItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState>
        The staged fixture calls will arrive here: an unlimited approval, an
        owner-gated path behind a proxy, a honeypot pair, and a plain swap through
        a verified router.
      </EmptyState>
    );
  }

  return (
    <ol className="space-y-2">
      {items.map((item) => (
        <li key={item.id}>
          <QueueCard item={item} />
        </li>
      ))}
    </ol>
  );
}
