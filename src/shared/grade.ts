/**
 * Grade to score, and the ordering a policy compares against.
 *
 * The table is 02-DECISIONS §5 and it is used identically everywhere, because the score is what is
 * written onchain. A letter and a number that disagree cannot be resolved by a reader.
 */

import type { Grade, Score } from './types.ts'

export const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'F']

export const SCORE_BY_GRADE = {
  A: 100,
  B: 75,
  C: 50,
  D: 25,
  F: 0,
} as const satisfies Record<Grade, Score>

export function isGrade(value: unknown): value is Grade {
  return typeof value === 'string' && (GRADES as readonly string[]).includes(value)
}

/** The only way a `Score` is ever produced. */
export function scoreForGrade(grade: Grade): Score {
  return SCORE_BY_GRADE[grade]
}

/**
 * Read an onchain score back as a letter.
 *
 * Exact matches only. A score off the 25-point scale is not rounded to the nearest letter: it did
 * not come from this methodology, and guessing a letter for it would put an unearned grade on
 * screen. The caller gets null and refuses.
 */
export function gradeForScore(score: number): Grade | null {
  for (const grade of GRADES) {
    if (SCORE_BY_GRADE[grade] === score) return grade
  }
  return null
}

/** Rank, where A is 0 and F is 4. Lower is better, which is why comparisons read `<=`. */
export function gradeRank(grade: Grade): number {
  return GRADES.indexOf(grade)
}

/** True when `grade` is at least as good as `min`. */
export function meetsMinGrade(grade: Grade, min: Grade): boolean {
  return gradeRank(grade) <= gradeRank(min)
}
