import type { Metadata } from "next";
import { BoardRefresh } from "../components/board/board-refresh";
import { Leaderboard } from "../components/board/leaderboard";
import { SubmitForm } from "../components/board/submit-form";
import { discoverAgentsForGrade } from "../lib/discover-agents";
import { SubmitQr } from "../components/board/submit-qr";
import { ConsoleFooter, ConsoleNav } from "../components/console-nav";
import { Container } from "../components/container";
import { PendingQueue } from "../components/firewall/pending-queue";
import { UnseenSlot } from "../components/firewall/unseen-slot";
import { EnsMirrorLine } from "../components/ens/ens-mirror-line";
import { DemoTargetLine } from "../components/floor/demo-target-line";
import { HiringFloor } from "../components/floor/hiring-floor";
import { MirrorLine } from "../components/receipts/mirror-line";
import { ReceiptChain } from "../components/receipts/receipt-chain";
import { LiveRun } from "../components/transcript/live-run";
import { RugPull } from "../components/watch/rug-pull";
import { readDemoTarget } from "../lib/demo-target";
import { readEnsMirror } from "../lib/ens";
import { loadFirewallQueue } from "../lib/firewall";
import { FLOOR_POLICY, loadFloor } from "../lib/floor";
import { readMirrorStatus } from "../lib/hcs";
import { loadReceipts } from "../lib/receipts";
import { boardSubjects, readBoard } from "../lib/registry";
import { loadTranscript } from "../lib/transcript";
import { isViewId, type ViewId } from "../lib/views";

export const metadata: Metadata = { title: "Console" };

/*
  Never cached. The recheck on every row is an active call against the live target,
  so a prerendered console would show yesterday's answer to the one question this
  product exists to answer freshly (02-DECISIONS section 8).
*/
export const dynamic = "force-dynamic";

function Head({
  title,
  meta,
  lede,
}: {
  title: string;
  meta?: string;
  lede: string;
}) {
  return (
    <>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-5">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.5px] sm:text-[30px]">
          {title}
        </h1>
        {meta ? (
          <p className="font-data text-[12px] text-meta">{meta}</p>
        ) : null}
      </div>
      <p className="mb-6 max-w-[660px] text-muted">{lede}</p>
    </>
  );
}

