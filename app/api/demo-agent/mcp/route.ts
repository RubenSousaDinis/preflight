import { handleMcpRequest } from "@/src/demo/mcp-server";

/*
  E1's MCP endpoint. A thin wrapper on purpose: every behaviour lives in
  src/demo/, where Lane 1 tests it, and this file exists only because app/ is not
  Lane 1's to write. Nothing here should grow logic of its own.
*/
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export async function GET(request: Request) {
  return handleMcpRequest(request);
}
