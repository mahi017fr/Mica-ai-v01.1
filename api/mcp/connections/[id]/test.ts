// Dedicated Vercel Serverless Function for the MCP probe route:
//
//   POST /api/mcp/connections/:id/test
//
// WHY THIS FILE EXISTS
// Outside Next.js, Vercel's /api filesystem routing does NOT support catch-all
// (`[...path]`) files: they only receive a single path segment, so this
// three-segment URL was answered by the platform with a text/plain 404
// (`X-Vercel-Error: NOT_FOUND`) that never reached our code — the browser then
// reported "Server returned 404" even though the MCP server itself was fine.
// `[id]` IS supported, so this exact-path function hands the request to the
// SAME gateway handler used everywhere else — identical authentication, CORS,
// diagnostics, route resolution, MCP handshake and JSON error envelopes.
//
// The actual probe lives in api/_lib/mcpProbe.ts and is the exact same
// `openMcpSession()` + `listTools()` handshake the MCP agent uses, so the Test
// button and Agent Mode always agree about whether a server is reachable.
//
// SECURITY: no MCP secret, API key or token is read, written or logged here.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handler } from "../../gateway.js";

/** The `:id` this function was matched on, from Vercel's dynamic param. */
function readConnectionId(req: VercelRequest): string {
  const raw = req.query.id;
  const fromQuery = Array.isArray(raw) ? raw[0] : raw;
  if (typeof fromQuery === "string" && fromQuery.length > 0) return fromQuery;

  // Fallback: the segment immediately after "connections" in the original URL
  // (the segment after that is the literal "test", not the id).
  const segments = (req.url ?? "").split("?")[0].split("/").filter(Boolean);
  const at = segments.lastIndexOf("connections");
  const id = at >= 0 && segments[at + 1] ? segments[at + 1] : "";
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export default async function connectionTestHandler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // The gateway derives the route from `req.query.path`, which only exists for
  // dynamic-segment files. Pin the shape explicitly: connections/:id/test.
  req.query.path = ["connections", readConnectionId(req), "test"];
  await handler(req, res);
}
