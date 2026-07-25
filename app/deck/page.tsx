import type { Metadata } from "next";
import { DeckStage } from "../components/deck/deck-stage";
import { SLIDES } from "../components/deck/slides";

export const metadata: Metadata = { title: "Deck" };

export default function DeckPage() {
  return <DeckStage slides={SLIDES} />;
}
