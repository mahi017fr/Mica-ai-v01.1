// Canonical Arc Network + Circle USDC configuration.
//
// Verified against official Arc documentation (docs.arc.io):
//   - Chain ID:        5042002 (0x4cef52) — Arc Testnet
//   - Public RPC:      https://rpc.testnet.arc.io
//   - Block explorer:  https://testnet.arcscan.app
//   - USDC ERC-20:     0x3600000000000000000000000000000000000000
//   - USDC is Arc's native gas token; the ERC-20 interface exposes the same
//     underlying balance at 6-decimal precision.
//
// NOTE: Arc's public endpoints currently point at Testnet (5042002). When Arc
// publishes Mainnet endpoints, update ONLY this object — nothing else reads
// chain constants directly.

import type { EIP1193Provider } from "@privy-io/react-auth";

export const ARC_NETWORK = {
  chainId: 5042002,
  chainIdHex: "0x4cef52",
  caipId: "eip155:5042002",
  name: "Arc Network",
  shortName: "Arc",
  rpcUrl: "https://rpc.testnet.arc.io",
  blockExplorerUrl: "https://testnet.arcscan.app",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  usdc: {
    address: "0x3600000000000000000000000000000000000000",
    decimals: 6, // ERC-20 interface precision (balanceOf / 10^decimals)
  },
} as const;

const KNOWN_CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum Mainnet",
  137: "Polygon",
  42161: "Arbitrum One",
  8453: "Base",
  10: "Optimism",
  [ARC_NETWORK.chainId]: ARC_NETWORK.name,
};

export function chainLabel(chainId: number | null | undefined): string {
  if (chainId == null) return "unknown";
  return KNOWN_CHAIN_NAMES[chainId] || `chain ${chainId}`;
}

export function isArcChainId(chainId: number | null | undefined): boolean {
  return chainId === ARC_NETWORK.chainId;
}

/**
 * Block-explorer URL for a transaction hash, or null when no explorer is
 * configured (the UI then shows the hash instead of a link).
 */
export function getTxExplorerUrl(hash?: string | null): string | null {
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  if (!ARC_NETWORK.blockExplorerUrl) return null;
  return `${ARC_NETWORK.blockExplorerUrl}/tx/${hash.toLowerCase()}`;
}

/**
 * Request the wallet provider to switch the connected chain to Arc Network.
 *
 * Uses the standard EIP-1193 `wallet_switchEthereumChain` flow. If Arc is not
 * yet present in the wallet's chain list (error 4902 / "unrecognized chain"),
 * it requests the network to be ADDED first via `wallet_addEthereumChain`
 * using the canonical `ARC_NETWORK` configuration.
 *
 * Returns `true` if the wallet ends up on Arc, `false` if the switch was
 * declined, failed, or the provider is unreachable. The caller decides whether
 * to abort (a transaction must NEVER be sent on a non-Arc chain).
 */
export async function ensureWalletArcChain(provider: EIP1193Provider): Promise<boolean> {
  if (!provider || typeof provider.request !== "function") return false;

  // 1) Read the wallet's current chain (authoritative).
  let chainId: number | null = null;
  try {
    const hex = await provider.request({ method: "eth_chainId", params: [] });
    chainId = typeof hex === "string" ? parseInt(hex, 16) : Number(hex);
  } catch (err: any) {
    console.error("[Arc] eth_chainId failed while ensuring Arc chain:", err?.message || err);
    return false;
  }

  if (chainId === ARC_NETWORK.chainId) return true;

  // 2) Request the switch (shows the wallet's network prompt).
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ARC_NETWORK.chainIdHex }],
    });
    return true;
  } catch (err: any) {
    const code = err?.code;
    const message = String(err?.message || "");
    const missing = code === 4902 || /unrecognized chain id|chain id.*not|not found|not added|add.*chain/i.test(message);
    if (!missing) {
      console.error("[Arc] wallet_switchEthereumChain failed:", err?.message || err);
      return false;
    }
  }

  // 3) Chain not installed — request the wallet to add the Arc network.
  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: ARC_NETWORK.chainIdHex,
          chainName: ARC_NETWORK.name,
          nativeCurrency: ARC_NETWORK.nativeCurrency,
          rpcUrls: [ARC_NETWORK.rpcUrl],
          blockExplorerUrls: [ARC_NETWORK.blockExplorerUrl],
        },
      ],
    });
    return true;
  } catch (err: any) {
    console.error("[Arc] wallet_addEthereumChain failed:", err?.message || err);
    return false;
  }
}
