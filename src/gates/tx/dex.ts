/**
 * Where a token can be sold, per chain.
 *
 * The honeypot check is a two-leg trade, so it needs a market to trade against, and which market
 * that is depends on the chain. txGuard is chainId-parameterized (02-DECISIONS section 3), so this
 * is configuration rather than a constant, and a chain with no entry here is a chain where the
 * check has no basis rather than one where everything is a trap.
 *
 * Base Sepolia has a live, verified UniswapV2Factory with recent activity (02-DECISIONS 13.4), and
 * the staged pairs are created against it. It has no meaningful liquidity of its own, which is
 * exactly why the pairs are staged.
 */

import type { Address, ChainId } from '../../shared/types.ts'

export interface DexConfig {
  /** A UniswapV2-compatible factory, used only to find the pair for a token. */
  factory: Address
  /**
   * Assets a token is quoted against, in the order they are tried. The first pair that exists and
   * holds reserves is the market the exit is probed through.
   */
  quoteAssets: Address[]
}

const CONFIG: Record<ChainId, DexConfig> = {
  84532: {
    factory: '0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e',
    quoteAssets: [
      // The staged quote asset, deployed with the pairs.
      '0x788830a5264397E8f02F0c790a579ABC3B3eCAE6',
      // WETH, the OP Stack predeploy. Present on the chain, thin, and tried second.
      '0x4200000000000000000000000000000000000006',
    ],
  },
}

/**
 * The market config for a chain, or null.
 *
 * `null` is a real answer and it is disclosed rather than hidden: on a chain with no configured
 * market, the exit cannot be probed, so this check reports nothing rather than inventing a verdict
 * from a market it never reached. The other three flags are unaffected.
 */
export function dexFor(chainId: ChainId): DexConfig | null {
  return CONFIG[chainId] ?? null
}
