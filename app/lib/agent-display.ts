import type { AgentId } from "@/src/shared";
import { KNOWN_AGENTS } from "./known-agents";

/*
  Names, and what a name is allowed to replace.

  A registry id identifies an agent. It does not describe one, and a column of bare
  numbers tells a reader nothing about what they are looking at. Every surface here
  leads with the name and keeps the id beside it in a quieter line, so the id stays
  readable and stays the thing that can be checked against the registry.

  When nothing names an agent the id is the name, and no second line repeats it.
*/

const DEMO_LABELS = new Map(
  KNOWN_AGENTS.map((agent) => [agent.id, agent.label] as const),
);

/** Anything carrying an id and a human label. The catalog entries satisfy it. */
export type LabelledAgent = { id: string; label: string };

/**
 * The best name available for an id, or null when only the id is known.
 *
 * Never invents one. A row with no name renders as the id, which is the ordinary
 * state for an agent this build has never been told about.
 */
export function agentLabelFor(
  agentId: AgentId,
  catalog: readonly LabelledAgent[] = [],
): string | null {
  const fromCatalog = catalog.find((agent) => agent.id === agentId)?.label;
  if (fromCatalog !== undefined && fromCatalog.length > 0) return fromCatalog;
  return DEMO_LABELS.get(agentId) ?? null;
}

/** Which registry an id is being read against, in words. */
export function chainLabelFor(chainId: number): string {
  return chainId === 8453 ? "Base mainnet / 8004scan" : "Base Sepolia / demo";
}
