"use client";

import { useCallback, useEffect, useState } from "react";
import { SLIDES } from "../../lib/deck";

/*
  The stage.

  Built for the back of a lit room: one claim per slide, display type that survives
  a projector, and arrow keys so the operator never hunts for a control while
  talking. The first slide renders on the server, so the deck is readable before any
  script runs and a dead laptop is not a dead deck.
*/
export function DeckStage() {
  const [index, setIndex] = useState(0);
  const last = SLIDES.length - 1;

  const go = useCallback(
    (next: number) => setIndex(Math.min(Math.max(next, 0), last)),
    [last],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        go(index + 1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        go(index - 1);
      } else if (event.key === "Home") {
        go(0);
      } else if (event.key === "End") {
        go(last);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, last]);

  const slide = SLIDES[index];

  return (
    <section className="border border-rule bg-panel">
      <div
        className="flex min-h-[26rem] flex-col justify-center px-6 py-10 sm:px-12 sm:py-16"
        aria-live="polite"
      >
        <p className="font-data text-[0.7rem] uppercase tracking-[0.18em] text-accent">
          {slide.eyebrow}
        </p>
        <h2 className="mt-4 max-w-[24ch] font-display text-[clamp(1.9rem,4.4vw,3.4rem)] leading-[1.06] font-semibold tracking-[-0.015em]">
          {slide.title}
        </h2>
        <div className="mt-6 max-w-[62ch] space-y-3">
          {slide.lines.map((line) => (
            <p
              key={line}
              className="text-[clamp(1rem,1.5vw,1.35rem)] leading-[1.45] text-ink/80"
            >
              {line}
            </p>
          ))}
        </div>
        {slide.fields ? (
          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            {slide.fields.map((field) => (
              <div key={field.label}>
                <dt className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-ink/50">
                  {field.label}
                </dt>
                <dd className="mt-1 font-data text-[clamp(0.95rem,1.3vw,1.2rem)]">
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <nav
        className="flex items-center justify-between gap-4 border-t border-rule bg-band/50 px-4 py-3 sm:px-6"
        aria-label="Slides"
      >
        <button
          type="button"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          className="border border-rule px-3 py-1.5 font-data text-[0.74rem] tracking-[0.1em] text-ink/75 disabled:opacity-40"
        >
          back
        </button>

        <ol className="flex flex-wrap items-center justify-center gap-2">
          {SLIDES.map((entry, position) => (
            <li key={entry.title}>
              <button
                type="button"
                onClick={() => go(position)}
                aria-label={`Slide ${position + 1}, ${entry.eyebrow}`}
                aria-current={position === index ? "true" : undefined}
                className={`block h-2.5 w-2.5 border ${
                  position === index
                    ? "border-accent bg-accent"
                    : "border-rule hover:border-ink/40"
                }`}
              />
            </li>
          ))}
        </ol>

        <div className="flex items-center gap-3">
          <p className="font-data text-[0.72rem] text-ink/50">
            {index + 1} of {SLIDES.length}
          </p>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index === last}
            className="border border-accent px-3 py-1.5 font-data text-[0.74rem] tracking-[0.1em] text-accent disabled:opacity-40"
          >
            next
          </button>
        </div>
      </nav>
    </section>
  );
}
