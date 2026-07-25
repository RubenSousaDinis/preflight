import type { KnownAgentCatalogEntry } from "./known-agents";

/** Client-safe filter for the grade search box. No Node / server imports. */
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
