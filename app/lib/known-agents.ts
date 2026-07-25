import type { AgentId, ChainId } from "@/src/shared";

/*
  The agents this stage already registered and published on Sepolia.

  The grade form also lists Base mainnet 8004scan leaders (see scan8004.ts).
  Appearance in this catalog does not require a mirrored ENS name.
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

/** Beat 4 drift subject; the rug pull view seeds its input with this id. */
export const DRIFT_AGENT_ID: AgentId = "8437";

/**
 * Beat 1 run candidates: 8430 refused at F, 8436 hired at B and then turns.
 *
 * 8427 is graded against the baseline surface, which cannot turn hostile, so a run
 * that hires it never reaches the injection.
 */
export const RUN_CANDIDATE_IDS: readonly AgentId[] = ["8430", "8436"];

export const SEPOLIA_IDENTITY_CHAIN_ID: ChainId = 84532;

export type KnownAgentCatalogEntry = KnownAgent & {
  /** Full ENS name when a resolver already answers; otherwise null. */
  ensName: string | null;
  /** Which IdentityRegistry to resolve against when grading. */
  identityChainId: ChainId;
  /** Optional Sepolia mirror id when this row is a mainnet leader that was linked. */
  sepoliaId: string | null;
  source: "sepolia-demo" | "8004scan" | "curated-fallback";
};

/** Catalog rows for Sepolia demos. ENS is filled in by discovery when mirrored. */
export function knownAgentsCatalog(): KnownAgentCatalogEntry[] {
  return KNOWN_AGENTS.map((agent) => ({
    ...agent,
    ensName: null,
    identityChainId: SEPOLIA_IDENTITY_CHAIN_ID,
    sepoliaId: null,
    source: "sepolia-demo" as const,
  }));
}
