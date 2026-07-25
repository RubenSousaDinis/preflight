"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/*
  The stage: a fixed 1920 by 1080 canvas scaled to fit whatever it is shown on.

  Written here rather than vendored. The design ships a support script for this,
  and copying a file authored before the clock into the submission is the thing the
  eligibility rule forbids, so the behaviour is reimplemented: scale to fit,
  keyboard nav, and one slide per page when printed.

  A fixed canvas is the point. Every size on a slide is chosen against 1920 and
  scales together, so a projector at any resolution gets the same composition
  rather than a reflow nobody rehearsed.
*/

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

export function DeckStage({ slides }: { slides: ReactNode[] }) {
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const last = slides.length - 1;

  const go = useCallback(
    (next: number) => setIndex(Math.min(Math.max(next, 0), last)),
    [last],
  );

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const fit = () => {
      const { width, height } = element.getBoundingClientRect();
      setScale(Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const key = event.key;
      if (key === "ArrowRight" || key === "PageDown" || key === " ") {
        event.preventDefault();
        go(index + 1);
      } else if (key === "ArrowLeft" || key === "PageUp") {
        event.preventDefault();
        go(index - 1);
      } else if (key === "Home") {
        go(0);
      } else if (key === "End") {
        go(last);
      } else if (key === "r" || key === "R") {
        go(0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, last]);

  return (
    <div className="fixed inset-0 bg-ink">
      <div ref={viewport} className="deck-viewport h-full w-full overflow-hidden">
        <div
          className="deck-canvas absolute top-1/2 left-1/2"
          style={{
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
        >
          {slides.map((slide, position) => (
            <div
              key={position}
              className="deck-slide absolute inset-0"
              style={{ display: position === index ? "flex" : "none" }}
              aria-hidden={position === index ? undefined : true}
            >
              {slide}
            </div>
          ))}
        </div>
      </div>

      <div className="deck-chrome fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2">
        <div className="flex items-center gap-2 rounded-control border border-dark-rule bg-ink px-3 py-2 font-data text-[13px] text-dark-text">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            className="px-1 disabled:opacity-40"
            aria-label="Previous slide"
          >
            prev
          </button>
          <span className="text-dark-faint">
            {String(index + 1).padStart(2, "0")} / {slides.length}
          </span>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index === last}
            className="px-1 disabled:opacity-40"
            aria-label="Next slide"
          >
            next
          </button>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-control bg-accent px-4 py-2.5 text-[14px] font-medium text-paper"
        >
          Download PDF
        </button>
        <Link
          href="/"
          className="rounded-control border border-dark-rule bg-ink px-4 py-2 text-[14px] text-dark-text no-underline hover:text-paper"
        >
          Back to site
        </Link>
      </div>
    </div>
  );
}
