"use client";

import { startTransition, useActionState, useMemo, useRef, useState } from "react";
import { baseSepoliaTxUrl, ensAppUrl } from "../../lib/ens-app-url";
import { filterAgentCatalog } from "../../lib/filter-agent-catalog";
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
  Grade catalog: Sepolia demos + Base 8004scan leaders. Claim for mainnet rows
  registers a Sepolia mirror then creates ENS for the mainnet owner.
*/
export function SubmitForm({
  catalog,
  allowMainnetClaim = false,
}: {
  catalog: readonly KnownAgentCatalogEntry[];
  /** Mainnet claims register a Sepolia mirror with the validator key; operator deployments only. */
  allowMainnetClaim?: boolean;
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
  const [chainId, setChainId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(
    () => filterAgentCatalog(catalog, query),
    [catalog, query],
  );
  const mirroredCount = catalog.filter((agent) => agent.ensName !== null).length;

  function gradeKnown(agent: KnownAgentCatalogEntry) {
    if (inputRef.current) inputRef.current.value = agent.id;
    setQuery(agent.id);
    setChainId(agent.identityChainId);
    const data = new FormData();
    data.set("ref", agent.id);
    data.set("chainId", String(agent.identityChainId));
    startTransition(() => {
      formAction(data);
    });
  }

  function claimKnown(agent: KnownAgentCatalogEntry) {
    const data = new FormData();
    data.set("agentId", agent.id);
    data.set("chainId", String(agent.identityChainId));
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
              <li
                key={`${agent.identityChainId}:${agent.id}`}
                className="flex items-stretch"
              >
                <div className="min-w-0 flex-1 px-3 py-2.5">
                  <p className="font-data text-[0.85rem] text-ink">
                    {agent.id}
                    <span className="text-ink/45"> · {agent.label}</span>
                  </p>
                  <p className="mt-0.5 font-data text-[0.68rem] text-ink/45">
                    {agent.identityChainId === 8453
                      ? "Base mainnet · 8004scan"
                      : "Base Sepolia · demo"}
                    {agent.sepoliaId !== null
                      ? ` · Sepolia mirror ${agent.sepoliaId}`
                      : ""}
                  </p>
                  {agent.ensName !== null ? (
                    <a
                      href={ensAppUrl(agent.ensName)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 block font-data text-[0.72rem] break-all text-accent underline-offset-2 hover:underline"
                    >
                      {agent.ensName}
                    </a>
                  ) : null}
                  <p className="mt-0.5 font-data text-[0.68rem] text-ink/45">
                    {agent.note}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isPending || claimPending}
                  onClick={() => gradeKnown(agent)}
                  className="shrink-0 border-l border-rule px-3 font-data text-[0.72rem] tracking-[0.08em] text-accent transition-colors hover:bg-band/60 disabled:opacity-50"
                >
                  grade
                </button>
                {agent.identityChainId !== 8453 || allowMainnetClaim ? (
                  <button
                    type="button"
                    disabled={isPending || claimPending}
                    onClick={() => claimKnown(agent)}
                    className="shrink-0 border-l border-rule px-3 font-data text-[0.68rem] tracking-[0.08em] text-ink/55 transition-colors hover:bg-band/60 hover:text-accent disabled:opacity-50"
                    title="Claim the Preflight ENS subname for this agent's owner"
                  >
                    claim
                  </button>
                ) : null}
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
        <input
          type="hidden"
          name="chainId"
          value={chainId ?? ""}
          readOnly
        />
        <label className="min-w-0 flex-1">
          <span className="block font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
            or another registry id
          </span>
          <input
            ref={inputRef}
            name="ref"
            autoComplete="off"
            spellCheck={false}
            placeholder="22332"
            onChange={() => setChainId(null)}
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
              claiming ENS (and registering a Sepolia mirror when needed)
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
              {result.identityChainId === 8453 ? " · Base mainnet" : " · Base Sepolia"}
              {result.sepoliaId !== null
                ? ` · Sepolia mirror ${result.sepoliaId}`
                : ""}
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
            {result.identityChainId !== 8453 || allowMainnetClaim ? (
              <button
                type="button"
                disabled={claimPending}
                onClick={() => {
                  const data = new FormData();
                  data.set("agentId", result.agentId);
                  data.set("chainId", String(result.identityChainId));
                  startTransition(() => {
                    claimAction(data);
                  });
                }}
                className="mt-3 border border-rule px-3 py-1.5 font-data text-[0.72rem] tracking-[0.08em] text-ink/70 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                claim ENS for owner
              </button>
            ) : null}
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
              <a
                href={ensAppUrl(claimResult.name)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-2 hover:underline"
              >
                {claimResult.name}
              </a>
            </p>
            <p className="mt-1 text-[0.95rem] text-ink/80">
              Owned by {claimResult.owner}
              {claimResult.mainnetId !== null
                ? ` · mainnet ${claimResult.mainnetId} → Sepolia ${claimResult.sepoliaId}`
                : ""}
              {claimResult.txHash === null ? (
                " · already claimed"
              ) : (
                <>
                  {" · "}
                  <a
                    href={baseSepoliaTxUrl(claimResult.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-accent underline-offset-2 hover:underline"
                  >
                    tx {claimResult.txHash}
                  </a>
                </>
              )}
            </p>
            <p className="mt-2 font-data text-[0.72rem] leading-snug text-ink/50">
              {claimResult.trustNote}{" "}
              {claimResult.recordsSeeded ? (
                <>
                  <a
                    href={ensAppUrl(claimResult.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    Open in ENS App (Base Sepolia)
                  </a>{" "}
                  to read the mirrored text records.
                </>
              ) : (
                <>
                  After a grade is published, claim again to seed them, then open{" "}
                  <a
                    href={ensAppUrl(claimResult.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    ENS App (Base Sepolia)
                  </a>
                  .
                </>
              )}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
