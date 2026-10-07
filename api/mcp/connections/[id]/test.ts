// Dedicated Vercel Serverless Function for the MCP probe route:
//
//   POST /api/mcp/connections/:id/test
//
// WHY THIS FILE EXISTS
// Outside Next.js, Vercel's /api filesystem routing does NOT support catch-all
// (`[...path]`) files: they only receive a single path segment, so this
// three-segment URL was answered by the platform with a 404
// (X-Vercel-Error: NOT_FOUND) and never reached our code. `[id]` IS supported,
// so this exact-path function hands the request to the same gateway handler
// used everywhere else — identical authentication, CORS, diagnostics, route
// resolution, MCP handshake and JSON error envelopes.
//
// SECURITY: no MCP secret, API key or token is read or logged here.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handler } from "../../[...path].js";

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
