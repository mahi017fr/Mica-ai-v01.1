// viem Chain object for Arc Testnet, derived from the canonical
// `src/payments/arcNetwork.ts` constants so chain identity never drifts.
//
// Used by the Circle Modular Wallet service for:
//   - the public client that reads chain data (balances, receipts), and
//   - the smart-account signing domain (chainId in replay-safe hashes).
//
// The RPC URL points at the public Arc Testnet endpoint (rpc.testnet.arc.io).
// Circle's Modular Wallet RPC (`clientUrl + "/arcTestnet"`) is handled
// separately by `toModularTransport` in the service.

import { defineChain } from "viem";
import { ARC_NETWORK } from "../payments/arcNetwork";

export const CIRCLE_ARC_TESTNET_CHAIN = defineChain({
  id: ARC_NETWORK.chainId,
  name: ARC_NETWORK.name,
  nativeCurrency: {
    name: ARC_NETWORK.nativeCurrency.name,
    symbol: ARC_NETWORK.nativeCurrency.symbol,
    decimals: ARC_NETWORK.nativeCurrency.decimals,
  },
  rpcUrls: {
    default: {
      http: [ARC_NETWORK.rpcUrl],
    },
    public: {
      http: [ARC_NETWORK.rpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: ARC_NETWORK.blockExplorerUrl,
    },
  },
  contracts: {
    usdc: {
      address: ARC_NETWORK.usdc.address,
    },
  },
});
