"use server";

import { gradeAgent } from "@/src/validator/grade-agent";
import { resolveAgent } from "@/src/validator/resolve-agent";
import { agentIdForEnsName } from "@/src/validator/ens/client";
import { ensConfig } from "@/src/shared/config";
import type { Grade } from "@/src/shared";
import { toRenderableError, type RenderableError } from "./errors";

export type SubmitResult =
  | { kind: "invalid"; message: string }
  | { kind: "error"; ref: string; error: RenderableError }
  | {
      kind: "graded";
      /** The ENS name (or other ref) the user submitted. */
      ref: string;
      grade: Grade;
      score: number;
      methodologyVersion: string;
      endpointsGraded: number;
      /** One line off the bundle. Empty is legitimate and never reads as clean. */
      finding: string | null;
    };

/** Long enough for a Basenames subname, short enough that nothing pathological lands. */
const MAX_REF_LENGTH = 200;
const ALLOWED_REF = /^[A-Za-z0-9@/:._\-+~?=&#%]+$/;

/*
  Beat 3's submission: take an ENS name under the Preflight parent, read the
  agent id off the name, then resolve and grade that registered agent.

  It grades registered agents only, and that is deliberate rather than a gap left
  open. gradeAgent takes an AgentCard, and a card is what the registry returned.
  The name is how the booth points at the agent; the registry remains the source.
*/
export async function submitAgent(
  _previous: SubmitResult | null,
  formData: FormData,
): Promise<SubmitResult> {
  const ref = String(formData.get("ref") ?? "").trim();

  if (ref.length === 0) {
    return {
      kind: "invalid",
      message: "Enter an ENS name, or pick a known agent above.",
    };
  }
  if (ref.length > MAX_REF_LENGTH) {
    return {
      kind: "invalid",
      message: `That is longer than ${MAX_REF_LENGTH} characters. Paste the ENS name on its own.`,
    };
  }
  if (!ALLOWED_REF.test(ref)) {
    return {
      kind: "invalid",
      message:
        "That contains characters an ENS name does not use. Paste a name like agent8441.preflight.basetest.eth.",
    };
  }
  if (/^https?:\/\//i.test(ref) || ref.includes("/")) {
    return {
      kind: "invalid",
      message:
        "That looks like a URL or package reference. Paste an ENS name under the Preflight parent, or pick a known agent above.",
    };
  }
  if (/^[0-9]+$/.test(ref)) {
    return {
      kind: "invalid",
      message:
        "Paste the agent's ENS name (for example agent8441.preflight.basetest.eth), not the numeric registry id.",
    };
  }
  if (ensConfig() === null) {
    return {
      kind: "invalid",
      message:
        "The ENS mirror is not configured, so a name cannot be converted to an agent id.",
    };
  }

  try {
    const { agentId, name } = await agentIdForEnsName(ref, { timeoutMs: 8_000 });
    const card = await resolveAgent(agentId);
    const result = await gradeAgent(card);
    return {
      kind: "graded",
      ref: name,
      grade: result.grade,
      score: result.score,
      methodologyVersion: result.methodologyVersion,
      endpointsGraded: result.bundle.coverage.endpointsGraded,
      finding: result.bundle.coverage.note,
    };
  } catch (thrown) {
    return { kind: "error", ref, error: toRenderableError(thrown) };
  }
}
