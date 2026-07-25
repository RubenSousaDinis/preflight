import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "../components/container";
import { Mark } from "../components/mark";

export const metadata: Metadata = {
  title: "ETHGlobal Lisbon 2026 tracks",
  /* Unlisted: nothing links here from the site, and crawlers are asked to skip it. */
  robots: { index: false, follow: false },
};

const DECKS = [
  {
    href: "/deck",
    label: "Main deck",
    note: "Ten slides: the problem, the two gates, the method, and the four demo beats.",
    meta: "10 slides",
  },
  {
    href: "/decks/hedera",
    label: "Hedera deck",
    note: "The payment rail the gate authorizes, and the receipt chain mirrored to an HCS topic through the Agent Kit.",
    meta: "3 slides",
  },
  {
    href: "/decks/0g",
    label: "0G deck",
    note: "The advisory scan on 0G Compute, evidence bundles on 0G Storage, and the rule that keeps both out of the trust path.",
    meta: "3 slides",
  },
  {
    href: "/decks/ens",
    label: "ENS deck",
    note: "How a claimed subname mirrors a ValidationRegistry row, and the five names it is live on.",
    meta: "3 slides",
  },
];

export default function TracksPage() {
  return (
    <div className="min-h-svh bg-paper">
      <div className="border-b border-rule">
        <Container className="flex justify-between gap-4 py-2.5 font-data text-[11.5px] tracking-[0.08em] text-meta">
          <span>PREFLIGHT / TRACK SUBMISSIONS</span>
          <span className="hidden sm:inline">UNLISTED</span>
        </Container>
      </div>

      <Container className="py-14">
        <div className="mb-3 flex items-center gap-2.5">
          <Mark />
          <span className="font-display text-[20px] font-semibold tracking-[-0.2px]">
            preflight
          </span>
        </div>
        <h1 className="font-display text-[34px] font-semibold tracking-[-0.6px]">
          ETHGlobal Lisbon 2026
        </h1>
        <p className="mt-3 mb-10 max-w-[46rem] text-muted">
          The main deck, and one short deck per partner track covering how their
          technology is actually used in this build. Each deck runs in the browser
          with arrow keys, and prints one slide per page.
        </p>

        <ul className="divide-y divide-rule border border-rule">
          {DECKS.map((deck) => (
            <li key={deck.href}>
              <Link
                href={deck.href}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-5 py-5 no-underline hover:bg-subtle"
              >
                <span className="min-w-0">
                  <span className="block font-display text-[1.2rem] font-semibold text-ink">
                    {deck.label}
                  </span>
                  <span className="mt-1 block max-w-[38rem] text-[0.92rem] leading-snug text-muted">
                    {deck.note}
                  </span>
                </span>
                <span className="font-data text-[0.72rem] tracking-[0.14em] text-meta">
                  {deck.meta}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-6 max-w-[46rem] font-data text-[0.75rem] leading-relaxed text-meta">
          Unlisted on purpose: nothing on the site links here, and the page asks
          crawlers to skip it. Every claim in every deck is checkable in the
          repository or on the console.
        </p>
      </Container>
    </div>
  );
}
