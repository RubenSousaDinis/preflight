import type { ScanReport } from "@/src/gates/tx/scan/llm-scan";

/*
  What the advisory source scan said, beside a verdict it did not decide.

  The scan reads a contract's published source and proposes candidates in readable
  language. It runs on 0G Compute, off our own machines, which costs nothing in
  trust precisely because it cannot move a verdict: severity and provenance are
  stamped where the flag is built, and the verdict composer rejects a blocking flag
  from this route a second time.

  The rule this panel exists to hold: no state renders as clean. Not scanned, no
  route configured, a model that failed, and a scan that proposed nothing are four
  different sentences here, and none of them is "this contract is fine". Collapsing
  any of them into reassurance would put the one claim the architecture refuses to
  make on the one surface that looks most like it is making it.
*/

function Head({ route }: { route: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-ink/50">
        advisory source scan
      </span>
      {route !== null ? (
        <span className="border border-rule px-1.5 py-0.5 font-data text-[0.62rem] tracking-[0.1em] text-ink/60">
          route {route}
        </span>
      ) : null}
    </div>
  );
}

/** The standing caveat. It renders in every state, including the one with findings. */
function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 font-data text-[0.7rem] leading-relaxed text-ink/55">
      {children}
    </p>
  );
}

export function ScanReportPanel({ report }: { report: ScanReport }) {
  const scanned = report.state === "scanned";

  return (
    <div className="border border-rule border-l-2 border-l-rule bg-band/30 px-4 py-3 sm:px-5">
      <Head route={report.route} />

      {!scanned ? (
        <>
          <p className="mt-2 text-[0.95rem] leading-snug text-ink">
            not scanned: {report.reason}
          </p>
          <Caveat>
            Not scanned is not a pass. Nothing read this source, so nothing here
            says anything about it either way. The verdict above was reached
            without it.
          </Caveat>
        </>
      ) : report.findings.length === 0 ? (
        <>
          <p className="mt-2 text-[0.95rem] leading-snug text-ink">
            The scan ran and proposed nothing.
          </p>
          <Caveat>
            A scan that proposes nothing is not a clean bill of health. It is one
            reader finding nothing it could name, and a source written to talk a
            reader out of reporting is exactly the case it would miss. The four
            checks above are what decided this call.
          </Caveat>
        </>
      ) : (
        <>
          <ul className="mt-2 space-y-2">
            {report.findings.map((finding, index) => (
              <li
                key={index}
                className="text-[0.95rem] leading-snug text-ink/80"
              >
                {finding}
              </li>
            ))}
          </ul>
          <Caveat>
            Proposed, not confirmed. An advisory finding never moves a verdict on
            its own, in either direction: it cannot block a call, and it cannot
            talk a simulator-confirmed flag out of blocking one.
          </Caveat>
        </>
      )}

      {report.discarded.length > 0 ? (
        <p className="mt-2 font-data text-[0.7rem] leading-relaxed text-ink/55">
          {report.discarded.length} proposed finding
          {report.discarded.length === 1 ? "" : "s"} discarded for naming
          something outside the closed set of four: {report.discarded.join(", ")}.
          Discarded where a reader can see it, rather than renamed into the set.
        </p>
      ) : null}
    </div>
  );
}
