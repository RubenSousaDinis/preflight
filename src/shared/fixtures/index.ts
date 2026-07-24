/**
 * The fixture set.
 *
 * Any task whose dependency has not landed builds against these and marks the seam
 * TODO-INTEGRATE. That is what turns the hard serial dependency on the first onchain write into a
 * soft one. Nothing here is evidence: every hash is the hex encoding of its own label.
 */

export * from './seed.ts'
export * from './agents.ts'
export * from './gate.ts'
export * from './receipts.ts'
export * from './tx.ts'
export * from './harness.ts'
