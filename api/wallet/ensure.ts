import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleEnsureWallet } from "../../src/server/circleWalletService";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", CORS_HEADERS["Access-Control-Allow-Origin"]);
  res.setHeader("Access-Control-Allow-Methods", CORS_HEADERS["Access-Control-Allow-Methods"]);
  res.setHeader("Access-Control-Allow-Headers", CORS_HEADERS["Access-Control-Allow-Headers"]);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Extract Firebase ID token from Authorization header.
  const authHeader = req.headers.authorization ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) {
    return res.status(401).json({ error: "Missing Firebase ID token in Authorization header." });
  }

  try {
    const wallet = await handleEnsureWallet(idToken);
    return res.status(200).json({
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
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/wallet/ensure] Error:", message);

    if (message.includes("not configured") || message.includes("not initialized")) {
      return res.status(500).json({ error: `Server configuration error: ${String(message).slice(0, 120)}` });
    }
    if (message.includes("verifyIdToken") || message.includes("auth/")) {
      return res.status(401).json({ error: "Invalid or expired Firebase ID token." });
    }

    return res.status(500).json({ error: `Wallet ensure failed: ${String(message).slice(0, 120)}` });
  }
}
