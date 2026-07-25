import type { ReactNode } from "react";
import { Card, Dim, Kicker, Slide, Terminal } from "./parts";

/*
  The Hedera track deck.

  Two integrations, both in the repo: the x402 payment rail for beat 1, and the
  HCS mirror of the receipt chain. Every claim here is checkable in
  src/demo/payment-rail.ts and src/receipts/hcs-mirror.ts.
*/

const TOTAL = 3;
const TOPIC = "0.0.9736592";

export const HEDERA_SLIDES: ReactNode[] = [
  <Slide key="1" tone="dark" eyebrow="HEDERA TRACK" index={1} total={TOTAL}>
    <h1 className="mb-9 max-w-[1500px] font-display text-[92px] leading-[1.05] font-semibold tracking-[-2.2px]">
      Hedera settles the money. It never decides the verdict.
    </h1>
    <p className="mb-12 max-w-[1300px] text-[34px] leading-[1.45] text-dark-text">
      Preflight gates what an agent is about to hire or sign. Hedera carries the
      payment the gate authorizes, and carries a public mirror of the receipt
      chain the gate produces. That split is deliberate, and it is the whole
      integration.
    </p>
    <div className="flex flex-wrap gap-4.5">
      {[
        "x402 on Hedera Testnet",
        "HBAR, ECDSA payer",
        `HCS topic ${TOPIC}`,
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

  <Slide key="2" tone="light" eyebrow="THE PAYMENT RAIL" index={2} total={TOTAL}>
    <h2 className="mb-9 font-display text-[68px] leading-[1.07] font-semibold tracking-[-1.5px]">
      The gate clears the hire.{" "}
      <span className="text-accent">x402 pays for it.</span>
    </h2>
    <div className="mb-9">
      <Terminal>
        <div>
          <Dim>@x402/hedera</Dim> ExactHederaScheme on{" "}
          <span className="text-dark-accent-soft">hedera:testnet</span>
        </div>
        <div>
          {"  "}ECDSA signer, not ED25519{"     "}
          <Dim>the scheme requires it</Dim>
        </div>
        <div>
          {"  "}a native TransferTransaction co-signed by a facilitator
        </div>
        <div>
          {"  "}amounts in tinybars{"          "}
          <Dim>1 HBAR = 100,000,000</Dim>
        </div>
        <div>
          a 200 with no settlement header{" "}
          <span className="font-semibold text-dark-bad">throws</span>
        </div>
        <div>
          {"  "}
          <Dim>
            otherwise a payment gate quietly becomes an advisory one
          </Dim>
        </div>
      </Terminal>
    </div>
    <div className="grid grid-cols-2 gap-7">
      <Card
        title="Gated, not incidental"
        body="The payment only happens after vetAgent clears the counterparty: grade at or above policy, evidence hashing to the record, and the live tool surface matching the surface that was graded. x402 pays the agent it hired. It never pays for a grade."
      />
      <Card
        title="A degrade that stays true"
        body="If the x402 leg is cut for time, a direct HBAR transfer through the SDK keeps the claim honest rather than dropping it. Both rails live behind one PaymentRail interface, and the harness takes whichever the operator passes."
      />
    </div>
  </Slide>,

  <Slide key="3" tone="light" eyebrow="THE RECEIPT MIRROR" index={3} total={TOTAL}>
    <h2 className="mb-9 font-display text-[68px] leading-[1.07] font-semibold tracking-[-1.5px]">
      Every decision, mirrored to consensus.
    </h2>
    <div className="mb-9 grid grid-cols-[1.05fr_0.95fr] items-start gap-12">
      <p className="text-[30px] leading-[1.55] text-muted">
        Each gate decision emits an Ed25519 signed receipt carrying the hash of
        the one before it. That chain is mirrored to an HCS topic, so the ordering
        of an audit trail is published where nobody involved controls it. The
        console reads the count back from a public mirror node rather than from
        what the surface believes it sent.
      </p>
      <Terminal>
        <div>
          <Dim>topic</Dim> {TOPIC}
        </div>
        <div>
          <Dim>read back from</Dim> testnet.mirrornode
        </div>
        <div>
          <Dim>rendered on</Dim> /console?view=receipts
        </div>
        <div>
          <Dim>linked to</Dim> hashscan.io/testnet
        </div>
      </Terminal>
    </div>
    <Kicker>
      A mirror, never a source.{" "}
      <span className="text-accent">
        A reader that trusted the topic over the signed chain would have the trust
        order backwards.
      </span>
    </Kicker>
  </Slide>,
];
