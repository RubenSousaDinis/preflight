import Link from "next/link";
import { Band, Container, SectionMark } from "../components/container";
import { FLAG_NAMES, FLAG_ORDER } from "../lib/flags";
import { loadFloor } from "../lib/floor";
import { grade as gradeTokens, gradeColor } from "../lib/tokens";

/*
  The product page, as the design sets it: full bleed bands closed by hairlines, a
  1080px column, and numbered sections.

  Two departures from the design, both deliberate. There is no pricing section:
  02-DECISIONS section 8 puts metering after the event and forbids the
  illustrative prices reading as live pricing, so the sections renumber around it.
  And the hero's specimen is the real drift row this build produces rather than a
  written transcript, because we have one and it is the strongest thing on the page.
*/

const SCALE: { grade: keyof typeof gradeTokens; letter: string; score: number }[] =
  [
    { grade: "gradeA", letter: "A", score: 100 },
    { grade: "gradeB", letter: "B", score: 75 },
    { grade: "gradeC", letter: "C", score: 50 },
    { grade: "gradeD", letter: "D", score: 25 },
    { grade: "gradeF", letter: "F", score: 0 },
  ];

const AGENT_THREATS = ["hijack", "exfiltrate", "rug pull"];

const PIPELINE = [
  { label: "AgentCard / pending tx", strong: true },
  { label: "run or simulate in a sandbox", strong: false },
  { label: "grade A to F", strong: false },
  { label: "validation record on Base Sepolia", strong: true },
];

const METHOD = [
  {
    title: "Behavioral",
    body: "Not a README review. The harness exercises the target the way an agent would and records what it actually does: egress, injection attempts, tool-surface drift, the effect of the exact calldata.",
  },
  {
    title: "Reproducible",
    body: "Same input, same verdict. Every grade carries the evidence bundle and hash to re-derive it, so a false grade is falsifiable by re-running the open engine. Nothing is taken on faith.",
  },
  {
    title: "Attested",
    body: "Verdicts post to the ERC-8004 Validation Registry on Base Sepolia, signed by the validator. The gates read the chain directly, so no offchain service sits in the trust path.",
  },
];

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[999px] border border-rule px-3 py-[5px] font-data text-[12.5px] text-grade-f">
      {children}
    </span>
  );
}

function Signature({ call }: { call: string }) {
  return (
    <div className="flex items-center justify-between rounded-control border border-accent bg-accent/5 px-3.5 py-2.5">
      <span className="font-data text-[14px] font-semibold">{call}</span>
      <span className="font-data text-[10.5px] tracking-[0.1em] text-accent">
        FAIL CLOSED
      </span>
    </div>
  );
}

function GateCard({
  boundary,
  question,
  threats,
  call,
  body,
  allow,
  deny,
}: {
  boundary: string;
  question: string;
  threats: string[];
  call: string;
  body: string;
  allow: string;
  deny: string;
}) {
  return (
    <div className="flex flex-col gap-3.5 rounded-card border border-rule bg-panel px-7 py-6">
      <p className="font-data text-[11.5px] tracking-[0.12em] text-meta">
        {boundary}
      </p>
      <p className="font-display text-[22px] font-semibold">{question}</p>
      <div className="flex flex-wrap gap-2">
        {threats.map((threat) => (
          <Pill key={threat}>{threat}</Pill>
        ))}
      </div>
      <Signature call={call} />
      <p className="text-[14.5px] text-muted">{body}</p>
      <p className="font-data text-[14px]">
        <span className="text-grade-a">{allow}</span>
        <span className="text-meta"> / </span>
        <span className="font-semibold text-grade-f">{deny}</span>
      </p>
    </div>
  );
}

