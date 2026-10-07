// Dedicated Vercel Serverless Function for the per-connection routes:
//
//   PATCH  /api/mcp/connections/:id
//   DELETE /api/mcp/connections/:id
//
// WHY THIS FILE EXISTS
// Outside Next.js, Vercel's /api filesystem routing does NOT support catch-all
// (`[...path]`) files: it treats them as a single dynamic segment, so anything
// deeper than /api/mcp/<one-segment> was answered by the platform with a 404
// (X-Vercel-Error: NOT_FOUND) and never reached our code. `[id]` IS supported,
// so this exact-path function delivers the request to the same gateway handler
// used everywhere else — identical authentication, CORS, diagnostics, route
// resolution and JSON error envelopes.
//
// SECURITY: no MCP secret, API key or token is read or logged here.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handler } from "../[...path].js";

/** The `:id` this function was matched on, from Vercel's dynamic param. */
function readConnectionId(req: VercelRequest): string {
  const raw = req.query.id;
  const fromQuery = Array.isArray(raw) ? raw[0] : raw;
  if (typeof fromQuery === "string" && fromQuery.length > 0) return fromQuery;

  // Fallback: the segment immediately after "connections" in the original URL.
  const segments = (req.url ?? "").split("?")[0].split("/").filter(Boolean);
  const at = segments.lastIndexOf("connections");
  const id = at >= 0 && segments[at + 1] ? segments[at + 1] : "";
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export default async function connectionItemHandler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // The gateway derives the route from `req.query.path`, which only exists for
  // dynamic-segment files. Pin the shape explicitly: connections/:id.
  req.query.path = ["connections", readConnectionId(req)];
  await handler(req, res);
}
