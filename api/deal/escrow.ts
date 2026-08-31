import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleDealEscrow } from "../_lib/dealEscrowService.js";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  try {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }

    if (req.method === "OPTIONS") {
      res.setHeader("Content-Type", "text/plain");
      res.status(200).end();
      return;
    }

    if (req.method !== "POST") {
      jsonResponse(res, 405, { ok: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
      return;
    }

    console.log("[POST /api/deal/escrow] ENTER", { method: req.method });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await handleDealEscrow(req.headers.authorization, body);
    jsonResponse(res, result.httpStatus, result.body as unknown as Record<string, unknown>);
    console.log("[POST /api/deal/escrow] EXIT", {
      httpStatus: result.httpStatus,
      ok: (result.body as { ok?: unknown }).ok === true,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err ?? "handler crashed");
    console.error("[POST /api/deal/escrow] OUTER ERROR:", message.slice(0, 200));
    jsonResponse(res, 500, { ok: false, error: "Internal error while executing the escrow write.", code: "SERVER_ERROR" });
  }
}
