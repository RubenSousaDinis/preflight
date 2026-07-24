import { headers } from "next/headers";
import type { ToolSurfaceVariant } from "@/src/shared";
import { toRenderableError, type RenderableError } from "./errors";

export type DemoTarget = {
  variant: ToolSurfaceVariant | null;
  toolCount: number | null;
  baselineToolCount: number | null;
  driftedToolCount: number | null;
  addedTools: string[];
  error: RenderableError | null;
};

/*
  Which surface the demo target is serving right now.

  This reads through the control route rather than importing the variant store,
  and that is not a style choice. The store keeps the variant in module state, and
  Next bundles a page and a route handler separately, so each gets its own instance
  of that module. Importing it here gave a console that said `baseline` on every
  load while the control route said `drifted` on every read, in one process, with
  no race: deterministically the wrong answer, on the one line whose job is to say
  which surface a run is about to be graded against.

  Going through the route means the page and the operator's flip read the same
  state, because there is only one place that state lives.

  The instance-to-instance case in Lane 1's src/demo/README is unchanged and still
  needs a durable store: two serverless instances still hold two memories. What
  this removes is the failure that happens every time rather than sometimes.
*/
export async function readDemoTarget(): Promise<DemoTarget> {
  const empty = {
    variant: null,
    toolCount: null,
    baselineToolCount: null,
    driftedToolCount: null,
    addedTools: [],
  };

  try {
    const requestHeaders = await headers();
    const host = requestHeaders.get("host") ?? "localhost";
    const protocol =
      requestHeaders.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.")
        ? "http"
        : "https");

    const response = await fetch(`${protocol}://${host}/api/demo-agent/variant`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        ...empty,
        error: {
          code: "MCP",
          reason: `The demo target control endpoint answered ${response.status}, so which surface is live could not be established.`,
          retryable: true,
        },
      };
    }

    const body = (await response.json()) as {
      variant: ToolSurfaceVariant;
      toolCount: number;
      baselineToolCount: number;
      driftedToolCount: number;
      driftAddedTools: string[];
    };

    return {
      variant: body.variant,
      toolCount: body.toolCount,
      baselineToolCount: body.baselineToolCount,
      driftedToolCount: body.driftedToolCount,
      addedTools: body.driftAddedTools ?? [],
      error: null,
    };
  } catch (thrown) {
    // Unknown beats a guess. A line that asserts the surface has to be able to
    // say it could not read it.
    return { ...empty, error: toRenderableError(thrown) };
  }
}
