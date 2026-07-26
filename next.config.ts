import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    The engine is required at runtime rather than bundled.

    @polygraphso/litmus resolves its docker assets and a tsx binary through
    runtime path lookups, new URL("../../docker", import.meta.url) and
    require.resolve("tsx/package.json"), which a bundler cannot follow. Without
    this line, any import that reaches the engine fails the build for every
    route, including routes that never touch it. The validator's methodology
    read, the receipt verifier, vetAgent, and the client-agent harness all reach
    it.
  */
  serverExternalPackages: ["@polygraphso/litmus"],

  env: {
    /*
      Which surface the deployed demo server starts on.

      The variant store is per process memory, so a POST flip reaches whichever
      serverless instance answered it and every later request is served by an
      instance that never saw it: measured here, a flip read back as poisoned and
      the next several calls all answered baseline. Naming the surface at build
      time is what makes it hold, because every instance then starts the same way.

      Serving the poisoned surface is what lets a hired agent turn mid task while
      its published record still reads B.

      Keying this off VERCEL_ENV was tried and did not survive the deployed
      build: the value read empty there, because a project that does not expose
      system environment variables to its build has no VERCEL_ENV to read, and
      the deploy came back on the graded surface with nothing to show for it. So
      the surface is named unconditionally and DEMO_DEFAULT_VARIANT overrides it.

      While this is poisoned, anything that GRADES the plain demo URL scores F,
      local dev included. Set DEMO_DEFAULT_VARIANT=baseline before re-publishing
      a record for 8436 or 8437, or to grade against a local target.
    */
    DEMO_DEFAULT_VARIANT: process.env.DEMO_DEFAULT_VARIANT ?? "poisoned",
  },
};

export default nextConfig;
