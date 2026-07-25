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

  Inactive slides stay mounted with visibility:hidden (not display:none). Print
  needs every slide in the box tree so page breaks can fire; display:none until
  @media print is a known way to get a one-page PDF of only the topmost slide.
*/

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

export function DeckStage({ slides }: { slides: ReactNode[] }) {
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [printing, setPrinting] = useState(false);
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
      if (printing) return;
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
  }, [go, index, last, printing]);

  useEffect(() => {
    const before = () => setPrinting(true);
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  const downloadPdf = useCallback(() => {
    // Commit the print layout before the browser snapshots. Relying on
    // @media print alone against absolutely stacked slides still collapses
    // to one page (the last slide) in Chromium.
    setPrinting(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }, []);

  return (
    <div
      className={`deck-root bg-ink ${printing ? "" : "fixed inset-0"}`}
      data-printing={printing ? "" : undefined}
      style={
        printing
          ? { position: "static", inset: "auto", height: "auto", width: "auto", overflow: "visible" }
          : undefined
      }
    >
      <div
        ref={viewport}
        className={`deck-viewport w-full ${printing ? "h-auto overflow-visible" : "h-full overflow-hidden"}`}
      >
        <div
          className={`deck-canvas ${printing ? "" : "absolute top-1/2 left-1/2"}`}
          style={
            printing
              ? {
                  width: CANVAS_WIDTH,
                  height: "auto",
                  transform: "none",
                  position: "static",
                }
              : {
                  width: CANVAS_WIDTH,
                  height: CANVAS_HEIGHT,
                  transform: `translate(-50%, -50%) scale(${scale})`,
                }
          }
        >
          {slides.map((slide, position) => {
            const active = position === index;
            return (
              <div
                key={position}
                className={`deck-slide ${printing ? "" : "absolute inset-0"}`}
                style={
                  printing
                    ? {
                        position: "relative",
                        inset: "auto",
                        width: CANVAS_WIDTH,
                        height: CANVAS_HEIGHT,
                        display: "block",
                        visibility: "visible",
                        opacity: 1,
                        breakAfter: position === last ? "auto" : "page",
                        pageBreakAfter: position === last ? "auto" : "always",
                      }
                    : {
                        visibility: active ? "visible" : "hidden",
                        opacity: active ? 1 : 0,
                        pointerEvents: active ? "auto" : "none",
                        display: "flex",
                      }
                }
                aria-hidden={active ? undefined : true}
              >
                {slide}
              </div>
            );
          })}
        </div>
      </div>

      <div className="deck-chrome fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2">
        <div className="flex items-center gap-2 rounded-control border border-dark-rule bg-ink px-3 py-2 font-data text-[13px] text-dark-text">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0 || printing}
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
            disabled={index === last || printing}
            className="px-1 disabled:opacity-40"
            aria-label="Next slide"
          >
            next
          </button>
        </div>
        <button
          type="button"
          onClick={downloadPdf}
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
