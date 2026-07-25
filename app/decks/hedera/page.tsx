import type { Metadata } from "next";
import { DeckStage } from "../../components/deck/deck-stage";
import { HEDERA_SLIDES } from "../../components/deck/hedera";

export const metadata: Metadata = {
  title: "Hedera track",
  robots: { index: false, follow: false },
};

export default function TrackDeckPage() {
  return <DeckStage slides={HEDERA_SLIDES} />;
}
