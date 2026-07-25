/**
 * Links into the ENS App for Preflight's Basenames mirror (Base Sepolia).
 *
 * Client-safe: no Node imports. chainId selects Base Sepolia so text records are
 * read from the L2 registry rather than mainnet.
 */

/** Base Sepolia — where preflight.basetest.eth lives. */
export const ENS_APP_CHAIN_ID = 84532;

/**
 * ENS App profile for a name, pinned to the mirror chain.
 *
 * Example: https://app.ens.domains/agent8443.preflight.basetest.eth?chainId=84532
 */
export function ensAppUrl(
  name: string,
  chainId: number = ENS_APP_CHAIN_ID,
): string {
  const normalised = name.trim().toLowerCase();
  return `https://app.ens.domains/${normalised}?chainId=${chainId}`;
}

/** Basescan for a Base Sepolia tx from claim / sync. */
export function baseSepoliaTxUrl(txHash: string): string {
  return `https://sepolia.basescan.org/tx/${txHash}`;
}
