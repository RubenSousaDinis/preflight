"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { VIEWS, type ViewId } from "../lib/views";
import { Container } from "./container";
import { Mark } from "./mark";

/*
  The console chrome: a sticky bar carrying the mark, the views, and who is acting.

  The console is tab switched rather than one long scroll, which is what the design
  sets and what an operator needs: one view on the projector at a time, reachable
  by URL so a beat can be opened directly rather than scrolled to.
*/

export function ConsoleNav({ view }: { view: ViewId }) {
  const pathname = usePathname();
  const params = useSearchParams();

  const hrefFor = (id: ViewId) => {
    const next = new URLSearchParams(params.toString());
    next.set("view", id);
    return `${pathname}?${next.toString()}`;
  };

  return (
    <div className="sticky top-0 z-20 border-b border-rule bg-paper">
      <Container wide className="flex items-center justify-between gap-5 py-3">
        <div className="flex min-w-0 items-center gap-5 sm:gap-[22px]">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 text-ink">
            <Mark width={30} />
            <span className="font-display text-[18px] font-semibold">
              preflight <span className="font-normal text-meta">console</span>
            </span>
          </Link>

          <nav aria-label="Console views" className="min-w-0">
            <ul className="flex flex-wrap gap-1 text-[14px]">
              {VIEWS.map((entry) => {
                const active = entry.id === view;
                return (
                  <li key={entry.id}>
                    <Link
                      href={hrefFor(entry.id)}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-control px-3 py-[7px] no-underline ${
                        active
                          ? "bg-selected font-semibold text-ink"
                          : "text-muted hover:text-ink"
                      }`}
                    >
                      {entry.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        <div className="hidden shrink-0 items-center gap-2.5 font-data text-[12.5px] lg:flex">
          <span className="rounded-control border border-rule bg-subtle px-3 py-1.5">
            client agent
          </span>
          <span className="rounded-control border border-rule bg-subtle px-3 py-1.5 font-semibold text-grade-a">
            fail closed
          </span>
        </div>
      </Container>
    </div>
  );
}

export function ConsoleFooter() {
  return (
    <div className="border-t border-rule">
      <Container
        wide
        className="flex flex-wrap justify-between gap-4 py-3.5 font-data text-[11.5px] text-meta"
      >
        <span>
          preflight console / <Link href="/">product page</Link> /{" "}
          <Link href="/deck">pitch deck</Link>
        </span>
        <span>
          x402 on Hedera / ERC-8004 on Base / nobody can pay for a grade
        </span>
      </Container>
    </div>
  );
}
