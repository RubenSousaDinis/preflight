"use client";

import { startTransition, useActionState, useRef } from "react";
import type { KnownAgentCatalogEntry } from "../../lib/known-agents";
import { submitAgent, type SubmitResult } from "../../lib/submit";
import { gradeColor } from "../../lib/tokens";
import { ErrorState, PulseDots } from "../states";

/*
  Beat 3's form: known agents by ENS name, then a free-text name field.

  The grading wait is the demo rather than something to hide, so the grading state
  says what is happening instead of spinning. The server converts the name to an
  ERC-8004 id via the mirror's preflight.agentId record before grading.
*/
export function SubmitForm({
  catalog,
}: {
  catalog: readonly KnownAgentCatalogEntry[];
}) {
  const [result, formAction, isPending] = useActionState<
    SubmitResult | null,
    FormData
  >(submitAgent, null);
  const inputRef = useRef<HTMLInputElement>(null);
  const placeholder =
    catalog.find((agent) => agent.ensName)?.ensName ??
    "agent8441.preflight.basetest.eth";

  function gradeKnown(ensName: string) {
    if (inputRef.current) inputRef.current.value = ensName;
    const data = new FormData();
    data.set("ref", ensName);
    startTransition(() => {
      formAction(data);
    });
  }

  return (
    <div id="submit">
      <div className="mb-5">
        <p className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
          known agents
        </p>
        {catalog.length === 0 || catalog.every((agent) => agent.ensName === null) ? (
          <p className="mt-2 font-data text-[0.8rem] text-ink/55">
            The ENS mirror is not configured, so there are no names to grade by.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-rule border border-rule">
            {catalog.map((agent) =>
              agent.ensName === null ? null : (
                <li key={agent.ensName}>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => gradeKnown(agent.ensName!)}
                    className="flex w-full items-baseline gap-3 px-3 py-2.5 text-left transition-colors hover:bg-band/60 disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-data text-[0.85rem] break-all text-ink">
                        {agent.ensName}
                      </span>
                      <span className="mt-0.5 block text-[0.95rem] leading-snug text-ink/80">
                        {agent.label}
                      </span>
                      <span className="mt-0.5 block font-data text-[0.68rem] text-ink/45">
                        {agent.note}
                      </span>
                    </span>
                    <span className="shrink-0 font-data text-[0.72rem] tracking-[0.08em] text-accent">
                      grade
                    </span>
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1">
          <span className="block font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
            or another ENS name
          </span>
          <input
            ref={inputRef}
            name="ref"
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-data text-[0.85rem] text-ink outline-none focus:border-accent"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="border border-accent px-4 py-2 font-data text-[0.78rem] tracking-[0.1em] text-accent disabled:opacity-50"
        >
          {isPending ? "grading" : "grade it"}
        </button>
      </form>

      <div className="mt-4">
        {isPending ? (
          <div
            className="border border-rule bg-band/50 px-4 py-3"
            role="status"
            aria-live="polite"
          >
            <p className="flex items-center gap-2 font-data text-[0.8rem] text-ink/70">
              <PulseDots />
              resolving the name, then exercising the target
            </p>
            <p className="mt-2 text-[0.85rem] leading-snug text-ink/60">
              The name is converted to a registry id through the ENS mirror, then
              the target&apos;s own code runs. A grade that arrives instantly would
              not have run anything.
            </p>
          </div>
        ) : null}

        {!isPending && result?.kind === "invalid" ? (
          <p className="font-data text-[0.8rem] text-grade-f">{result.message}</p>
        ) : null}

        {!isPending && result?.kind === "error" ? (
          <div className="space-y-2">
            <p className="font-data text-[0.74rem] break-all text-ink/55">
              {result.ref}
            </p>
            <ErrorState error={result.error} />
          </div>
        ) : null}

        {!isPending && result?.kind === "graded" ? (
          <div className="border border-rule bg-band/50 px-4 py-3">
            <p className="font-data text-[0.74rem] break-all text-ink/55">
              {result.ref}
            </p>
            <p className="mt-1 flex items-baseline gap-3">
              <span
                className="font-display text-[2rem] leading-none font-semibold"
                style={{ color: gradeColor(result.grade) }}
              >
                {result.grade}
              </span>
              <span className="font-data text-[0.8rem] text-ink/60">
                {result.score}
              </span>
              <span className="text-[0.95rem] text-ink/75">
                {result.finding ?? "No finding recorded for this run."}
              </span>
            </p>
            <p className="mt-2 font-data text-[0.72rem] text-ink/50">
              {result.methodologyVersion} / {result.endpointsGraded} endpoint
              {result.endpointsGraded === 1 ? "" : "s"} graded
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
