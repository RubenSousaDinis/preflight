import type { Metadata } from "next";
import { Container } from "../components/container";
import { Panel } from "../components/panel";
import { EmptyState } from "../components/states";

export const metadata: Metadata = {
  title: "Console",
};

export default function ConsolePage() {
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
        {/* TODO-INTEGRATE: C2 mounts the hiring floor here, against Lane 1's vetAgent (01-INTERFACES section 4). */}
        <Panel eyebrow="beat 1" title="Hiring floor" status="not wired">
          <EmptyState>
            Candidate agents, their attested grade, their live fingerprint check,
            and the hire or refuse verdict for each.
          </EmptyState>
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
