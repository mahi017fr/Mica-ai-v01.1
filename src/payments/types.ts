// Arc + Circle USDC payment domain types.
//
// These contracts are shared between the Send USDC modal, the Arc RPC layer,
// and the payment history storage. The UI only ever talks to these types —
// never to raw chain values typed in by the user.

import type { EIP1193Provider } from "@privy-io/react-auth";
import type { StepLogger } from "./arcRpc";

export type ArcNetwork = "arc";

export type UsdcAsset = "circle_usdc";

export type ArcPaymentStatus = "succeeded";

// Verified-wallet-only request. Wallets are always resolved from the
// database (recipient's verified primary wallet) or Privy (sender's verified
// primary wallet). They are never captured from manual input.
export interface ArcPaymentRequest {
  chatId?: string | null;
  senderId: string;
  senderUsername: string;
  senderWallet: string;
  recipientId: string;
  recipientUsername: string;
  recipientWallet: string;
  amount: number; // positive decimal, USDC units
}

// Everything the send needs that is NOT part of the request itself:
// - the real signing provider from the connected Privy wallet (NEVER a mock),
// - the sender address on that wallet,
// - an optional step logger for the console timeline.
export interface ArcSendDeps {
  provider: EIP1193Provider;
  from: string;
  log?: StepLogger;
}

// What the adapter returns after the transaction is executed AND confirmed.
// `transactionHash` is ALWAYS a real hash returned by the wallet's
// `eth_sendTransaction` — a payment is only marked successful after that.
export interface ArcPaymentReceipt {
  transactionHash: string;
  amount: number;
  fee: number;
  network: ArcNetwork;
  asset: UsdcAsset;
  senderWallet: string;
  recipientWallet: string;
  status: ArcPaymentStatus;
  confirmedAt: string;
}

// The seam that executes a real Arc Circle USDC blockchain transfer through the
// connected wallet's EIP-1193 provider (Privy embedded wallet or an external
// wallet). It never simulates and never fakes a hash.
export interface ArcUsdcAdapter {
  readonly network: ArcNetwork;
  readonly asset: UsdcAsset;
  readonly fee: number;
  sendUsdc(request: ArcPaymentRequest, deps: ArcSendDeps): Promise<ArcPaymentReceipt>;
}

// Normalized payment record persisted so it can later surface in
// Wallet History, Payment History, and Deal History.
export interface PaymentRecord {
  id?: string;
  type: "usdc_transfer";
  network: ArcNetwork;
  asset: UsdcAsset;
  senderId: string;
  senderUsername: string;
  senderWallet: string;
  recipientId: string;
  recipientUsername: string;
  recipientWallet: string;
  amount: number;
  fee: number;
  transactionHash: string;
  status: ArcPaymentStatus;
  chatId?: string | null;
  timestamp?: any; // ISO string
}
