import type { Metadata } from "next";
import { DeckStage } from "../../components/deck/deck-stage";
import { ENS_SLIDES } from "../../components/deck/ens";

export const metadata: Metadata = {
  title: "ENS track",
  robots: { index: false, follow: false },
};

export default function TrackDeckPage() {
  return <DeckStage slides={ENS_SLIDES} />;
}
