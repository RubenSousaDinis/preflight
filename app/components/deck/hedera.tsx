import type { ReactNode } from "react";
import { Card, Dim, Kicker, Slide, Terminal } from "./parts";

/*
  The Hedera track deck.

  Two integrations, both in the repo: the payment rail behind beat 1's `paid`
  event (src/demo/payment-rail.ts) and the HCS mirror of the receipt chain
  (src/receipts/hcs-mirror.ts). Values on slides 2 and 3 are the ones recorded in
  src/demo/VERIFICATION.md and src/receipts/VERIFICATION.md, so every number here
  came off a run rather than off a plan.

  Slide 2 states which of the three rails settles on stage. The x402 leg is the
  signed client half and nothing in this repo issues a 402, so the deck says that
  instead of letting the package name imply an end-to-end flow.
*/

const TOTAL = 3;
const TOPIC = "0.0.9736592";

export const HEDERA_SLIDES: ReactNode[] = [
  <Slide key="1" tone="dark" eyebrow="HEDERA TRACK" index={1} total={TOTAL}>
    <h1 className="mb-9 max-w-[1500px] font-display text-[92px] leading-[1.05] font-semibold tracking-[-2.2px]">
      Hedera settles the money. It never decides the verdict.
    </h1>
    <p className="mb-12 max-w-[1340px] text-[34px] leading-[1.45] text-dark-text">
      Preflight gates what an agent is about to hire or sign. Hedera carries the
      payment that gate authorizes, and carries a public mirror of the receipt
      chain the gate produces. Two integrations, one boundary rule: neither can
      reach into a verdict, and both fail without stopping a gate.
    </p>
    <div className="flex flex-wrap gap-4.5">
      {[
        "HBAR settlement, ECDSA payer",
        `HCS topic ${TOPIC}`,
        "Agent Kit audit-trail hook",
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
      <span className="text-accent">The rail settles it.</span>
    </h2>
    <div className="mb-9">
      <Terminal>
        <div>
          interface PaymentRail {"{"} pay({"{"}to, amount, resource{"}"}) {"}"}
          {"   "}
          <Dim>three implementations, one flag</Dim>
        </div>
        <div>
          {"  "}stub{"             "}
          <Dim>nothing settles, and every event says so</Dim>
        </div>
        <div>
          {"  "}hedera-transfer{"  "}TransferTransaction in tinybars, receipt
          polled to consensus
        </div>
        <div>
          {"  "}hedera-x402{"      "}@x402/hedera ExactHederaScheme, ECDSA
          signer, facilitator
        </div>
        <div>
          settled on stage{"   "}
          <span className="text-dark-accent-soft">1 HBAR</span> to 0.0.9737723
          {"   "}tx 0.0.9695674@1784942480.789267915
        </div>
      </Terminal>
    </div>
    <div className="grid grid-cols-2 gap-7">
      <Card
        title="Gated, not incidental"
        body="The payment happens only after vetAgent clears the counterparty: the letter at or above the floor, evidence that rehashes to the record, and a live tool surface matching the graded one. It never pays for a grade."
      />
      <Card
        title="The rail is named in the event"
        body="Every paid event carries the rail that settled it, so a stub can never read as a settlement. demo:hiring settles real HBAR; the browser run uses the labelled stub. The x402 leg is the signed client half, waiting on a facilitator."
      />
    </div>
  </Slide>,

  <Slide key="3" tone="light" eyebrow="THE RECEIPT MIRROR" index={3} total={TOTAL}>
    <h2 className="mb-9 font-display text-[68px] leading-[1.07] font-semibold tracking-[-1.5px]">
      Every decision, mirrored to consensus.
    </h2>
    <p className="mb-9 max-w-[1560px] text-[30px] leading-[1.55] text-muted">
      Each gate decision emits an Ed25519 signed receipt carrying the hash of the
      one before it. That chain is mirrored to an HCS topic, so the ordering of
      an audit trail is published where nobody involved controls it.
    </p>
    <div className="mb-9">
      <Terminal>
        <div>
          topic {TOPIC}
          {"   "}
          <Dim>created once with TopicCreateTransaction</Dim>
        </div>
        <div>
          one message per receipt{"   "}
          {"{"}receiptId, receiptHash, index{"}"}
          {"   "}
          <Dim>and nothing else</Dim>
        </div>
        <div>
          {"  "}
          <Dim>
            written through the Agent Kit HcsAuditTrailHook with the payer client
          </Dim>
        </div>
        <div>
          submit() queues and returns{"   "}
          <Dim>5 receipts emitted in 4 ms, mirrored 0, pending 5</Dim>
        </div>
        <div>
          {"  "}a failed submit is retried behind the caller,{" "}
          <span className="text-dark-bad">never raised into a gate</span>
        </div>
        <div>
          read back from the public mirror node REST API, not from what we
          believe we sent
        </div>
        <div>
          {"  "}sequence_number 5, and the newest message ={" "}
          <span className="text-dark-ok">local receipt-0005</span>
        </div>
      </Terminal>
    </div>
    <Kicker>
      A mirror, never a source.{" "}
      <span className="text-accent">
        Trusting the topic over the signed chain would invert the order.
      </span>
    </Kicker>
  </Slide>,
];
