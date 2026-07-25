import type { AgentCard, AgentId, GateDecision, GatePolicy } from "@/src/shared";
import {
  DEFAULT_GATE_POLICY,
  FIXTURE_CARD_A,
  FIXTURE_CARD_DRIFTED,
  FIXTURE_CARD_F,
  FIXTURE_DECISION_BELOW_POLICY,
  FIXTURE_DECISION_DRIFT,
  FIXTURE_DECISION_HIRE,
} from "@/src/shared/fixtures";
import { ensNameIfRegistered } from "./ens";
import { toRenderableError, type RenderableError } from "./errors";

/**
 * One line on the hiring floor.
 *
 * `decision` and `error` are mutually exclusive and both can be absent while the
 * gate is still running. Nothing in this type can carry a verdict and an error at
 * once, which is what keeps a failed check from rendering next to a stale HIRE.
 */
export type FloorRow = {
  agentId: AgentId;
  card: AgentCard;
  decision: GateDecision | null;
  error: RenderableError | null;
  pending: boolean;
  /**
   * How long this row's gate call took, in milliseconds. Rendered so the screen
   * shows that the recheck ran now rather than at grading time. A row that reads
   * its fingerprint result off the attestation would sit at zero forever.
   */
  recheckMs: number;
  /**
   * The agent's ENS name, when one is derivable. Cosmetic, and null renders the
   * row exactly as it rendered before names existed. Nothing in the verdict this
   * row carries depends on it.
   */
  ensName: string | null;
};

const CANDIDATES: { card: AgentCard; decision: GateDecision }[] = [
  { card: FIXTURE_CARD_A, decision: FIXTURE_DECISION_HIRE },
  { card: FIXTURE_CARD_F, decision: FIXTURE_DECISION_BELOW_POLICY },
  { card: FIXTURE_CARD_DRIFTED, decision: FIXTURE_DECISION_DRIFT },
];

export const FLOOR_POLICY: GatePolicy = DEFAULT_GATE_POLICY;

/*
  TODO-INTEGRATE: B1 owns vetAgent (01-INTERFACES section 4) and D1 owns the
  registered candidate list. Until both land, each candidate resolves to its frozen
  fixture decision and the shape of the call is already the shape B1 exposes.

  Two properties of this function are not placeholders and must survive the swap:
  the call runs once per row per request, never memoized (02-DECISIONS section 8
  forbids substituting a cached read for the active recheck), and a throw becomes a
  row with an error and no verdict rather than a row with a default verdict.
*/
async function vetCandidate(candidate: {
  card: AgentCard;
  decision: GateDecision;
}): Promise<FloorRow> {
  const startedAt = performance.now();
  // The ENS lookup is cosmetic and must never delay or fail the gate call. It runs
  // beside it, and a miss is null rather than an error on the row.
  const ensNamePromise = ensNameIfRegistered(candidate.card.agentId).catch(
    () => null,
  );
  try {
    const [decision, ensName] = await Promise.all([
      Promise.resolve(candidate.decision),
      ensNamePromise,
    ]);
    return {
      agentId: candidate.card.agentId,
      card: candidate.card,
      ensName,
      decision,
      error: null,
      pending: false,
      recheckMs: Math.round(performance.now() - startedAt),
    };
  } catch (thrown) {
    return {
      agentId: candidate.card.agentId,
      card: candidate.card,
      ensName: await ensNamePromise,
      decision: null,
      error: toRenderableError(thrown),
      pending: false,
      recheckMs: Math.round(performance.now() - startedAt),
    };
  }
}

/**
 * Every candidate, vetted. Candidates are vetted concurrently and one failure never
 * removes a row: a row that vanished on error would read as an agent nobody asked
 * about rather than as an agent the gate could not clear.
 */
export async function loadFloor(): Promise<FloorRow[]> {
  return Promise.all(CANDIDATES.map(vetCandidate));
}
