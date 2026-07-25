"use server";

import { gradeAgent } from "@/src/validator/grade-agent";
import { resolveAgent } from "@/src/validator/resolve-agent";
import {
  agentIdForEnsName,
  claimSubname,
} from "@/src/validator/ens/client";
import { ensConfig } from "@/src/shared/config";
import type { Grade } from "@/src/shared";
import { toRenderableError, type RenderableError } from "./errors";

export type SubmitResult =
  | { kind: "invalid"; message: string }
  | { kind: "error"; ref: string; error: RenderableError }
  | {
      kind: "graded";
      /** What the user typed or picked (id or ENS name). */
      ref: string;
      /** Registry id that was graded. */
      agentId: string;
      grade: Grade;
      score: number;
      methodologyVersion: string;
      endpointsGraded: number;
      /** One line off the bundle. Empty is legitimate and never reads as clean. */
      finding: string | null;
    };

export type ClaimResult =
  | { kind: "invalid"; message: string }
  | { kind: "error"; agentId: string; error: RenderableError }
  | {
      kind: "claimed";
      agentId: string;
      name: string;
      owner: string;
      txHash: string | null;
    };

/** Long enough for a Basenames subname, short enough that nothing pathological lands. */
const MAX_REF_LENGTH = 200;
const ALLOWED_REF = /^[A-Za-z0-9@/:._\-+~?=&#%]+$/;
const AGENT_ID = /^[0-9]+$/;

/*
  Beat 3's submission: resolve a registry id (primary) or an optional ENS name under
  the Preflight parent, then grade the registered agent.

  ENS is discoverability only. The registry remains the source of the card, and
  nothing here sits in a hire/refuse verdict path.
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
    const agentId = await resolveSubmitRef(ref);
    const card = await resolveAgent(agentId);
    const result = await gradeAgent(card);
    return {
      kind: "graded",
      ref,
      agentId,
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

/**
 * Operator-assisted claim: create `agent{id}` under the Preflight parent with owner =
 * IdentityRegistry ownerOf(agentId). Does not grade or publish.
 */
export async function claimAgent(
  _previous: ClaimResult | null,
  formData: FormData,
): Promise<ClaimResult> {
  const raw = String(formData.get("agentId") ?? "").trim();
  if (!AGENT_ID.test(raw)) {
    return {
      kind: "invalid",
      message: "Claim needs a numeric ERC-8004 agent id.",
    };
  }
  if (ensConfig() === null) {
    return {
      kind: "invalid",
      message: "The ENS mirror is not configured, so a subname cannot be claimed.",
    };
  }

  try {
    const result = await claimSubname(raw);
    return {
      kind: "claimed",
      agentId: raw,
      name: result.plan.name,
      owner: result.agentOwner,
      txHash: result.txHash,
    };
  } catch (thrown) {
    return { kind: "error", agentId: raw, error: toRenderableError(thrown) };
  }
}

async function resolveSubmitRef(ref: string): Promise<string> {
  if (AGENT_ID.test(ref)) return ref;

  if (ensConfig() === null) {
    throw new Error(
      "That looks like an ENS name, but the ENS mirror is not configured. Paste the numeric registry id instead.",
    );
  }

  const { agentId } = await agentIdForEnsName(ref, { timeoutMs: 8_000 });
  return agentId;
}
