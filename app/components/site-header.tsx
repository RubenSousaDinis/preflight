"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Container } from "./container";
import { Mark } from "./mark";

/*
  The header, as the design sets it: a thin meta rule above a sticky nav.

  The meta rule states what this is and what it stands on, in the mono face, at a
  size meant to be read once and then ignored. The nav carries the section anchors
  on the product page and the routes everywhere, with the console as a filled
  accent control because it is the only place anything actually happens.
*/

const SECTIONS = [
  { href: "/#gates", label: "The gates" },
  { href: "/#method", label: "How it works" },
  { href: "/#receipts", label: "Receipts" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header>
      <div className="border-b border-rule">
        <Container className="flex justify-between gap-4 py-2.5 font-data text-[11.5px] tracking-[0.08em] text-meta">
          <span>THE PRE-FLIGHT CHECK FOR AUTONOMOUS AGENTS</span>
          <span className="hidden sm:inline">
            x402 ON HEDERA / ERC-8004 ON BASE / FAIL CLOSED
          </span>
        </Container>
      </div>

      <div className="sticky top-0 z-20 border-b border-rule bg-paper">
        <Container className="flex items-center justify-between gap-6 py-3.5">
          <Link href="/" className="flex items-center gap-2.5 text-ink">
            <Mark />
            <span className="font-display text-[20px] font-semibold tracking-[-0.2px]">
              preflight
            </span>
          </Link>

          <nav aria-label="Sections">
            <ul className="flex items-center gap-4 text-[14.5px] sm:gap-[22px]">
              {SECTIONS.map((section) => (
                <li key={section.href} className="hidden md:block">
                  <Link href={section.href} className="text-muted">
                    {section.label}
                  </Link>
                </li>
              ))}
              <li className="hidden sm:block">
                <Link
                  href="/deck"
                  className={
                    pathname === "/deck" ? "text-accent" : "text-muted"
                  }
                >
                  Pitch deck
                </Link>
              </li>
              <li>
                <Link
                  href="/console"
                  className="inline-block rounded-control bg-accent px-4 py-2 text-[14px] font-medium text-paper no-underline hover:bg-accent-hover"
                >
                  Open the console
                </Link>
              </li>
            </ul>
          </nav>
        </Container>
      </div>
    </header>
  );
}
