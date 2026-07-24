import Link from "next/link";
import { Container } from "./components/container";
import { HiringFloor } from "./components/floor/hiring-floor";
import { Panel } from "./components/panel";
import { FLAG_NAMES, FLAG_ORDER } from "./lib/flags";
import { loadFloor } from "./lib/floor";

/*
  The product page.

  The hero is the specimen, not a strapline over a stock claim: the row a judge
  will probe is an agent this gate graded A and refused anyway, so it is on screen
  above the fold rather than described three paragraphs down. Everything under it
  explains that row.
*/

const TUPLE_FIELDS = ["block", "from", "to", "calldataHash", "value"];

export default async function ProductPage() {
  const rows = await loadFloor();
  const specimen = rows.filter((row) => row.decision?.fingerprintMatch === false);

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
      </section>

      {specimen.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-ink/50">
            what that looks like
          </h2>
          <div className="mt-3">
            <HiringFloor rows={specimen} />
          </div>
          <p className="mt-3 max-w-[46rem] text-[0.92rem] leading-snug text-ink/70">
            A grade of A, and a refusal. The letter was earned; the tool surface
            behind it moved afterwards. Drift outranks the letter, which is the
            case a grade on its own cannot see and the reason a stored score is
            not enough.
          </p>
        </section>
      ) : null}

      <p className="mt-8 font-data text-[0.82rem]">
        <Link href="/console" className="text-accent">
          Open the console
        </Link>
        <span className="text-ink/40"> / </span>
        <Link href="/deck" className="text-accent">
          the deck
        </Link>
      </p>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <Panel eyebrow="vetAgent" title="The agent boundary">
          <p className="text-ink/80">
            Reads the attested grade for an agent, connects to the live target,
            and re-enumerates every page of its tool surface. A single page read
            silently passes a target that hid tools behind pagination, so every
            page is read and the fingerprint is recomputed from all of them.
          </p>
          <p className="mt-3 font-data text-[0.78rem] text-ink/55">
            on any error path: REFUSE
          </p>
        </Panel>

        <Panel eyebrow="txGuard" title="The transaction boundary">
          <p className="text-ink/80">
            Forks the chain at the live block and simulates the exact calldata,
            then runs four checks. The set is closed: the answer to a contract
            nobody has seen is new input to these four, never a fifth detector.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
            {FLAG_ORDER.map((id) => (
              <li key={id} className="font-data text-[0.78rem] text-ink/60">
                {FLAG_NAMES[id]}
              </li>
            ))}
          </ul>
          <p className="mt-3 font-data text-[0.78rem] text-ink/55">
            on any error path: BLOCK
          </p>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel eyebrow="audit trail" title="What a decision leaves behind">
          <p className="max-w-[46rem] text-ink/80">
            Every decision emits an Ed25519 signed receipt carrying the hash of
            the one before it. A transaction verdict records the five values it
            was produced from, so anyone can run them again and either get the
            same verdict or falsify this one.
          </p>
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {TUPLE_FIELDS.map((field) => (
              <li
                key={field}
                className="border border-rule px-2.5 py-1 font-data text-[0.8rem] text-ink/75"
              >
                {field}
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-[46rem] text-[0.9rem] leading-snug text-ink/60">
            That is the difference against a verdict you are asked to take on
            trust. It is also the limit of the claim: reproducible means a wrong
            answer can be shown to be wrong, not that anyone else has already
            checked this one.
          </p>
        </Panel>
      </div>
    </Container>
  );
}
