import type { Metadata } from "next";
import { Container } from "../components/container";
import { Panel } from "../components/panel";
import { EmptyState } from "../components/states";

export const metadata: Metadata = {
  title: "Deck",
};

export default function DeckPage() {
  return (
    <Container className="py-10 sm:py-12">
      <header className="max-w-[46rem]">
        <p className="font-data text-[0.68rem] uppercase tracking-[0.16em] text-accent">
          stage
        </p>
        <h1 className="mt-3 font-display text-[1.9rem] font-semibold leading-tight tracking-[-0.015em] sm:text-[2.2rem]">
          Deck
        </h1>
        <p className="mt-4 text-ink/80">
          The stage deck renders here, at the same width as the console so the
          projector never has to be re-focused between them.
        </p>
      </header>

      <div className="mt-8">
        <Panel eyebrow="slides" title="Stage deck" status="not wired">
          <EmptyState>
            Slides load here once the deck lands. Fonts resolve by plain family
            name, which is why this app does not use next/font.
          </EmptyState>
        </Panel>
      </div>
    </Container>
  );
}
