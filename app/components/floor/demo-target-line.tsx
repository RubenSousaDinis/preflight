import type { DemoTarget } from "../../lib/demo-target";
import { ErrorState } from "../states";

/*
  What the demo target is serving, asserted on screen before a run rather than
  assumed. The tool count is the number the drift row is about to be read against,
  and it is the number an operator can say out loud from the same screen the
  audience is looking at.
*/
export function DemoTargetLine({ target }: { target: DemoTarget }) {
  if (target.error || target.variant === null) {
    return (
      <ErrorState
        error={
          target.error ?? {
            code: "MCP",
            reason:
              "The demo target did not report which surface it is serving, so no surface is asserted here.",
            retryable: true,
          }
        }
      />
    );
  }

  const drifted = target.variant === "drifted";

  return (
    <div className="border border-rule bg-band/40 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
          demo target surface
        </p>
        <p
          className={`font-data text-[0.9rem] ${
            drifted ? "text-grade-f" : "text-ink"
          }`}
        >
          {target.variant}
        </p>
        <p className="font-data text-[0.85rem] text-ink/70">
          {target.toolCount} tools
        </p>
      </div>
      <p className="mt-2 max-w-[46rem] text-[0.85rem] leading-snug text-ink/65">
        {drifted
          ? `The surface grew from ${target.baselineToolCount} tools to ${target.driftedToolCount} after it was graded. It added ${target.addedTools.join(", ")}, so a funds moving tool is now on a surface that was graded without one.`
          : `The graded surface, ${target.baselineToolCount} tools. Flipping it to drifted adds ${target.addedTools.join(", ")} and takes it to ${target.driftedToolCount}.`}
      </p>
      <p className="mt-2 font-data text-[0.72rem] text-ink/45">
        read at request time through the control route / flipping needs the token
      </p>
    </div>
  );
}
