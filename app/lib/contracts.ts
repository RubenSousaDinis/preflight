/*
  TODO-INTEGRATE: view-side mirror of 01-INTERFACES.md section 0.

  Lane 1 owns src/shared/ and freezes the real shapes there in its first hour. This
  file exists so the surface can be built and type checked before that lands, and it
  is replaced by imports from src/shared once Lane 1 merges. Keep it a strict subset
  of the interfaces file: never invent a shape the contract does not define.
*/

export type Grade = "A" | "B" | "C" | "D" | "F";
export type Score = 100 | 75 | 50 | 25 | 0;
export type Hex = `0x${string}`;

/** txGuard, the contract boundary. */
export type Verdict = "ALLOW" | "BLOCK";

/** vetAgent, the agent boundary. */
export type GateVerdict = "HIRE" | "REFUSE";

/**
 * Every typed failure carries a code, a human reason suitable for rendering, and
 * whether it is retryable. The UI renders `reason` verbatim: a gate error is the
 * most specific sentence the product ever produces, and collapsing it into
 * "something went wrong" throws that away.
 */
export type RenderableError = {
  code: string;
  reason: string;
  retryable: boolean;
};