export default async function ProductPage() {
  const rows = await loadFloor();
  // The row a judge probes: graded A, refused anyway. Real, from the same loader
  // the console uses, so the page and the console cannot disagree.
  const row = rows.find((entry) => entry.decision?.fingerprintMatch === false);

  return (
    <>
      <Band id="top">
        <Container className="grid items-center gap-14 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-[72px]">
          <div>
            <p className="mb-4 font-data text-[12px] tracking-[0.16em] uppercase text-accent">
              Two fail-closed gates / one check
            </p>
            <h1 className="font-display text-[38px] leading-[1.06] font-semibold tracking-[-1.2px] sm:text-[54px]">
              Before it spends or signs, your agent checks what it is about to
              trust.
            </h1>
            <p className="mt-5 max-w-[520px] text-[18px] leading-[1.65] text-muted">
              A tool it hires or a transaction it signs: either one can drain the
              wallet. preflight runs the agent or simulates the call, watches what
              it actually does, grades it A to F, and gates the action on the
              result.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3.5">
              <Link
                href="/console"
                className="rounded-control bg-ink px-5 py-2.5 text-[15px] font-medium text-paper no-underline"
              >
                Open the console
              </Link>
              <span className="rounded-control border border-rule bg-subtle px-3.5 py-2.5 font-data text-[13px] text-muted">
                preflight_agent / preflight_tx over MCP
              </span>
            </div>
            <p className="mt-6 font-data text-[13.5px]">
              const go = await preflight(agentId, pendingTx){" "}
              <span className="text-meta">{"// fail closed"}</span>
            </p>
          </div>

          {row?.decision ? (
            <div className="rounded-card border border-rule bg-panel shadow-[0_1px_0_var(--pf-rule)]">
              <div className="flex justify-between border-b border-rule px-4 py-2.5 font-data text-[11px] tracking-[0.1em] text-meta">
                <span>GATE TRANSCRIPT</span>
                <span>AGENT BOUNDARY</span>
              </div>
              <dl className="px-5 py-4.5 font-data text-[12.5px] leading-[1.85]">
                <div className="flex gap-3">
                  <dt className="w-[7.5rem] shrink-0 text-meta">agent</dt>
                  <dd className="min-w-0 break-all">{row.agentId}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-[7.5rem] shrink-0 text-meta">attested</dt>
                  <dd>
                    <span
                      className="font-semibold"
                      style={{ color: gradeColor(row.decision.grade) }}
                    >
                      {row.decision.grade}
                    </span>{" "}
                    <span className="text-meta">{row.decision.score}</span>
                  </dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-[7.5rem] shrink-0 text-meta">live recheck</dt>
                  <dd className="text-grade-f">moved since grading</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-[7.5rem] shrink-0 text-meta">verdict</dt>
                  <dd className="font-semibold text-grade-f">
                    {row.decision.verdict}
                  </dd>
                </div>
              </dl>
              <p className="border-t border-rule px-5 py-3.5 text-[14px] leading-snug text-muted">
                {row.decision.reason}. The letter was earned; the surface behind
                it moved afterwards. Drift outranks the letter, which is the case
                a stored score cannot see.
              </p>
            </div>
          ) : null}
        </Container>
      </Band>

      <Band className="bg-band">
        <Container className="py-[30px]">
          <p className="max-w-[840px] font-display text-[20px] leading-[1.4] tracking-[-0.2px] sm:text-[24px]">
            x402 moves the money. Nothing in the stack checks who you are paying.{" "}
            <span className="text-accent">That is the layer this is.</span>
          </p>
        </Container>
      </Band>

      <Band id="gates">
        <Container className="py-16">
          <SectionMark>§ 01 / THE TWO GATES</SectionMark>
          <h2 className="mt-3 font-display text-[28px] font-semibold tracking-[-0.6px] sm:text-[34px]">
            Money leaves an agent in exactly two ways.
          </h2>
          <p className="mt-2.5 mb-9 max-w-[640px] text-muted">
            It pays a counterparty it hired, or it signs a transaction. Both
            boundaries get a gate, and both gates fail closed: no verdict, no
            action.
          </p>
          <div className="grid gap-5 md:grid-cols-2">
            <GateCard
              boundary="AGENT BOUNDARY"
              question="Who do I hire and pay?"
              threats={AGENT_THREATS}
              call="vetAgent(agentId)"
              body="Reads the onchain grade from the ERC-8004 Validation Registry, verifies the evidence hash, then rechecks the live tool surface against the graded fingerprint. A rug pull after grading is a mismatch, and a mismatch is a refusal."
              allow="hire"
              deny="REFUSE"
            />
            <GateCard
              boundary="CONTRACT BOUNDARY"
              question="What do I sign?"
              threats={FLAG_ORDER.map((id) => FLAG_NAMES[id].toLowerCase())}
              call="txGuard(pendingTx)"
              body="Forks the chain at the live block and simulates the exact pending call: this calldata, this value, this wallet. A static red-flag pass runs beside it. Any of the four checks blocks the signature before value leaves the wallet."
              allow="sign"
              deny="BLOCK"
            />
          </div>
          <p className="mt-4.5 font-data text-[12.5px] text-meta">
            Runs as an MCP server, so any MCP-capable agent can call either gate
            without an integration: preflight_agent / preflight_tx
          </p>
        </Container>
      </Band>

      <Band id="method">
        <Container className="py-16">
          <SectionMark>§ 02 / HOW IT WORKS</SectionMark>
          <h2 className="mt-3 font-display text-[28px] font-semibold tracking-[-0.6px] sm:text-[34px]">
            Observe behavior before trust.
          </h2>
          <p className="mt-2.5 mb-8 max-w-[680px] text-muted">
            Tools are run. Skills are loaded. Contracts are simulated. One
            method, one grade format, one registry, across everything an agent
            touches.
          </p>

          <div className="mb-9 flex flex-wrap items-center gap-3">
            {PIPELINE.map((step, index) => (
              <span key={step.label} className="flex items-center gap-3">
                <span
                  className={`rounded-control border px-4 py-2.5 font-data text-[13px] ${
                    step.strong
                      ? "border-accent bg-accent/5"
                      : "border-rule bg-panel"
                  }`}
                >
                  {step.label}
                </span>
                {index < PIPELINE.length - 1 ? (
                  <span aria-hidden="true" className="font-data text-meta">
                    &rarr;
                  </span>
                ) : null}
              </span>
            ))}
          </div>

          <div className="mb-8 grid gap-5 md:grid-cols-3">
            {METHOD.map((item) => (
              <div key={item.title} className="border-t-2 border-ink pt-3.5">
                <p className="mb-1.5 font-semibold">{item.title}</p>
                <p className="text-[14.5px] text-muted">{item.body}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="mr-1 font-data text-[12px] tracking-[0.1em] text-meta">
              THE GRADE SCALE
            </span>
            {SCALE.map((step) => (
              <span
                key={step.letter}
                className="rounded-control border px-2.5 py-[3px] font-data text-[13.5px] font-semibold"
                style={{
                  color: gradeTokens[step.grade],
                  borderColor: `${gradeTokens[step.grade]}4d`,
                  backgroundColor: `${gradeTokens[step.grade]}1a`,
                }}
              >
                {step.letter} / {step.score}
              </span>
            ))}
          </div>
        </Container>
      </Band>

      <Band id="receipts">
        <Container className="grid items-start gap-12 py-16 md:grid-cols-2">
          <div>
            <SectionMark>§ 03 / RECEIPTS</SectionMark>
            <h2 className="mt-3 font-display text-[28px] font-semibold tracking-[-0.6px] sm:text-[34px]">
              Proof the check ran.
            </h2>
            <p className="mt-2.5 mb-4.5 text-muted">
              Every gate decision emits an Ed25519 signed, hash-chained receipt
              in the shape of the IETF Agent Audit Trail draft. The agent, its
              principal, or an auditor keeps it: evidence the check was made, for
              their own audit trail.
            </p>
            <p className="mb-4.5 text-muted">
              A transaction verdict is reproducible from the block, the sender,
              the callee, the calldata hash and the value. Run those five again
              and the check returns the same verdict, or this one is falsified.
            </p>
            <p className="font-data text-[13px]">
              <Link href="/console#audit-trail">
                See the chain on the console
              </Link>
            </p>
          </div>
          <div className="rounded-card border border-rule bg-panel">
            <div className="flex justify-between border-b border-rule px-4 py-2.5 font-data text-[11px] tracking-[0.1em] text-meta">
              <span>WHAT A RECEIPT CARRIES</span>
              <span>ED25519 / HASH-CHAINED</span>
            </div>
            <dl className="px-5 py-4 font-data text-[12.5px] leading-[1.9]">
              {[
                ["verdict", "the decision, as the gate returned it"],
                ["flags", "every check that fired, and where it came from"],
                ["reproducibleFrom", "block, from, to, calldataHash, value"],
                ["responseHash", "keccak256 of the canonical verdict"],
                ["evidenceURI", "the bundle the grade was read from"],
                ["methodologyVersion", "read from the installed engine"],
                ["prevHash", "the receipt before this one"],
                ["sig", "ed25519 over the receipt hash"],
              ].map(([field, note]) => (
                <div key={field} className="flex flex-wrap gap-x-3">
                  <dt className="min-w-[9.5rem]">{field}</dt>
                  <dd className="text-meta">{note}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </Band>

      <Band>
        <Container className="py-16">
          <SectionMark>§ 04 / THE ENGINE</SectionMark>
          <h2 className="mt-3 font-display text-[28px] font-semibold tracking-[-0.6px] sm:text-[34px]">
            Built on an open engine.
          </h2>
          <p className="mt-2.5 mb-8 max-w-[720px] text-muted">
            The behavioral grading harness is open source and consumed from npm
            the way any third party could. Every grade carries the evidence to
            re-derive it. Anyone can re-run it, which is the point.
          </p>
          <div className="grid overflow-hidden rounded-card border border-rule bg-panel sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["npm", "the engine, consumed as a library", false],
              ["Apache-2.0", "open source, anyone can re-run it", false],
              ["Base Sepolia", "records anyone can read onchain", true],
              ["A to F", "one grade format across tools, skills, contracts", true],
            ].map(([value, note, accent], index) => (
              <div
                key={String(value)}
                className={`px-5 py-5 ${index < 3 ? "border-b border-rule lg:border-r lg:border-b-0" : ""}`}
              >
                <p
                  className={`font-data text-[22px] font-semibold ${accent ? "text-accent" : ""}`}
                >
                  {value}
                </p>
                <p className="mt-1 text-[13px] text-muted">{note}</p>
              </div>
            ))}
          </div>
        </Container>
      </Band>
    </>
  );
}
