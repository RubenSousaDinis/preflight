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
};

export default nextConfig;
