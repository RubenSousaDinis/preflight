import type { Metadata } from "next";
import { Container } from "../components/container";
import { HiringFloor } from "../components/floor/hiring-floor";
import { Panel } from "../components/panel";
import { EmptyState } from "../components/states";
import { PaymentSummary } from "../components/transcript/payment-summary";
import { TranscriptPanel } from "../components/transcript/transcript-panel";
import { FLOOR_POLICY, loadFloor } from "../lib/floor";
import { loadTranscript } from "../lib/transcript";

export const metadata: Metadata = {
  title: "Console",
};

/*
  Never cached. The recheck on every row is an active call against the live target,
  so a prerendered console would be showing yesterday's answer to the one question
  this product exists to answer freshly (02-DECISIONS section 8).
*/
export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const [rows, events] = await Promise.all([loadFloor(), loadTranscript()]);
  return (
    <Container className="py-10 sm:py-12">
      <header className="max-w-[46rem]">
        <p className="font-data text-[0.68rem] uppercase tracking-[0.16em] text-accent">
          demo surface
        </p>
        <h1 className="mt-3 font-display text-[1.9rem] font-semibold leading-tight tracking-[-0.015em] sm:text-[2.2rem]">
          Console
        </h1>
        <p className="mt-4 text-ink/80">
          Each panel below runs the gate live and shows the verdict it produced,
          along with the evidence the verdict was read from.
        </p>
      </header>

      <div className="mt-8 grid gap-4">
        <Panel
          eyebrow="beat 1"
          title="Hiring floor"
          status={`minimum grade ${FLOOR_POLICY.minGrade}`}
        >
          <HiringFloor rows={rows} />
          <p className="mt-3 font-data text-[0.72rem] text-ink/55">
            Each row rechecks the live tool surface at request time and compares it
            to the surface that was graded. Drift outranks the letter.
          </p>
        </Panel>

        <Panel
          eyebrow="beat 1"
          title="Run transcript"
          status={`${events.length} events`}
        >
          <TranscriptPanel events={events} />
        </Panel>

        <Panel eyebrow="beat 1" title="Budget">
          <PaymentSummary events={events} />
        </Panel>

        {/* TODO-INTEGRATE: C3 mounts the firewall panel here, against Lane 2's txGuard (01-INTERFACES section 9). */}
        <Panel eyebrow="beat 2" title="Firewall" status="not wired">
          <EmptyState>
            A pending transaction, the flags the simulation raised against it, and
            the block and state the verdict is reproducible from.
          </EmptyState>
        </Panel>

        {/* TODO-INTEGRATE: receipt rendering, against Lane 1's B2 chain (01-INTERFACES section 5). */}
        <Panel eyebrow="audit trail" title="Receipts" status="not wired">
          <EmptyState>
            The signed, hash chained record of every decision on this page, in the
            order it was made.
          </EmptyState>
        </Panel>
      </div>
    </Container>
  );
}
