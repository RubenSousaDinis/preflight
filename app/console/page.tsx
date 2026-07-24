import type { Metadata } from "next";
import { ConsoleNav } from "../components/console-nav";
import { Container } from "../components/container";
import { Leaderboard } from "../components/board/leaderboard";
import { SubmitForm } from "../components/board/submit-form";
import { SubmitQr } from "../components/board/submit-qr";
import { PendingQueue } from "../components/firewall/pending-queue";
import { UnseenSlot } from "../components/firewall/unseen-slot";
import { DemoTargetLine } from "../components/floor/demo-target-line";
import { HiringFloor } from "../components/floor/hiring-floor";
import { Panel } from "../components/panel";
import { ReceiptChain } from "../components/receipts/receipt-chain";
import { LiveRun } from "../components/transcript/live-run";
import { loadFirewallQueue } from "../lib/firewall";
import { FLOOR_POLICY, loadFloor } from "../lib/floor";
import { readDemoTarget } from "../lib/demo-target";
import { loadReceipts } from "../lib/receipts";
import { readBoard } from "../lib/registry";
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
  const [rows, events, queue, receipts, board, demoTarget] = await Promise.all([
    loadFloor(),
    loadTranscript(),
    loadFirewallQueue(),
    loadReceipts(),
    readBoard(),
    readDemoTarget(),
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

      <ConsoleNav />

      <div className="mt-6 grid gap-4">
        <Panel
          id="beat-1"
          eyebrow="beat 1"
          title="Hiring floor"
          status={`minimum grade ${FLOOR_POLICY.minGrade}`}
        >
          <div className="mb-4">
            <DemoTargetLine target={demoTarget} />
          </div>
          <HiringFloor rows={rows} />
          <p className="mt-3 max-w-[46rem] text-[0.85rem] leading-snug text-ink/60">
            Each row rechecks the live tool surface at request time and compares it
            to the surface that was graded. Drift outranks the letter.
          </p>
          {/*
            The evasion limit renders here, next to the letters, rather than only
            in the footer. This is where the grade claim is made, so it is where
            the limit of that claim has to be readable.
          */}
          <p className="mt-2 max-w-[46rem] text-[0.85rem] leading-snug text-ink/60">
            A letter describes what the target did while it was being tested. A
            target that detects the test context and behaves during it can still
            act differently afterwards, which is the limit the run below
            demonstrates: the agent that turns hostile is one this gate graded A
            and hired.
          </p>
        </Panel>

        <Panel
          id="beat-1-run"
          eyebrow="beat 1"
          title="Run transcript"
          status="driven live"
        >
          <LiveRun
            fixtureEvents={events}
            defaultCandidates={rows.map((row) => row.agentId).join(" ")}
          />
          <p className="mt-4 max-w-[46rem] text-[0.85rem] leading-snug text-ink/60">
            The agent that turns hostile here passed the gate on its letter and on
            its live fingerprint, both. Its hostile turn fires on a condition that
            was not present at grading time, so what stops it is the boundary
            around the run rather than the grade in front of it.
          </p>
        </Panel>

        <Panel
          id="beat-2"
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
          id="beat-3"
          eyebrow="beat 3"
          title="Graded onchain"
          status={`${board.entries.length} listed`}
        >
          <Leaderboard board={board} />
          <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_15rem] md:items-start">
            <div>
              <h3 className="font-display text-[1.1rem] font-semibold">
                Submit an agent
              </h3>
              <p className="mt-1 max-w-[40rem] text-[0.9rem] leading-snug text-ink/70">
                Any agent in the room can be graded here. The grade that comes
                back is the one the board lists, produced by the same engine, and
                nobody pays for it.
              </p>
              <div className="mt-4">
                <SubmitForm />
              </div>
            </div>
            <SubmitQr />
          </div>
        </Panel>

        <Panel
          id="audit-trail"
          eyebrow="audit trail"
          title="Receipts, the reference chain"
          status={`${receipts.receipts.length} in the chain`}
        >
          <p className="mb-3 max-w-[46rem] text-[0.9rem] leading-snug text-ink/70">
            The receipts a run produces are shown with that run, under beat 1.
            This chain is the fixture set, kept here because the verifier rejects
            it and a screen that can only ever agree is not worth putting a
            verifier behind. Compare the two: same panel, same verifier, opposite
            answers.
          </p>
          <ReceiptChain log={receipts} />
        </Panel>
      </div>
    </Container>
  );
}
