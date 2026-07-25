import type { ReactNode } from "react";
import { Card, Dim, Kicker, Slide, Terminal } from "./parts";

/*
  The ENS track deck.

  Written against the repository as it stands, which contains no ENS code. The
  names task and the subname grade records are designed and specified and have not
  been built, so this deck says that rather than describing them as shipped. If
  they land before submission, slide 2 is the slide that changes.
*/

const TOTAL = 2;

export const ENS_SLIDES: ReactNode[] = [
  <Slide key="1" tone="dark" eyebrow="ENS TRACK" index={1} total={TOTAL}>
    <h1 className="mb-9 max-w-[1520px] font-display text-[88px] leading-[1.05] font-semibold tracking-[-2.1px]">
      A grade an agent carries in its own name.
    </h1>
    <p className="mb-12 max-w-[1320px] text-[34px] leading-[1.45] text-dark-text">
      Preflight publishes a grade to the ERC-8004 Validation Registry, which a
      gate reads by agent id. ENS is what would make that trust surface
      discoverable from the name instead: a validator with a name rather than an
      address, and a subname per graded agent carrying its letter and the evidence
      behind it.
    </p>
    <div className="flex flex-wrap gap-4.5">
      {[
        "Validator name",
        "Subname per graded agent",
        "Text records as a mirror",
      ].map((chip) => (
        <span
          key={chip}
          className="rounded-card border border-dark-rule px-[26px] py-3.5 font-data text-[25px] text-dark-text"
        >
          {chip}
        </span>
      ))}
    </div>
  </Slide>,

  <Slide key="2" tone="light" eyebrow="WHERE IT STANDS" index={2} total={TOTAL}>
    <h2 className="mb-9 font-display text-[68px] leading-[1.07] font-semibold tracking-[-1.5px]">
      Designed and specified.{" "}
      <span className="text-grade-c">Not built yet.</span>
    </h2>
    <div className="mb-9">
      <Terminal>
        <div>
          <Dim>shipped</Dim> validator identity as an address, records read from
          the registry
        </div>
        <div>
          <Dim>shipped</Dim> a grade and an evidence hash per agent, onchain and
          readable
        </div>
        <div>
          <span className="text-dark-warn">not built</span> a name for the
          validator
        </div>
        <div>
          <span className="text-dark-warn">not built</span> subnames carrying the
          grade and evidence URI as text records
        </div>
      </Terminal>
    </div>
    <div className="mb-9 grid grid-cols-2 gap-7">
      <Card
        title="The rule it would land under"
        body="Text records are a mirror of the registry, never a source. A reader that trusted a text record over the registry has inverted the trust order, and any surface rendering one has to label it as a mirror. The same rule already governs the Hedera consensus mirror, so it is not a new idea to enforce."
      />
      <Card
        title="Why it is not claimed"
        body="Nothing in this repository touches ENS. Saying otherwise on a sponsor slide would be the one thing this project argues against: a claim on a screen that the thing behind it cannot support. The console labels its own fixtures for the same reason."
      />
    </div>
    <Kicker>
      Reproducible means falsifiable.{" "}
      <span className="text-accent">
        That applies to what we say about ourselves too.
      </span>
    </Kicker>
  </Slide>,
];
