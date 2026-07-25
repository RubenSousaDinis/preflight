import type { EnsMirror } from "../../lib/ens";

/*
  One line: the grade is mirrored onto an ENS name, and here is what that name
  currently answers.

  The word mirror is doing the same work it does on the receipts line. The
  registry record is the grade; the name carries a copy of it that a resolver can
  answer for. A reader that preferred the name to the registry would have the
  trust order backwards, so the line says which is which and points at the record
  to check.

  The freshness note is the same bound the rest of this surface uses, applied to
  the mirror's own updatedAt: a regrade moves the registry first and the name
  after it, and a copy that is behind should say so rather than be smoothed over.
*/

const STALE_AFTER_SECONDS = 86_400;

/** Read once per render of this line, server side, the way the board reads its own clock. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function ageLabel(updatedAt: number, now: number): string {
  const age = now - updatedAt;
  if (age < 0) return "updated";
  if (age < 90) return "updated moments ago";
  if (age < 3_600) return `updated ${Math.floor(age / 60)} minutes ago`;
  const hours = Math.floor(age / 3_600);
  return `updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
}

export function EnsMirrorLine({
  mirror,
  at,
}: {
  mirror: EnsMirror;
  /** Injected only by a test that pins the clock. */
  at?: number;
}) {
  if (mirror.off) {
    return (
      <p className="font-data text-[0.74rem] text-ink/50">
        no ENS name configured, so no grade is mirrored onto one
      </p>
    );
  }

  const now = at ?? nowSeconds();
  const stale =
    mirror.updatedAt !== null && now > mirror.updatedAt + STALE_AFTER_SECONDS;

  return (
    <div className="border border-rule bg-band/40 px-4 py-3 sm:px-5">
      <p className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
        mirrored onto an ens name
      </p>
      <p className="mt-1 font-data text-[0.85rem] break-all">
        {mirror.name ?? "no name derived"}
      </p>
      <p className="mt-2 text-[0.85rem] leading-snug text-ink/70">
        {mirror.error
          ? `The name could not be resolved, so what it answers is unknown here rather than assumed: ${mirror.error.reason}`
          : mirror.grade === null
            ? "The name carries no grade record yet. The registry record below is unaffected, and every grade on this surface is read from it."
            : `The name answers grade ${mirror.grade}${
                mirror.score === null ? "" : `, score ${mirror.score}`
              }${
                mirror.updatedAt === null
                  ? ""
                  : `, ${ageLabel(mirror.updatedAt, now)}`
              }.`}
      </p>
      {mirror.registryPointer ? (
        <p className="mt-1 font-data text-[0.72rem] break-all text-ink/55">
          copied from {mirror.registryPointer}
        </p>
      ) : null}
      {stale ? (
        <p className="mt-2 text-[0.82rem] leading-snug text-grade-f">
          This copy is more than a day old, which is past the bound the reader
          applies to the record itself. Read the registry.
        </p>
      ) : null}
      <p className="mt-2 text-[0.82rem] leading-snug text-ink/60">
        A mirror, not a source. The validation record on the registry is the
        grade; these text records are a copy of it published where a resolver can
        answer for them. Trusting the name over the registry would have it
        backwards.
      </p>
    </div>
  );
}
