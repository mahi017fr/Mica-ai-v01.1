import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { ethers } from "ethers";
import { v2 as cloudinary } from "cloudinary";
import formidable from "formidable";
import { handleEnsureWallet } from "./api/_lib/circleWalletService";
import { handleSendUsdc } from "./api/_lib/sendUsdcService";

function logDiag(entry: Record<string, unknown>) {
  console.log("[WALLET_DIAG]", JSON.stringify(entry));
}

const arcReadProvider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io", 5042002, { staticNetwork: true });
const arcBalanceInflight = new Map<string, Promise<any>>();
const arcSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function readArcUsdcBalance(address: string) {
  let last: any;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await new ethers.Contract("0x3600000000000000000000000000000000000000", ["function balanceOf(address) view returns (uint256)"], arcReadProvider).balanceOf(address);
    } catch (err) {
      last = err;
      if (attempt < 3) await arcSleep(Math.min(2000, 500 * 2 ** attempt));
    }
  }
  throw last;
}

// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for body parsing
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  // Configure Cloudinary
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  // --- API Routes ---

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Circle Developer-Controlled Wallet: ensure one wallet per uid.
  app.post("/api/wallet/ensure", async (req, res) => {
    res.type("application/json");
    try {
      const authHeader = req.headers.authorization ?? "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!idToken) {
        return res.status(401).json({ ok: false, error: "Missing Firebase ID token." });
      }
      logDiag({ step: "received_request", hasAuth: Boolean(authHeader.startsWith("Bearer ")), idTokenLen: idToken.length, circleApiKeySet: Boolean(process.env.CIRCLE_API_KEY), entitySecretSet: Boolean(process.env.CIRCLE_ENTITY_SECRET), walletSetIdSet: Boolean(process.env.CIRCLE_WALLET_SET_ID) });

      const wallet = await handleEnsureWallet(idToken);
      logDiag({ step: "wallet_ensured_ok", address: wallet.address, walletId: wallet.walletId, blockchain: wallet.blockchain, state: wallet.state });
      return res.json({
        ok: true,
        wallet: {
          walletId: wallet.walletId,
          address: wallet.address,
          blockchain: wallet.blockchain,
          state: wallet.state,
          ensuredAt: wallet.ensuredAt,
        },
      });
    } catch (err: any) {
      const message = err?.message || String(err);
      console.error("[POST /api/wallet/ensure] Error:", message);
      logDiag({ step: "caught_exception", message: String(message).slice(0, 300), name: err?.name, stackSnippet: err?.stack ? String(err.stack).slice(0, 400) : null });
      if (message.includes("not configured") || message.includes("not initialized")) {
        return res.status(500).json({ ok: false, error: `Server configuration error: ${String(message).slice(0, 120)}` });
      }
      if (message.includes("verifyIdToken") || message.includes("auth/")) {
        return res.status(401).json({ ok: false, error: "Invalid Firebase ID token." });
      }
      return res.status(500).json({ ok: false, error: `Wallet ensure failed: ${String(message).slice(0, 120)}` });
    }
  });

  // Circle Developer-Controlled Wallet: USDC transfer between MICA users.
  app.post("/api/wallet/send-usdc", async (req, res) => {
    res.type("application/json");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    try {
      const result = await handleSendUsdc(req.headers.authorization, req.body ?? {});
      return res.status(result.httpStatus).json(result.body);
    } catch (err: any) {
      const message = err?.message || String(err);
      console.error("[POST /api/wallet/send-usdc] OUTER ERROR:", String(message).slice(0, 200));
      return res.status(500).json({ ok: false, error: "Internal error while sending USDC.", code: "SERVER_ERROR" });
    }
  });

  app.get("/api/arc-usdc-balance", async (req, res) => {
    res.type("application/json");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    try {
      const address = ethers.getAddress(String(req.query.address || ""));
      const key = address.toLowerCase();
      let request = arcBalanceInflight.get(key);
      if (!request) { request = readArcUsdcBalance(address); arcBalanceInflight.set(key, request); }
      let raw;
      try { raw = await request; }
      finally { if (arcBalanceInflight.get(key) === request) arcBalanceInflight.delete(key); }
      const formatted = ethers.formatUnits(raw, 6);
      res.json({ ok: true, wallet: address, chainId: 5042002, contract: "0x3600000000000000000000000000000000000000", rawBalance: raw.toString(), balance: formatted, decimals: 6 });
    } catch (err: any) { res.status(400).json({ ok: false, error: err?.message || "Unable to fetch balance" }); }
  });

  // Groq AI Chat Proxy Route
  app.post("/api/bot/chat", async (req, res) => {
    try {
      const { messages, systemInstruction } = req.body;
      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: "Missing or invalid messages array" });
        return;
      }

      const apiKey = process.env.GROQ_API_KEY;
      
      const defaultSystem = "You are a very friendly, helpful, and concise AI Assistant named MAHI, developed by and under the MAHIX company. You converse in a normal, highly friendly, and warm manner. Your answers MUST be short, sweet, and to the point. Always write responses in the same language as the user's message (Bengali, English, or any other language) and maintain a modern, friendly vibe.";
      const systemContent = systemInstruction || defaultSystem;

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: systemContent
            },
            ...messages
          ],
          temperature: 0.7,
          max_tokens: 1024
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Groq API returned error status:", response.status, errText);
        res.status(response.status).json({ error: `Groq API Error: ${errText}` });
        return;
      }

      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      console.error("Groq Chat endpoint failed:", err);
      res.status(500).json({ error: err.message || "Internal Server Error" });
    }
  });

  // Fetch public credentials (to keep design clean and avoid hardcoding variables in frontend bundle)
  app.get("/api/config", (req, res) => {
    res.json({
      privyAppId: "cmqf5t8me00ls0cl86fkcuczj",
      apiHost: process.env.APP_URL || "https://sendxx.netlify.app/",
    });
  });

  // Verify Web3 Wallet Personal Signatures
  app.post("/api/auth/verify-wallet", async (req, res) => {
    try {
      const { address, message, signature, isMock } = req.body;

      if (!address || !message || !signature) {
        res.status(400).json({ error: "Missing address, message, or signature" });
        return;
      }

      // If simulated/mock, allow sandbox bypass for the preview iframe environment
      if (isMock) {
        res.json({
          success: true,
          address: address.toLowerCase(),
          uid: `wallet_${address.toLowerCase()}`,
        });
        return;
      }

      // Recover signer's address from signature
      const recoveredAddress = ethers.verifyMessage(message, signature);

      if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
        res.status(401).json({ error: "Cryptographic signature validation failed" });
        return;
      }

      res.json({
        success: true,
        address: recoveredAddress,
        uid: `wallet_${recoveredAddress.toLowerCase()}`,
      });
    } catch (err: any) {
      console.error("Signature recovery failed:", err);
      res.status(500).json({ error: "Error during signature verification: " + err.message });
    }
  });

  // Image/Voice Upload API via Cloudinary
  app.post("/api/upload", (req, res) => {
    const form = formidable({
      multiples: false,
      maxFileSize: 25 * 1024 * 1024,
      uploadDir: uploadDir,
      keepExtensions: true,
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error("Formidable parse error:", err);
        res.status(500).json({ error: "File parsing failed: " + err.message });
        return;
      }

      const fileField = files.file;
      const file = Array.isArray(fileField) ? fileField[0] : fileField;

      if (!file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      try {
        const result = await cloudinary.uploader.upload(file.filepath, {
          resource_type: "auto",
          folder: "sendxx_uploads",
        });

        // Clean up the temp file
        fs.unlink(file.filepath, () => {});

        res.json({ success: true, url: result.secure_url });
      } catch (uploadErr: any) {
        console.error("Cloudinary upload failed:", uploadErr);
        res.status(500).json({ error: "Upload failed: " + uploadErr.message });
      }
    });
  });

  // --- Vite Dev Server Middleware vs Serve Build ---
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode with Vite Middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode with static files...");
    const distPath = path.join(process.cwd(), "dist");
    
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Critical server bootstrap failure:", error);
});
