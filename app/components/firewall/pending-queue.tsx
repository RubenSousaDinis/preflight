import type { QueueItem } from "../../lib/firewall";
import { EmptyState, ErrorState, PulseDots } from "../states";
import { VerdictCard } from "./verdict-card";

/*
  Transactions moving through queued, simulating, and decided.

  The simulating state is on screen for real seconds while a fork is established, so
  it names the chain and the block it is working against rather than spinning. That
  state is what the room stares at during the beat, which makes it a designed state
  and not a placeholder.
*/

function ItemHeader({ item }: { item: QueueItem }) {
  return (
    <header className="border-b border-rule bg-band/50 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-[1.05rem] leading-tight font-semibold">
          {item.label}
        </h3>
        <p className="font-data text-[0.66rem] uppercase tracking-[0.14em] text-ink/50">
          {item.state} / {item.chainLabel}
        </p>
      </div>
      <p className="mt-1 font-data text-[0.72rem] break-all text-ink/55">
        to {item.tx.to} / value {item.tx.value}
      </p>
    </header>
  );
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

/**
 * Every call and its verdict, in one line each.
 *
 * A summary, never a substitute: each entry jumps to the card it summarizes, and
 * the evidence under that card is unchanged. It exists because the four cards are
 * several screens tall, and an operator asked "what did it say to all four" should
 * not have to scroll to answer.
 */
function QueueIndex({ items }: { items: QueueItem[] }) {
  return (
    <ul className="mb-4 divide-y divide-rule border border-rule bg-band/40">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-5"
        >
          <a
            href={`#call-${item.id}`}
            className="text-[0.92rem] text-ink no-underline hover:text-accent"
          >
            {item.label}
          </a>
          <span
            className={`font-data text-[0.78rem] tracking-[0.1em] ${
              item.state === "decided"
                ? item.verdict.verdict === "BLOCK"
                  ? "text-grade-f"
                  : "text-accent"
                : "text-ink/55"
            }`}
          >
            {item.state === "decided" ? item.verdict.verdict : item.state}
          </span>
        </li>
      ))}
    </ul>
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
    <div>
      <QueueIndex items={items} />
      <ol className="space-y-4">
        {items.map((item) => (
          <li
            key={item.id}
            id={`call-${item.id}`}
            className="scroll-mt-16 border border-rule bg-panel"
          >
            <ItemHeader item={item} />
            <div className="px-4 py-4 sm:px-5">
              <Body item={item} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
