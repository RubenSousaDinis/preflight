import { DEFAULT_FEE } from "@/src/demo/harness";
import { railFromEnv } from "@/src/demo/payment-rail";
import { toRenderableError, type RenderableError } from "./errors";
import { formatHbar } from "./transcript";

/*
  What a run on this deployment will do with money, read once on the server.

  The console says this before the button is pressed rather than after the fact.
  A page whose Run button settles real HBAR and a page whose Run button settles
  nothing look identical until the transcript arrives, and the difference is
  whose funds move.

  Never throws. A rail the environment asks for but cannot supply is `refused`,
  which is what the run route will do with the same request, so the line and the
  outcome agree.
*/

export type DemoRail = {
  /** The rail that will settle, or null when the request would be refused. */
  name: "stub" | "hedera-transfer" | "hedera-x402" | null;
  /** True when pressing Run moves real funds. */
  settles: boolean;
  /** The account a settled fee is paid to. */
  payTo: string | null;
  /** The per-call fee a run will move, already in HBAR. */
  feeHbar: string;
  error: RenderableError | null;
};

export function readDemoRail(): DemoRail {
  const feeHbar = formatHbar(DEFAULT_FEE.toString());
  try {
    const configured = railFromEnv();
    return {
      name: configured.rail.name,
      settles: configured.rail.name !== "stub",
      payTo: configured.payTo ?? null,
      feeHbar,
      error: null,
    };
  } catch (thrown) {
    return {
      name: null,
      settles: false,
      payTo: null,
      feeHbar,
      error: toRenderableError(thrown),
    };
  }
}
