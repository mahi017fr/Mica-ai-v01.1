import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ethers } from "ethers";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { address, message, signature, isMock } = req.body;

    if (!address || !message || !signature) {
      return res.status(400).json({ error: "Missing address, message, or signature" });
    }

    // If simulated/mock, allow sandbox bypass for the preview iframe environment
    if (isMock) {
      return res.status(200).json({
        success: true,
        address: address.toLowerCase(),
        uid: `wallet_${address.toLowerCase()}`,
      });
    }

    // Recover signer's address from signature
    const recoveredAddress = ethers.verifyMessage(message, signature);

    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: "Cryptographic signature validation failed" });
    }

    return res.status(200).json({
      success: true,
      address: recoveredAddress,
      uid: `wallet_${recoveredAddress.toLowerCase()}`,
    });
  } catch (err: any) {
    console.error("Signature recovery failed:", err);
    return res.status(500).json({ error: "Error during signature verification: " + err.message });
  }
}
