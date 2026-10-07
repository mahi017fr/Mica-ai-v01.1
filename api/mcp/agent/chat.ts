// Dedicated Vercel Serverless Function for the MCP agent chat endpoint:
//
//   POST /api/mcp/agent/chat
//
// WHY THIS FILE EXISTS
// Outside Next.js, Vercel's /api filesystem routing does NOT support catch-all
// (`[...path]`) files: it treats them as a single dynamic segment. A request to
// /api/mcp/agent/chat therefore never reached api/mcp/[...path].ts and Vercel
// answered with a platform 404 (X-Vercel-Error: NOT_FOUND, text/plain) — while
// localhost worked, because server.ts / vite.config.ts dispatch path segments
// themselves instead of relying on file-system routing.
//
// An exact-path file is routed reliably at any depth, so this module exists to
// hand the request to the SAME gateway handler used by every other /api/mcp/*
// route: authentication, CORS, diagnostics, route resolution, MCP tool calling
// and JSON error envelopes are byte-identical to local development.
//
// SECURITY: no MCP secret, API key or token is read or logged here.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handler } from "../[...path].js";

export default async function agentChatHandler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // The gateway derives the route from `req.query.path`, which only exists for
  // dynamic-segment files. This file has none, so pin the segments explicitly.
  req.query.path = ["agent", "chat"];
  await handler(req, res);
}
