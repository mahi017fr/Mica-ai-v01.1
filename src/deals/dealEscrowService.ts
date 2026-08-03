import { Interface, parseUnits, keccak256, toUtf8Bytes, getAddress, isAddress } from "ethers";
import type { EIP1193Provider } from "@privy-io/react-auth";
import { ARC_NETWORK } from "../payments/arcNetwork";
import { getFreshArcProvider, waitForArcTransaction, sleep } from "../payments/arcRpc";
import { classifySendError } from "../payments/arcUsdc";
import {
  ARC_ESCROW_FACTORY_ADDRESS,
  DEAL_ESCROW_ABI,
  DEAL_ESCROW_FACTORY_ABI,
  USDC_ABI,
  escrowCustodyMode,
} from "../config/arcEscrow";

// On-chain escrow client. Every financial action goes through the connected
// wallet's EIP-1193 provider (real signature -> eth_sendTransaction -> receipt).
// No private key ever touches the frontend; the per-deal escrow contract holds
// the funds and enforces the 24h timelock itself.

export class DealEscrowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DealEscrowError";
  }
}

export type EscrowStepLogger = (step: string, detail?: string) => void;

export const ARBITER_ZERO = "0x0000000000000000000000000000000000000000";

export function dealIdToUint256(dealId: string): string {
  return keccak256(toUtf8Bytes(dealId));
}

function usdcAmountWei(amount: number): bigint {
  if (!(amount > 0) || !Number.isFinite(amount)) {
    throw new DealEscrowError("Escrow amount must be a positive number.");
  }
  return parseUnits(amount.toFixed(6), ARC_NETWORK.usdc.decimals);
}

async function estimateGasForCall(
  provider: EIP1193Provider,
  tx: Record<string, unknown>
): Promise<string | undefined> {
  try {
    const hex = await provider.request({ method: "eth_estimateGas", params: [tx] });
    return typeof hex === "string" ? hex : undefined;
  } catch (err: any) {
    console.warn("[DealEscrow] gas estimate failed; sending without a limit:", err?.message || err);
    return undefined;
  }
}

/**
 * Send an arbitrary contract call through the wallet and wait for its receipt.
 * Returns the real transaction hash (lowercased).
 */
export async function sendContractCall(
  provider: EIP1193Provider,
  from: string,
  to: string,
  iface: Interface,
  fn: string,
  args: unknown[],
  log?: EscrowStepLogger
): Promise<string> {
  const data = iface.encodeFunctionData(fn, args as any);
  const tx: Record<string, unknown> = { from: from.toLowerCase(), to, value: "0x0", data };
  const gas = await estimateGasForCall(provider, tx);
  let hash: string;
  try {
    const result = await provider.request({
      method: "eth_sendTransaction",
      params: [(gas ? { ...tx, gas } : tx) as any],
    });
    if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
      throw new DealEscrowError("Wallet returned an invalid transaction hash.");
    }
    hash = result.toLowerCase();
  } catch (err: any) {
    const { userMessage } = classifySendError(err);
    throw new DealEscrowError(userMessage);
  }
  log?.("Transaction Hash", hash);
  const receipt = await waitForArcTransaction(hash, 60_000, (s, d) => log?.(s, d));
  if (receipt.confirmed && receipt.status === 0) {
    throw new DealEscrowError(`Transaction reverted on-chain (status 0). Hash: ${hash}`);
  }
  return hash;
}

/** Decode the escrow address from the factory's `DealCreated` event. */
export async function decodeEscrowAddressFromReceipt(txHash: string): Promise<string | null> {
  const provider = getFreshArcProvider();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return null;
  const iface = new Interface([...DEAL_ESCROW_FACTORY_ABI, ...DEAL_ESCROW_ABI]);
  for (const l of receipt.logs) {
    try {
      const parsed = iface.parseLog(l);
      if (parsed?.name === "DealCreated") {
        return String(parsed.args.escrow).toLowerCase();
      }
    } catch {
      /* not our event */
    }
  }
  return null;
}

export interface CreateEscrowResult {
  mode: "contract" | "seam";
  escrowAddress: string | null;
  factoryTxHash: string | null;
}

export interface DepositResult {
  mode: "contract" | "seam";
  mainTxHash: string | null;
  txHashes: string[];
}

/**
 * Create a per-deal escrow through the factory. In contract mode this is a real
 * wallet-signed transaction; the returned escrow address is read from the
 * `DealCreated` event on-chain.
 */
