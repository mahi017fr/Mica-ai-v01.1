// Dedicated Vercel Serverless Function for the per-connection routes:
//
//   PATCH  /api/mcp/connections/:id
//   DELETE /api/mcp/connections/:id
//
// WHY THIS FILE EXISTS
// Outside Next.js, Vercel's /api filesystem routing does NOT support catch-all
// (`[...path]`) files: they only receive a single path segment. A request to
// /api/mcp/connections/:id (two segments) therefore never reached the gateway
// and Vercel answered with a platform 404 (`X-Vercel-Error: NOT_FOUND`,
// text/plain) that never reached our code. `[id]` IS supported, so this
// exact-path function hands the request to the SAME gateway handler used by
// every other /api/mcp/* route — identical authentication, CORS, diagnostics,
// route resolution, encryption, SSRF validation and JSON error envelopes.
//
// SECURITY: no MCP secret, API key or token is read, written or logged here.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handler } from "../gateway.js";

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
