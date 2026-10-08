// Dedicated Vercel Serverless Function for the MCP agent chat endpoint:
//
//   POST /api/mcp/agent/chat
//
// WHY THIS FILE EXISTS
// Outside Next.js, Vercel's /api filesystem routing does NOT support catch-all
// (`[...path]`) files: it treats them as a single dynamic segment. A request to
// /api/mcp/agent/chat (two segments) therefore never reached api/mcp/[any].
// An exact-path function is routed reliably at any depth, so this module
// physically deploys the route and hands the request to the SAME gateway
// handler used by every other /api/mcp/* route — authentication, CORS,
// diagnostics, route resolution, MCP tool calling and JSON error envelopes
// are identical to local development and to the /api/mcp/gateway function.
//
// The gateway derives segments from `req.query.path`, a query param that only
// exists for dynamic-segment files. This file matches an exact URL with no
// such param, so the segments are pinned explicitly below.
//
// SECURITY: no MCP secret, API key or token is read, written or logged here.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handler } from "../gateway.js";

export default async function agentChatHandler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  req.query.path = ["agent", "chat"];
  await handler(req, res);
}