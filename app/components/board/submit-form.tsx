"use client";

import { startTransition, useActionState, useMemo, useRef, useState } from "react";
import { filterAgentCatalog } from "../../lib/discover-agents";
import type { KnownAgentCatalogEntry } from "../../lib/known-agents";
import {
  claimAgent,
  submitAgent,
  type ClaimResult,
  type SubmitResult,
} from "../../lib/submit";
import { gradeColor } from "../../lib/tokens";
import { ErrorState, PulseDots } from "../states";

/*
  Beat 3's form: searchable catalog of registered agents, grade by registry id,
  optional ENS sub-line when a name is already mirrored. Claim is a separate CTA.
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
  const [claimResult, claimAction, claimPending] = useActionState<
    ClaimResult | null,
    FormData
  >(claimAgent, null);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(
    () => filterAgentCatalog(catalog, query),
    [catalog, query],
  );
  const mirroredCount = catalog.filter((agent) => agent.ensName !== null).length;

  function gradeKnown(agentId: string) {
    if (inputRef.current) inputRef.current.value = agentId;
    setQuery(agentId);
    const data = new FormData();
    data.set("ref", agentId);
    startTransition(() => {
      formAction(data);
    });
  }

  function claimKnown(agentId: string) {
    const data = new FormData();
    data.set("agentId", agentId);
    startTransition(() => {
      claimAction(data);
    });
  }

  return (
    <div id="submit">
      <div className="mb-5">
        <label className="block">
          <span className="block font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
            search known agents
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="registry id, label, or ENS name"
            className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-data text-[0.85rem] text-ink outline-none focus:border-accent"
          />
        </label>

        {catalog.length === 0 ? (
          <p className="mt-2 font-data text-[0.8rem] text-ink/55">
            No known agents are configured for this booth.
          </p>
        ) : visible.length === 0 ? (
          <p className="mt-2 font-data text-[0.8rem] text-ink/55">
            No agents match {JSON.stringify(query.trim())}.
          </p>
        ) : (
          <ul className="mt-2 max-h-[22rem] divide-y divide-rule overflow-y-auto border border-rule">
            {visible.map((agent) => (
              <li key={agent.id} className="flex items-stretch">
                <button
                  type="button"
                  disabled={isPending || claimPending}
                  onClick={() => gradeKnown(agent.id)}
                  className="flex min-w-0 flex-1 items-baseline gap-3 px-3 py-2.5 text-left transition-colors hover:bg-band/60 disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-data text-[0.85rem] text-ink">
                      {agent.id}
                      <span className="text-ink/45"> · {agent.label}</span>
                    </span>
                    {agent.ensName !== null ? (
                      <span className="mt-0.5 block font-data text-[0.72rem] break-all text-ink/55">
                        {agent.ensName}
                      </span>
                    ) : null}
                    <span className="mt-0.5 block font-data text-[0.68rem] text-ink/45">
                      {agent.note}
                    </span>
                  </span>
                  <span className="shrink-0 font-data text-[0.72rem] tracking-[0.08em] text-accent">
                    grade
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isPending || claimPending}
                  onClick={() => claimKnown(agent.id)}
                  className="shrink-0 border-l border-rule px-3 font-data text-[0.68rem] tracking-[0.08em] text-ink/55 transition-colors hover:bg-band/60 hover:text-accent disabled:opacity-50"
                  title="Claim the Preflight ENS subname for this agent's owner"
                >
                  claim
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 font-data text-[0.68rem] text-ink/45">
          {visible.length} of {catalog.length} agents
          {mirroredCount > 0 ? ` · ${mirroredCount} with ENS` : ""}
        </p>
      </div>

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1">
          <span className="block font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
            or another registry id
          </span>
          <input
            ref={inputRef}
            name="ref"
            autoComplete="off"
            spellCheck={false}
            placeholder="8441"
            className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-data text-[0.85rem] text-ink outline-none focus:border-accent"
          />
        </label>
        <button
          type="submit"
          disabled={isPending || claimPending}
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
              resolving the agent, then exercising the target
            </p>
            <p className="mt-2 text-[0.85rem] leading-snug text-ink/60">
              The registry card is fetched, then the target&apos;s own code runs.
              A grade that arrives instantly would not have run anything.
            </p>
          </div>
        ) : null}

        {claimPending ? (
          <div
            className="border border-rule bg-band/50 px-4 py-3"
            role="status"
            aria-live="polite"
          >
            <p className="flex items-center gap-2 font-data text-[0.8rem] text-ink/70">
              <PulseDots />
              claiming the ENS subname for the agent owner
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
              agent {result.agentId}
              {result.ref !== result.agentId ? ` · via ${result.ref}` : ""}
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
            <button
              type="button"
              disabled={claimPending}
              onClick={() => claimKnown(result.agentId)}
              className="mt-3 border border-rule px-3 py-1.5 font-data text-[0.72rem] tracking-[0.08em] text-ink/70 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              claim ENS for owner
            </button>
          </div>
        ) : null}

        {!claimPending && claimResult?.kind === "invalid" ? (
          <p className="mt-3 font-data text-[0.8rem] text-grade-f">
            {claimResult.message}
          </p>
        ) : null}

        {!claimPending && claimResult?.kind === "error" ? (
          <div className="mt-3 space-y-2">
            <p className="font-data text-[0.74rem] text-ink/55">
              claim agent {claimResult.agentId}
            </p>
            <ErrorState error={claimResult.error} />
          </div>
        ) : null}

        {!claimPending && claimResult?.kind === "claimed" ? (
          <div className="mt-3 border border-rule bg-band/50 px-4 py-3">
            <p className="font-data text-[0.74rem] break-all text-ink/55">
              {claimResult.name}
            </p>
            <p className="mt-1 text-[0.95rem] text-ink/80">
              Owned by {claimResult.owner}
              {claimResult.txHash === null
                ? " · already claimed"
                : ` · tx ${claimResult.txHash}`}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
