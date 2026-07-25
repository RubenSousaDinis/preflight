import type { AgentId, ChainId } from "@/src/shared";
import { ensConfig } from "@/src/shared/config";
import { readAgentRecords } from "@/src/validator/ens/client";
import { sepoliaIdForMainnet } from "@/src/validator/mirror-links";
import {
  KNOWN_AGENTS,
  knownAgentsCatalog,
  type KnownAgentCatalogEntry,
} from "./known-agents";
import { loadBaseLeaderCatalog } from "./scan8004";

/*
  Discover agents that can be graded: Sepolia demos + Base 8004scan leaders.

  ENS sub-lines are filled only when a resolver answers under the Preflight parent
  (for Sepolia ids / linked sepolia mirrors). Catalog membership never requires ENS.
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

async function enrichEns(
  entries: KnownAgentCatalogEntry[],
): Promise<KnownAgentCatalogEntry[]> {
  const config = ensConfig();
  if (config === null) return entries;

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const { from, to } = discoverRange();
  const ids: AgentId[] = [];
  for (let id = from; id <= to; id += 1) ids.push(String(id));

  // Also probe linked Sepolia mirror ids outside the demo range.
  for (const entry of entries) {
    if (entry.sepoliaId !== null) ids.push(entry.sepoliaId);
  }

  try {
    await mapPool([...new Set(ids)], PROBE_CONCURRENCY, async (id) => {
      try {
        const read = await readAgentRecords(id, {
          timeoutMs: 4_000,
          keys: ["preflight.agentId", "preflight.grade", "preflight.methodology"],
        });
        if (read.resolver === null) return;

        const existing = byId.get(id);
        if (existing !== undefined) {
          byId.set(id, { ...existing, ensName: read.name });
          return;
        }

        // Linked mirror: attach ENS onto the mainnet catalog row that owns this sepolia id.
        for (const [key, row] of byId) {
          if (row.sepoliaId === id) {
            byId.set(key, { ...row, ensName: read.name });
            break;
          }
        }
      } catch {
        // One id failing must not empty the catalog.
      }
    });
  } catch {
    // Probe failed entirely; keep what we have.
  }

  return [...byId.values()];
}

/**
 * Agents available to grade: Sepolia demos + Base 8004scan leaders.
 */
export async function discoverAgentsForGrade(): Promise<
  KnownAgentCatalogEntry[]
> {
  const demos = knownAgentsCatalog();
  const leaders = await loadBaseLeaderCatalog();

  const merged: KnownAgentCatalogEntry[] = [
    ...demos,
    ...leaders.map((leader) => ({
      id: leader.id,
      label: leader.label,
      note: leader.note,
      ensName: null as string | null,
      identityChainId: leader.identityChainId as ChainId,
      sepoliaId: sepoliaIdForMainnet(leader.id),
      source: leader.source,
    })),
  ];

  const withEns = await enrichEns(merged);
  return withEns.sort((a, b) => {
    if (a.identityChainId !== b.identityChainId) {
      return a.identityChainId - b.identityChainId;
    }
    return Number(a.id) - Number(b.id);
  });
}

/** Client-side filter for the grade search box. */
export function filterAgentCatalog(
  catalog: readonly KnownAgentCatalogEntry[],
  query: string,
): KnownAgentCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...catalog];
  return catalog.filter((agent) => {
    const haystack = [
      agent.ensName,
      agent.label,
      agent.note,
      agent.id,
      agent.sepoliaId,
      String(agent.identityChainId),
      agent.source,
    ]
      .filter((value): value is string => value !== null && value.length > 0)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
