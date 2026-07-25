/**
 * Curated Base mainnet (8453) agents from the 8004scan leaderboard.
 *
 * Used when the public API is slow or rate-limited. Ids and labels are checked
 * against https://8004scan.io/leaderboard.
 *
 * Membership is end to end checked, not read off the leaderboard: each id below was
 * resolved through the IdentityRegistry and graded, and each one returned a letter on
 * 2026-07-25. Declaring MCP on a leaderboard is not the same as serving it, and a row
 * that cannot produce a grade offers the reader a button whose only outcome is a
 * failure notice.
 *
 * Four leaderboard ids that advertise MCP were checked and left out, each for a reason
 * that a retry does not change:
 *
 * - 2290 Clawdia and 32214 AegisProtocol: the registry card itself does not resolve.
 *   Clawdia's tokenURI is `ipfs://`, which this validator does not fetch by decision
 *   (see fetch-card.ts), and AegisProtocol's card is not valid JSON.
 * - 19506 QuantaBot and 22524 Quantiva Intelligence: the endpoint the card declares
 *   answers HTTP 404, so there is no MCP surface at the address to exercise.
 *
 * They are left out of the offered catalog, not blocked: any registry id can still be
 * typed into the grade form, where the run reports which of these it hit.
 */

export type CuratedScanAgent = {
  /** ERC-8004 token id on Base mainnet. */
  id: string;
  label: string;
  note: string;
};

/** Base leaders that resolved and graded when checked on 2026-07-25. */
export const CURATED_BASE_LEADERS: readonly CuratedScanAgent[] = [
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
