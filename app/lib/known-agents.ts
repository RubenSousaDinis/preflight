import type { AgentId } from "@/src/shared";
import { ensConfig } from "@/src/shared/config";
import { agentEnsName } from "@/src/validator/ens/names";

/*
  The agents this stage already registered and published.

  The grade form accepts ENS names under the Preflight parent, then converts them
  to ERC-8004 ids via the name's preflight.agentId text record. The catalog shows
  those names, not the numeric ids.
*/

export type KnownAgent = {
  id: AgentId;
  /** Short stage name shown next to the ENS name. */
  label: string;
  /** One line of why this agent is in the set. */
  note: string;
};

export const KNOWN_AGENTS: readonly KnownAgent[] = [
  {
    id: "8427",
    label: "Demo baseline",
    note: "E1 surface=baseline, hired path",
  },
  {
    id: "8430",
    label: "Demo poisoned",
    note: "E1 surface=poisoned, refuse path",
  },
  {
    id: "8436",
    label: "Demo poisoned card",
    note: "card pointed at the poisoned surface",
  },
  {
    id: "8437",
    label: "Demo updatable",
    note: "beat 4 drift subject",
  },
  {
    id: "8441",
    label: "ENSWhois",
    note: "mcp.enswhois.com, live Basenames mirror",
  },
];

/** Ids only, for the board default and anything that already takes a subject list. */
export const KNOWN_AGENT_IDS: readonly AgentId[] = KNOWN_AGENTS.map(
  (agent) => agent.id,
);

export type KnownAgentCatalogEntry = KnownAgent & {
  /** Full ENS name under the configured parent, or null when the mirror is off. */
  ensName: string | null;
};

/** Catalog rows for the grade form. Computed on the server so the parent comes from env. */
export function knownAgentsCatalog(): KnownAgentCatalogEntry[] {
  const config = ensConfig();
  return KNOWN_AGENTS.map((agent) => ({
    ...agent,
    ensName: config === null ? null : agentEnsName(agent.id, config.parent),
  }));
}
