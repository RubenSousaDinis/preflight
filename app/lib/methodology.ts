/*
  The methodology version is read from the installed engine package at runtime and
  is never typed as a literal (02-DECISIONS section 2): three sources report three
  different values, and a wrong one cannot be corrected once it has been written
  into an attestation tag.

  TODO-INTEGRATE: Lane 1 adds @polygraphso/litmus as a dependency in A3a. Until it
  lands, this read has to fail closed rather than break the build, so the specifier
  is resolved through an indirect import the bundler does not follow, and a missing
  package renders as unresolved rather than as a plausible looking literal.
*/

const ENGINE_PACKAGE = "@polygraphso/litmus";

const importAtRuntime = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<Record<string, unknown>>;

export async function readMethodologyVersion(): Promise<string | null> {
  try {
    const engine = await importAtRuntime(ENGINE_PACKAGE);
    const fromDefault = engine.default as Record<string, unknown> | undefined;
    const value = engine.METHODOLOGY_VERSION ?? fromDefault?.METHODOLOGY_VERSION;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
