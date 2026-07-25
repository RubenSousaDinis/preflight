/**
 * The fork handle, and the two backends that implement it.
 *
 * Kept in its own file so the anvil backend and the RPC backend can both refer to the shape without
 * importing each other. `01-INTERFACES.md` section 7 owns the three methods a detector may use; the
 * extra two are additive, and anything typed against the frozen `Fork` still accepts this.
 */

import type { Address, Fork, Hex } from '../../shared/types.ts'

/**
 * Headroom injected on top of `value` so an unfunded demo wallet can execute.
 *
 * Disclosed, not hidden: without it every simulation for a wallet holding nothing fails on funds
 * and tests nothing. Both backends apply it the same way, so a verdict does not depend on which one
 * ran. It lives here rather than in either backend for the same reason.
 */
export const INJECTED_HEADROOM_WEI = 10n ** 18n

/** Which machine executed the EVM. Recorded and rendered, never assumed from configuration. */
export type ForkBackend = 'anvil' | 'rpc'

export interface ForkHandle extends Fork {
  readonly block: bigint
  /** Which backend produced this handle's answers. */
  readonly backend: ForkBackend
  /**
   * A read only call against the state the fork is currently in.
   *
   * The two-leg detector needs reserves read from the state the buy leg left behind, not from the
   * chain, or the sell is quoted against a market that no longer exists.
   */
  call(to: Address, data: Hex): Promise<Hex>
}
