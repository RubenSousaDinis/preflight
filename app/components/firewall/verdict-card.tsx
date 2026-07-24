import type { VerdictView } from "../../lib/verdict-view";
import { FlagList } from "./flag-list";
import { ReproducibilityFooter } from "./reproducibility-footer";

/*
  One TxVerdict, in the reading order the beat needs: verdict, reason, drift, flags,
  balance movements, then the five values it is reproducible from.

  BLOCK and ALLOW carry the same visual weight. An ALLOW rendered as an afterthought
  undersells the clean run, and the clean run is half of what makes the blocked run
  mean anything.
*/

function VerdictBadge({ verdict }: { verdict: VerdictView["verdict"] }) {
  const blocked = verdict === "BLOCK";
  return (
    <span
      className={`inline-block border-2 px-3 py-1.5 font-data text-[1.1rem] tracking-[0.12em] ${
        blocked ? "border-grade-f text-grade-f" : "border-accent text-accent"
      }`}
    >
      {verdict}
    </span>
  );
}

/**
 * Drift is checked before simulation and blocks regardless of what the simulation
 * found, so it renders above the flags. A null reads as "no prior grade" and never
 * as "no drift": the absence of a baseline is not evidence that the code held
 * still.
 */
function DriftLine({ drift }: { drift: boolean | null }) {
  if (drift === true) {
    return (
      <p className="border border-rule border-l-2 border-l-grade-f px-4 py-3 text-[0.92rem] leading-snug text-ink sm:px-5">
        <span className="font-data text-[0.68rem] uppercase tracking-[0.16em] text-grade-f">
          code moved since grading
        </span>
        <br />
        Checked before the simulation ran. Code that moved since it was graded
        blocks whatever the simulation goes on to find.
      </p>
    );
  }
  if (drift === false) {
    return (
      <p className="font-data text-[0.76rem] text-ink/60">
        code matches the version that was graded
      </p>
    );
  }
  return (
    <p className="font-data text-[0.76rem] text-ink/60">
      no prior grade for this code, so there is no baseline to compare against
    </p>
  );
}

function Deltas({ deltas }: { deltas: VerdictView["deltas"] }) {
  if (deltas.length === 0) {
    return (
      <p className="font-data text-[0.8rem] text-ink/65">
        no balance moved
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {deltas.map((delta, index) => {
        const negative = delta.delta.startsWith("-");
        return (
          <li
            key={`${delta.token}-${delta.owner}-${index}`}
            className="font-data text-[0.8rem] break-all"
          >
            <span className={negative ? "text-grade-f" : "text-accent"}>
              {negative ? delta.delta : `+${delta.delta}`}
            </span>{" "}
            <span className="text-ink/70">{delta.token}</span>{" "}
            <span className="text-ink/50">to {delta.owner}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="mb-2 font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
        {label}
      </h4>
      {children}
    </section>
  );
}

export function VerdictCard({ verdict }: { verdict: VerdictView }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <VerdictBadge verdict={verdict.verdict} />
        <div className="min-w-0 flex-1">
          <p className="text-[1.15rem] leading-snug text-ink">{verdict.reason}</p>
          {/*
            The disclosed state-level limit sits next to the verdict, which is
            exactly where the overclaim would otherwise be read.
          */}
          <p className="mt-2 text-[0.8rem] leading-snug text-ink/60">
            Reproducible for block {verdict.reproducibleFrom.block} and the state
            at that block. It is not a prediction of what the transaction does
            once it lands.
          </p>
        </div>
      </div>

      <DriftLine drift={verdict.driftFromGraded} />

      <Section label="flags">
        <FlagList flags={verdict.flags} verdict={verdict.verdict} />
      </Section>

      <Section label="balance movements">
        <Deltas deltas={verdict.deltas} />
      </Section>

      <ReproducibilityFooter
        tuple={verdict.reproducibleFrom}
        codeFingerprint={verdict.codeFingerprint}
      />
    </div>
  );
}
