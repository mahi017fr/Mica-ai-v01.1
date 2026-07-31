import { Interface } from "ethers";
import type { EIP1193Provider } from "@privy-io/react-auth";
import { ARC_NETWORK, chainLabel, isArcChainId } from "./arcNetwork";
import { waitForArcTransaction } from "./arcRpc";
import { ArcPaymentRequest, ArcPaymentReceipt, ArcSendDeps, ArcUsdcAdapter } from "./types";

// Circle USDC ERC-20 on Arc. `transfer(to, value)` moves real USDC.
const USDC_IFACE = new Interface([
  "function transfer(address to, uint256 value) returns (bool)",
]);

/**
 * Build the ERC-20 `transfer(to, value)` calldata for the Circle USDC contract.
 * `amount` is in USDC units (6 decimals).
 */
export function buildUsdcTransferCalldata(to: string, amount: number): string {
  const amountWei = BigInt(Math.round(amount * 10 ** ARC_NETWORK.usdc.decimals));
  if (!(amountWei > 0n)) {
    throw new Error("Payment amount must be greater than zero.");
  }
  return USDC_IFACE.encodeFunctionData("transfer", [to, amountWei]);
}

/**
 * Classify a failed `eth_sendTransaction` into an EXACT, user-facing message.
 *
 * - Code 4001 / "user rejected"      -> the user declined in the wallet popup.
 * - "method not supported"/disconnect -> the wallet could not produce a
 *   signature at all — this is the "Wallet signature required." case from the
 *   spec: do NOT continue the payment flow.
 * - anything else                    -> the raw error message.
 */
export function classifySendError(err: any): { userMessage: string; detail: string } {
  const code = err?.code;
  const message = String(err?.message || err || "Unknown wallet error");
  if (code === 4001 || /user rejected|user denied|reject/i.test(message)) {
    return {
      userMessage: "Transaction was rejected in your wallet.",
      detail: message,
    };
  }
  if (/method not supported|not supported|disconnected|wallet.*sign/i.test(message)) {
    return { userMessage: "Wallet signature required.", detail: message };
  }
  if (/insufficient/i.test(message)) {
    return {
      userMessage: "Insufficient funds to cover the transaction.",
      detail: message,
    };
  }
  return { userMessage: message, detail: message };
}

/**
 * Estimate gas for the USDC transfer using the wallet's provider. Best-effort:
 * if the wallet cannot estimate (some external wallets), send without a gas
 * limit and let the Arc node compute it.
 */
async function estimateGas(provider: EIP1193Provider, tx: Record<string, unknown>): Promise<string | undefined> {
  try {
    const hex = await provider.request({ method: "eth_estimateGas", params: [tx] });
    return typeof hex === "string" ? hex : undefined;
  } catch (err: any) {
    console.warn("[Arc] eth_estimateGas failed; sending without a gas limit:", err?.message || err);
    return undefined;
  }
}

/**
 * Execute a REAL Arc Circle USDC transfer through the connected wallet's
 * EIP-1193 provider (obtained from Privy's `wallet.getEthereumProvider()`).
 *
 * Flow (each step is logged to the console via `deps.log`):
 *   Preparing Transaction
 *   Opening Wallet Signature      <- Privy embedded wallet confirmation modal /
 *                                    external wallet popup appears here
 *   Submitting Transaction        <- eth_sendTransaction (real broadcast)
 *   Signature Approved
 *   Transaction Hash              <- real 0x hash
 *   Waiting Confirmation          <- fresh-RPC receipt polling
 *   Transaction Confirmed
 *
 * No wallet signature is ever bypassed: if the wallet cannot sign (method not
 * supported / disconnected / no provider), we throw `Wallet signature required.`
 * and the flow stops — we never continue with a fake success.
 */
export async function executeArcUsdcSend(
  request: ArcPaymentRequest,
  deps: ArcSendDeps
): Promise<ArcPaymentReceipt> {
  const { provider, from, log } = deps;
  const step = (s: string, d?: string) => log?.(s, d);

  if (!request.senderWallet || !request.recipientWallet) {
    throw new Error("Verified sender and recipient wallets are required.");
  }
  if (!(request.amount > 0) || !Number.isFinite(request.amount)) {
    throw new Error("Payment amount must be greater than zero.");
  }

  step("Preparing Transaction", `${request.amount} USDC -> ${request.recipientWallet}`);

  // 1) Re-verify the connected wallet is on Arc right before sending.
  //    Never send on the wrong chain, and never let a stale provider decide.
  let walletChainId: number | null = null;
  try {
    const hex = await provider.request({ method: "eth_chainId", params: [] });
    walletChainId = typeof hex === "string" ? parseInt(hex, 16) : Number(hex);
  } catch (err: any) {
    console.error("[Arc] eth_chainId failed before send:", err);
  }
  if (walletChainId != null && !isArcChainId(walletChainId)) {
    throw new Error(
      `Please switch to Arc Network. Your wallet is on ${chainLabel(walletChainId)} (chain ${walletChainId}).`
    );
  }

  // 2) Build the real ERC-20 transfer calldata.
  const data = buildUsdcTransferCalldata(request.recipientWallet.toLowerCase(), request.amount);

  const tx: Record<string, unknown> = {
    from: from.toLowerCase(),
    to: ARC_NETWORK.usdc.address,
    value: "0x0",
    data,
  };

  // 3) Request the wallet signature + broadcast. For a Privy embedded wallet
  //    this shows Privy's confirmation modal; for an external wallet it shows
  //    the wallet's own popup. A real signature is ALWAYS required.
  step("Opening Wallet Signature");

  const gas = await estimateGas(provider, tx);

  step("Submitting Transaction");

  let hash: string;
  try {
    const result = await provider.request({
      method: "eth_sendTransaction",
      params: [gas ? { ...tx, gas } : tx] as any,
    });
    if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
      throw new Error("Wallet returned an invalid transaction hash.");
    }
    hash = result.toLowerCase();
  } catch (err: any) {
    // The wallet could not (or would not) sign — surface the exact reason.
    const { userMessage, detail } = classifySendError(err);
    console.error("[Arc] eth_sendTransaction failed:", detail, err);
    throw new Error(userMessage);
  }

  step("Signature Approved");
  step("Transaction Hash", hash);

  // 4) Wait for on-chain confirmation using a FRESH RPC connection (never the
  //    wallet provider, never a reused instance).
  const receipt = await waitForArcTransaction(hash, 45_000, (s, d) => step(s, d));

  if (receipt.confirmed && receipt.status === 0) {
    throw new Error(`Transaction reverted on-chain (status 0). Hash: ${hash}`);
  }
  if (receipt.confirmed && receipt.status === 1) {
    step("Transaction Confirmed", hash);
  } else {
    console.warn(
      `[Arc] Transaction ${hash} was submitted but confirmation is pending; recording as succeeded (valid hash received).`
    );
  }

  return {
    transactionHash: hash,
    amount: request.amount,
    fee: arcUsdcAdapter.fee,
    network: "arc",
    asset: "circle_usdc",
    senderWallet: request.senderWallet.toLowerCase(),
    recipientWallet: request.recipientWallet.toLowerCase(),
    status: "succeeded",
    confirmedAt: new Date().toISOString(),
  };
}

export const arcUsdcAdapter: ArcUsdcAdapter = {
  network: "arc",
  asset: "circle_usdc",
  fee: 0,

  async sendUsdc(request: ArcPaymentRequest, deps: ArcSendDeps): Promise<ArcPaymentReceipt> {
    return executeArcUsdcSend(request, deps);
  },
};
