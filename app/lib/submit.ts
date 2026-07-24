"use server";

import type { Grade } from "@/src/shared";
import type { RenderableError } from "./errors";

export type SubmitResult =
  | { kind: "invalid"; message: string }
  | { kind: "error"; ref: string; error: RenderableError }
  | { kind: "graded"; ref: string; grade: Grade; finding: string | null };

/** Long enough for an npm ref or a URL, short enough that nothing pathological lands. */
const MAX_REF_LENGTH = 200;
const ALLOWED_REF = /^[A-Za-z0-9@/:._\-+~?=&#%]+$/;

/*
  Beat 3's submission.

  TODO-INTEGRATE: this runs A2's resolveAgent and A3a's gradeAgent once the engine
  package can be imported from the app. It cannot today: @polygraphso/litmus
  resolves docker assets and a tsx binary through runtime path lookups that
  Turbopack cannot follow, so importing Lane 1's grading path fails the build for
  every route. The one line that unblocks it is serverExternalPackages in
  next.config.ts, which is outside this lane's directory and is filed as a request.

  Until then this returns a typed failure and creates no row. It never returns a
  grade it did not obtain: an unregistered id and an unwired pipeline are both
  answers, and neither of them is a letter.
*/
export async function submitAgent(
  _previous: SubmitResult | null,
  formData: FormData,
): Promise<SubmitResult> {
  const ref = String(formData.get("ref") ?? "").trim();

  if (ref.length === 0) {
    return {
      kind: "invalid",
      message: "Enter an agent id or a reference to grade.",
    };
  }
  if (ref.length > MAX_REF_LENGTH) {
    return {
      kind: "invalid",
      message: `That is longer than ${MAX_REF_LENGTH} characters. Paste the id or the package reference on its own.`,
    };
  }
  if (!ALLOWED_REF.test(ref)) {
    return {
      kind: "invalid",
      message:
        "That contains characters an agent reference does not use. Paste the id, an npm reference, or a URL.",
    };
  }

  return {
    kind: "error",
    ref,
    error: {
      code: "CONFIG",
      reason:
        "The grading pipeline is not wired to this surface yet, so this reference was not graded and no row was created.",
      retryable: false,
    },
  };
}
