import { Interface, parseUnits, keccak256, toUtf8Bytes, getAddress, isAddress } from "ethers";
import { ARC_NETWORK } from "../payments/arcNetwork";
import { getSharedArcReadProvider, waitForArcTransaction, sleep, withArcReadCache, isRateLimited } from "../payments/arcRpc";
import { classifySendError } from "../payments/arcUsdc";
import {
  ARC_ESCROW_FACTORY_ADDRESS,
  DEAL_ESCROW_ABI,
  DEAL_ESCROW_FACTORY_ABI,
  USDC_ABI,
  escrowCustodyMode,
} from "../config/arcEscrow";

// Minimal EIP-1193-shaped provider interface. This is the smallest surface the
// escrow client needs (request only). It lets BOTH the Privy browser provider
// and the Circle Developer-Controlled-Wallet server-stub provider be used here
// — the server-stub routes `eth_sendTransaction` through Circle MPC signing.
export interface AnyEip1193Provider {
  request(req: { method: string; params?: unknown[] }): Promise<unknown>;
}

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
  provider: AnyEip1193Provider,
  tx: Record<string, unknown>
): Promise<string | undefined> {
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const hex = await provider.request({ method: "eth_estimateGas", params: [tx] });
        return typeof hex === "string" ? hex : undefined;
      } catch (err) {
        if (!isRateLimited(err) || attempt === 3) throw err;
        await sleep(Math.min(4000, 400 * 2 ** attempt));
      }
    }
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
  provider: AnyEip1193Provider,
  from: string,
  to: string,
  iface: Interface,
  fn: string,
  args: unknown[],
  log?: EscrowStepLogger,
  requireConfirmation = false,
  onSubmitted?: (hash: string) => Promise<void>
): Promise<string> {
  const data = iface.encodeFunctionData(fn, args as any);
  const tx: Record<string, unknown> = { from: from.toLowerCase(), to, value: "0x0", data };
  const gas = await estimateGasForCall(provider, tx);
  let hash: string;
  try {
    let result: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        result = await provider.request({ method: "eth_sendTransaction", params: [(gas ? { ...tx, gas } : tx) as any] });
        break;
      } catch (err) {
        if (!isRateLimited(err) || attempt === 3) throw err;
        await sleep(Math.min(8000, 500 * 2 ** attempt));
      }
    }
    if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
      throw new DealEscrowError("Wallet returned an invalid transaction hash.");
    }
    hash = result.toLowerCase();
  } catch (err: any) {
    const { userMessage } = classifySendError(err);
    throw new DealEscrowError(userMessage);
  }
  log?.("Transaction Hash", hash);
  await onSubmitted?.(hash);
  const receipt = await waitForArcTransaction(hash, 60_000, (s, d) => log?.(s, d));
  if (receipt.confirmed && receipt.status === 0) {
    throw new DealEscrowError(`Transaction reverted on-chain (status 0). Hash: ${hash}`);
  }
  if (requireConfirmation && (!receipt.confirmed || receipt.status !== 1)) {
    throw new DealEscrowError(`Transaction submitted. Waiting for Arc confirmation. Hash: ${hash}`);
  }
  return hash;
}

/** Decode the escrow address from the factory's `DealCreated` event. */
export async function decodeEscrowAddressFromReceipt(txHash: string): Promise<string | null> {
  const provider = getSharedArcReadProvider();
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
  alreadyDeposited?: boolean;
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
  provider: AnyEip1193Provider;
  from: string;
  log?: EscrowStepLogger;
  onSubmitted?: (hash: string) => Promise<void>;
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
    params.log,
    false,
    params.onSubmitted
  );
  let escrowAddress: string | null = null;
  for (const delay of [0, 500, 1000, 2000, 4000]) {
    if (delay) await sleep(delay);
    try {
      escrowAddress = await decodeEscrowAddressFromReceipt(hash);
      if (escrowAddress) break;
    } catch { /* retry read-only verification */ }
  }
  if (!escrowAddress) {
    throw new DealEscrowError(`Escrow creation submitted. Verifying on Arc… Hash: ${hash}`);
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
  provider: AnyEip1193Provider;
  from: string;
  log?: EscrowStepLogger;
}): Promise<DepositResult> {
  const mode = escrowCustodyMode();
  if (mode !== "contract") return { mode: "seam", mainTxHash: null, txHashes: [] };

  const usdcIface = new Interface([...USDC_ABI]);
  const escrowIface = new Interface([...DEAL_ESCROW_ABI]);
  const amountWei = usdcAmountWei(params.amount);
  const amountLabel = `${params.amount} USDC`;

  const readUint = async (to: string, iface: Interface, fn: string, args: unknown[]) => {
    const data = iface.encodeFunctionData(fn, args as any);
    const readProvider = getSharedArcReadProvider();
    const raw = await readProvider.call({ to, data });
    return iface.decodeFunctionResult(fn, String(raw))[0] as bigint;
  };

  const existingDeposit = await readUint(params.escrowAddress, escrowIface, "deposited", [params.from]);
  if (existingDeposit === amountWei) {
    return { mode: "contract", mainTxHash: null, txHashes: [], alreadyDeposited: true };
  }
  if (existingDeposit !== 0n) {
    throw new DealEscrowError("The escrow already records a different deposit amount for this wallet.");
  }

  const allowance = await readUint(ARC_NETWORK.usdc.address, usdcIface, "allowance", [params.from, params.escrowAddress]);
  let approveHash: string | null = null;
  if (allowance < amountWei) {
    params.log?.("Approving Escrow", amountLabel);
    approveHash = await sendContractCall(
      params.provider, params.from, ARC_NETWORK.usdc.address, usdcIface,
      "approve", [params.escrowAddress, amountWei], params.log, true
    );
  }

  params.log?.("Depositing", amountLabel);
  const depositHash = await sendContractCall(
    params.provider,
    params.from,
    params.escrowAddress,
    escrowIface,
    "deposit",
    [],
    params.log,
    true
  );

  // Arc can briefly lag between receipt availability and contract-state reads.
  // Keep the submitted hash, and retry only this read-side verification.
  let verifiedDeposit = 0n;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      verifiedDeposit = await readUint(params.escrowAddress, escrowIface, "deposited", [params.from]);
      if (verifiedDeposit === amountWei) break;
    } catch { /* transient read propagation/rate-limit */ }
    if (attempt < 4) await sleep(Math.min(8000, 750 * 2 ** attempt));
  }
  if (verifiedDeposit !== amountWei) {
    throw new DealEscrowError("Deposit transaction confirmed, but the escrow deposit could not be verified on-chain.");
  }

  return { mode: "contract", mainTxHash: depositHash, txHashes: approveHash ? [approveHash, depositHash] : [depositHash] };
}

