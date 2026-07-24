import type { Grade } from "./contracts";

/*
  The token module.

  Every colour and every font family in this app is spelled here and nowhere else.
  Later views reference the exported names, never a literal, so three panels built
  in parallel cannot drift on colour. Values are fixed by 02-DECISIONS section 9.
*/

export const surface = {
  paper: "#f2f3ee",
  panel: "#fbfcf8",
  band: "#e4e9e2",
  rule: "#ccd3cc",
} as const;

export const text = {
  ink: "#101613",
  accent: "#0e5f56",
} as const;

export const grade = {
  gradeA: "#2f5132",
  gradeB: "#4f6b36",
  gradeC: "#a86b19",
  gradeD: "#b85024",
  gradeF: "#a83226",
} as const;

/*
  Family names are spelled plainly on purpose. The deck stage component resolves
  fonts by family name at runtime and the C1 verification runs document.fonts.check
  against these exact strings, so both read the same source.
*/
export const families = {
  display: "Source Serif 4",
  body: "IBM Plex Sans",
  data: "IBM Plex Mono",
} as const;

/*
  Fallback stacks are chosen deliberately rather than left to the browser: the venue
  network is the one variable nobody controls, and a blocked font request has to
  land on a face with comparable metrics instead of shifting the layout.
*/
export const type = {
  display: `"${families.display}", Georgia, "Times New Roman", serif`,
  body: `"${families.body}", "Helvetica Neue", Arial, sans-serif`,
  data: `"${families.data}", ui-monospace, "SF Mono", Menlo, monospace`,
} as const;

const gradeByLetter: Record<Grade, string> = {
  A: grade.gradeA,
  B: grade.gradeB,
  C: grade.gradeC,
  D: grade.gradeD,
  F: grade.gradeF,
};

/**
 * The colour for a letter grade. A null grade takes the neutral rule colour and
 * never a grade colour: an unattested subject tinted green is a false claim
 * rendered in CSS.
 */
export function gradeColor(letter: Grade | null | undefined): string {
  return letter ? gradeByLetter[letter] : surface.rule;
}

const encodeFamily = (name: string) => name.replace(/ /g, "+");

/**
 * The Google Fonts stylesheet, built from the family names above so the two cannot
 * disagree. A plain link, never next/font, per 02-DECISIONS section 9.
 */
export const googleFontsHref =
  "https://fonts.googleapis.com/css2" +
  `?family=${encodeFamily(families.data)}:wght@400;500` +
  `&family=${encodeFamily(families.body)}:wght@400;500;600` +
  `&family=${encodeFamily(families.display)}:opsz,wght@8..60,400..700` +
  "&display=swap";

const declarations: ReadonlyArray<readonly [string, string]> = [
  ["--pf-paper", surface.paper],
  ["--pf-panel", surface.panel],
  ["--pf-band", surface.band],
  ["--pf-rule", surface.rule],
  ["--pf-ink", text.ink],
  ["--pf-accent", text.accent],
  ["--pf-grade-a", grade.gradeA],
  ["--pf-grade-b", grade.gradeB],
  ["--pf-grade-c", grade.gradeC],
  ["--pf-grade-d", grade.gradeD],
  ["--pf-grade-f", grade.gradeF],
  ["--pf-display", type.display],
  ["--pf-body", type.body],
  ["--pf-data", type.data],
];

/**
 * The token set as CSS custom properties. The root layout writes this into the
 * document so Tailwind's theme (globals.css) and any inline style resolve against
 * one source rather than a second copy of the palette in CSS.
 */
export const cssVariables = `:root{${declarations
  .map(([name, value]) => `${name}:${value}`)
  .join(";")}}`;
