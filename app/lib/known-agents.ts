import type { AgentId } from "@/src/shared";

/*
  The agents this stage already registered and published.

  The grade form takes registry ids as the primary input. ENS names are optional
  discoverability; appearance in this catalog does not require a mirrored name.
*/

export type KnownAgent = {
  id: AgentId;
  /** Short stage name shown next to the id. */
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
  /** Full ENS name when a resolver already answers; otherwise null. */
  ensName: string | null;
};

/** Catalog rows for the grade form. ENS is filled in by discovery when mirrored. */
export function knownAgentsCatalog(): KnownAgentCatalogEntry[] {
  return KNOWN_AGENTS.map((agent) => ({
    ...agent,
    ensName: null,
  }));
}
