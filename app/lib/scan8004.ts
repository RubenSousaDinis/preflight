import {
  BASE_MAINNET_CHAIN_ID,
  CURATED_BASE_LEADERS,
  type CuratedScanAgent,
} from "./curated-base-leaders";

/*
  8004scan public API client for the booth catalog.

  Live enrichment of curated Base token ids via GET /agents/{chainId}/{tokenId}.
  On failure or missing MCP, the curated row still appears so the booth is never empty.
*/

const PUBLIC_BASE = "https://8004scan.io/api/v1/public";
const FETCH_TIMEOUT_MS = 4_000;

export type ScanLeaderEntry = CuratedScanAgent & {
  identityChainId: typeof BASE_MAINNET_CHAIN_ID;
  /** MCP endpoint from 8004scan when the API answered; null if unknown. */
  mcpEndpoint: string | null;
  source: "8004scan" | "curated-fallback";
};

type ScanAgentDetail = {
  token_id?: string | number;
  name?: string | null;
  description?: string | null;
  supported_protocols?: string[] | null;
  services?: {
    mcp?: { endpoint?: string | null } | null;
  } | null;
};

async function fetchAgentDetail(
  tokenId: string,
): Promise<ScanAgentDetail | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${PUBLIC_BASE}/agents/${BASE_MAINNET_CHAIN_ID}/${tokenId}`,
      {
        signal: controller.signal,
        headers: { accept: "application/json" },
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { success?: boolean; data?: ScanAgentDetail };
    if (!body.success || body.data === undefined) return null;
    return body.data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function hasMcp(detail: ScanAgentDetail): boolean {
  const endpoint = detail.services?.mcp?.endpoint;
  if (typeof endpoint === "string" && endpoint.startsWith("http")) return true;
  return (detail.supported_protocols ?? []).includes("MCP");
}

/**
 * Base mainnet leaders for the grade catalog.
 *
 * Starts from the curated id list, enriches names/endpoints from 8004scan when
 * possible, and always returns at least the curated fallback rows.
 */
export async function loadBaseLeaderCatalog(): Promise<ScanLeaderEntry[]> {
  const results: ScanLeaderEntry[] = [];

  await Promise.all(
    CURATED_BASE_LEADERS.map(async (curated) => {
      const detail = await fetchAgentDetail(curated.id);
      if (detail === null) {
        results.push({
          ...curated,
          identityChainId: BASE_MAINNET_CHAIN_ID,
          mcpEndpoint: null,
          source: "curated-fallback",
        });
        return;
      }

      const mcpEndpoint =
        typeof detail.services?.mcp?.endpoint === "string"
          ? detail.services.mcp.endpoint
          : null;
      const label =
        typeof detail.name === "string" && detail.name.trim().length > 0
          ? detail.name.trim()
          : curated.label;
      const note = hasMcp(detail)
        ? "8004scan Base leader, MCP"
        : "8004scan Base leader (no MCP listed)";

      results.push({
        id: curated.id,
        label,
        note,
        identityChainId: BASE_MAINNET_CHAIN_ID,
        mcpEndpoint,
        source: "8004scan",
      });
    }),
  );

  return results.sort((a, b) => Number(a.id) - Number(b.id));
}
