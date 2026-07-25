import type { AgentId } from "@/src/shared";

/*
  The agents this stage already registered and published.

  The grade form only accepts an ERC-8004 id (a uint256). A catalog of known
  agents is the honest booth UX: pick one that resolves, rather than pasting an
  MCP URL the resolver will refuse. Labels are stage shorthand, not card names
  re-fetched on every render.
*/

export type KnownAgent = {
  id: AgentId;
  /** Short stage name shown next to the id. */
  name: string;
  /** One line of why this agent is in the set. */
  note: string;
};

export const KNOWN_AGENTS: readonly KnownAgent[] = [
  {
    id: "8427",
    name: "Demo baseline",
    note: "E1 surface=baseline, hired path",
  },
  {
    id: "8430",
    name: "Demo poisoned",
    note: "E1 surface=poisoned, refuse path",
  },
  {
    id: "8436",
    name: "Demo poisoned card",
    note: "card pointed at the poisoned surface",
  },
  {
    id: "8437",
    name: "Demo updatable",
    note: "beat 4 drift subject",
  },
  {
    id: "8441",
    name: "ENSWhois",
    note: "mcp.enswhois.com, live Basenames mirror",
  },
];

/** Ids only, for the board default and anything that already takes a subject list. */
export const KNOWN_AGENT_IDS: readonly AgentId[] = KNOWN_AGENTS.map(
  (agent) => agent.id,
);
