import Link from "next/link";
import { readMethodologyVersion } from "../lib/methodology";
import { Container } from "./container";
import { Mark } from "./mark";

const REPO = "https://github.com/RubenSousaDinis/preflight";

/*
  The footer, as the design sets it: a dark call band, then three columns, then a
  bottom rule.

  The disclosed limits live here rather than only in the README, per 02-DECISIONS
  section 10, and they keep the design's own treatment: mono, quiet, behind a
  left hairline. Putting them in the shell makes it impossible to ship a route
  without them.
*/
export async function SiteFooter() {
  const methodology = await readMethodologyVersion();

  return (
    <footer>
      <div className="border-b border-rule bg-ink text-paper">
        <Container className="flex flex-wrap items-center justify-between gap-8 py-[72px]">
          <div>
            <h2 className="font-display text-[30px] leading-tight font-semibold tracking-[-0.6px] sm:text-[36px]">
              Put a gate in front of the wallet.
            </h2>
            <p className="mt-2 max-w-[560px] text-on-dark">
              One call before your agent hires or signs. Fail closed, receipt
              attached, verdict reproducible.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3.5">
            <Link
              href="/console"
              className="rounded-control bg-paper px-[22px] py-3 font-medium text-ink no-underline"
            >
              Open the console
            </Link>
            <a
              href={REPO}
              className="rounded-control border border-muted px-[22px] py-3 text-paper no-underline hover:border-paper"
            >
              The repository
            </a>
          </div>
        </Container>
      </div>

      <Container className="grid gap-10 pt-[52px] pb-10 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <div className="mb-3.5 flex items-center gap-2.5">
            <Mark width={30} />
            <span className="font-display text-[18px] font-semibold">
              preflight
            </span>
          </div>
          <p className="mb-3.5 max-w-[300px] text-[13.5px] text-muted">
            The pre-flight check for autonomous agents. Run or simulate, grade A
            to F, attest on Base, gate the action.
          </p>
          <p className="font-data text-[12px] text-meta">
            Nobody can pay for a grade.
          </p>
        </div>

        <div>
          <p className="mb-3 font-data text-[11px] tracking-[0.12em] text-meta">
            PRODUCT
          </p>
          <ul className="flex flex-col gap-2.5 text-[14px]">
            <li>
              <Link href="/console">Console</Link>
            </li>
            <li>
              <Link href="/deck">Pitch deck</Link>
            </li>
            <li>
              <Link href="/#method">How it works</Link>
            </li>
            <li>
              <Link href="/#receipts">Receipts</Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="mb-3 font-data text-[11px] tracking-[0.12em] text-meta">
            THE RUN
          </p>
          <dl className="flex flex-col gap-2.5 font-data text-[13px]">
            <div>
              <dt className="text-meta">on any error path</dt>
              <dd>REFUSE / BLOCK</dd>
            </div>
            <div>
              <dt className="text-meta">methodology</dt>
              <dd>{methodology ?? "unresolved"}</dd>
            </div>
            <div>
              <dt className="text-meta">receipts</dt>
              <dd>ed25519, hash chained</dd>
            </div>
          </dl>
        </div>
      </Container>

      <Container className="pb-10">
        <div className="max-w-[820px] border-l-2 border-rule pl-4 font-data text-[12.5px] leading-[1.7] text-meta">
          <p>
            Disclosed limits: a target that detects the test context and behaves
            during the test can pass, and the live recheck narrows that window
            rather than closing it. A per-transaction verdict is reproducible for
            a given block and state, not a prediction of the landed outcome. An
            advisory source scan proposes candidates; only simulator-confirmed
            findings move a verdict. Grades here are self-run and self-minted, so
            reproducible means a false grade can be falsified by re-running the
            open engine, not that anyone has re-run it.
          </p>
        </div>
      </Container>

      <div className="border-t border-rule">
        <Container className="flex flex-wrap justify-between gap-4 py-4 font-data text-[12.5px] text-meta">
          <span>preflight</span>
          <span>
            ETHGlobal Lisbon 2026 / all project code starts at the event clock
          </span>
        </Container>
      </div>
    </footer>
  );
}
