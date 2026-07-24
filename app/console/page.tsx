import type { Metadata } from "next";
import { Container } from "../components/container";
import { PendingQueue } from "../components/firewall/pending-queue";
import { UnseenSlot } from "../components/firewall/unseen-slot";
import { HiringFloor } from "../components/floor/hiring-floor";
import { Panel } from "../components/panel";
import { ReceiptChain } from "../components/receipts/receipt-chain";
import { PaymentSummary } from "../components/transcript/payment-summary";
import { TranscriptPanel } from "../components/transcript/transcript-panel";
import { loadFirewallQueue } from "../lib/firewall";
import { FLOOR_POLICY, loadFloor } from "../lib/floor";
import { loadReceipts } from "../lib/receipts";
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
  const [rows, events, queue, receipts] = await Promise.all([
    loadFloor(),
    loadTranscript(),
    loadFirewallQueue(),
    loadReceipts(),
  ]);
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
          {/*
            The evasion limit renders here, next to the letters, rather than only
            in the footer. This is where the grade claim is made, so it is where
            the limit of that claim has to be readable.
          */}
          <p className="mt-2 max-w-[46rem] text-[0.82rem] leading-snug text-ink/60">
            A letter describes what the target did while it was being tested. A
            target that detects the test context and behaves during it can still
            act differently afterwards, which is the limit the run below
            demonstrates: the agent that turns hostile is one this gate graded A
            and hired.
          </p>
        </Panel>

        <Panel
          eyebrow="beat 1"
          title="Run transcript"
          status={`${events.length} events`}
        >
          <TranscriptPanel events={events} />
          <p className="mt-3 max-w-[46rem] text-[0.82rem] leading-snug text-ink/60">
            The agent that turns hostile here passed the gate on its letter and on
            its live fingerprint, both. Its hostile turn fires on a condition that
            was not present at grading time, so what stops it is the boundary
            around the run rather than the grade in front of it.
          </p>
        </Panel>

        <Panel eyebrow="beat 1" title="Budget">
          <PaymentSummary events={events} />
        </Panel>

        <Panel
          eyebrow="beat 2"
          title="Firewall"
          status={`${queue.length} checked`}
        >
          <PendingQueue items={queue} />
          <div className="mt-4">
            <UnseenSlot />
          </div>
        </Panel>

        <Panel
          eyebrow="audit trail"
          title="Receipts"
          status={`${receipts.receipts.length} in the chain`}
        >
          <ReceiptChain log={receipts} />
        </Panel>
      </div>
    </Container>
  );
}
