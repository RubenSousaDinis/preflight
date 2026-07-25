import type { ReactNode } from "react";
import { Card, Dim, Kicker, Slide, Terminal } from "./parts";

/*
  The ENS track deck.

  Written against the repository as it stands. The integration is in
  src/validator/ens and app/lib/ens.ts, and every claim on slides 1 and 2 is
  checkable there. Slide 3 tracks the live pass: subnames and records are on
  preflight.basetest.eth (Base Sepolia Basenames). Writes stay on Sepolia on
  purpose; this project does not spend mainnet ETH on a Basename. The deck
  does not lead the build.
*/

const TOTAL = 3;

export const ENS_SLIDES: ReactNode[] = [
  <Slide key="1" tone="dark" eyebrow="ENS TRACK" index={1} total={TOTAL}>
    <h1 className="mb-9 max-w-[1520px] font-display text-[88px] leading-[1.05] font-semibold tracking-[-2.1px]">
      An optional name an agent&apos;s owner can carry.
    </h1>
    <p className="mb-12 max-w-[1320px] text-[34px] leading-[1.45] text-dark-text">
      Preflight grades by registry id. ENS is discoverability on top: a claimed
      subname under preflight.basetest.eth whose text records mirror the
      ValidationRegistry. The registry stays the source. The name is owned by
      the agent&apos;s IdentityRegistry owner after claim, not required to grade.
    </p>
    <div className="flex flex-wrap gap-4.5">
      {[
        "Grade without ENS",
        "Claim gives owner the subname",
        "Fifteen text records as a mirror",
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
          <Dim>on claim + sync</Dim> fifteen records when the name is writable
        </div>
        <div>
          {"  "}preflight.grade{"          "}A{"      "}
          <Dim>read off the record, never recomputed</Dim>
        </div>
        <div>
          {"  "}preflight.zerog{"          "}
          <span className="text-dark-accent-soft">0g.ai/…</span>
          {"  "}
          <Dim>only when evidence is on 0G</Dim>
        </div>
        <div>
          {"  "}preflight.hedera{"         "}
          <span className="text-dark-accent-soft">hashscan/…</span>
          {"  "}
          <Dim>only when HCS topic is set</Dim>
        </div>
        <div>
          {"  "}url{"                     "}
          <span className="text-dark-accent-soft">/a/{"{"}id{"}"}</span>
          {"  "}
          <Dim>Preflight grade + evidence page</Dim>
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
        title="Claim is optional"
        body="Grading and publishing work without a name. Claim creates agent{id} under the Preflight parent with owner = IdentityRegistry ownerOf. Sync writes mirror texts only when that name already exists and the validator can still write; publish never auto-creates a subname."
      />
      <Card
        title="It cannot fail a verdict"
        body="No lookup here sits in or before a gate. Unconfigured resolves to null and stays quiet, a failed resolution is a value rather than a throw, and the fallback is the address with the registry-backed rendering. The write queue coalesces by agent so a superseded grade never lands after the one that replaced it."
      />
    </div>
  </Slide>,

  <Slide key="3" tone="light" eyebrow="WHERE IT STANDS" index={3} total={TOTAL}>
    <h2 className="mb-9 font-display text-[68px] leading-[1.07] font-semibold tracking-[-1.5px]">
      On a name.{" "}
      <span className="text-accent">Verified against the registry.</span>
    </h2>
    <div className="mb-9">
      <Terminal>
        <div>
          <Dim>live</Dim> parent{"   "}preflight.basetest.eth{"   "}
          <Dim>Basenames on Base Sepolia</Dim>
        </div>
        <div>
          <Dim>live</Dim> agent8427 · 8430 · 8436 · 8437 · 8441
          .preflight.basetest.eth
        </div>
        <div>
          <Dim>checked</Dim> ens verify{"   "}exit 0 for each{"   "}
          <Dim>twelve keys agree with the ValidationRegistry</Dim>
        </div>
        <div>
          <Dim>checked</Dim> independent resolver.text read{"   "}
          grade B on agent8441
        </div>
        <div>
          <Dim>policy</Dim> writes on Base Sepolia only{"   "}
          <Dim>no mainnet ETH spent on a name</Dim>
        </div>
      </Terminal>
    </div>
    <div className="mb-9 grid grid-cols-2 gap-7">
      <Card
        title="What verify proved"
        body="Each subname's text records were written from the ValidationRegistry row for that agent, then read back through the configured Basenames registry and L2Resolver. ens verify exits zero only when every key matches. The description record still names the registry as the source."
      />
      <Card
        title="Why Sepolia"
        body="The grade mirror writes only on Base Sepolia. A mainnet Basename would cost real ETH for no change to the trust model: the ValidationRegistry on Sepolia is still the source, and the name is still a labelled copy. The send path refuses any other ENS_CHAIN_ID."
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
