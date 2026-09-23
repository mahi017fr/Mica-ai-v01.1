import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleDealFundingStatus } from "../../_lib/bdtDealPaymentService.js";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
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
  try {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Content-Type", "text/plain");
      res.status(200).end();
      return;
    }
    if (req.method !== "GET") {
      jsonResponse(res, 405, { ok: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
      return;
    }
    const result = await handleDealFundingStatus(req.headers.authorization, req.query.fundingId);
    jsonResponse(res, result.httpStatus, result.body);
  } catch (err: unknown) {
    console.error("[GET /api/bdt/deal-funding/:id] OUTER ERROR:", err instanceof Error ? err.message.slice(0, 200) : String(err));
    jsonResponse(res, 500, { ok: false, error: "Internal error reading deal funding.", code: "SERVER_ERROR" });
  }
}