import { configuredTopicId } from "@/src/receipts/hcs-mirror";
import { validationRegistry, validatorAddress } from "@/src/shared/config";
import { gradeForScore } from "@/src/shared";
import type { Grade } from "@/src/shared";
import {
  hederaTopicExplorerUrl,
  isZerogEvidenceUri,
  zerogShowcaseUrl,
} from "@/src/validator/ens/partner-links";
import { readValidationWithEvidence } from "@/src/validator/validation-registry";
import { ensNameIfRegistered } from "./ens";
import { toRenderableError, type RenderableError } from "./errors";

/**
 * Server loader for `/a/[agentId]`: grade and evidence from the ValidationRegistry.
 * ENS names are cosmetic. Expired records still render, marked expired, so an ENS
 * `url` landing does not go blank the moment the reader-side TTL elapses.
 *
 * Partner links appear only when that stack was used: 0G when the evidence URI is
 * on 0G Storage; Hedera when an HCS receipt-mirror topic is configured.
 */

export type PartnerLink = {
  partner: "0g" | "hedera";
  label: string;
  href: string;
  note: string;
};

export type AgentGradePage =
  | {
      kind: "graded";
      agentId: string;
      grade: Grade;
      score: number;
      methodology: string;
      evidenceUri: string;
      evidenceHash: string;
      expiresAt: number;
      expired: boolean;
      validator: string;
      ensName: string | null;
      chainId: number;
      partners: PartnerLink[];
    }
  | { kind: "absent"; agentId: string }
  | { kind: "error"; agentId: string; error: RenderableError };

function partnerLinksFor(evidenceUri: string): PartnerLink[] {
  const partners: PartnerLink[] = [];
  const zerog = zerogShowcaseUrl(evidenceUri);
  if (zerog.length > 0) {
    partners.push({
      partner: "0g",
      label: "0G Storage",
      href: zerog,
      note: "Evidence bundle pinned on 0G Storage.",
    });
  } else if (isZerogEvidenceUri(evidenceUri)) {
    partners.push({
      partner: "0g",
      label: "0G Storage",
      href: evidenceUri.trim(),
      note: "Evidence bundle pinned on 0G Storage.",
    });
  }

  const hedera = hederaTopicExplorerUrl(configuredTopicId());
  if (hedera.length > 0) {
    partners.push({
      partner: "hedera",
      label: "Hedera Consensus",
      href: hedera,
      note: "Receipt chain mirrored to Hedera Consensus Service (mirror, not source).",
    });
  }
  return partners;
}

export async function loadAgentGradePage(
  agentId: string,
): Promise<AgentGradePage> {
  try {
    const { chainId } = validationRegistry();
    const validator = validatorAddress();
    const [record, ensName] = await Promise.all([
      readValidationWithEvidence(agentId, validator, { includeExpired: true }),
      ensNameIfRegistered(agentId),
    ]);

    if (record === null) return { kind: "absent", agentId };

    const grade = gradeForScore(record.score);
    if (grade === null) return { kind: "absent", agentId };

    const now = Math.floor(Date.now() / 1000);
    return {
      kind: "graded",
      agentId,
      grade,
      score: record.score,
      methodology: record.tag,
      evidenceUri: record.responseURI,
      evidenceHash: record.responseHash,
      expiresAt: record.expiresAt,
      expired: record.expiresAt <= now,
      validator: record.validator,
      ensName,
      chainId,
      partners: partnerLinksFor(record.responseURI),
    };
  } catch (thrown) {
    return {
      kind: "error",
      agentId,
      error: toRenderableError(thrown),
    };
  }
}
