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
  How many clients re-run the gate each poll.

  This was one. Measured against the event RPC on Base Sepolia, one vetAgent call took
  about twenty one seconds, and four run concurrently came back three refusals reading
  "the validation registry could not be read", because the endpoint rate limited the
  burst. A screen showing three clients failing on throttling reports the RPC, not the
  propagation, so the fan-out was cut to one.

  What made the read expensive was the reader, not the chain: it walked a 90,000 block
  lookback in 900 block windows, a hundred calls, and that is what saturated the
  limiter. The window is now asked for wide (see LOG_WINDOW_LADDER), and re-measured
  on 2026-07-25 against the same endpoint one call takes 2.7 seconds and four
  concurrent clients all return HIRE in 2.6 seconds, none of them throttled.

  So the fan-out is four, which is what the beat needs: simultaneity is the claim, and
  one client cannot show it. A throttle that does happen is now retried inside the read
  rather than rendered as a verdict about an agent.
*/
function clientNames(): string[] {
  const raw = Number(process.env.PREFLIGHT_WATCH_CLIENTS ?? "4");
  const count = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 4) : 1;
  return Array.from({ length: count }, (_unused, index) => `client-${index + 1}`);
}

async function clientVerdicts(
  agentId: string,
  chainId?: number,
): Promise<ClientVerdict[]> {
  const results = await Promise.all(
    clientNames().map(async (client): Promise<ClientVerdict> => {
      try {
        const decision = await vetAgent(agentId, undefined, {
          resolve: chainId !== undefined ? { chainId } : undefined,
        });
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
  let chainId: number | undefined;
  try {
    const body = (await request.json()) as {
      agentId?: unknown;
      chainId?: unknown;
    };
    if (typeof body.agentId === "string") agentId = body.agentId.trim();
    if (
      typeof body.chainId === "number" &&
      (body.chainId === 8453 || body.chainId === 84532)
    ) {
      chainId = body.chainId;
    }
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

  const watcher = new AgentWatcher(agentId, {
    resolve: chainId !== undefined ? { chainId } : undefined,
  });
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
            clients: await clientVerdicts(agentId, chainId),
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