export async function createEscrowForDeal(params: {
  dealId: string;
  buyerWallet: string;
  sellerWallet: string;
  amount: number;
  collateralAmount: number;
  provider: EIP1193Provider;
  from: string;
  log?: EscrowStepLogger;
}): Promise<CreateEscrowResult> {
  const mode = escrowCustodyMode();
  if (mode !== "contract" || !ARC_ESCROW_FACTORY_ADDRESS) {
    return { mode: "seam", escrowAddress: null, factoryTxHash: null };
  }
  if (!isAddress(ARC_ESCROW_FACTORY_ADDRESS)) {
    throw new DealEscrowError("VITE_ESCROW_FACTORY_ADDRESS is not a valid EVM address.");
  }
  const factoryAddress = getAddress(ARC_ESCROW_FACTORY_ADDRESS);
  const from = params.from.toLowerCase();
  const buyer = params.buyerWallet.toLowerCase();
  const seller = params.sellerWallet.toLowerCase();
  if (!isAddress(buyer) || !isAddress(seller)) {
    throw new DealEscrowError("Both deal participants must have valid verified EVM wallets.");
  }
  if (from !== buyer && from !== seller) {
    throw new DealEscrowError("Connected wallet does not match the verified buyer or seller wallet.");
  }
  const chainHex = await params.provider.request({ method: "eth_chainId", params: [] });
  const chainId = typeof chainHex === "string" ? parseInt(chainHex, 16) : Number(chainHex);
  if (chainId !== ARC_NETWORK.chainId) {
    throw new DealEscrowError(`Wallet must be on Arc Testnet (chain ${ARC_NETWORK.chainId}).`);
  }
  const code = await params.provider.request({
    method: "eth_getCode",
    params: [factoryAddress, "latest"],
  });
  if (typeof code !== "string" || code === "0x" || code === "0x0") {
    throw new DealEscrowError("No deployed DealEscrowFactory contract was found at VITE_ESCROW_FACTORY_ADDRESS.");
  }
  const factory = new Interface([...DEAL_ESCROW_FACTORY_ABI]);
  const hash = await sendContractCall(
    params.provider,
    from,
    factoryAddress,
    factory,
    "createDeal",
    [
      dealIdToUint256(params.dealId),
      buyer,
      seller,
      usdcAmountWei(params.amount),
      usdcAmountWei(params.collateralAmount),
      ARBITER_ZERO,
    ],
    params.log
  );
  const escrowAddress = await decodeEscrowAddressFromReceipt(hash);
  if (!escrowAddress) {
    throw new DealEscrowError("Escrow created but its address could not be decoded.");
  }
  return { mode: "contract", escrowAddress, factoryTxHash: hash };
}

/**
 * Deposit one funding leg. The depositor first approves the escrow contract to
 * pull their USDC, then calls `deposit()` which pulls via transferFrom. Both
 * steps are real wallet-signed transactions.
 */
export async function depositEscrowLeg(params: {
  escrowAddress: string;
  amount: number;
  provider: EIP1193Provider;
  from: string;
  log?: EscrowStepLogger;
}): Promise<DepositResult> {
  const mode = escrowCustodyMode();
  if (mode !== "contract") return { mode: "seam", mainTxHash: null, txHashes: [] };

  const usdcIface = new Interface([...USDC_ABI]);
  const escrowIface = new Interface([...DEAL_ESCROW_ABI]);
  const amountWei = usdcAmountWei(params.amount);
  const amountLabel = `${params.amount} USDC`;

  params.log?.("Approving Escrow", amountLabel);
  const approveHash = await sendContractCall(
    params.provider,
    params.from,
    ARC_NETWORK.usdc.address,
    usdcIface,
    "approve",
    [params.escrowAddress, amountWei],
    params.log
  );

  params.log?.("Depositing", amountLabel);
  const depositHash = await sendContractCall(
    params.provider,
    params.from,
    params.escrowAddress,
    escrowIface,
    "deposit",
    [],
    params.log
  );

  return { mode: "contract", mainTxHash: depositHash, txHashes: [approveHash, depositHash] };
}

/** Seller confirms delivery and starts the 24h review window on-chain. */
export async function startReviewPeriod(params: {
  escrowAddress: string;
  provider: EIP1193Provider;
  from: string;
  log?: EscrowStepLogger;
}): Promise<{ mode: "contract" | "seam"; txHash: string | null }> {
  const mode = escrowCustodyMode();
  if (mode !== "contract") return { mode: "seam", txHash: null };
  const iface = new Interface([...DEAL_ESCROW_ABI]);
  const txHash = await sendContractCall(
    params.provider,
    params.from,
    params.escrowAddress,
    iface,
    "startReviewPeriod",
    [],
    params.log
  );
  return { mode: "contract", txHash };
}

