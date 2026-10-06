// Consolidated MCP Connections gateway — ONE Vercel Serverless Function for
// every /api/mcp/* route. Public URLs are unchanged:
//
//   GET    /api/mcp/connections             -> list connections (safe fields only)
//   POST   /api/mcp/connections             -> create a connection
//   PATCH  /api/mcp/connections/:id         -> update a connection
//   DELETE /api/mcp/connections/:id         -> delete a connection
//   POST   /api/mcp/connections/:id/test    -> probe the MCP server, store status
//
// Routing follows Vercel's file-based convention: a `[...path]` file in /api
// becomes a catch-all function served at its folder path. Each segment of the
// requested URL is delivered via `req.query.path`.
//
// This module is a thin transport shell. All logic — authentication, Firestore
// access, encryption, SSRF validation and the MCP handshake — lives in
// api/_lib/mcpConnectionsService.ts so that api/, server.ts and vite.config.ts
// all execute byte-identical behaviour.
//
// SECURITY: no MCP secret is read, written, logged or returned by this file.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  dispatchMcpRoute,
  resolveMcpRoute,
  mcpRouteNotFound,
  MCP_ROUTE_METHODS,
} from "../_lib/mcpConnectionsService.js";

/**
 * Always return valid JSON — never HTML, never empty. Uses
 * res.end(JSON.stringify(...)) so output is guaranteed even if res.json() throws.
 */
function jsonResponse(
  res: VercelResponse,
  status: number,
  body: Record<string, unknown>
): void {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(status);
    res.end(JSON.stringify(body));
  } catch {
    // Last-resort: if even res.end fails, write raw bytes.
    try {
      if (!res.writableEnded) {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end('{"ok":false,"error":"response write failed","code":"SERVER_ERROR"}');
      }
    } catch {
      // Nothing more we can do.
    }
  }
}

function readPathSegments(req: VercelRequest): string[] {
  const raw = req.query.path;
  const fromQuery = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.length > 0
      ? [raw]
      : [];
  if (fromQuery.length > 0) return fromQuery;

  const urlPath = (req.url ?? "").split("?")[0];
  const prefix = "/api/mcp/";
  return urlPath.startsWith(prefix)
    ? urlPath.slice(prefix.length).split("/").filter(Boolean)
    : [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── Outermost guard: ANY uncaught error still returns JSON ───────────
  try {
    const segments = readPathSegments(req);
    const resolved = resolveMcpRoute(req.method, segments);

    res.setHeader("Access-Control-Allow-Origin", "*");

    if (!resolved) {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (req.method === "OPTIONS") {
        res.setHeader("Content-Type", "text/plain");
        res.status(200).end();
        return;
      }
      // Shared with vite.config.ts so all runtimes return identical status codes.
      const miss = mcpRouteNotFound(req.method, segments);
      jsonResponse(res, miss.httpStatus, miss.body);
      return;
    }

    const allowedMethods = [...MCP_ROUTE_METHODS[resolved.key], "OPTIONS"];
    res.setHeader("Access-Control-Allow-Methods", allowedMethods.join(","));
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.setHeader("Content-Type", "text/plain");
      res.status(200).end();
      return;
    }

    const authHeader =
      typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const result = await dispatchMcpRoute(resolved.key, authHeader, resolved.id, body);
    jsonResponse(res, result.httpStatus, result.body);
  } catch (outerErr: unknown) {
    // Log the error type only, never a message that might carry a value
    // echoed back from a user's MCP server.
    console.error(
      "[api/mcp] OUTER ERROR:",
      outerErr instanceof Error ? outerErr.name : typeof outerErr
    );
    jsonResponse(res, 500, { ok: false, error: "Internal MCP service error.", code: "SERVER_ERROR" });
  }
}
