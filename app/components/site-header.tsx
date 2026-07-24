"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Container } from "./container";
import { Mark } from "./mark";

const ROUTES = [
  { href: "/", label: "Product" },
  { href: "/console", label: "Console" },
  { href: "/deck", label: "Deck" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-rule bg-panel">
      <Container className="flex items-center justify-between gap-4 py-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-ink no-underline"
        >
          <Mark />
          <span className="font-display text-[1.15rem] font-semibold tracking-[-0.01em]">
            Preflight
          </span>
        </Link>

        <nav aria-label="Sections">
          <ul className="flex items-center gap-5 sm:gap-7">
            {ROUTES.map((route) => {
              const active = isActive(pathname, route.href);
              return (
                <li key={route.href}>
                  <Link
                    href={route.href}
                    aria-current={active ? "page" : undefined}
                    className={`font-data text-[0.7rem] uppercase tracking-[0.14em] no-underline ${
                      active
                        ? "border-b-2 border-accent pb-0.5 text-accent"
                        : "border-b-2 border-transparent pb-0.5 text-ink/60 hover:text-ink"
                    }`}
                  >
                    {route.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </Container>
    </header>
  );
}
