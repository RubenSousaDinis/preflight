/**
 * B3 step 3: the budget, with a freeze that cannot be undone.
 *
 * A clearable freeze is a pause, and a pause is not what beat 1 claims. Once frozen, this object
 * refuses every further spend for the rest of the run; restarting is a deliberate act by an operator
 * creating a new budget, not a flag being flipped back.
 *
 * The budget is the one thing B3 owns outright, so the arithmetic lives here rather than in the loop
 * that reads it: total, spent, remaining, and whether it is frozen, each derivable by anyone holding
 * this object and none of it recomputed on a screen.
 */

import { HarnessError } from '../shared/errors.ts'

export interface BudgetState {
  total: string
  spent: string
  remaining: string
  frozen: boolean
  frozenReason: string | null
}

export class Budget {
  readonly total: bigint
  #spent = 0n
  #frozen = false
  #frozenReason: string | null = null

  constructor(total: bigint) {
    if (total < 0n) throw new HarnessError('a budget cannot start negative')
    this.total = total
  }

  get spent(): bigint {
    return this.#spent
  }

  get remaining(): bigint {
    return this.total - this.#spent
  }

  get frozen(): boolean {
    return this.#frozen
  }

  get frozenReason(): string | null {
    return this.#frozenReason
  }

  /** True when a spend of this size is currently allowed. Frozen is never allowed, at any size. */
  canSpend(amount: bigint): boolean {
    return !this.#frozen && amount >= 0n && this.#spent + amount <= this.total
  }

  /**
   * Records a spend. Throws when frozen or over budget, rather than clamping.
   *
   * Clamping would let a run keep going with numbers that no longer describe it, which is the failure
   * this object exists to prevent.
   */
  spend(amount: bigint): void {
    if (this.#frozen) {
      throw new HarnessError(
        `the budget is frozen (${this.#frozenReason ?? 'no reason recorded'}), so nothing further can be spent`,
      )
    }
    if (amount < 0n) throw new HarnessError('a spend cannot be negative')
    if (this.#spent + amount > this.total) {
      throw new HarnessError(
        `a spend of ${amount} would exceed the budget: ${this.#spent} already spent of ${this.total}`,
      )
    }
    this.#spent += amount
  }

  /** Irreversible. Freezing twice keeps the first reason, because that is the one that stopped the run. */
  freeze(reason: string): void {
    if (this.#frozen) return
    this.#frozen = true
    this.#frozenReason = reason
  }

  state(): BudgetState {
    return {
      total: this.total.toString(),
      spent: this.#spent.toString(),
      remaining: this.remaining.toString(),
      frozen: this.#frozen,
      frozenReason: this.#frozenReason,
    }
  }
}
