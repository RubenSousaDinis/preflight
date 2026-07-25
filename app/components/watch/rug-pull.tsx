"use client";

import { useCallback, useRef, useState } from "react";
import { agentLabelFor } from "../../lib/agent-display";
import type { KnownAgentCatalogEntry } from "../../lib/known-agents";
import {
  AgentCatalogPicker,
  PickerAction,
} from "../agents/agent-catalog-picker";
import type {
  ClientVerdict,
  WatchFrame,
  WatchObservation,
} from "../../lib/watch-view";
import { gradeColor } from "../../lib/tokens";
import { PulseDots } from "../states";

/*
  Beat 4: a graded agent ships an update, and every client drops it.

  The clients render together because propagation is the claim. Sequential drops
  read as a script, and four rows appearing at one timestamp do not.

  What they are is stated on screen rather than implied: four invocations of the
  same gate, not four independent parties. What propagates here is the check.
*/

function ObservationRow({
  observation,
  first,
}: {
  observation: WatchObservation;
  first: boolean;
}) {
  // Drift outranks a partial failure. A moved fingerprint is the signal this beat
  // exists to show, and it stays the headline even when the version channel could
  // not be read; that failure becomes a caveat under it rather than replacing it.
  const label = observation.changed
    ? `${observation.changeKind} moved`
    : observation.fingerprintError !== null
      ? "could not check the surface"
      : first
        ? "baseline"
        : "no change";

  const tone = observation.changed
    ? "text-grade-f"
    : observation.fingerprintError !== null
      ? "text-grade-c"
      : "text-ink/55";

  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-1 px-4 py-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:px-5">
      <p className={`font-data text-[0.7rem] uppercase tracking-[0.12em] ${tone}`}>
        {label}
      </p>
      <div className="min-w-0">
        <p className="font-data text-[0.74rem] break-all text-ink/70">
          version {observation.declaredVersion ?? "unread"} / fingerprint{" "}
          {observation.fingerprint ?? "unread"}
        </p>
        {observation.fingerprintError ? (
          <p className="mt-1 text-[0.82rem] leading-snug text-ink/70">
            the surface could not be read, which is not the same as unchanged:{" "}
            {observation.fingerprintError}
          </p>
        ) : null}
        {observation.versionError && !observation.fingerprintError ? (
          <p className="mt-1 font-data text-[0.7rem] text-ink/50">
            version channel unread, fingerprint channel is the one reporting
          </p>
        ) : null}
      </div>
    </li>
  );
}

function ClientCard({ client }: { client: ClientVerdict }) {
  const refused = client.verdict === "REFUSE";
  return (
    // min-w-0 because a grid item defaults to a minimum of its own content, and the
    // reason below carries a 42 character address. Without it the four columns are
    // sized by that address rather than by the space available.
    <li className="min-w-0 border border-rule bg-panel px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-data text-[0.66rem] uppercase tracking-[0.14em] text-ink/50">
          {client.client}
        </p>
        {client.grade === null ? null : (
          <span
            className="font-display text-[1.1rem] leading-none font-semibold"
            style={{ color: gradeColor(client.grade) }}
          >
            {client.grade}
          </span>
        )}
      </div>
      <p
        className={`mt-2 inline-block border px-2 py-0.5 font-data text-[0.78rem] tracking-[0.1em] ${
          refused ? "border-grade-f text-grade-f" : "border-accent text-accent"
        }`}
      >
        {client.verdict}
      </p>
      {/*
        The reason is a sentence with an address inside it, and an address is one
        unbreakable word wider than this column. wrap-anywhere rather than break-all
        so the ordinary words still break at spaces and only the hex splits.
      */}
      <p className="mt-2 text-[0.82rem] leading-snug wrap-anywhere text-ink/70">
        {client.reason}
      </p>
    </li>
  );
}

