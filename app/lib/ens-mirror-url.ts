/**
 * Links for reading the ENS mirror, which answers on Base Sepolia and nowhere else.
 *
 * The records are written to the Basenames registry and L2 resolver on Base Sepolia, and that is the
 * only place they answer. Resolving one of these names the ordinary way walks up to `basetest.eth` on
 * L1 and hands off to Base's CCIP bridge, which comes back empty for every key: checked against both
 * L1 mainnet and L1 Sepolia, every key null, while the same key read straight from the Base Sepolia
 * resolver returns its value.
 *
 * So nothing here links into the ENS App. Sending a reader there put a blank profile in front of them
 * for a name whose records are set, which reads as a failed write and is the opposite of what a
 * mirror is for. These links point at the resolver that holds the values, on the explorer for the
 * chain that holds them.
 *
 * Client-safe: no Node imports, no chain reads.
 */

/** Base Sepolia, where `preflight.basetest.eth` and its subnames answer. */
export const ENS_MIRROR_CHAIN_ID = 84532;

/** How every surface names that chain, so two of them cannot name it differently. */
export const ENS_MIRROR_CHAIN_LABEL = "Base Sepolia (Basenames)";

const BASESCAN = "https://sepolia.basescan.org";

/**
 * The resolver's Read Contract tab, which is where a reader checks a record themselves.
 *
 * Basescan does not accept prefilled arguments, so the surface that renders this link renders the
 * name's node beside it: `text(bytes32,string)` takes the node and the key, and the node is the part
 * a reader cannot derive by eye.
 */
export function ensResolverReadUrl(resolver: string): string {
  return `${BASESCAN}/address/${resolver.trim()}#readContract`;
}

/** Basescan for a Base Sepolia address. */
export function baseSepoliaAddressUrl(address: string): string {
  return `${BASESCAN}/address/${address.trim()}`;
}

/** Basescan for a Base Sepolia tx from claim or sync. */
export function baseSepoliaTxUrl(txHash: string): string {
  return `${BASESCAN}/tx/${txHash}`;
}
