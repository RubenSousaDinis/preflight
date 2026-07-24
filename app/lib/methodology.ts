/*
  The methodology version behind every letter on screen.

  It is read from the installed engine at runtime and never typed as a literal
  (02-DECISIONS section 2): three sources reported three different values before the
  event, and a wrong one cannot be corrected once it has reached an attestation tag.

  Lane 1's src/validator/methodology.ts imports the engine statically, which is the
  right shape for the validator. The app cannot import that module today: the engine
  package resolves its docker assets and a tsx binary through runtime path lookups
  that Turbopack cannot follow, so a static import fails the build for every route,
  including the ones that never show a grade.

  So the read goes through an indirect import the bundler does not follow. The
  engine is a real dependency and this resolves to the real version at runtime.

  TODO-INTEGRATE: adding "@polygraphso/litmus" to serverExternalPackages in
  next.config.ts makes the static import work and makes the dependency traceable for
  deployment. next.config.ts is outside this lane's directory, so it is a request
  rather than an edit. Once it lands, this file becomes a re-export of Lane 1's.
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
