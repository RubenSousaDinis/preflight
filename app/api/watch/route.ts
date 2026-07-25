import { vetAgent } from "@/src/gates/vet/vet-agent";
import { AgentWatcher } from "@/src/validator/watcher";
import type { ClientVerdict, WatchFrame } from "@/app/lib/watch-view";

/*
  Beat 4, streamed.

  A5's watcher polls the target; after every poll each client re-runs the gate and
  all their answers go out in one frame. Simultaneity is the claim being made, so
  the clients are run concurrently and rendered together rather than one after
  another, which would read as a script.

  Nothing here publishes and nothing here re-grades. The drop the beat shows is
  caused by the live tool surface no longer matching the surface that was attested,
  which the gate checks on every call, so it needs no new attestation to fire.
*/
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 4_000;
const MAX_MS = 240_000;

/*
  How many clients re-run the gate each poll, and why the default is one.

  Measured against the event RPC on Base Sepolia: one vetAgent call takes about
  twenty one seconds and returns HIRE. Four run concurrently and three of them come
  back "the validation registry could not be read", because the registry read is
  several RPC calls and the endpoint rate limits a burst. Staggering them two and a
  half seconds apart does not help. Four run sequentially and all four succeed, at
  eighty four seconds a round, which is not a beat.

  So the honest fan-out on this endpoint is one. A screen showing four clients where
  three failed on throttling would be reporting the RPC, not the propagation, and a
  refusal caused by a rate limit is a true refusal about the wrong thing.

  Raise PREFLIGHT_WATCH_CLIENTS once the endpoint allows it: the clients already run
  concurrently and render together, so nothing but this number changes.
*/
function clientNames(): string[] {
  const raw = Number(process.env.PREFLIGHT_WATCH_CLIENTS ?? "1");
  const count = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 4) : 1;
  return Array.from({ length: count }, (_unused, index) => `client-${index + 1}`);
}

async function clientVerdicts(agentId: string): Promise<ClientVerdict[]> {
  const results = await Promise.all(
    clientNames().map(async (client): Promise<ClientVerdict> => {
      try {
        const decision = await vetAgent(agentId);
        return {
          client,
          verdict: decision.verdict,
          reason: decision.reason,
          grade: decision.grade,
          fingerprintMatch: decision.fingerprintMatch,
        };
      } catch (thrown) {
        // A client that could not reach a verdict refuses. There is no path here
        // where a failed check renders as a client still willing to hire.
        return {
          client,
          verdict: "REFUSE",
          reason:
            thrown instanceof Error
              ? thrown.message
              : "the gate could not reach a verdict",
          grade: null,
          fingerprintMatch: null,
        };
      }
    }),
  );
  return results;
}

export async function POST(request: Request) {
  let agentId = "";
  try {
    const body = (await request.json()) as { agentId?: unknown };
    if (typeof body.agentId === "string") agentId = body.agentId.trim();
  } catch {
    // No body is no agent, which the guard below refuses.
  }

  if (agentId.length === 0 || agentId.length > 100) {
    return Response.json(
      {
        code: "AGENT_RESOLVE",
        reason: "No agent id was given, so there was nothing to watch.",
        retryable: false,
      },
      { status: 400 },
    );
  }

  const watcher = new AgentWatcher(agentId);
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (frame: WatchFrame) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };

      try {
        while (Date.now() - startedAt < MAX_MS) {
          if (request.signal.aborted) break;

          const observation = await watcher.check();
          send({ kind: "observation", observation });
          send({
            kind: "clients",
            at: observation.at,
            clients: await clientVerdicts(agentId),
          });

          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        send({
          kind: "closed",
          reason: request.signal.aborted
            ? "the watch was stopped"
            : "the watch reached its time limit",
        });
      } catch (thrown) {
        send({
          kind: "failed",
          reason:
            thrown instanceof Error ? thrown.message : "the watch stopped early",
        });
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