export function RugPull({
  catalog,
  defaultAgentId,
}: {
  catalog: readonly KnownAgentCatalogEntry[];
  defaultAgentId: string;
}) {
  // An id the catalog does not carry stays the id that was asked for. Falling back
  // to the first row would quietly watch a different agent than the link named.
  const defaultEntry =
    catalog.find((agent) => agent.id === defaultAgentId) ?? null;
  const [observations, setObservations] = useState<WatchObservation[]>([]);
  const [clients, setClients] = useState<ClientVerdict[] | null>(null);
  const [watching, setWatching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<KnownAgentCatalogEntry | null>(
    defaultEntry,
  );
  // The id being watched when nothing in the catalog is picked. Seeded with the
  // view's default so the beat is one click away on a cold load.
  const [freeTextId, setFreeTextId] = useState(
    defaultEntry === null ? defaultAgentId : "",
  );
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setWatching(false);
  }, []);

  const start = useCallback(async () => {
    const agentId = (selected?.id ?? freeTextId).trim();
    const chainId = selected?.identityChainId;
    if (agentId.length === 0) {
      setNotice("Pick an agent from the list, or paste a registry id.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setObservations([]);
    setClients(null);
    setNotice(null);
    setWatching(true);

    try {
      const response = await fetch("/api/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId,
          ...(chainId !== undefined ? { chainId } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        setNotice(
          body?.reason ?? `The watch endpoint answered ${response.status}.`,
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const raw of frames) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          let frame: WatchFrame;
          try {
            frame = JSON.parse(line.slice(5).trim()) as WatchFrame;
          } catch {
            continue;
          }
          if (frame.kind === "observation") {
            setObservations((current) => [...current, frame.observation]);
          } else if (frame.kind === "clients") {
            setClients(frame.clients);
          } else {
            setNotice(frame.reason);
          }
        }
      }
    } catch (thrown) {
      if (!controller.signal.aborted) {
        setNotice(
          thrown instanceof Error ? thrown.message : "The watch stopped.",
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setWatching(false);
    }
  }, [freeTextId, selected]);

  const flipped = observations.some((observation) => observation.changed);
  // Offered only for something that could be a registry id, so a search term
  // never reads as a watchable target.
  const typed = query.trim();
  const typedIsNew =
    /^[0-9]{1,78}$/.test(typed) && !catalog.some((agent) => agent.id === typed);
  const watchingId = selected?.id ?? freeTextId.trim();
  const watchingName =
    selected?.label ?? (watchingId ? agentLabelFor(watchingId, catalog) : null);

  function pickAgent(agent: KnownAgentCatalogEntry) {
    setSelected(agent);
    setFreeTextId("");
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={watching ? stop : start}
          disabled={!watching && watchingId.length === 0}
          className="border border-accent bg-accent/5 px-5 py-2.5 font-data text-[0.85rem] tracking-[0.1em] text-accent disabled:opacity-40"
        >
          {watching ? "stop watching" : "watch it"}
        </button>
        {watchingId.length > 0 ? (
          <p className="text-[0.92rem] leading-tight text-ink">
            {watchingName ?? watchingId}
            {watchingName !== null ? (
              <span className="ml-2 font-data text-[0.7rem] text-ink/45">
                id {watchingId}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="font-data text-[0.75rem] text-ink/55">
            pick an agent below
          </p>
        )}
      </div>

      <div className="mb-5 max-w-[860px]">
        <AgentCatalogPicker
          catalog={catalog}
          query={query}
          onQueryChange={setQuery}
          disabled={watching}
          label="agent to watch"
          listHeight="max-h-[16rem]"
          isSelected={(agent) =>
            selected?.id === agent.id &&
            selected.identityChainId === agent.identityChainId
          }
          actions={(agent) => {
            const active =
              selected?.id === agent.id &&
              selected.identityChainId === agent.identityChainId;
            return (
              <PickerAction
                onClick={() => pickAgent(agent)}
                disabled={watching}
                active={active}
              >
                {active ? "selected" : "select"}
              </PickerAction>
            );
          }}
          footNote={
            freeTextId.trim().length > 0 ? ` / free-text id ${freeTextId}` : null
          }
        />

        {typedIsNew ? (
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setFreeTextId(typed);
              setQuery("");
            }}
            disabled={watching}
            className="mt-2 w-full border border-rule px-3 py-2 font-data text-[0.72rem] tracking-[0.08em] text-ink/70 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            watch {typed} as a registry id
          </button>
        ) : null}
      </div>

      {watching ? (
        <p
          className="mb-3 flex items-center gap-2 font-data text-[0.78rem] text-ink/65"
          role="status"
          aria-live="polite"
        >
          <PulseDots />
          polling the target every four seconds
        </p>
      ) : null}

      {notice ? (
        <p className="mb-3 border border-rule border-l-2 border-l-grade-c bg-band/50 px-4 py-2 text-[0.88rem] leading-snug text-ink/80">
          {notice}
        </p>
      ) : null}

      {clients ? (
        <section className="mb-4">
          <h4 className="mb-2 font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
            {clients.length === 1
              ? "the client, on its next call"
              : "every client, at the same instant"}
          </h4>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {clients.map((client) => (
              <ClientCard key={client.client} client={client} />
            ))}
          </ul>
          <p className="mt-2 max-w-[46rem] text-[0.82rem] leading-snug text-ink/60">
            {clients.length === 1
              ? "One invocation of the gate, run fresh each poll. Nothing told it the agent changed: it reads the live tool surface itself, which is why the drop needs no new attestation and no notification."
              : `${clients.length} invocations of the same gate, run concurrently and rendered together, not independent parties. What propagates is the check: each reads the live tool surface itself, so none of them needs to be told the agent changed.`}
          </p>
        </section>
      ) : null}

      {observations.length > 0 ? (
        <section>
          <h4 className="mb-2 font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
            what the watcher saw
            {flipped ? " / a change was detected" : ""}
          </h4>
          <ol className="divide-y divide-rule border border-rule">
            {observations.map((observation, index) => (
              <ObservationRow
                key={`${observation.at}-${index}`}
                observation={observation}
                first={index === 0}
              />
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