/** Seller confirms delivery and starts the 24h review window on-chain. */
export async function startReviewPeriod(params: {
  escrowAddress: string;
  provider: AnyEip1193Provider;
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
  provider: AnyEip1193Provider;
  from: string;
  log?: EscrowStepLogger;
  onSubmitted?: (hash: string) => Promise<void>;
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
    params.log,
    true,
    params.onSubmitted
  );
  return { mode: "contract", txHash };
}

/** Dispute -> pauses the review clock; no release can happen while disputed. */
export async function disputeEscrow(params: {
  escrowAddress: string;
  provider: AnyEip1193Provider;
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
  provider: AnyEip1193Provider;
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
  provider: AnyEip1193Provider;
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

async function retryEscrowRead<T>(read: () => Promise<T>): Promise<T> {
  const waits = [0, 500, 1000, 2000];
  let last: unknown;
  for (const wait of waits) {
    if (wait) await sleep(wait);
    try { return await read(); } catch (err) { last = err; }
  }
  throw last;
}

export async function fetchEscrowDeposit(
  escrowAddress: string,
  participant: string
): Promise<bigint> {
  return retryEscrowRead(async () => {
    const provider = getSharedArcReadProvider();
    const iface = new Interface([...DEAL_ESCROW_ABI]);
    const data = await provider.call({
      to: escrowAddress,
      data: iface.encodeFunctionData("deposited", [participant]),
    });
    return iface.decodeFunctionResult("deposited", data)[0] as bigint;
  });
}

export async function fetchEscrowFunded(escrowAddress: string): Promise<boolean> {
  return retryEscrowRead(async () => {
    const provider = getSharedArcReadProvider();
    const iface = new Interface([...DEAL_ESCROW_ABI]);
    const data = await provider.call({ to: escrowAddress, data: iface.encodeFunctionData("funded") });
    return iface.decodeFunctionResult("funded", data)[0] as boolean;
  });
}

/** Read the on-chain escrow state via Arc RPC (read-only, no wallet needed). */
export async function fetchEscrowOnChainStatus(
  escrowAddress: string,
  buyerWallet: string,
  sellerWallet: string
): Promise<OnChainEscrowStatus | null> {
  try {
    return await withArcReadCache(`escrow-status:${escrowAddress.toLowerCase()}:${buyerWallet.toLowerCase()}:${sellerWallet.toLowerCase()}`, async () => {
    const provider = getSharedArcReadProvider();
    const iface = new Interface([...DEAL_ESCROW_ABI]);
    const call = async (fn: string, args: unknown[] = []) =>
      provider.call({ to: escrowAddress, data: iface.encodeFunctionData(fn, args as any) });
    const funded = iface.decodeFunctionResult("funded", await call("funded"))[0] as boolean;
    const released = iface.decodeFunctionResult("released", await call("released"))[0] as boolean;
    const disputed = iface.decodeFunctionResult("disputed", await call("disputed"))[0] as boolean;
    const reviewStarted = iface.decodeFunctionResult("reviewStarted", await call("reviewStarted"))[0] as boolean;
    const deadline = Number(iface.decodeFunctionResult("deadline", await call("deadline"))[0]);
    const total = iface.decodeFunctionResult("totalDeposited", await call("totalDeposited"))[0].toString();
    const buyerDep = iface.decodeFunctionResult("deposited", await call("deposited", [buyerWallet]))[0].toString();
    const sellerDep = iface.decodeFunctionResult("deposited", await call("deposited", [sellerWallet]))[0].toString();
    return { funded, released, disputed, reviewStarted, deadline, totalDeposited: total, buyerDeposited: buyerDep, sellerDeposited: sellerDep };
    }, 1200);
  } catch (err) {
    console.error("[DealEscrow] on-chain status read failed:", err);
    return null;
  }
}

export { sleep };
