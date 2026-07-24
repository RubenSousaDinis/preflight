"use client";

import { useCallback, useRef, useState } from "react";
import type { HarnessEvent } from "@/src/shared";
import { PaymentSummary } from "./payment-summary";
import { TranscriptPanel } from "./transcript-panel";

/*
  Beat 1, driven live.

  The events append as the run yields them, which is the whole reason the panel
  renders a stream rather than a written story: a narration that happens to match
  is indistinguishable from a fake, and a stream that fills in front of the room
  is not.

  Before a run, the panel shows the frozen fixture stream, labelled as fixture so
  nobody reads it as a run that happened.
*/
export function LiveRun({
  fixtureEvents,
  defaultCandidates,
}: {
  fixtureEvents: HarnessEvent[];
  defaultCandidates: string;
}) {
  const [events, setEvents] = useState<HarnessEvent[] | null>(null);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const candidatesRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async () => {
    const raw = candidatesRef.current?.value ?? "";
    const candidates = raw
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    setFailure(null);
    setEvents([]);
    setRunning(true);

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidates }),
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
            const event = JSON.parse(line.slice(5).trim()) as HarnessEvent;
            setEvents((current) => [...(current ?? []), event]);
          } catch {
            // A frame that will not parse is dropped rather than killing the run.
            // The stream is still the record; one unreadable frame is not.
          }
        }
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1">
          <span className="block font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
            candidate agents, space or comma separated
          </span>
          <input
            ref={candidatesRef}
            defaultValue={defaultCandidates}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-data text-[0.85rem] text-ink outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="border border-accent px-4 py-2 font-data text-[0.78rem] tracking-[0.1em] text-accent disabled:opacity-50"
        >
          {running ? "running" : "run the task"}
        </button>
      </div>

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

      <TranscriptPanel events={shown} />

      <div className="mt-6">
        <h3 className="mb-3 font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
          budget
        </h3>
        <PaymentSummary events={shown} />
      </div>
    </div>
  );
}
