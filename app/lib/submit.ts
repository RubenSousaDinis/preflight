"use server";

import { gradeAgent } from "@/src/validator/grade-agent";
import { resolveAgent } from "@/src/validator/resolve-agent";
import type { Grade } from "@/src/shared";
import { toRenderableError, type RenderableError } from "./errors";

export type SubmitResult =
  | { kind: "invalid"; message: string }
  | { kind: "error"; ref: string; error: RenderableError }
  | {
      kind: "graded";
      ref: string;
      grade: Grade;
      score: number;
      methodologyVersion: string;
      endpointsGraded: number;
      /** One line off the bundle. Empty is legitimate and never reads as clean. */
      finding: string | null;
    };

/** Long enough for a registry id, short enough that nothing pathological lands. */
const MAX_REF_LENGTH = 100;
const ALLOWED_REF = /^[A-Za-z0-9@/:._\-+~?=&#%]+$/;

/*
  Beat 3's submission: resolve the reference, then grade what it resolved to.

  It grades registered agents only, and that is deliberate rather than a gap left
  open. gradeAgent takes an AgentCard, and a card is what the registry returned:
  its tokenURI and its raw document are hashed into the evidence bundle. Building
  a card here for an endpoint nobody registered would put values this surface
  invented into evidence that can later be attested, so an unregistered reference
  gets AgentResolveError's own reason and no row. The grade form's catalog lists
  the known registered ids for that reason; free text still accepts another id.
*/
export async function submitAgent(
  _previous: SubmitResult | null,
  formData: FormData,
): Promise<SubmitResult> {
  const ref = String(formData.get("ref") ?? "").trim();

  if (ref.length === 0) {
    return {
      kind: "invalid",
      message: "Enter a registry id, or pick a known agent above.",
    };
  }
  if (ref.length > MAX_REF_LENGTH) {
    return {
      kind: "invalid",
      message: `That is longer than ${MAX_REF_LENGTH} characters. Paste the registry id on its own.`,
    };
  }
  if (!ALLOWED_REF.test(ref)) {
    return {
      kind: "invalid",
      message:
        "That contains characters a registry id does not use. Paste the numeric ERC-8004 agent id.",
    };
  }
  if (/^https?:\/\//i.test(ref) || ref.includes("/")) {
    return {
      kind: "invalid",
      message:
        "That looks like a URL or package reference. This form grades a registered ERC-8004 agent id (for example 8441), not an MCP endpoint. Pick a known agent above, or paste the id.",
    };
  }

  try {
    const card = await resolveAgent(ref);
    const result = await gradeAgent(card);
    return {
      kind: "graded",
      ref,
      grade: result.grade,
      score: result.score,
      methodologyVersion: result.methodologyVersion,
      endpointsGraded: result.bundle.coverage.endpointsGraded,
      finding: result.bundle.coverage.note,
    };
  } catch (thrown) {
    // A reference that does not resolve, a target that could not be reached, and
    // an engine that could not run are all the same answer here: no letter.
    return { kind: "error", ref, error: toRenderableError(thrown) };
  }
}
