import type { Metadata } from "next";
import { Container } from "../../components/container";
import { DeckStage } from "../../components/deck/deck-stage";

export const metadata: Metadata = {
  title: "Deck",
};

export default function DeckPage() {
  return (
    <Container className="py-8 sm:py-10">
      <header className="max-w-[46rem]">
        <p className="font-data text-[0.68rem] uppercase tracking-[0.16em] text-accent">
          stage
        </p>
        <h1 className="mt-3 font-display text-[1.9rem] font-semibold leading-tight tracking-[-0.015em] sm:text-[2.2rem]">
          Deck
        </h1>
        <p className="mt-4 text-ink/80">
          Arrow keys move between slides. Every claim here can be pointed at on
          the console, which is the only reason to make it.
        </p>
      </header>

      <div className="mt-6">
        <DeckStage />
      </div>
    </Container>
  );
}
