// Consolidated MCP gateway — ONE Vercel Serverless Function for every
// /api/mcp/* route. Public URLs are unchanged:
//
//   GET    /api/mcp/connections             -> list connections (safe fields only)
//   POST   /api/mcp/connections             -> create a connection
//   PATCH  /api/mcp/connections/:id         -> update a connection
//   DELETE /api/mcp/connections/:id         -> delete a connection
//   POST   /api/mcp/connections/:id/test    -> probe the MCP server, store status
//   POST   /api/mcp/agent/chat              -> MCP-enabled agent chat turn
//
// Routing follows Vercel's file-based convention. NOTE: outside Next.js,
// Vercel treats `[...path]` as a SINGLE dynamic segment (equivalent to
// `[path]`), so this file only receives one segment (/api/mcp/<segment>).
// Deeper paths such as /api/mcp/agent/chat or /api/mcp/connections/:id/test
// are forwarded here by `rewrites` in vercel.json: the rewrite destination
// passes the full remaining path as `?path=<a/b/c>`, and readPathSegments()
// below splits it back into segments. Requests that reach the function
// directly (single-segment paths) are parsed from req.url instead.
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
import { redactSecrets, redactSecretsUnbounded } from "../_lib/mcpProbe.js";

// ─────────────────────────────────────────────────────────────────────────────
// Production diagnostics.
//
// A deployment failure is invisible from localhost: the browser only shows a
// generic sentence, so the log is the only place that can tell a missing
// environment variable apart from a rejected Firebase token.
//
// INVARIANTS — these lines must never contain:
//   API keys, Firebase service-account material, MICA_SECRET_ENCRYPTION_KEY,
//   MCP bearer tokens or decrypted MCP credentials.
// Every value written here is a boolean, a number, a route segment, an error
// name, or text that has passed through `redactSecrets()`.
// ─────────────────────────────────────────────────────────────────────────────

/** Server-side variables the MCP agent flow cannot run without. */
const MCP_REQUIRED_ENV = [
  "GROQ_API_KEY",
  "MICA_SECRET_ENCRYPTION_KEY",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
] as const;

function logDiag(entry: Record<string, unknown>): void {
  try {
    console.log("[mcp/diag]", JSON.stringify(entry));
  } catch {
    // Logging must never be able to break the HTTP response.
  }
}

/** Presence only — never the value. */
function envPresence(): Record<string, boolean> {
  const present: Record<string, boolean> = {};
  for (const name of MCP_REQUIRED_ENV) {
    present[name] = Boolean(process.env[name] && String(process.env[name]).trim());
  }
  return present;
}

/**
 * Exact `name` / `message` / `stack` for the log, with credential-shaped
 * material stripped first. Bounded so a hostile error cannot flood the log.
 */
function describeError(err: unknown): { name: string; message: string; stack: string } {
  const name = err instanceof Error ? err.name : typeof err;
  const rawMessage = err instanceof Error ? err.message : String(err ?? "unknown error");
  const rawStack = err instanceof Error && err.stack ? err.stack : "";
  return {
    name,
    message: redactSecrets(rawMessage, []),
    stack: redactSecretsUnbounded(rawStack, []).slice(0, 600),
  };
}

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
    ? raw.flatMap((s) => s.split("/")).filter(Boolean)
    : typeof raw === "string" && raw.length > 0
      ? raw.split("/").filter(Boolean)
      : [];
  if (fromQuery.length > 0) return fromQuery;

  const urlPath = (req.url ?? "").split("?")[0];
  const prefix = "/api/mcp/";
  return urlPath.startsWith(prefix)
    ? urlPath.slice(prefix.length).split("/").filter(Boolean)
    : [];
}

export async function handler(req: VercelRequest, res: VercelResponse) {
  // ── Outermost guard: ANY uncaught error still returns JSON ───────────
  try {
    const segments = readPathSegments(req);
    const resolved = resolveMcpRoute(req.method, segments);

    logDiag({
      step: "route_reached",
      method: req.method ?? "UNKNOWN",
      path: segments.join("/").slice(0, 120),
      runtime: "node",
      nodeVersion: process.version,
      nodeEnv: process.env.NODE_ENV ?? null,
      isVercel: process.env.VERCEL === "1",
      env: envPresence(),
    });

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
      logDiag({ step: "route_response", status: miss.httpStatus, code: miss.body.code ?? "UNKNOWN" });
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
    logDiag({
      step: "route_response",
      route: resolved.key,
      status: result.httpStatus,
      code:
        typeof result.body?.code === "string"
          ? result.body.code
          : result.body?.ok === true
            ? "OK"
            : "UNKNOWN",
    });
    jsonResponse(res, result.httpStatus, result.body);
  } catch (outerErr: unknown) {
    // Full (redacted) error detail belongs in the server log: the client only
    // ever receives a safe, generic message.
    logDiag({ step: "route_error", ...describeError(outerErr) });
    jsonResponse(res, 500, { ok: false, error: "Internal MCP service error.", code: "SERVER_ERROR" });
  }
}

export default handler;
