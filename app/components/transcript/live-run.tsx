"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ChainVerification, HarnessEvent, Receipt } from "@/src/shared";
import {
  AgentCatalogPicker,
  PickerAction,
} from "../agents/agent-catalog-picker";
import { agentLabelFor } from "../../lib/agent-display";
import type { KnownAgentCatalogEntry } from "../../lib/known-agents";
import { ReceiptChain } from "../receipts/receipt-chain";
import { PaymentSummary } from "./payment-summary";
import { TranscriptPanel } from "./transcript-panel";

/** Every receipt the stream carried, in the order the run made them. */
function receiptsOf(events: HarnessEvent[]): Receipt[] {
  const seen = new Set<string>();
  const chain: Receipt[] = [];
  for (const event of events) {
    if (!("receipt" in event) || !event.receipt) continue;
    if (seen.has(event.receipt.id)) continue;
    seen.add(event.receipt.id);
    chain.push(event.receipt);
  }
  return chain;
}

async function verifyReceipts(
  receipts: Receipt[],
): Promise<ChainVerification | null> {
  try {
    const response = await fetch("/api/verify-receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receipts }),
    });
    return (await response.json()) as ChainVerification;
  } catch {
    // Unverified, never verified.
    return null;
  }
}

/** One picked candidate, named, removable. */
function CandidateChip({
  agentId,
  name,
  onRemove,
  disabled,
}: {
  agentId: string;
  name: string | null;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 border border-rule bg-band/60 py-1 pr-1 pl-2.5">
      <span className="text-[0.88rem] leading-tight text-ink">
        {name ?? agentId}
        {name !== null ? (
          <span className="ml-1.5 font-data text-[0.68rem] text-ink/45">
            {agentId}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${name ?? agentId} from the run`}
        className="border-l border-rule px-1.5 font-data text-[0.78rem] text-ink/50 transition-colors hover:text-grade-f disabled:opacity-50"
      >
        x
      </button>
    </span>
  );
}

/*
  Beat 1, driven live.

  The events append as the run yields them, which is the whole reason the panel
  renders a stream rather than a written story: a narration that happens to match
  is indistinguishable from a fake, and a stream that fills in front of the room
  is not.

  Candidates are picked from the catalog rather than typed as ids. An operator who
  has to remember that 8436 is the poisoned card is an operator who mistypes it on
  stage, and a run against the wrong agent looks exactly like a run that lied.

  Before a run, the panel shows the frozen fixture stream, labelled as fixture so
  nobody reads it as a run that happened.
*/
export function LiveRun({
  fixtureEvents,
  catalog,
  defaultCandidateIds,
}: {
  fixtureEvents: HarnessEvent[];
  catalog: readonly KnownAgentCatalogEntry[];
  defaultCandidateIds: readonly string[];
}) {
  const [events, setEvents] = useState<HarnessEvent[] | null>(null);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [verification, setVerification] = useState<ChainVerification | null>(
    null,
  );
  const [candidates, setCandidates] = useState<string[]>([
    ...defaultCandidateIds,
  ]);
  const [query, setQuery] = useState("");
  // The run is read from a ref so a candidate removed mid-stream cannot change
  // what the transcript says was run.
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;

  const nameFor = useCallback(
    (agentId: string) => agentLabelFor(agentId, catalog),
    [catalog],
  );

  // The free-text escape hatch, offered only for something that could be a
  // registry id. A search term is a search term, and "add poisoned as an id"
  // beside a list that just matched two agents is noise.
  const typed = query.trim();
  const typedIsNew =
    /^[0-9]{1,78}$/.test(typed) &&
    !candidates.includes(typed) &&
    !catalog.some((agent) => agent.id === typed);

  const run = useCallback(async () => {
    const picked = candidatesRef.current;
    if (picked.length === 0) {
      setFailure(
        "No candidate agents are selected, so there is nothing to shop for and no run was made.",
      );
      return;
    }

    setFailure(null);
    setEvents([]);
    setVerification(null);
    setRunning(true);

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidates: picked }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        setFailure(
          body?.reason ??
            `The run endpoint answered ${response.status} and produced no stream.`,
        );
        setEvents(null);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // The run is accumulated here rather than read back out of state, so what
      // gets verified at the end is exactly what arrived.
      const received: HarnessEvent[] = [];

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          try {
            received.push(JSON.parse(line.slice(5).trim()) as HarnessEvent);
          } catch {
            // A frame that will not parse is dropped rather than killing the run.
            // The stream is still the record; one unreadable frame is not.
          }
        }
        setEvents([...received]);
      }

      // The run is over. Its receipts carry a claim, so they go back to B2's
      // verifier rather than being rendered as though the claim were checked.
      const chain = receiptsOf(received);
      if (chain.length > 0) {
        setVerification(await verifyReceipts(chain));
      }
    } catch (thrown) {
      setFailure(
        thrown instanceof Error
          ? thrown.message
          : "The run could not be started.",
      );
    } finally {
      setRunning(false);
    }
  }, []);

  const shown = events ?? fixtureEvents;
  const isLive = events !== null;
  const chips = useMemo(
    () =>
      candidates.map((agentId) => ({ agentId, name: nameFor(agentId) })),
    [candidates, nameFor],
  );

  function toggle(agentId: string) {
    setCandidates((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId],
    );
  }

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-start">
        <div className="min-w-0 order-2 lg:order-1">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={running || candidates.length === 0}
              className="border border-accent bg-accent/5 px-5 py-2.5 font-data text-[0.85rem] tracking-[0.1em] text-accent disabled:opacity-40"
            >
              {running ? "running" : "run the task"}
            </button>
            <p className="font-data text-[0.72rem] text-ink/55">
              {candidates.length === 0
                ? "pick at least one candidate"
                : `${candidates.length} candidate${candidates.length === 1 ? "" : "s"}, gated in order`}
            </p>
          </div>

          {chips.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <CandidateChip
                  key={chip.agentId}
                  agentId={chip.agentId}
                  name={chip.name}
                  disabled={running}
                  onRemove={() => toggle(chip.agentId)}
                />
              ))}
            </div>
          ) : null}

          <p className="mb-3 font-data text-[0.72rem] text-ink/55">
            {isLive
              ? running
                ? `live run in progress, ${shown.length} events so far`
                : `live run, ${shown.length} events`
              : "fixture stream. No run has been made on this page."}
          </p>

          {failure ? (
            <p className="mb-3 border border-rule border-l-2 border-l-grade-f bg-band/50 px-4 py-3 text-[0.9rem] leading-snug text-ink">
              {failure}
            </p>
          ) : null}

          <TranscriptPanel events={shown} nameFor={nameFor} />

          <div className="mt-6">
            <h3 className="mb-3 font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
              budget
            </h3>
            <PaymentSummary events={shown} />
          </div>

          {isLive && receiptsOf(shown).length > 0 ? (
            <div className="mt-6">
              <h3 className="mb-3 font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
                receipts from this run
              </h3>
              <ReceiptChain log={{ receipts: receiptsOf(shown), verification }} />
            </div>
          ) : null}
        </div>

        {/* Sticky, because the transcript is longer than the picker and an
            operator who scrolls into the run should not lose the control that
            starts the next one. */}
        <div className="min-w-0 order-1 lg:sticky lg:top-[4.5rem] lg:order-2">
          <AgentCatalogPicker
            catalog={catalog}
            query={query}
            onQueryChange={setQuery}
            disabled={running}
            label="candidates for this run"
            placeholder="search by name or registry id"
            listHeight="max-h-[19rem]"
            isSelected={(agent) => candidates.includes(agent.id)}
            actions={(agent) => (
              <PickerAction
                onClick={() => toggle(agent.id)}
                disabled={running}
                active={candidates.includes(agent.id)}
              >
                {candidates.includes(agent.id) ? "picked" : "add"}
              </PickerAction>
            )}
            footNote={
              candidates.length > 0 ? ` / ${candidates.length} picked` : null
            }
          />

          {typedIsNew ? (
            <button
              type="button"
              onClick={() => {
                toggle(typed);
                setQuery("");
              }}
              disabled={running}
              className="mt-2 w-full border border-rule px-3 py-2 font-data text-[0.72rem] tracking-[0.08em] text-ink/70 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              add {typed} as a registry id
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
