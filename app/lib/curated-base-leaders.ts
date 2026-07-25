/**
 * Curated Base mainnet (8453) agents from the 8004scan leaderboard.
 *
 * Used when the public API is slow or rate-limited. Ids and labels are checked
 * against https://8004scan.io/leaderboard; MCP presence is preferred.
 */

export type CuratedScanAgent = {
  /** ERC-8004 token id on Base mainnet. */
  id: string;
  label: string;
  note: string;
};

/** Top Base leaders that declare an MCP surface (verified 2026-07-25). */
export const CURATED_BASE_LEADERS: readonly CuratedScanAgent[] = [
  {
    id: "2290",
    label: "Clawdia",
    note: "8004scan Base leader, MCP",
  },
  {
    id: "19506",
    label: "QuantaBot",
    note: "8004scan Base leader, MCP",
  },
  {
    id: "32214",
    label: "AegisProtocol",
    note: "8004scan Base leader, MCP",
  },
  {
    id: "22332",
    label: "AeroDropX",
    note: "8004scan Base leader, MCP",
  },
  {
    id: "22335",
    label: "erni",
    note: "8004scan Base leader, MCP",
  },
  {
    id: "22524",
    label: "Quantiva Intelligence",
    note: "8004scan Base leader, MCP",
  },
  {
    id: "22387",
    label: "governancex",
    note: "8004scan Base leader, MCP",
  },
  {
    id: "22385",
    label: "quantrax",
    note: "8004scan Base leader, MCP",
  },
  {
    id: "22353",
    label: "castmind",
    note: "8004scan Base leader, MCP",
  },
  {
    id: "22381",
    label: "oraclemind",
    note: "8004scan Base leader, MCP",
  },
];

export const BASE_MAINNET_CHAIN_ID = 8453;