export default async function ConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ agents?: string; view?: string }>;
}) {
  const { agents, view: rawView } = await searchParams;
  const view: ViewId = isViewId(rawView) ? rawView : "floor";

  // Only the active view reads. The registry read is several RPC calls and the
  // endpoint rate limits a burst, so loading every view on every tab would spend
  // the demo throttling itself.
  const [floor, events, demoTarget] =
    view === "floor"
      ? await Promise.all([loadFloor(), loadTranscript(), readDemoTarget()])
      : [null, null, null];
  const queue = view === "firewall" ? await loadFirewallQueue() : null;
  const board =
    view === "board"
      ? await Promise.all([
          readBoard(boardSubjects(agents)),
          readEnsMirror(boardSubjects(agents)[0] ?? ""),
        ]).then(([entries, mirror]) => ({ entries, mirror }))
      : null;
  // The ENS mirror is read for the first subject the board is about, which is the
  // agent the demo resolves on stage. It never throws and it is never awaited by
  // anything that decides something.
  const receipts =
    view === "receipts"
      ? await Promise.all([
          loadReceipts(),
          readMirrorStatus(),
          readEnsMirror(boardSubjects(agents)[0] ?? ""),
        ])
      : null;
  const gradeCatalog =
    view === "grade" ? await discoverAgentsForGrade() : null;

  return (
    <div className="flex min-h-svh flex-col">
      <ConsoleNav view={view} />

      <div className="flex-1">
        <Container wide className="py-8 pb-16">
          {view === "floor" && floor && events && demoTarget ? (
            <>
              <Head
                title="The hiring floor"
                meta={`POLICY  minGrade ${FLOOR_POLICY.minGrade} / fail closed / fingerprint drift means refuse`}
                lede="Candidate agents, gated on the attested grade and then on a fresh fingerprint recheck. These rows are the fixture set until the demo agents are registered; the run beside them calls the real gate."
              />
              <div className="grid items-start gap-6">
                <div className="min-w-0 space-y-4">
                  <DemoTargetLine target={demoTarget} />
                  <HiringFloor rows={floor} />
                  <p className="max-w-[46rem] text-[14px] leading-snug text-muted">
                    A letter describes what the target did while it was being
                    tested. A target that detects the test context and behaves
                    during it can still act differently afterwards, which is the
                    limit the run beside this demonstrates: the agent that turns
                    hostile is one this gate graded A and hired.
                  </p>
                </div>
                <div className="min-w-0">
                  <div className="rounded-card border border-rule bg-panel">
                    <p className="border-b border-rule px-4 py-2.5 font-data text-[10.5px] tracking-[0.1em] text-meta">
                      RUN TRANSCRIPT / runTask()
                    </p>
                    <div className="px-4 py-4">
                      <LiveRun
                        fixtureEvents={events}
                        defaultCandidates={floor
                          .map((row) => row.agentId)
                          .join(" ")}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {view === "firewall" && queue ? (
            <>
              <Head
                title="Transaction firewall"
                meta={`${queue.length} CHECKED / FOUR CHECKS, NO FIFTH`}
                lede="txGuard() forks the chain at the live block and simulates the exact pending call before the wallet signs. The four calls below are staged fixtures and replay a recorded verdict; the unseen slot underneath them calls the real gate against Base mainnet."
              />
              <PendingQueue items={queue} />
              <div className="mt-6">
                <UnseenSlot />
              </div>
            </>
          ) : null}

          {view === "board" && board ? (
            <>
              <Head
                title="Public attestations"
                meta="ERC-8004 VALIDATION REGISTRY / READ DIRECT, NO INDEXER"
                lede="Every grade this validator has published for the agents this board was asked about. Anyone can re-run the harness against the evidence hash."
              />
              <Leaderboard board={board.entries} />
              <div className="mt-5">
                <EnsMirrorLine mirror={board.mirror} />
              </div>
              <div className="mt-3">
                <BoardRefresh />
              </div>
            </>
          ) : null}

          {view === "grade" ? (
            <div className="max-w-[860px]">
              <Head
                title="Grade an agent"
                lede="Search agents mirrored under the Preflight ENS parent, or paste another name. The harness reads the agent id from the name, resolves the card, runs the target in a sandbox, and returns a verdict."
              />
              <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_15rem] md:items-start">
                <SubmitForm catalog={await discoverAgentsForGrade()} />
                <SubmitQr />
              </div>
              <p className="mt-6 max-w-[46rem] font-data text-[11.5px] leading-[1.8] text-meta">
                Disclosed limit: a target that detects the sandbox and behaves can
                pass. The live recheck at hire time narrows that window; it does
                not close it.
              </p>
            </div>
          ) : null}

          {view === "rugpull" ? (
            <>
              <Head
                title="The rug pull"
                meta="A5 WATCHER / LIVE"
                lede="A graded agent ships an update. The watcher notices the tool surface move, and the client drops it without being told. Flip the demo target to drifted while this is running to see it happen."
              />
              <RugPull defaultAgentId={boardSubjects(agents)[0] ?? ""} />
            </>
          ) : null}

          {view === "receipts" && receipts ? (
            <>
              <Head
                title="Receipts"
                meta={`${receipts[0].receipts.length} IN THE CHAIN / ED25519, HASH CHAINED`}
                lede="The receipts a run produces are shown with that run, on the hiring floor. This chain is the fixture set, kept because the verifier rejects it: a screen that can only ever agree is not worth putting a verifier behind."
              />
              <ReceiptChain log={receipts[0]} />
              <div className="mt-5 space-y-4">
                <MirrorLine status={receipts[1]} />
                <EnsMirrorLine mirror={receipts[2]} />
              </div>
            </>
          ) : null}
        </Container>
      </div>

      <ConsoleFooter />
    </div>
  );
}