/** Buyer approves delivery -> escrow pays the seller (price + collateral back). */
export async function buyerReleaseEscrow(params: {
  escrowAddress: string;
  provider: EIP1193Provider;
  from: string;
  log?: EscrowStepLogger;
}): Promise<{ mode: "contract" | "seam"; txHash: string | null }> {
  const mode = escrowCustodyMode();
  if (mode !== "contract") return { mode: "seam", txHash: null };
  const iface = new Interface([...DEAL_ESCROW_ABI]);
  const txHash = await sendContractCall(
    params.provider,
    params.from,
    params.escrowAddress,
    iface,
    "buyerRelease",
    [],
    params.log
  );
  return { mode: "contract", txHash };
}

/** Dispute -> pauses the review clock; no release can happen while disputed. */
export async function disputeEscrow(params: {
  escrowAddress: string;
  provider: EIP1193Provider;
  from: string;
  log?: EscrowStepLogger;
}): Promise<{ mode: "contract" | "seam"; txHash: string | null }> {
  const mode = escrowCustodyMode();
  if (mode !== "contract") return { mode: "seam", txHash: null };
  const iface = new Interface([...DEAL_ESCROW_ABI]);
  const txHash = await sendContractCall(
    params.provider,
    params.from,
    params.escrowAddress,
    iface,
    "dispute",
    [],
    params.log
  );
  return { mode: "contract", txHash };
}

/** Auto-release: callable by anyone once the 24h window has passed on-chain. */
export async function triggerAutoRelease(params: {
  escrowAddress: string;
  provider: EIP1193Provider;
  from: string;
  log?: EscrowStepLogger;
}): Promise<{ mode: "contract" | "seam"; txHash: string | null }> {
  const mode = escrowCustodyMode();
  if (mode !== "contract") return { mode: "seam", txHash: null };
  const iface = new Interface([...DEAL_ESCROW_ABI]);
  const txHash = await sendContractCall(
    params.provider,
    params.from,
    params.escrowAddress,
    iface,
    "autoRelease",
    [],
    params.log
  );
  return { mode: "contract", txHash };
}

/** A party can claw back their own deposit before the review period starts. */
export async function refundEscrowLeg(params: {
  escrowAddress: string;
  provider: EIP1193Provider;
  from: string;
  log?: EscrowStepLogger;
}): Promise<{ mode: "contract" | "seam"; txHash: string | null }> {
  const mode = escrowCustodyMode();
  if (mode !== "contract") return { mode: "seam", txHash: null };
  const iface = new Interface([...DEAL_ESCROW_ABI]);
  const txHash = await sendContractCall(
    params.provider,
    params.from,
    params.escrowAddress,
    iface,
    "refund",
    [],
    params.log
  );
  return { mode: "contract", txHash };
}

export interface OnChainEscrowStatus {
  funded: boolean;
  released: boolean;
  disputed: boolean;
  reviewStarted: boolean;
  deadline: number;
  totalDeposited: string;
  buyerDeposited: string;
  sellerDeposited: string;
}

/** Read the on-chain escrow state via Arc RPC (read-only, no wallet needed). */
export async function fetchEscrowOnChainStatus(
  escrowAddress: string,
  buyerWallet: string,
  sellerWallet: string
): Promise<OnChainEscrowStatus | null> {
  try {
    const provider = getFreshArcProvider();
    const iface = new Interface([...DEAL_ESCROW_ABI]);
    const call = async (fn: string, args: unknown[] = []) =>
      provider.call({ to: escrowAddress, data: iface.encodeFunctionData(fn, args as any) });
    const [funded, released, disputed, reviewStarted, deadline, total, buyerDep, sellerDep] =
      await Promise.all([
        call("funded").then((d) => iface.decodeFunctionResult("funded", d)[0] as boolean),
        call("released").then((d) => iface.decodeFunctionResult("released", d)[0] as boolean),
        call("disputed").then((d) => iface.decodeFunctionResult("disputed", d)[0] as boolean),
        call("reviewStarted").then((d) => iface.decodeFunctionResult("reviewStarted", d)[0] as boolean),
        call("deadline").then((d) => Number(iface.decodeFunctionResult("deadline", d)[0])),
        call("totalDeposited").then((d) => iface.decodeFunctionResult("totalDeposited", d)[0].toString()),
        call("deposited", [buyerWallet]).then((d) => iface.decodeFunctionResult("deposited", d)[0].toString()),
        call("deposited", [sellerWallet]).then((d) => iface.decodeFunctionResult("deposited", d)[0].toString()),
      ]);
    return { funded, released, disputed, reviewStarted, deadline, totalDeposited: total, buyerDeposited: buyerDep, sellerDeposited: sellerDep };
  } catch (err) {
    console.error("[DealEscrow] on-chain status read failed:", err);
    return null;
  }
}

export { sleep };
