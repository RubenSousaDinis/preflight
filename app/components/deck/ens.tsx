import type { ReactNode } from "react";
import { Card, Dim, Kicker, Slide, Terminal } from "./parts";

/*
  The ENS track deck.

  The integration is src/validator/ens (names, records, client, mirror) and
  app/lib/ens.ts. Slide 2 is the write and read mechanics; slide 3 is the live
  pass recorded in src/validator/ens/VERIFICATION.md.

  Subnames and records are on preflight.basetest.eth, the Sepolia Basenames
  parent. Writes stay on Sepolia by policy, enforced in assertEnsWriteAllowed,
  so this project never spends mainnet ETH on a name.
*/

const TOTAL = 3;

export const ENS_SLIDES: ReactNode[] = [
  <Slide key="1" tone="dark" eyebrow="ENS TRACK" index={1} total={TOTAL}>
    <h1 className="mb-9 max-w-[1520px] font-display text-[88px] leading-[1.05] font-semibold tracking-[-2.1px]">
      An optional name an agent&apos;s owner can carry.
    </h1>
    <p className="mb-12 max-w-[1340px] text-[34px] leading-[1.45] text-dark-text">
      Preflight grades by registry id. ENS is discoverability on top: a claimed
      subname under preflight.basetest.eth whose text records mirror the
      ValidationRegistry row for that agent. The registry stays the source, the
      name is owned by the agent&apos;s IdentityRegistry owner, and nothing in a
      verdict path reads a text record.
    </p>
    <div className="flex flex-wrap gap-4.5">
      {[
        "Grade without a name",
        "Owner = IdentityRegistry ownerOf",
        "Fifteen records, one multicall",
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
          <Dim>claim</Dim>{" "}
          {`setSubnodeRecord(parentNode, labelhash("agent8427"), owner, resolver, ttl)`}
        </div>
        <div>
          {"  "}owner = IdentityRegistry.ownerOf(agentId){"   "}
          <Dim>a foreign owner refuses before a key loads</Dim>
        </div>
        <div>
          <Dim>sync</Dim> one resolver multicall carries all fifteen setText
          calls
        </div>
        <div>
          {"  "}preflight.grade{"  "}
          <span className="font-semibold text-dark-ok">B</span> / score 75{"   "}
          <Dim>read off the record, never recomputed</Dim>
        </div>
        <div>
          {"  "}an absent value is written as &quot;&quot;{"   "}
          <Dim>so a re-sync clears a stale record instead of leaving it</Dim>
        </div>
        <div>
          <Dim>read</Dim> registry.resolver(node) then resolver.text(node, key),
          not getEnsText
        </div>
      </Terminal>
    </div>
    <div className="grid grid-cols-2 gap-7">
      <Card
        title="Claim is optional"
        body="Grading and publishing work with no name. Claim creates agent{id} under the Preflight parent, and publishing a grade never creates a subname on its own."
      />
      <Card
        title="It cannot fail a verdict"
        body="No lookup here sits in or before a gate. Unconfigured resolves to null, a failed resolution is a value rather than a throw, and the fallback is the address."
      />
    </div>
  </Slide>,

  <Slide key="3" tone="light" eyebrow="WHERE IT STANDS" index={3} total={TOTAL}>
    <h2 className="mb-9 font-display text-[68px] leading-[1.07] font-semibold tracking-[-1.5px]">
      On a name.{" "}
      <span className="text-accent">Checked against the registry.</span>
    </h2>
    <div className="mb-9">
      <Terminal>
        <div>
          <Dim>live</Dim> parent{"   "}preflight.basetest.eth{"   "}
          <Dim>Basenames on Base Sepolia, L2Resolver</Dim>
        </div>
        <div>
          <Dim>live</Dim>{" "}
          {"five subnames   agent8427 / 8430 / 8436 / 8437 / 8441   under the parent"}
        </div>
        <div>
          <Dim>checked</Dim> ens verify{"   "}
          <span className="text-dark-ok">exit 0</span> for each, and a
          resolver.text read outside the CLI agrees
        </div>
        <div>
          <Dim>policy</Dim> assertEnsWriteAllowed refuses any chain but Base
          Sepolia
        </div>
      </Terminal>
    </div>
    <div className="mb-9 grid grid-cols-2 gap-7">
      <Card
        title="What verify proved"
        body="Each subname's records were written from that agent's ValidationRegistry row, then read back. Verify exits zero only when every key matches."
      />
      <Card
        title="Why Sepolia"
        body="A mainnet Basename would cost real ETH and change nothing about the trust model. The console reads the same Sepolia registry the writes hit."
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
