import type { ReactNode } from "react";
import { Card, Dim, Kicker, Slide, Terminal } from "./parts";

/*
  The 0G track deck.

  Two integrations, both in the repo: 0G Compute runs the advisory source scan
  (src/gates/tx/scan/routes.ts), and 0G Storage pins the evidence bundles
  (src/validator/pin-evidence.ts). One boundary rule is what keeps both
  outside the trust path.
*/

const TOTAL = 3;

export const ZEROG_SLIDES: ReactNode[] = [
  <Slide key="1" tone="dark" eyebrow="0G TRACK" index={1} total={TOTAL}>
    <h1 className="mb-9 max-w-[1520px] font-display text-[92px] leading-[1.05] font-semibold tracking-[-2.2px]">
      0G runs the reading and holds the evidence.
    </h1>
    <p className="mb-12 max-w-[1300px] text-[34px] leading-[1.45] text-dark-text">
      Two integrations, and one rule that makes both of them fit. The advisory
      source scan runs on 0G Compute. The evidence bundle behind every grade is
      pinned to 0G Storage. Neither sits in the path that decides a verdict, and
      that is by design rather than by accident.
    </p>
    <div className="flex flex-wrap gap-4.5">
      {[
        "0G Compute: the advisory scan",
        "0G Storage: evidence bundles",
        "Content addressed",
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

  <Slide key="2" tone="light" eyebrow="0G COMPUTE" index={2} total={TOTAL}>
    <h2 className="mb-9 font-display text-[68px] leading-[1.07] font-semibold tracking-[-1.5px]">
      The scan proposes.{" "}
      <span className="text-accent">The simulator decides.</span>
    </h2>
    <div className="mb-9 grid grid-cols-[1.05fr_0.95fr] items-start gap-12">
      <p className="text-[30px] leading-[1.55] text-muted">
        Alongside the fork and the four checks, an advisory scan reads a
        contract&apos;s source and proposes candidate traps in readable language.
        Its inference runs on 0G Compute as the primary route, with a fallback if
        the route or its findings are unusable.
      </p>
      <p className="border-l-4 border-accent py-2 pl-[30px] text-[27px] leading-[1.5]">
        An advisory finding can never carry a blocking severity. Only a
        simulator-confirmed finding moves a verdict, so a jailbroken all-clear
        cannot suppress a deterministic flag.
      </p>
    </div>
    <Terminal>
      <div>
        <Dim>flag</Dim> bad-callee{"   "}
        <Dim>severity</Dim> advisory{"   "}
        <Dim>confirmedBy</Dim> llm-scan
      </div>
      <div>
        {"  "}rendered as advisory on its face, beside the blocking flags
      </div>
      <div>
        {"  "}verdict unchanged{"   "}
        <span className="text-dark-ok">by construction</span>
      </div>
    </Terminal>
    <div className="mt-9">
      <Kicker>
        A check that cannot move a verdict{" "}
        <span className="text-accent">
          can run anywhere without entering the trust path.
        </span>
      </Kicker>
    </div>
  </Slide>,

  <Slide key="3" tone="light" eyebrow="0G STORAGE" index={3} total={TOTAL}>
    <h2 className="mb-9 font-display text-[68px] leading-[1.07] font-semibold tracking-[-1.5px]">
      The evidence has to outlive the run.
    </h2>
    <div className="mb-9 grid grid-cols-2 gap-7">
      <Card
        title="Pinned, then hashed into the record"
        body="A grade is only falsifiable if the evidence behind it can be fetched. The bundle goes to 0G Storage, and the validation record onchain carries the hash of it, so a reader can fetch, hash, and compare rather than take the grade on faith."
      />
      <Card
        title="The URI is not load-bearing"
        body="The gate checks the hash, not the host. A data URI is the pre-authorized degrade, and it changes where the bundle lives without touching the reproducibility claim. That is what content addressing buys."
      />
    </div>
    <Terminal>
      <div>
        vetAgent: fetch the bundle{" "}
        <span className="text-dark-ok">then hash it</span>
      </div>
      <div>
        {"  "}hash does not match the record{" "}
        <span className="font-semibold text-dark-bad">REFUSE</span>
      </div>
      <div>
        {"  "}
        <Dim>
          verified live: the gate names the two values that disagree rather than
          falling back to the onchain score
        </Dim>
      </div>
    </Terminal>
  </Slide>,
];
