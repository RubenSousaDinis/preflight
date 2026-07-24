import { readMethodologyVersion } from "../lib/methodology";
import { Container } from "./container";

function Field({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
        {label}
      </dt>
      <dd className="mt-1 font-data text-[0.9rem] break-words">{value}</dd>
      <dd className="mt-1 text-[0.8rem] leading-snug text-ink/60">{note}</dd>
    </div>
  );
}

/*
  The shell footer, on every route.

  The plate carries the two things that are true of this product before any data
  loads: both gates return a refusal on any error path, and the version of the
  methodology behind every letter on screen. The limits sit directly under it
  because 02-DECISIONS section 10 requires them in the interface, not only in the
  README, and putting them in the shell makes it impossible to ship a route
  without them.
*/
export async function SiteFooter() {
  const methodology = await readMethodologyVersion();

  return (
    <footer className="border-t border-rule bg-panel">
      <Container className="py-8">
        <dl className="grid gap-px border border-rule bg-rule sm:grid-cols-3">
          <Field
            label="default verdict"
            value="REFUSE / BLOCK"
            note="What both gates return on any error path, including when a check cannot run."
          />
          <Field
            label="methodology"
            value={methodology ?? "unresolved"}
            note={
              methodology
                ? "Read from the installed engine package, never typed in."
                : "Reads from the installed engine package once that dependency lands."
            }
          />
          <Field
            label="receipts"
            value="ed25519, hash chained"
            note="Every decision is signed and linked to the one made before it."
          />
        </dl>

        <section className="mt-6 max-w-[54rem]">
          <h2 className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
            disclosed limits
          </h2>
          <div className="mt-2 space-y-2 text-[0.85rem] leading-relaxed text-ink/75">
            <p>
              Evasion. A target that detects the test context and behaves during
              the test can still act differently outside it. A letter grade cannot
              rule that out, and a grade that turns out wrong later is the limit
              showing itself rather than a surprise.
            </p>
            <p>
              A transaction verdict is reproducible for a given block and state. It
              is not a prediction of what the transaction does once it lands.
            </p>
            <p>
              Grades here are self-run and self-minted. Reproducible means a false
              grade can be falsified by re-running the open engine, not that anyone
              has re-run it independently.
            </p>
          </div>
        </section>

        <p className="mt-6 font-data text-[0.7rem] uppercase tracking-[0.14em] text-ink/40">
          Preflight / ETHGlobal Lisbon 2026
        </p>
      </Container>
    </footer>
  );
}
