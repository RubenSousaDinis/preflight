import type { ReactNode } from "react";
import { Card, Dim, Kicker, Slide, Terminal } from "./parts";

/*
  The 0G track deck.

  Two integrations, both in the repo: 0G Compute runs the advisory source scan
  (src/gates/tx/scan/routes.ts, stamped in scan/llm-scan.ts) and 0G Storage pins
  the evidence bundles (src/validator/pin-evidence.ts). The values on slides 2
  and 3 are the ones recorded in src/gates/tx/VERIFICATION.md and
  src/validator/VERIFICATION.md.

  One boundary rule is what keeps both outside the trust path, and it is enforced
  in code twice: once where the flag is built, once where the verdict is composed.
*/

const TOTAL = 3;

export const ZEROG_SLIDES: ReactNode[] = [
  <Slide key="1" tone="dark" eyebrow="0G TRACK" index={1} total={TOTAL}>
    <h1 className="mb-9 max-w-[1520px] font-display text-[92px] leading-[1.05] font-semibold tracking-[-2.2px]">
      0G runs the reading and holds the evidence.
    </h1>
    <p className="mb-12 max-w-[1340px] text-[34px] leading-[1.45] text-dark-text">
      The advisory source scan runs its inference on 0G Compute. The evidence
      bundle behind every published grade is stored on 0G Storage and addressed
      by its merkle root. Neither one can move a verdict, which is what makes
      running them off our own machines cost nothing in trust.
    </p>
    <div className="flex flex-wrap gap-4.5">
      {[
        "0G Compute: OpenAI-shaped router",
        "0G Storage: merkle-rooted bundles",
        "Neither in the trust path",
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
        Beside the fork and the four checks, an advisory scan reads a contract&apos;s
        verified source and proposes candidate traps in readable language. Its
        inference is a plain HTTP call to the 0G Compute router, which speaks the
        OpenAI chat-completions shape, so no vendor SDK sits in the path.
      </p>
      <p className="border-l-4 border-accent py-2 pl-[30px] text-[27px] leading-[1.5]">
        Severity and provenance are stamped in one function, and the verdict
        composer rejects a blocking flag from this route a second time. A
        jailbroken all-clear cannot suppress a deterministic flag, and a
        jailbroken alarm cannot manufacture one.
      </p>
    </div>
    <Terminal>
      <div>
        POST router-api.0g.ai/v1/chat/completions{"   "}
        <Dim>model 0gm-1.0-35b-a3b</Dim>
      </div>
      <div>
        {"  "}source passed as data inside {"<"}contract_source{">"}, never as
        instruction
      </div>
      <div>
        {"  "}closed set of four ids{"   "}
        <Dim>a fifth is discarded where a reader can see it, not renamed</Dim>
      </div>
      <div>
        one stamp, one place{"   "}severity{" "}
        <span className="text-dark-warn">advisory</span>, confirmedBy{" "}
        <span className="text-dark-warn">llm-scan</span>
      </div>
      <div>
        {"  "}the injection fixture argues its own case, the scan reported it,
        and the call still{" "}
        <span className="font-semibold text-dark-bad">BLOCKED</span>
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
        title="Uploaded from memory, hashed once"
        body="The bytes stored are the bytes that were canonicalized, with no re-serialization between them. The merkle root is computed before the upload, so the same bundle sent twice is recognized as already stored rather than read as a failure."
      />
      <Card
        title="The URI is not load-bearing"
        body="The gate checks the hash, not the host. A data URI is the pre-authorized degrade: it moves where the bundle lives without touching the reproducibility claim, and it is labelled when it runs. That is what content addressing buys."
      />
    </div>
    <Terminal>
      <div>
        agent 8427{"   "}19757 bytes at root 0x75564b19…b0c2{"   "}
        <Dim>chain 16602</Dim>
      </div>
      <div>
        {"  "}served by the 0G indexer at /file?root=…{"   "}
        <Dim>fetched by a third party over HTTP</Dim>
      </div>
      <div>
        vetAgent: fetch the bundle{" "}
        <span className="text-dark-ok">then rehash it</span>, and compare against
        the record
      </div>
      <div>
        {"  "}hash does not match{" "}
        <span className="font-semibold text-dark-bad">REFUSE</span>
        {"   "}
        <Dim>never a fallback to the onchain score</Dim>
      </div>
      <div>
        {"  "}
        <Dim>
          seen live on the smoke record: the gate named the two values that
          disagree
        </Dim>
      </div>
    </Terminal>
  </Slide>,
];
