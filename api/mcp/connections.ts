// Dedicated Vercel Serverless Function for the MCP connections collection:
//
//   GET  /api/mcp/connections   -> list connections
//   POST /api/mcp/connections   -> create a connection
//
// WHY THIS FILE EXISTS
// Outside Next.js, Vercel's /api filesystem routing does NOT support catch-all
// (`[...path]`) files: they only receive a single path segment, and a rewrite
// cannot be relied on to route POST/PATCH/DELETE requests to the gateway. Any
// URL that did not match an actual file was answered by the platform with a
// text/plain 404 (`X-Vercel-Error: NOT_FOUND`) that never reached our code, so
// the browser saw a body it could not parse and reported "Server returned 404".
//
// An exact-path file is routed reliably, so this module physically deploys the
// route and hands the request to the SAME gateway handler used by every other
// /api/mcp/* route — authentication, CORS, diagnostics, route resolution,
// encryption, SSRF validation and JSON error envelopes are identical to local
// development and to the /api/mcp/gateway function.
//
// SECURITY: no MCP secret, API key or token is read, written or logged here.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handler } from "./gateway.js";

export default async function connectionsCollectionHandler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // The gateway derives the route from `req.query.path`, which only exists for
  // dynamic-segment files. Pin the shape explicitly: connections.
  req.query.path = ["connections"];
  await handler(req, res);
}
