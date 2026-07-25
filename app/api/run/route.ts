import { runTask } from "@/src/demo/harness";
import { railFromEnv, type ConfiguredRail } from "@/src/demo/payment-rail";
import type { TaskSpec } from "@/src/shared";

/*
  Beat 1's run, streamed as it happens.

  The transcript renders the event stream rather than a narration written beside
  it, which only means something if the events arrive as the run makes them. So
  this streams: one server-sent event per HarnessEvent, in order, as the harness
  yields them.

  No gate result is ever injected from here. runTask's own defaults do the vetting,
  so a gate that cannot reach a verdict produces a refusal in the stream rather
  than this route deciding anything.

  The payment rail comes from the environment and is resolved before the first
  byte is written. A misconfigured rail refuses the request; it never falls back
  to the stub, because a deployment that meant to settle would then quietly stop
  settling and the transcript would still read as a completed run.
*/
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TASK = "summarize three sources and return the citations";
const DEFAULT_BUDGET = 1_000_000_000n;

function encodeEvent(event: unknown): string {
  const json = JSON.stringify(event, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return `data: ${json}\n\n`;
}

export async function POST(request: Request) {
  let candidates: string[] = [];
  let task = DEFAULT_TASK;

  try {
    const body = (await request.json()) as {
      candidates?: unknown;
      task?: unknown;
    };
    if (Array.isArray(body.candidates)) {
      candidates = body.candidates
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value.length <= 200)
        .slice(0, 8);
    }
    if (typeof body.task === "string" && body.task.trim().length > 0) {
      task = body.task.trim().slice(0, 300);
    }
  } catch {
    // An unparseable body is an empty candidate list, which the guard below refuses.
  }

  if (candidates.length === 0) {
    return Response.json(
      {
        code: "HARNESS",
        reason:
          "No candidate agents were given, so there was nothing to shop for and no run was made.",
        retryable: false,
      },
      { status: 400 },
    );
  }

  let configured: ConfiguredRail;
  try {
    configured = railFromEnv();
  } catch (thrown) {
    return Response.json(
      {
        code: "CONFIG",
        reason:
          thrown instanceof Error
            ? thrown.message
            : "the payment rail for this deployment could not be resolved, so no run was made.",
        retryable: false,
      },
      { status: 500 },
    );
  }

  const spec: TaskSpec = { budget: DEFAULT_BUDGET, task, candidates };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const event of runTask(spec, {
          rail: configured.rail,
          payTo: configured.payTo,
        })) {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        }
      } catch (thrown) {
        // The run died rather than reaching `done`. The transcript has to see that,
        // because a stream that simply stops reads as a run that finished.
        const reason =
          thrown instanceof Error ? thrown.message : "the run failed to complete";
        controller.enqueue(
          encoder.encode(
            encodeEvent({ type: "runFailed", at: 0, reason }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  });
}
