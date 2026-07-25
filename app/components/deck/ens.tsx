import type { ReactNode } from "react";
import { Card, Dim, Kicker, Slide, Terminal } from "./parts";

/*
  The ENS track deck.

  Written against the repository as it stands. The integration is in
  src/validator/ens and app/lib/ens.ts, and every claim on slides 1 and 2 is
  checkable there. Nothing has been written to a chain yet: no parent name is
  registered, so no agent carries a record. Slide 3 says that, and slide 3 is the
  slide that changes when the live pass lands. The deck does not lead the build.
*/

const TOTAL = 3;

export const ENS_SLIDES: ReactNode[] = [
  <Slide key="1" tone="dark" eyebrow="ENS TRACK" index={1} total={TOTAL}>
    <h1 className="mb-9 max-w-[1520px] font-display text-[88px] leading-[1.05] font-semibold tracking-[-2.1px]">
      A grade an agent carries in its own name.
    </h1>
    <p className="mb-12 max-w-[1320px] text-[34px] leading-[1.45] text-dark-text">
      Preflight publishes a grade to the ERC-8004 Validation Registry, which a
      gate reads by agent id. ENS makes that trust surface discoverable from the
      name instead: a subname per graded agent, whose text records carry the
      letter, the evidence pointer, and the record they were copied from. The
      registry stays the source. The name carries a copy of it.
    </p>
    <div className="flex flex-wrap gap-4.5">
      {[
        "Subname per graded agent",
        "Twelve text records",
        "A mirror of the registry",
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

  <Slide key="2" tone="light" eyebrow="THE MIRROR" index={2} total={TOTAL}>
    <h2 className="mb-9 font-display text-[68px] leading-[1.07] font-semibold tracking-[-1.5px]">
      The grade lands onchain.{" "}
      <span className="text-accent">The name follows it.</span>
    </h2>
    <div className="mb-9">
      <Terminal>
        <div>
          <Dim>on every publish</Dim> twelve records in one resolver multicall
        </div>
        <div>
          {"  "}preflight.grade{"          "}A{"      "}
          <Dim>read off the record, never recomputed</Dim>
        </div>
        <div>
          {"  "}preflight.evidenceHash{"   "}0x…{"    "}
          <Dim>always written</Dim>
        </div>
        <div>
          {"  "}preflight.registry{"       "}
          <span className="text-dark-accent-soft">
            eip155:{"{"}chainId{"}"}:{"{"}registry{"}"}
          </span>
        </div>
        <div>
          {"  "}description{"              "}
          <Dim>names the registry record as the source</Dim>
        </div>
        <div>
          <Dim>read as</Dim> registry.resolver(node){" "}
          <Dim>then</Dim> resolver.text(node, key)
        </div>
        <div>
          {"  "}
          <Dim>
            not getEnsText, which resolves through the universal resolver on L1
          </Dim>
        </div>
      </Terminal>
    </div>
    <div className="grid grid-cols-2 gap-7">
      <Card
        title="A mirror, never a source"
        body="The registry record is the grade. A reader that trusted a text record over it has inverted the trust order, so the description record says which is which, and the console labels every value that came from a name as a copy. The same rule already governs the Hedera consensus mirror."
      />
      <Card
        title="It cannot fail a verdict"
        body="No lookup here sits in or before a gate. Unconfigured resolves to null and stays quiet, a failed resolution is a value rather than a throw, and the fallback is the address with the registry-backed rendering. The write queue coalesces by agent so a superseded grade never lands after the one that replaced it."
      />
    </div>
  </Slide>,

  <Slide key="3" tone="light" eyebrow="WHERE IT STANDS" index={3} total={TOTAL}>
    <h2 className="mb-9 font-display text-[68px] leading-[1.07] font-semibold tracking-[-1.5px]">
      Built and checked.{" "}
      <span className="text-grade-c">Not yet on a name.</span>
    </h2>
    <div className="mb-9">
      <Terminal>
        <div>
          <Dim>shipped</Dim> src/validator/ens{"   "}names, records, client,
          mirror
        </div>
        <div>
          <Dim>shipped</Dim> ens status | subname | sync | verify | set{"   "}
          <Dim>dry run by default</Dim>
        </div>
        <div>
          <Dim>shipped</Dim> the console renders the name and labels it a copy
        </div>
        <div>
          <Dim>checked</Dim> 22 offline tests on the mirror, five on the line
          that renders it
        </div>
        <div>
          <Dim>checked</Dim> the read path against a live ENS registry, read
          only
        </div>
        <div>
          <span className="text-dark-warn">not yet</span> a parent name
          registered, so no agent carries a record
        </div>
      </Terminal>
    </div>
    <div className="mb-9 grid grid-cols-2 gap-7">
      <Card
        title="What the live pass adds"
        body="Register the parent, create one subname per graded agent, and sync each one from its registry record. Then ens verify exits zero when every key on the name matches the registry read side by side, and a publish moves preflight.updatedAt on chain while the demo watches."
      />
      <Card
        title="Why the slide says so"
        body="A sponsor slide that describes unwritten records as live is the one thing this project argues against: a claim on a screen that the thing behind it cannot support. The console labels its own fixtures for the same reason, and this deck changes when the transactions land, not before."
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
