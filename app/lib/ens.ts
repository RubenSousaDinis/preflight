import type { AgentId } from "@/src/shared";
import { ensConfig } from "@/src/shared/config";
import { agentEnsName } from "@/src/validator/ens/names";
import { readAgentRecords } from "@/src/validator/ens/client";
import { toRenderableError, type RenderableError } from "./errors";

/*
  The one ENS read module, the same shape as app/lib/hcs.ts.

  Two rules, and both are about what this is allowed to do to a page.

  It is a mirror and never a source. The values below are a copy of the
  ValidationRegistry record, published on a name so a resolver can answer for
  them. Every surface that renders one says so, and no verdict on this site
  reads any of it.

  It never throws and it never blocks. Unconfigured is all null and quiet, a
  failed lookup is an error value rather than an exception, and the timeout is
  short: this sits beside gate output, and a name lookup is not permitted to
  fail a page that is showing a verdict.
*/

export type EnsMirror = {
  /** The derived name, present even when nothing resolves for it. */
  name: string | null;
  grade: string | null;
  score: string | null;
  /** The evidence URI, when it was short enough to live in a text record. */
  evidence: string | null;
  /** `eip155:{chainId}:{registry}`, the record these values were copied from. */
  registryPointer: string | null;
  /** The registry's own lastUpdate, in unix seconds, as the records carry it. */
  updatedAt: number | null;
  /** True when no ENS target is configured, which is an ordinary state. */
  off: boolean;
  error: RenderableError | null;
};

const NOTHING: EnsMirror = {
  name: null,
  grade: null,
  score: null,
  evidence: null,
  registryPointer: null,
  updatedAt: null,
  off: true,
  error: null,
};

/**
 * The name an agent would have, derived rather than looked up.
 *
 * Null when the mirror is switched off, and null for anything that is not an
 * agent id. Callers render the address or the id when this is null, which is
 * the state every row is in before a name is registered.
 */
export function ensNameFor(agentId: AgentId): string | null {
  try {
    const config = ensConfig();
    if (config === null) return null;
    return agentEnsName(agentId, config.parent);
  } catch {
    return null;
  }
}

/**
 * The name only when it actually exists on the configured registry.
 *
 * A derived name with no owner and no resolver is a string about a name that
 * answers nothing. The board and the floor refuse to put that on a row: they
 * wait until the registry names a resolver for the node, which is the same
 * moment the subname step finished.
 */
export async function ensNameIfRegistered(
  agentId: AgentId,
): Promise<string | null> {
  try {
    const config = ensConfig();
    if (config === null) return null;
    const read = await readAgentRecords(agentId, {
      timeoutMs: 4_000,
      keys: [],
    });
    return read.resolver === null ? null : read.name;
  } catch {
    return null;
  }
}

/** The records on an agent's name. Never throws. */
export async function readEnsMirror(agentId: AgentId): Promise<EnsMirror> {
  let name: string | null = null;
  try {
    const config = ensConfig();
    if (config === null) return NOTHING;
    name = agentEnsName(agentId, config.parent);

    const read = await readAgentRecords(agentId, {
      timeoutMs: 4_000,
      keys: [
        "preflight.grade",
        "preflight.score",
        "preflight.evidence",
        "preflight.registry",
        "preflight.updatedAt",
      ],
    });
    const updatedAt = Number(read.records["preflight.updatedAt"]);

    return {
      name: read.name,
      grade: read.records["preflight.grade"] ?? null,
      score: read.records["preflight.score"] ?? null,
      evidence: read.records["preflight.evidence"] ?? null,
      registryPointer: read.records["preflight.registry"] ?? null,
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null,
      off: false,
      error: null,
    };
  } catch (thrown) {
    return { ...NOTHING, name, off: false, error: toRenderableError(thrown) };
  }
}
