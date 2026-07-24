/**
 * The shared layer: the frozen shapes from tasks/01-INTERFACES.md, the typed failures, the grade
 * table, and the per-chain configuration surface.
 *
 * Written once, then frozen. Additions are append-only and go through operator arbitration: one
 * commit, both consumers rebase. Fixtures are imported from `./fixtures/index.ts` directly, so
 * nothing in a production path picks one up by accident.
 */

export type * from './types.ts'
export * from './errors.ts'
export * from './grade.ts'
export * from './config.ts'
