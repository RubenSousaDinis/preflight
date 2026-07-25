"use server";

import { gradeAgent } from "@/src/validator/grade-agent";
import { resolveAgent } from "@/src/validator/resolve-agent";
import {
  agentIdForEnsName,
  claimSubname,
} from "@/src/validator/ens/client";
import { ensConfig } from "@/src/shared/config";
import type { ChainId, Grade } from "@/src/shared";
import {
  ensureSepoliaMirror,
  MAINNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
} from "@/src/validator/sepolia-mirror";
import { sepoliaIdForMainnet } from "@/src/validator/mirror-links";
import { identityChainId } from "@/src/validator/identity-registry";
import { toRenderableError, type RenderableError } from "./errors";
import { KNOWN_AGENT_IDS } from "./known-agents";

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
  // Booth default for unknown numeric ids: mainnet leaders (demos are in the known set).
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
      sepoliaId:
        chain === MAINNET_CHAIN_ID ? sepoliaIdForMainnet(agentId) : null,
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

  try {
    if (chain === MAINNET_CHAIN_ID) {
      const mirror = await ensureSepoliaMirror(raw);
      const result = await claimSubname(mirror.sepoliaId, {
        agentOwner: mirror.mainnetOwner,
      });
      return {
        kind: "claimed",
        agentId: raw,
        sepoliaId: mirror.sepoliaId,
        mainnetId: raw,
        name: result.plan.name,
        owner: result.agentOwner,
        txHash: result.txHash,
        trustNote:
          "Grade evidence is from the mainnet card. The Sepolia identity is validator-owned; this ENS name is owned by the mainnet agent owner.",
      };
    }

    const result = await claimSubname(raw);
    return {
      kind: "claimed",
      agentId: raw,
      sepoliaId: raw,
      mainnetId: null,
      name: result.plan.name,
      owner: result.agentOwner,
      txHash: result.txHash,
      trustNote:
        "ENS subname owned by the Sepolia IdentityRegistry ownerOf for this agent.",
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
