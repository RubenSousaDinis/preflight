/**
 * The stage deck, as data.
 *
 * Every claim on a slide is one the console can be pointed at directly, because a
 * deck that says more than the build does is the fastest way to lose a room. The
 * limits slide is not a disclaimer at the end: it is the slide that makes the
 * other five worth believing.
 */
export type Slide = {
  eyebrow: string;
  title: string;
  lines: string[];
  /** Rendered in the mono face under the lines. Values, not prose. */
  fields?: { label: string; value: string }[];
};

export const SLIDES: Slide[] = [
  {
    eyebrow: "ETHGlobal Lisbon 2026",
    title: "An agent about to act, checked before it acts.",
    lines: [
      "An agent asks to hire another agent, or to sign a transaction. Preflight answers first, and refuses when the evidence does not hold.",
    ],
  },
  {
    eyebrow: "the problem",
    title: "Two decisions nobody checks.",
    lines: [
      "An agent picks another agent off a registry and trusts whatever it returns. Then it signs a transaction against a contract it has never read.",
      "Both decisions happen in milliseconds, without a gate, and both are irreversible once they land.",
    ],
  },
  {
    eyebrow: "the agent boundary",
    title: "Drift outranks the letter.",
    lines: [
      "Read the attested grade. Connect to the live target. Re-enumerate every page of its tool surface and compare the fingerprint to the one that was graded.",
      "An agent graded A whose live surface has moved is refused. That is the rug pull a grade on its own cannot see.",
    ],
    fields: [
      { label: "on any error path", value: "REFUSE" },
      { label: "policy", value: "minimum grade B" },
    ],
  },
  {
    eyebrow: "the transaction boundary",
    title: "Fork the chain, replay the exact call.",
    lines: [
      "The pending transaction runs against a fork at the live block, with the exact calldata, and four checks run over what it did.",
      "Drainer approval. Honeypot. Bad callee. Owner or upgrade backdoor. The set is closed, and a check that cannot run blocks rather than passing.",
    ],
    fields: [
      { label: "on any error path", value: "BLOCK" },
      { label: "the set", value: "four checks, no fifth" },
    ],
  },
  {
    eyebrow: "the evidence",
    title: "Five values, and you can re-derive the verdict.",
    lines: [
      "Every transaction verdict records the block, the sender, the callee, the hash of the calldata and the value. Run them again against the same chain and the check returns the same answer, or this one is falsified.",
      "Every decision emits an Ed25519 signed receipt carrying the hash of the one before it.",
    ],
    fields: [
      { label: "reproducible from", value: "block, from, to, calldataHash, value" },
      { label: "receipts", value: "ed25519, hash chained" },
    ],
  },
  {
    eyebrow: "disclosed limits",
    title: "What this does not do.",
    lines: [
      "A target that detects the test context and behaves during the test can still act differently afterwards. The agent that turns hostile in this demo is one the gate graded A and hired.",
      "A transaction verdict is reproducible for a given block and state. It is not a prediction of what the transaction does once it lands.",
      "Grades here are self-run and self-minted. Reproducible means a false grade can be falsified by re-running the open engine, not that anyone has re-run it independently.",
    ],
  },
  {
    eyebrow: "live",
    title: "The console.",
    lines: [
      "Every claim on the slides above is on one screen: the hiring floor with its refusals, the run transcript, the four checks against staged calls, and a slot for an address nobody here wrote.",
    ],
    fields: [{ label: "route", value: "/console" }],
  },
];
