"use server";

import { gradeAgent } from "@/src/validator/grade-agent";
import { resolveAgent } from "@/src/validator/resolve-agent";
import {
  agentIdForEnsName,
  claimSubname,
} from "@/src/validator/ens/client";
import { recordsFromValidationRegistry } from "@/src/validator/ens/records-from-registry";
import { ensConfig } from "@/src/shared/config";
import type { ChainId, Grade } from "@/src/shared";
import { identityChainId } from "@/src/validator/identity-registry";
import { toRenderableError, type RenderableError } from "./errors";
import { KNOWN_AGENT_IDS } from "./known-agents";

/** Keep chain ids local so this server-actions module does not pull node:fs into the client graph. */
const MAINNET_CHAIN_ID = 8453 as ChainId;
const SEPOLIA_CHAIN_ID = 84532 as ChainId;

export type SubmitResult =
  | { kind: "invalid"; message: string }
  | { kind: "error"; ref: string; error: RenderableError }
  | {
      kind: "graded";
      ref: string;
      agentId: string;
      identityChainId: ChainId;
      grade: Grade;
      score: number;
      methodologyVersion: string;
      endpointsGraded: number;
      finding: string | null;
      /** Set when a Sepolia mirror already exists for a mainnet grade. */
      sepoliaId: string | null;
    };

export type ClaimResult =
  | { kind: "invalid"; message: string }
  | { kind: "error"; agentId: string; error: RenderableError }
  | {
      kind: "claimed";
      agentId: string;
      /** Sepolia id the ENS label uses. */
      sepoliaId: string;
      mainnetId: string | null;
      name: string;
      owner: string;
      txHash: string | null;
      /** True when ValidationRegistry values were written before ownership moved. */
      recordsSeeded: boolean;
      trustNote: string;
    };

const MAX_REF_LENGTH = 200;
const ALLOWED_REF = /^[A-Za-z0-9@/:._\-+~?=&#%]+$/;
const AGENT_ID = /^[0-9]+$/;

function parseChainId(raw: string): ChainId | null {
  const n = Number(raw);
  if (n === MAINNET_CHAIN_ID || n === SEPOLIA_CHAIN_ID) return n;
  return null;
}

function defaultChainForId(agentId: string): ChainId {
  if (KNOWN_AGENT_IDS.includes(agentId)) return SEPOLIA_CHAIN_ID;
  return MAINNET_CHAIN_ID;
}

/*
  Resolve a registry id (primary) or optional ENS name, on the correct identity
  chain, then grade. 8004scan leaders resolve on Base mainnet; demos on Sepolia.
*/
export async function submitAgent(
  _previous: SubmitResult | null,
  formData: FormData,
): Promise<SubmitResult> {
  const ref = String(formData.get("ref") ?? "").trim();
  const chainRaw = String(formData.get("chainId") ?? "").trim();

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
        "That looks like a URL or package reference. This form grades a registered ERC-8004 agent id (for example 2290 or 8441), not an MCP endpoint.",
    };
  }

  try {
    const agentId = await resolveSubmitRef(ref);
    const chain =
      parseChainId(chainRaw) ??
      (AGENT_ID.test(ref) ? defaultChainForId(agentId) : identityChainId());
    const card = await resolveAgent(agentId, { chainId: chain });
    const result = await gradeAgent(card);
    let sepoliaId: string | null = null;
    if (chain === MAINNET_CHAIN_ID) {
      const { sepoliaIdForMainnet } = await import(
        "@/src/validator/mirror-links"
      );
      sepoliaId = sepoliaIdForMainnet(agentId);
    }
    return {
      kind: "graded",
      ref,
      agentId,
      identityChainId: chain,
      grade: result.grade,
      score: result.score,
      methodologyVersion: result.methodologyVersion,
      endpointsGraded: result.bundle.coverage.endpointsGraded,
      finding: result.bundle.coverage.note,
      sepoliaId,
    };
  } catch (thrown) {
    return { kind: "error", ref, error: toRenderableError(thrown) };
  }
}

/**
 * Claim ENS for an agent. Mainnet ids first ensure a Sepolia mirror; the
 * subname is agent{sepoliaId} owned by the mainnet ownerOf.
 */
export async function claimAgent(
  _previous: ClaimResult | null,
  formData: FormData,
): Promise<ClaimResult> {
  const raw = String(formData.get("agentId") ?? "").trim();
  const chainRaw = String(formData.get("chainId") ?? "").trim();
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

  const chain = parseChainId(chainRaw) ?? defaultChainForId(raw);

  if (
    chain === MAINNET_CHAIN_ID &&
    process.env.PREFLIGHT_ALLOW_MAINNET_CLAIM !== "1"
  ) {
    return {
      kind: "invalid",
      message:
        "Mainnet claims are not enabled on this deployment. The claim path registers a Sepolia mirror with the validator key, so it runs operator-side only; grading works for every row.",
    };
  }

  try {
    if (chain === MAINNET_CHAIN_ID) {
      const { ensureSepoliaMirror } = await import(
        "@/src/validator/sepolia-mirror"
      );
      const mirror = await ensureSepoliaMirror(raw);
      const built = await recordsFromValidationRegistry(mirror.sepoliaId);
      const result = await claimSubname(mirror.sepoliaId, {
        agentOwner: mirror.mainnetOwner,
        ...(built !== null ? { records: built.records } : {}),
      });
      return {
        kind: "claimed",
        agentId: raw,
        sepoliaId: mirror.sepoliaId,
        mainnetId: raw,
        name: result.plan.name,
        owner: result.agentOwner,
        txHash: result.txHash,
        recordsSeeded: result.recordsSeeded,
        trustNote: result.recordsSeeded
          ? "Grade evidence is from the mainnet card. Text records were seeded from the Sepolia ValidationRegistry before ownership moved to the mainnet agent owner."
          : "Grade evidence is from the mainnet card. The Sepolia identity is validator-owned; this ENS name is owned by the mainnet agent owner. No ValidationRegistry record was available to seed text records — publish a grade on the Sepolia mirror, then claim again.",
      };
    }

    const built = await recordsFromValidationRegistry(raw);
    const result = await claimSubname(raw, {
      ...(built !== null ? { records: built.records } : {}),
    });
    return {
      kind: "claimed",
      agentId: raw,
      sepoliaId: raw,
      mainnetId: null,
      name: result.plan.name,
      owner: result.agentOwner,
      txHash: result.txHash,
      recordsSeeded: result.recordsSeeded,
      trustNote: result.recordsSeeded
        ? "ENS subname owned by the Sepolia IdentityRegistry ownerOf for this agent. Text records were seeded from the ValidationRegistry before ownership moved."
        : "ENS subname owned by the Sepolia IdentityRegistry ownerOf for this agent. No ValidationRegistry record was available to seed text records — publish a grade, then claim again.",
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
