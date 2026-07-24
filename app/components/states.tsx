import type { ReactNode } from "react";
import type { RenderableError } from "../lib/contracts";

/*
  The three states a live demo actually lands on, decided once here so C2, C3 and C4
  do not each invent their own at H+20.

  A blank rectangle on a projector reads as a crash, "loading" alone gives the
  operator nothing to say while it hangs, and an error collapsed into "something
  went wrong" throws away the most specific sentence the product produces.
*/

const FRAME = "border border-dashed border-rule bg-band/50 px-4 py-4";
const LABEL = "font-data text-[0.68rem] uppercase tracking-[0.16em]";

/** No data yet. Says what will appear here, so the empty case still informs. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className={FRAME}>
      <p className={`${LABEL} text-ink/50`}>no data yet</p>
      <p className="mt-2 text-ink/80">{children}</p>
    </div>
  );
}

/**
 * Waiting on something named. `awaiting` is the thing being waited on, in the
 * operator's words: "the fork at head", "tools/list, page 2 of 3".
 */
export function LoadingState({ awaiting }: { awaiting: string }) {
  return (
    <div className={FRAME} role="status" aria-live="polite">
      <p className={`${LABEL} flex items-center gap-2 text-ink/50`}>
        <span aria-hidden="true" className="flex gap-1">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="block h-1.5 w-1.5 animate-pulse bg-accent"
              style={{ animationDelay: `${index * 180}ms` }}
            />
          ))}
        </span>
        awaiting {awaiting}
      </p>
    </div>
  );
}

/**
 * A typed failure. The `reason` renders verbatim: every gate error carries one, and
 * on this product a failure to obtain a verdict is itself the verdict.
 */
export function ErrorState({ error }: { error: RenderableError }) {
  return (
    <div className="border border-rule border-l-2 border-l-grade-f bg-band/50 px-4 py-4">
      <p className={`${LABEL} text-grade-f`}>error / {error.code}</p>
      <p className="mt-2 text-ink">{error.reason}</p>
      <p className="mt-2 font-data text-[0.72rem] text-ink/60">
        {error.retryable
          ? "This one can be retried."
          : "Retrying does not resolve this."}
      </p>
    </div>
  );
}
