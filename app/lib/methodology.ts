import { methodologyVersion } from "@/src/validator/methodology";

/*
  The methodology version behind every letter on screen.

  Read from the installed engine at runtime and never typed as a literal
  (02-DECISIONS section 2): three sources reported three different values before
  the event, and a wrong one cannot be corrected once it has reached an
  attestation tag.

  Lane 1 owns the read. The shell keeps a null path around it because a footer
  that throws takes down every route including the ones that never show a grade,
  and a version the surface could not obtain should say so rather than take the
  page with it.
*/
export async function readMethodologyVersion(): Promise<string | null> {
  try {
    const version = methodologyVersion();
    return typeof version === "string" && version.length > 0 ? version : null;
  } catch {
    return null;
  }
}
