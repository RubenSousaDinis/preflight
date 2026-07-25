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

/** Long enough for an npm ref or a URL, short enough that nothing pathological lands. */
const MAX_REF_LENGTH = 200;
const ALLOWED_REF = /^[A-Za-z0-9@/:._\-+~?=&#%]+$/;

/*
  Beat 3's submission: resolve the reference, then grade what it resolved to.

  It grades registered agents only, and that is deliberate rather than a gap left
  open. gradeAgent takes an AgentCard, and a card is what the registry returned:
  its tokenURI and its raw document are hashed into the evidence bundle. Building
  a card here for an endpoint nobody registered would put values this surface
  invented into evidence that can later be attested, so an unregistered reference
  gets AgentResolveError's own reason and no row.

  See the report attached to this commit for the open question that leaves: a judge
  submitting their own MCP server on the day is not registered, and how an
  endpoint-only grade is represented in evidence is Lane 1's shape to decide.

  Nothing here returns a letter it did not obtain. Every failure path is an error.
*/
export async function submitAgent(
  _previous: SubmitResult | null,
  formData: FormData,
): Promise<SubmitResult> {
  const ref = String(formData.get("ref") ?? "").trim();

  if (ref.length === 0) {
    return {
      kind: "invalid",
      message: "Enter an agent id or a reference to grade.",
    };
  }
  if (ref.length > MAX_REF_LENGTH) {
    return {
      kind: "invalid",
      message: `That is longer than ${MAX_REF_LENGTH} characters. Paste the id or the package reference on its own.`,
    };
  }
  if (!ALLOWED_REF.test(ref)) {
    return {
      kind: "invalid",
      message:
        "That contains characters an agent reference does not use. Paste the id, an npm reference, or a URL.",
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
