import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleEnsureWallet } from "../_lib/circleWalletService";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Always return valid JSON — never HTML, never empty.
 * Uses res.end(JSON.stringify(...)) instead of res.json() to guarantee
 * JSON output even if Express's res.json() throws.
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
        res.end('{"ok":false,"error":"response write failed"}');
      }
    } catch {
      // Nothing more we can do.
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── Outermost guard: ANY uncaught error returns JSON ───────────────
  try {
    // ── CORS preflight ──────────────────────────────────────────────
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }

    if (req.method === "OPTIONS") {
      res.setHeader("Content-Type", "text/plain");
      res.status(200).end();
      return;
    }

    if (req.method !== "POST") {
      jsonResponse(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    // ── Extract Firebase ID token ───────────────────────────────────
    const authHeader = req.headers.authorization ?? "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) {
      jsonResponse(res, 401, { ok: false, error: "Missing Firebase ID token in Authorization header." });
      return;
    }

    // ── Inner try/catch for wallet logic ────────────────────────────
    try {
      const wallet = await handleEnsureWallet(idToken);
      jsonResponse(res, 200, {
        ok: true,
        wallet: {
          walletId: wallet.walletId,
          address: wallet.address,
          blockchain: wallet.blockchain,
          state: wallet.state,
          ensuredAt: wallet.ensuredAt,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err ?? "unknown error");
      console.error("[POST /api/wallet/ensure] Error:", message);

      if (message.includes("not configured") || message.includes("not initialized")) {
        jsonResponse(res, 500, { ok: false, error: `Server configuration error: ${String(message).slice(0, 200)}` });
        return;
      }
      if (message.includes("verifyIdToken") || message.includes("auth/")) {
        jsonResponse(res, 401, { ok: false, error: "Invalid or expired Firebase ID token." });
        return;
      }

      jsonResponse(res, 500, { ok: false, error: `Wallet ensure failed: ${String(message).slice(0, 200)}` });
    }
  } catch (outerErr: unknown) {
    // Absolutely last-resort: return JSON no matter what.
    const msg = outerErr instanceof Error ? outerErr.message : String(outerErr ?? "handler crashed");
    console.error("[POST /api/wallet/ensure] OUTER ERROR:", msg);
    jsonResponse(res, 500, { ok: false, error: `Internal error: ${msg.slice(0, 200)}` });
  }
}
