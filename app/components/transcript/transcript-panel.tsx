import type { ReactNode } from "react";
import type { HarnessEvent, Receipt } from "@/src/shared";
import { formatHbar } from "../../lib/transcript";
import { EmptyState } from "../states";

/*
  The beat-1 run, rendered straight off the event stream.

  Every variant of the union gets a case, and anything that is not one of them
  still renders as a visible row. A silently dropped event makes the stream look
  shorter than the run, which is worse than an ugly row.
*/

type Tone = "neutral" | "allow" | "block";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-rule text-ink/70",
  allow: "border-accent text-accent",
  block: "border-grade-f text-grade-f",
};

function Badge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span
      className={`inline-block border px-2 py-0.5 font-data text-[0.68rem] tracking-[0.1em] ${TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  );
}

function Line({ children }: { children: ReactNode }) {
  return <p className="text-[1rem] leading-snug text-ink/85">{children}</p>;
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 font-data text-[0.72rem] break-all text-ink/55">
      {children}
    </p>
  );
}

function ReceiptRef({ receipt }: { receipt: Receipt }) {
  return (
    <Mono>
      receipt {receipt.id} / {receipt.hash.slice(0, 12)}
    </Mono>
  );
}

function tone(event: HarnessEvent): Tone {
  switch (event.type) {
    case "vetted":
      return event.decision.verdict === "HIRE" ? "allow" : "block";
    case "hired":
    case "paid":
      return "allow";
    case "injectionCaught":
    case "frozen":
      return "block";
    default:
      return "neutral";
  }
}

function Body({ event }: { event: HarnessEvent }) {
  switch (event.type) {
    case "shopping":
      return (
        <>
          <Line>{event.task}</Line>
          <Mono>
            candidates {event.candidates.join(", ")} / budget{" "}
            {formatHbar(event.budget)}
          </Mono>
        </>
      );
    case "vetted":
      return (
        <>
          <Line>
            <span className="font-data text-[0.8rem]">{event.agentId}</span>{" "}
            {event.decision.verdict === "HIRE" ? "cleared" : "refused"}.{" "}
            {event.decision.reason}
          </Line>
          <ReceiptRef receipt={event.receipt} />
        </>
      );
    case "hired":
      return (
        <>
          <Line>
            <span className="font-data text-[0.8rem]">{event.agentId}</span> was
            hired for the task.
          </Line>
          <Mono>{event.decision.reason}</Mono>
        </>
      );
    case "paid":
      return (
        <>
          <Line>
            {formatHbar(event.amount)} to{" "}
            <span className="font-data text-[0.8rem]">{event.agentId}</span> for
            the call it ran.
          </Line>
          <Mono>
            rail {event.rail} / {event.txRef}
          </Mono>
          <ReceiptRef receipt={event.receipt} />
        </>
      );
    case "toolOutput":
      return (
        <>
          <Line>
            Output returned by{" "}
            <span className="font-data text-[0.8rem]">{event.agentId}</span>,
            shown as data. Nothing inside it is read as an instruction.
          </Line>
          <pre className="mt-2 max-w-full overflow-x-auto border border-rule bg-band/60 px-3 py-2 font-data text-[0.72rem] leading-relaxed break-words whitespace-pre-wrap text-ink/80">
            {JSON.stringify(event.output, null, 2)}
          </pre>
        </>
      );
    case "injectionCaught":
      return (
        <>
          <Line>{event.detail}</Line>
          <ReceiptRef receipt={event.receipt} />
        </>
      );
    case "frozen":
      return (
        <>
          <Line>{event.reason}</Line>
          <Mono>spent so far {formatHbar(event.spentSoFar)}</Mono>
          <ReceiptRef receipt={event.receipt} />
        </>
      );
    case "done":
      return (
        <>
          <Line>
            Hired {event.hired.length}, refused {event.refused.length}. Spent{" "}
            {formatHbar(event.spent)} of {formatHbar(event.budget)}.
          </Line>
          <Mono>
            {event.receiptCount} receipts / refused {event.refused.join(", ")}
          </Mono>
        </>
      );
    default: {
      // The union is closed, so this is unreachable by types. It still renders,
      // because an event the surface does not know about is a fact about the run.
      const unhandled = event as { type?: unknown };
      return (
        <Line>
          <span className="text-grade-f">
            Unhandled event type {String(unhandled.type)}. Shown rather than
            dropped.
          </span>
        </Line>
      );
    }
  }
}

export function TranscriptPanel({ events }: { events: HarnessEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState>
        The run has not started. Each event the client agent emits will appear
        here in order, with the decision or receipt that justifies it.
      </EmptyState>
    );
  }

  const startedAt = events[0].at;

  return (
    <ol className="divide-y divide-rule border border-rule">
      {events.map((event, index) => (
        <li
          key={`${event.type}-${event.at}-${index}`}
          className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[3.5rem_9rem_minmax(0,1fr)] sm:px-5"
        >
          <p className="font-data text-[0.72rem] text-ink/45">
            +{event.at - startedAt}s
          </p>
          <div>
            <Badge label={event.type} tone={tone(event)} />
          </div>
          <div className="min-w-0">
            <Body event={event} />
          </div>
        </li>
      ))}
    </ol>
  );
}
