import Link from "next/link";
import { Container } from "./components/container";
import { Panel } from "./components/panel";

export default function ProductPage() {
  return (
    <Container className="py-10 sm:py-14">
      <section className="max-w-[46rem]">
        <p className="font-data text-[0.68rem] uppercase tracking-[0.16em] text-accent">
          agent boundary / transaction boundary
        </p>
        <h1 className="mt-3 font-display text-[2rem] font-semibold leading-[1.08] tracking-[-0.015em] sm:text-[2.6rem]">
          An agent about to act, checked before it acts.
        </h1>
        <p className="mt-5 text-[1.05rem] leading-[1.65] text-ink/80">
          An agent asks to hire another agent, or to sign a transaction. Preflight
          answers first, and refuses when the evidence does not hold. Every answer
          carries a signed receipt and the values that reproduce it.
        </p>
        <p className="mt-6 font-data text-[0.78rem]">
          <Link href="/console" className="text-accent">
            Open the console
          </Link>
        </p>
      </section>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <Panel eyebrow="vetAgent" title="The agent boundary">
          <p className="text-ink/80">
            Reads the attested grade for an agent, connects to the live target, and
            re-enumerates every page of its tool surface. Drift outranks the letter:
            an A graded agent whose live fingerprint has moved since grading is
            refused, because that is the rug pull the grade cannot see.
          </p>
        </Panel>

        <Panel eyebrow="txGuard" title="The transaction boundary">
          <p className="text-ink/80">
            Forks the chain at the live block and simulates the exact calldata, then
            runs four checks: an unlimited or unknown spender approval, a honeypot,
            value routed to an unverified callee, and an owner or upgrade path
            firing. A check that cannot run blocks the action.
          </p>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel eyebrow="audit trail" title="What a decision leaves behind">
          <p className="max-w-[46rem] text-ink/80">
            Each verdict emits an Ed25519 signed receipt, hash chained to the one
            before it. A transaction verdict records the block, sender, callee,
            calldata hash and value it was produced from, so the same five values
            re-run to the same verdict or the claim is falsified.
          </p>
        </Panel>
      </div>
    </Container>
  );
}
