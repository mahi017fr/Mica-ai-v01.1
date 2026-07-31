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
