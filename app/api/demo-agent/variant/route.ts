import { handleControlRequest } from "@/src/demo/control";

/*
  E1's variant control. Reads are open so the console and the runbook can assert
  which surface is live before a run; a flip needs DEMO_CONTROL_TOKEN and is
  refused without it. Thin wrapper, same rule as the MCP route.
*/
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleControlRequest(request);
}

export async function POST(request: Request) {
  return handleControlRequest(request);
}
