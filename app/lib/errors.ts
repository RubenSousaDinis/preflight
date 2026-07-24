import type { PreflightError } from "@/src/shared";

/**
 * What a view needs off a typed failure.
 *
 * Structural rather than the class itself, so an error that has crossed the server
 * boundary and lost its prototype still renders. `code` widens by one member: a
 * throw that is not a PreflightError has no code from the closed set, and inventing
 * one for it would misreport where the failure came from.
 */
export type RenderableError = {
  code: PreflightError["code"] | "UNKNOWN";
  reason: string;
  retryable: boolean;
};

function hasErrorShape(value: unknown): value is RenderableError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.reason === "string" &&
    typeof candidate.retryable === "boolean"
  );
}

/**
 * Read anything thrown into something renderable.
 *
 * Never returns null and never returns a verdict. A caller that could not obtain a
 * verdict renders this and refuses; there is no path here that produces a decision.
 */
export function toRenderableError(thrown: unknown): RenderableError {
  if (hasErrorShape(thrown)) {
    return {
      code: thrown.code,
      reason: thrown.reason,
      retryable: thrown.retryable,
    };
  }
  if (thrown instanceof Error) {
    return { code: "UNKNOWN", reason: thrown.message, retryable: false };
  }
  return {
    code: "UNKNOWN",
    reason: "The gate failed without reporting a reason.",
    retryable: false,
  };
}
