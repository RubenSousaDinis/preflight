import type { Metadata } from "next";
import { DeckStage } from "../../components/deck/deck-stage";
import { ZEROG_SLIDES } from "../../components/deck/zerog";

export const metadata: Metadata = {
  title: "0G track",
  robots: { index: false, follow: false },
};

export default function TrackDeckPage() {
  return <DeckStage slides={ZEROG_SLIDES} />;
}
