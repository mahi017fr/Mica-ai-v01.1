import { Contract, formatUnits } from "ethers";
import type { EIP1193Provider } from "@privy-io/react-auth";
import { ARC_NETWORK, chainLabel, isArcChainId } from "./arcNetwork";
import { getFreshArcProvider, sleep } from "./arcRpc";

/**
 * Result of an Arc USDC balance lookup.
 * - `checking`  -> request in flight
 * - `no_wallet` -> no verified wallet address available
 * - `wrong_network` -> the connected wallet is NOT on Arc Network
 * - `success`   -> real on-chain Circle USDC balance (6 decimals)
 * - `error`     -> RPC / network failure while fetching (after retries)
 */
export type ArcBalanceStatus =
  | { status: "checking" }
  | { status: "no_wallet" }
  | { status: "wrong_network"; walletChainId: number | null }
  | { status: "success"; balance: number; formatted: string; decimals: number }
  | { status: "error"; message: string };

// Minimal Circle USDC ERC-20 ABI on Arc. `balanceOf` is exposed at 6-decimal
// precision; `decimals()` is read once and cached (it never changes).
const USDC_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// Cached decimals so repeated balance reads only need ONE `eth_call` (the Arc
// public RPC is flaky — fewer requests per read reduces failures).
let cachedDecimals: number | null = null;

async function readDecimals(): Promise<number> {
  if (cachedDecimals != null) return cachedDecimals;
  try {
    const provider = getFreshArcProvider();
    const contract = new Contract(ARC_NETWORK.usdc.address, USDC_ABI, provider);
    const raw = await contract.decimals();
    const n = Number(raw);
    cachedDecimals = n > 0 ? n : ARC_NETWORK.usdc.decimals;
  } catch (err) {
    console.warn("[Arc] decimals() read failed; using configured value:", err);
    cachedDecimals = ARC_NETWORK.usdc.decimals;
  }
  return cachedDecimals;
}

/**
 * Determine the chain ID the connected wallet is currently on.
 * Authoritative source is `eth_chainId` from the wallet's EIP-1193 provider;
 * falls back to the CAIP-2 `chainId` (e.g. "eip155:5042002") reported by Privy.
 */
export async function getWalletChainId(
  wallet: {
    chainId?: string;
    getEthereumProvider?: () => Promise<EIP1193Provider | null>;
  } | null
): Promise<number | null> {
  if (!wallet) return null;

  // 1) Authoritative: ask the wallet itself.
  try {
    const provider = wallet.getEthereumProvider ? await wallet.getEthereumProvider() : null;
    if (provider) {
      const hex = await provider.request({ method: "eth_chainId", params: [] });
      const n = typeof hex === "string" ? parseInt(hex, 16) : Number(hex);
      if (Number.isFinite(n)) return n;
    }
  } catch (err) {
    console.error("[Arc] eth_chainId via wallet provider failed:", err);
  }

  // 2) Fallback: parse the CAIP-2 chain id Privy reports on the wallet.
  if (wallet.chainId) {
    const part = wallet.chainId.split(":").pop();
    if (part) {
      const n = parseInt(part, 10);
      if (Number.isFinite(n)) return n;
    }
  }

  return null;
}

/**
 * Fetch the REAL Circle USDC balance for the connected wallet.
 *
 * Rules (no mock data, no placeholders):
 * 1. Verifies the connected wallet is actually on Arc Network (chain 5042002).
 *    If it is on another chain -> `wrong_network` (UI prompts to switch).
 * 2. Reads `balanceOf(wallet)` on the Arc Circle USDC ERC-20 contract
 *    `0x3600000000000000000000000000000000000000` via Arc's public RPC.
 * 3. A FRESH provider is created on EVERY attempt — stale provider instances
 *    are never reused.
 * 4. Transient RPC failures are retried (up to `attempts` times) with backoff
 *    so a single flaky request can never permanently break the balance card.
 * 5. Only after all retries are exhausted is `error` returned, carrying the
 *    exact RPC error message (the generic "Unable to fetch your USDC balance."
 *    is shown in the UI ONLY in this case — the balance request itself failed).
 *
 * @param walletAddress  Verified wallet address (from the connected Privy wallet).
 * @param walletChainId  Chain the wallet is currently on (null = unknown).
 * @param attempts       Number of attempts before reporting an error.
 */
export async function fetchArcUsdcBalance(
  walletAddress: string | null | undefined,
  walletChainId: number | null,
  attempts = 3
): Promise<ArcBalanceStatus> {
  if (!walletAddress) {
    return { status: "no_wallet" };
  }

  // 1) Network verification — never show a balance for a wallet on another chain.
  if (walletChainId != null && !isArcChainId(walletChainId)) {
    console.error(
      `[Arc] Wallet connected to ${chainLabel(walletChainId)} (chain ${walletChainId}), expected ${ARC_NETWORK.name} (${ARC_NETWORK.chainId}). Prompting the user to switch.`
    );
    return { status: "wrong_network", walletChainId };
  }

  // 2) Read the real on-chain USDC balance from Arc RPC, retrying each time
  //    with a BRAND-NEW provider.
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const provider = getFreshArcProvider();
      const contract = new Contract(ARC_NETWORK.usdc.address, USDC_ABI, provider);

      const raw = await contract.balanceOf(walletAddress);
      const decimals = await readDecimals();
      const formatted = formatUnits(raw as bigint, decimals);
      const balance = parseFloat(formatted);

      console.info(
        `[Arc] USDC balance for ${walletAddress}: ${balance} USDC (raw=${raw}, decimals=${decimals}, attempt=${attempt}/${attempts})`
      );

      return {
        status: "success",
        balance,
        formatted: balance.toFixed(2),
        decimals,
      };
    } catch (err: any) {
      lastError = err;
      console.warn(
        `[Arc] Balance fetch attempt ${attempt}/${attempts} failed (fresh provider, will retry):`,
        err?.message || err
      );
      if (attempt < attempts) {
        await sleep(600 * attempt);
      }
    }
  }

  console.error(
    `[Arc] Unable to fetch USDC balance from ${ARC_NETWORK.rpcUrl} (chain ${ARC_NETWORK.chainId}, contract ${ARC_NETWORK.usdc.address}) after ${attempts} attempts:`,
    lastError
  );
  return { status: "error", message: (lastError as any)?.message || String(lastError) };
}
