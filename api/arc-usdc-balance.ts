import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Contract, JsonRpcProvider, formatUnits, getAddress } from "ethers";

const CHAIN_ID = 5042002;
const USDC = "0x3600000000000000000000000000000000000000";
const provider = new JsonRpcProvider(
  process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io",
  CHAIN_ID,
  { staticNetwork: true }
);
const contract = new Contract(USDC, ["function balanceOf(address) view returns (uint256)"], provider);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const wallet = getAddress(String(req.query.address || ""));
    const raw = await contract.balanceOf(wallet);
    return res.status(200).json({
      ok: true,
      wallet,
      chainId: CHAIN_ID,
      contract: USDC,
      rawBalance: raw.toString(),
      balance: formatUnits(raw, 6),
      decimals: 6,
    });
  } catch (err: any) {
    return res.status(502).json({ ok: false, error: err?.message || "Arc RPC request failed" });
  }
}
