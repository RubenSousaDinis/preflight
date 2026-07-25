"use client";

import { useCallback, useRef, useState } from "react";
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
    <li className="border border-rule bg-panel px-3 py-3">
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
      <p className="mt-2 text-[0.82rem] leading-snug text-ink/70">
        {client.reason}
      </p>
    </li>
  );
}

export function RugPull({ defaultAgentId }: { defaultAgentId: string }) {
  const [observations, setObservations] = useState<WatchObservation[]>([]);
  const [clients, setClients] = useState<ClientVerdict[] | null>(null);
  const [watching, setWatching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const agentRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setWatching(false);
  }, []);

  const start = useCallback(async () => {
    const agentId = agentRef.current?.value.trim() ?? "";
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
        body: JSON.stringify({ agentId }),
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
      setWatching(false);
    }
  }, []);

  const flipped = observations.some((observation) => observation.changed);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1">
          <span className="block font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
            agent to watch
          </span>
          <input
            ref={agentRef}
            defaultValue={defaultAgentId}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-data text-[0.85rem] text-ink outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          onClick={watching ? stop : start}
          className="border border-accent px-4 py-2 font-data text-[0.78rem] tracking-[0.1em] text-accent"
        >
          {watching ? "stop watching" : "watch it"}
        </button>
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
