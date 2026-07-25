import type { AgentId } from "@/src/shared";
import { ensConfig } from "@/src/shared/config";
import { readAgentRecords } from "@/src/validator/ens/client";
import { agentEnsName } from "@/src/validator/ens/names";
import {
  KNOWN_AGENTS,
  knownAgentsCatalog,
  type KnownAgentCatalogEntry,
} from "./known-agents";

/*
  Discover agents that can be graded by ENS name.

  ENS has no "list agents" API. What works: probe our Preflight parent for
  agent{id} subnames that already have a resolver (the ones we mirrored), over a
  bounded id range, and merge the stage-known set so the booth catalog is never
  empty when the probe is slow or partial.
*/

const DEFAULT_FROM = 8420;
const DEFAULT_TO = 8450;
const MAX_RANGE = 200;
const PROBE_CONCURRENCY = 8;

function discoverRange(): { from: number; to: number } {
  const rawFrom = Number(process.env.PREFLIGHT_DISCOVER_FROM ?? DEFAULT_FROM);
  const rawTo = Number(process.env.PREFLIGHT_DISCOVER_TO ?? DEFAULT_TO);
  const from = Number.isInteger(rawFrom) ? rawFrom : DEFAULT_FROM;
  const to = Number.isInteger(rawTo) ? rawTo : DEFAULT_TO;
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.max(from, to);
  return { from: lo, to: Math.min(hi, lo + MAX_RANGE) };
}

async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}

function knownLabel(id: AgentId): { label: string; note: string } | null {
  const known = KNOWN_AGENTS.find((agent) => agent.id === id);
  if (known === undefined) return null;
  return { label: known.label, note: known.note };
}

/**
 * Agents under the Preflight ENS parent that already resolve, ready to grade by name.
 *
 * Falls back to the static known catalog when ENS is unconfigured. Never throws:
 * a partial probe still returns what it found plus the known set.
 */
export async function discoverAgentsForGrade(): Promise<
  KnownAgentCatalogEntry[]
> {
  const config = ensConfig();
  if (config === null) return knownAgentsCatalog();

  const { from, to } = discoverRange();
  const ids: AgentId[] = [];
  for (let id = from; id <= to; id += 1) ids.push(String(id));

  const byId = new Map<string, KnownAgentCatalogEntry>();

  for (const known of knownAgentsCatalog()) {
    if (known.ensName !== null) byId.set(known.id, known);
  }

  try {
    await mapPool(ids, PROBE_CONCURRENCY, async (id) => {
      try {
        const read = await readAgentRecords(id, {
          timeoutMs: 4_000,
          keys: ["preflight.agentId", "preflight.grade", "preflight.methodology"],
        });
        if (read.resolver === null) return;

        const known = knownLabel(id);
        const grade = read.records["preflight.grade"];
        byId.set(id, {
          id,
          ensName: read.name,
          label: known?.label ?? (grade !== undefined ? `Grade ${grade}` : read.name),
          note:
            known?.note ??
            (grade !== undefined
              ? `ENS mirror, published grade ${grade}`
              : "ENS mirror under the Preflight parent"),
        });
      } catch {
        // One id failing must not empty the catalog.
      }
    });
  } catch {
    // Probe failed entirely; keep the known set already loaded.
  }

  // Guarantee every known agent with a derivable name is present even if its
  // resolver probe raced or rate-limited.
  for (const known of KNOWN_AGENTS) {
    if (byId.has(known.id)) continue;
    byId.set(known.id, {
      ...known,
      ensName: agentEnsName(known.id, config.parent),
    });
  }

  return [...byId.values()].sort((a, b) =>
    (a.ensName ?? a.id).localeCompare(b.ensName ?? b.id),
  );
}

/** Client-side filter for the grade search box. */
export function filterAgentCatalog(
  catalog: readonly KnownAgentCatalogEntry[],
  query: string,
): KnownAgentCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...catalog];
  return catalog.filter((agent) => {
    const haystack = [agent.ensName, agent.label, agent.note, agent.id]
      .filter((value): value is string => value !== null && value.length > 0)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
