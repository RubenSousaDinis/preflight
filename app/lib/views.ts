/**
 * The console's views.
 *
 * Plain module, imported by both the server page and the client nav. It lived in
 * the nav until the page tried to call the guard across the boundary, which is a
 * runtime error rather than a build one: worth remembering that a "use client"
 * file exports components to the server, not functions.
 */
export const VIEWS = [
  { id: "floor", label: "Hiring floor" },
  { id: "firewall", label: "Tx firewall" },
  { id: "board", label: "Leaderboard" },
  { id: "grade", label: "Grade an agent" },
  { id: "rugpull", label: "Rug pull" },
  { id: "receipts", label: "Receipts" },
] as const;

export type ViewId = (typeof VIEWS)[number]["id"];

export function isViewId(value: string | undefined): value is ViewId {
  return VIEWS.some((view) => view.id === value);
}
