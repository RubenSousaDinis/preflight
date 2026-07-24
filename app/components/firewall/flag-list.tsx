import type { Flag, FlagId, Verdict } from "@/src/shared";
import { CONFIRMED_BY_LABEL, FLAG_NAMES, FLAG_ORDER } from "../../lib/flags";

/*
  Flags, with where each one came from on its face.

  Only a simulator-confirmed finding moves a verdict. If a source-scan finding and a
  simulated one render identically, the fail-closed property of the architecture is
  invisible, and invisible is indistinguishable from absent to anyone in the room.
*/

function FlagCard({ flag }: { flag: Flag }) {
  const blocking = flag.severity === "block";
  return (
    <article
      className={`border border-l-2 border-rule px-4 py-3 sm:px-5 ${
        blocking ? "border-l-grade-f" : "border-l-rule"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={`font-data text-[0.66rem] uppercase tracking-[0.16em] ${
            blocking ? "text-grade-f" : "text-ink/50"
          }`}
        >
          {FLAG_NAMES[flag.id]}
        </span>
        <span
          className={`border px-1.5 py-0.5 font-data text-[0.62rem] tracking-[0.1em] ${
            blocking ? "border-grade-f text-grade-f" : "border-rule text-ink/60"
          }`}
        >
          {blocking ? "blocks" : "advisory"}
        </span>
        <span className="font-data text-[0.66rem] text-ink/50">
          {CONFIRMED_BY_LABEL[flag.confirmedBy]}
        </span>
      </div>
      <p className="mt-2 text-[1.05rem] leading-snug text-ink">{flag.title}</p>
      <p className="mt-1 text-[0.94rem] leading-snug text-ink/70">
        {flag.detail}
      </p>
      {!blocking ? (
        <p className="mt-2 font-data text-[0.7rem] text-ink/55">
          Advisory only. It did not move this verdict and cannot move one on its
          own.
        </p>
      ) : null}
    </article>
  );
}

/**
 * The closed set of four, with the ones this run reported marked.
 *
 * A blocking finding and an advisory one are marked differently here for the same
 * reason they are rendered differently below: an advisory name in the blocking
 * colour would read as a block on a card that says ALLOW.
 *
 * A name left unmarked is not a claim that the check passed either. For a
 * structural block nothing ran at all, so the caption says so rather than letting a
 * dim row read as a clean bill of health.
 */
function FlagLegend({ flags }: { flags: Flag[] }) {
  const severityById = new Map<FlagId, Flag["severity"]>();
  for (const flag of flags) {
    if (flag.severity === "block" || !severityById.has(flag.id)) {
      severityById.set(flag.id, flag.severity);
    }
  }

  return (
    <div className="border border-rule bg-band/40 px-4 py-3 sm:px-5">
      <p className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
        the four checks
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {FLAG_ORDER.map((id) => {
          const severity = severityById.get(id);
          const blocking = severity === "block";
          const advisory = severity === "advisory";
          return (
            <li
              key={id}
              className={`flex items-center gap-2 font-data text-[0.74rem] ${
                blocking
                  ? "text-grade-f"
                  : advisory
                    ? "text-ink/75"
                    : "text-ink/45"
              }`}
            >
              <span
                aria-hidden="true"
                className={`block h-2 w-2 border ${
                  blocking
                    ? "border-grade-f bg-grade-f"
                    : advisory
                      ? "border-ink/60"
                      : "border-rule"
                }`}
              />
              {FLAG_NAMES[id]}
              {advisory ? (
                <span className="text-ink/50">(advisory)</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[0.78rem] leading-snug text-ink/55">
        This set is closed. A name left unmarked was not reported by this run,
        which is not the same as a check that passed.
      </p>
    </div>
  );
}

export function FlagList({
  flags,
  verdict,
}: {
  flags: Flag[];
  verdict: Verdict;
}) {
  return (
    <div className="space-y-3">
      <FlagLegend flags={flags} />

      {flags.length === 0 ? (
        <p
          className={`border border-l-2 px-4 py-3 text-[0.9rem] leading-snug sm:px-5 ${
            verdict === "BLOCK"
              ? "border-rule border-l-grade-f text-ink"
              : "border-rule border-l-accent text-ink/75"
          }`}
        >
          {verdict === "BLOCK"
            ? "No flags, and it still blocks. The failure is structural: the call was never checked, and a check that cannot run blocks rather than passing."
            : "No simulator-confirmed finding on this call at this block."}
        </p>
      ) : (
        flags.map((flag) => <FlagCard key={`${flag.id}-${flag.title}`} flag={flag} />)
      )}
    </div>
  );
}
