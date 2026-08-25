// USDC send orchestration — server-side only.
//
// POST /api/wallet/send-usdc pipeline:
//   verify Firebase ID token → resolve sender Circle wallet (Firestore)
//   → resolve recipient Circle wallet (Firestore) → validate amount
//   → idempotency (race-free) → server-side balance check
//   → Circle Developer-Controlled Wallet transfer (MPC signing, no passkey)
//   → poll to terminal state → persist payment history once.
//
// SECURITY:
//   - The source wallet is ALWAYS resolved from users/{authenticatedUid}.
//   - Client-supplied sender wallets / ids / Circle credentials are never read.
//   - CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET / CIRCLE_WALLET_SET_ID stay here.
//   - Firebase ID tokens are verified, never logged.

import { Contract, JsonRpcProvider } from "ethers";
import { ARC_NETWORK } from "../../src/payments/arcNetwork";
import {
  createCircleUsdcTransfer,
  firestoreCreate,
  firestoreGet,
  firestoreRunTransaction,
  firestoreSet,
  getCircleTransaction,
  resolveCircleWallet,
  resolveUserCircleWallet,
  verifyFirebaseToken,
} from "./circleWalletService";

const IDEMPOTENCY_COLLECTION = "usdc_send_idempotency";

// Per-invocation polling budget — deliberately below Vercel's function
// timeout. If Circle has not reached a terminal state in time, the response is
// ok:true with a PENDING status and the client re-posts the SAME idempotency
// key, which continues status polling without ever re-submitting.
const POLL_BUDGET_MS = 8_000;
const POLL_INTERVAL_MS = 1_500;

// Shared read-only Arc provider + USDC balanceOf contract (single instance per
// warm lambda; reads only — never used for writes).
let _arcReadProvider: JsonRpcProvider | null = null;
function getArcReadProvider(): JsonRpcProvider {
  if (!_arcReadProvider) {
    _arcReadProvider = new JsonRpcProvider(ARC_NETWORK.rpcUrl, ARC_NETWORK.chainId, {
      staticNetwork: true,
    });
  }
  return _arcReadProvider;
}
async function readUsdcRawBalance(address: string): Promise<bigint> {
  const contract = new Contract(
    ARC_NETWORK.usdc.address,
    ["function balanceOf(address owner) view returns (uint256)"],
    getArcReadProvider()
  );
  return BigInt(await contract.balanceOf(address));
}

// ---------------------------------------------------------------------------
// Errors mapped to HTTP responses by the handler.
// ---------------------------------------------------------------------------

export class SendUsdcError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface SendUsdcRequest {
  recipientUid?: unknown;
  amount?: unknown;
  idempotencyKey?: unknown;
  chatId?: unknown;
}

interface SendUsdcSuccess {
  ok: true;
  transaction: {
    id: string;
    transactionHash: string;
    status: "COMPLETE" | "PENDING";
    amount: string;
    senderWallet: string;
    recipientWallet: string;
    network: "arc";
    asset: "circle_usdc";
  };
}

interface SendUsdcFailure {
  ok: false;
  error: string;
  code: string;
}

type SendUsdcResult =
  | { httpStatus: number; body: SendUsdcSuccess }
  | { httpStatus: number; body: SendUsdcFailure };

// ---------------------------------------------------------------------------
// Amount validation — string-exact, no float arithmetic before validation.
// ---------------------------------------------------------------------------

interface ParsedAmount {
  decimal: string; // canonical ≤6dp decimal string sent to Circle
  units: bigint; // integer base units (10^-6)
}

function parseUsdcAmount(raw: unknown): ParsedAmount {
  let s: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new SendUsdcError("INVALID_AMOUNT", "Amount must be a finite number.");
    s = raw.toString();
  } else if (typeof raw === "string") {
    s = raw.trim().replace(",", ".");
  } else {
    throw new SendUsdcError("INVALID_AMOUNT", "Amount is required.");
  }

  // Reject NaN/Infinity/negatives/exponents/scientific notation implicitly.
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(s)) {
    throw new SendUsdcError("INVALID_AMOUNT", "Amount must be a positive number with at most 6 decimals.");
  }

  const [intPart, fracPart = ""] = s.split(".");
  if (BigInt(intPart || "0") <= 0n && !/[1-9]/.test(fracPart)) {
    throw new SendUsdcError("INVALID_AMOUNT", "Amount must be greater than zero.");
  }

  const units = BigInt((intPart || "0") + fracPart.padEnd(ARC_NETWORK.usdc.decimals, "0"));
  // Sanity cap (~1e9 USDC) — keeps every downstream Number() conversion exact.
  if (units > 10n ** 15n) {
    throw new SendUsdcError("INVALID_AMOUNT", "Amount exceeds the maximum supported value.");
  }

  const normalizedFrac = fracPart.replace(/0+$/, "");
  const decimal = normalizedFrac ? `${intPart || "0"}.${normalizedFrac}` : intPart || "0";
  return { decimal, units };
}

function isValidUid(uid: unknown): uid is string {
  return typeof uid === "string" && /^[a-zA-Z0-9_\-]{1,128}$/.test(uid);
}

function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && /^[a-zA-Z0-9_\-]{8,64}$/.test(key);
}

// ---------------------------------------------------------------------------
// Idempotency record helpers.
// ---------------------------------------------------------------------------

interface IdempotencyDoc {
  key: string;
  senderUid: string;
  recipientUid: string;
  amountUnits: string;
  amountDecimal: string;
  chatId: string | null;
  status: "CREATED" | "SUBMITTING" | "SUBMITTED" | "COMPLETE" | "FAILED";
  circleTransactionId: string | null;
  transactionHash: string | null;
  createdAt?: string;
  updatedAt?: string;
}

function asIdemDoc(id: string, data: Record<string, unknown> | null): IdempotencyDoc | null {
  if (!data) return null;
  return {
    key: id,
    senderUid: String(data.senderUid ?? ""),
    recipientUid: String(data.recipientUid ?? ""),
    amountUnits: String(data.amountUnits ?? ""),
    amountDecimal: String(data.amountDecimal ?? ""),
    chatId: typeof data.chatId === "string" ? data.chatId : null,
    status: (data.status as IdempotencyDoc["status"]) ?? "CREATED",
    circleTransactionId: typeof data.circleTransactionId === "string" ? data.circleTransactionId : null,
    transactionHash: typeof data.transactionHash === "string" ? data.transactionHash : null,
  };
}

/**
 * Atomically claim the right to submit the Circle write for this key.
 *
 * - CREATED / SUBMITTING / FAILED (no tx id yet) → transitions to SUBMITTING
 *   and returns true. Re-claiming SUBMITTING/FAILED is safe: if a previous
 *   caller crashed after Circle accepted the write, re-invoking Circle with
 *   the SAME idempotency key returns the ORIGINAL transaction — never a
 *   second blockchain write.
 * - Already SUBMITTED / COMPLETE → returns false; nobody may submit again.
 */
async function claimSubmitRight(key: string): Promise<boolean> {
  let maySubmit = false;
  await firestoreRunTransaction(async (tx, db) => {
    const ref = db.doc(`${IDEMPOTENCY_COLLECTION}/${key}`);
    const snap = await ref.get();
    if (!snap.exists) return;
    const data = snap.data() ?? {};
    if (typeof data.circleTransactionId === "string" && data.circleTransactionId) return;
    const status = String(data.status ?? "");
    if (status === "SUBMITTED" || status === "COMPLETE") return;
    maySubmit = true;
    tx.update(ref, { status: "SUBMITTING", updatedAt: new Date().toISOString() });
  });
  return maySubmit;
}

// ---------------------------------------------------------------------------
// Main handler logic.
// ---------------------------------------------------------------------------

export async function handleSendUsdc(
  authHeader: string | undefined,
  body: SendUsdcRequest
): Promise<SendUsdcResult> {
  try {
    // ── 1. Authenticate ──────────────────────────────────────────────
    const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) {
      throw new SendUsdcError("UNAUTHORIZED", "Missing Firebase ID token.", 401);
    }
    let senderUid: string;
    try {
      ({ uid: senderUid } = await verifyFirebaseToken(idToken));
    } catch {
      throw new SendUsdcError("UNAUTHORIZED", "Invalid or expired Firebase ID token.", 401);
    }

    // ── 2. Validate request shape ────────────────────────────────────
    if (!isValidUid(body.recipientUid)) {
      throw new SendUsdcError("INVALID_REQUEST", "recipientUid is required.");
    }
    const recipientUid = body.recipientUid;
    if (recipientUid === senderUid) {
      throw new SendUsdcError("SELF_TRANSFER", "You cannot send USDC to yourself.");
    }
    if (!isValidIdempotencyKey(body.idempotencyKey)) {
      throw new SendUsdcError("INVALID_REQUEST", "idempotencyKey is required.");
    }
    const parsedAmount = parseUsdcAmount(body.amount);
    const chatId = typeof body.chatId === "string" && body.chatId.length <= 200 ? body.chatId : null;

    // ── 3. Resolve SENDER from the authenticated uid (never the browser).
    //    Uses the centralized resolver — creates a wallet if the sender doesn't
    //    have one yet.
    const senderWallet = await resolveUserCircleWallet(senderUid);

    // ── 4. Resolve RECIPIENT from their Firebase UID.
    //    Uses resolveCircleWallet which repairs the Firestore mapping if the
    //    Circle wallet exists but Firestore is missing the mapping.
    const recipientWallet = await resolveCircleWallet(recipientUid);
    if (!recipientWallet) {
      return {
        httpStatus: 400,
        body: { ok: false, code: "RECIPIENT_WALLET_NOT_FOUND", error: "This account doesn't have a MICA wallet yet." },
      };
    }
    const recipientAddress = recipientWallet.address;

    // ── 5. Idempotency record (create-or-load, race-free).
    const created = await firestoreCreate(IDEMPOTENCY_COLLECTION, body.idempotencyKey, {
      senderUid,
      recipientUid,
      amountUnits: parsedAmount.units.toString(),
      amountDecimal: parsedAmount.decimal,
      chatId,
      status: "CREATED",
      circleTransactionId: null,
      transactionHash: null,
      createdAt: new Date().toISOString(),
    });
    const existing = asIdemDoc(body.idempotencyKey, await firestoreGet(`${IDEMPOTENCY_COLLECTION}/${body.idempotencyKey}`));

    // A reused key with DIFFERENT parameters is a conflict, never a replay.
    if (
      existing &&
      (existing.senderUid !== senderUid ||
        existing.recipientUid !== recipientUid ||
        existing.amountUnits !== parsedAmount.units.toString())
    ) {
      throw new SendUsdcError("IDEMPOTENCY_CONFLICT", "This payment request was already used with different parameters.", 409);
    }

    // ── 6. Submit (only if this logical send was never submitted).
    let circleTransactionId: string | null = existing?.circleTransactionId ?? null;

    if (!circleTransactionId) {
      const claimed = await claimSubmitRight(body.idempotencyKey);
      if (!claimed) {
        throw new SendUsdcError("DUPLICATE_REQUEST", "This payment is already being processed.", 409);
      }

      // Server-side balance check immediately before the ONLY submission.
      const rawBalance = await readUsdcRawBalance(senderWallet.address);
      if (rawBalance < parsedAmount.units) {
        await firestoreSetStatus(body.idempotencyKey, { status: "FAILED" });
        throw new SendUsdcError("INSUFFICIENT_FUNDS", "Insufficient USDC balance for this transfer.", 400);
      }

      try {
        const result = await createCircleUsdcTransfer({
          sourceWalletId: senderWallet.walletId,
          destinationAddress: recipientAddress,
          amountDecimal: parsedAmount.decimal,
          tokenAddress: ARC_NETWORK.usdc.address,
          idempotencyKey: body.idempotencyKey, // Circle-side exactly-once guard
        });
        circleTransactionId = result.transactionId;
      } catch (err: any) {
        const message = err?.message ? String(err.message).slice(0, 300) : "Circle transfer failed.";
        console.error("[SendUsdc] createTransaction failed:", message);
        // Mark FAILED so a retry can safely re-claim; Circle's idempotency key
        // guarantees this never produced two blockchain writes.
        await firestoreSetStatus(body.idempotencyKey, { status: "FAILED" });
        throw new SendUsdcError("CIRCLE_ERROR", `Transfer could not be submitted: ${message}`, 502);
      }

      // Persist the Circle transaction id BEFORE any waiting so a crash or
      // timeout can NEVER lead to a second blockchain write for this key.
      await firestoreSetStatus(body.idempotencyKey, {
        status: "SUBMITTED",
        circleTransactionId,
      });
    }

    // ── 7. Poll to a terminal state within this invocation's budget.
    const deadline = Date.now() + POLL_BUDGET_MS;
    let state = "";
    let txHash: string | null = existing?.transactionHash ?? null;
    while (Date.now() < deadline) {
      const current = await getCircleTransaction(circleTransactionId);
      if (current) {
        state = current.state;
        txHash = current.txHash ?? txHash;
        if (state === "COMPLETE" || ["FAILED", "DENIED", "CANCELLED"].includes(state)) break;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // ── 8. Terminal handling.
    if (state === "COMPLETE") {
      if (txHash && txHash !== existing?.transactionHash) {
        await firestoreSetStatus(body.idempotencyKey, { status: "COMPLETE", transactionHash: txHash });
      }
      await writePaymentHistoryOnce({
        key: body.idempotencyKey,
        senderUid,
        senderWallet: senderWallet.address,
        recipientUid,
        recipientWallet: recipientAddress,
        amountDecimal: parsedAmount.decimal,
        chatId,
        transactionHash: txHash ?? "",
      });
      return successBody({ circleTransactionId, txHash, amount: parsedAmount.decimal, sender: senderWallet.address, recipient: recipientAddress }, "COMPLETE");
    }

    if (["FAILED", "DENIED", "CANCELLED"].includes(state)) {
      await firestoreSetStatus(body.idempotencyKey, { status: "FAILED" });
      return {
        httpStatus: 502,
        body: {
          ok: false,
          code: "TRANSACTION_FAILED",
          error: `The transfer was rejected on-chain (${state}). No funds were moved.`,
        },
      };
    }

    // Still pending — report progress; the client re-posts the same key.
    return successBody({ circleTransactionId, txHash, amount: parsedAmount.decimal, sender: senderWallet.address, recipient: recipientAddress }, "PENDING");
  } catch (err: unknown) {
    if (err instanceof SendUsdcError) {
      return { httpStatus: err.httpStatus, body: { ok: false, error: err.message, code: err.code } };
    }
    const message = err instanceof Error ? err.message : String(err ?? "unknown error");
    console.error("[SendUsdc] Unexpected error:", message.slice(0, 300));
    return {
      httpStatus: 500,
      body: { ok: false, error: "Internal error while sending USDC.", code: "SERVER_ERROR" },
    };
  }
}

async function firestoreSetStatus(key: string, patch: Record<string, unknown>): Promise<void> {
  await firestoreSet(`${IDEMPOTENCY_COLLECTION}/${key}`, {
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

function successBody(
  t: { circleTransactionId: string; txHash: string | null; amount: string; sender: string; recipient: string },
  status: "COMPLETE" | "PENDING"
): SendUsdcResult {
  return {
    httpStatus: 200,
    body: {
      ok: true,
      transaction: {
        id: t.circleTransactionId,
        transactionHash: t.txHash ?? "",
        status,
        amount: t.amount,
        senderWallet: t.sender.toLowerCase(),
        recipientWallet: t.recipient.toLowerCase(),
        network: "arc",
        asset: "circle_usdc",
      },
    },
  };
}

/**
 * Persist the payment record AFTER confirmed success, exactly once.
 * Uses a deterministic document id derived from the idempotency key, so even
 * concurrent writers converge on ONE history entry.
 */
async function writePaymentHistoryOnce(info: {
  key: string;
  senderUid: string;
  senderWallet: string;
  recipientUid: string;
  recipientWallet: string;
  amountDecimal: string;
  chatId: string | null;
  transactionHash: string;
}): Promise<void> {
  const [senderProfile, recipientProfile] = await Promise.all([
    firestoreGet(`users/${info.senderUid}`),
    firestoreGet(`users/${info.recipientUid}`),
  ]);
  const payload: Record<string, unknown> = {
    type: "usdc_transfer",
    network: "arc",
    asset: "circle_usdc",
    senderId: info.senderUid,
    senderUsername: String(senderProfile?.username ?? ""),
    senderWallet: info.senderWallet.toLowerCase(),
    recipientId: info.recipientUid,
    recipientUsername: String(recipientProfile?.username ?? ""),
    recipientWallet: info.recipientWallet.toLowerCase(),
    amount: Number(info.amountDecimal),
    fee: 0,
    transactionHash: info.transactionHash.toLowerCase(),
    status: "succeeded",
    idempotencyKey: info.key,
    timestamp: new Date().toISOString(),
  };
  if (info.chatId) payload.chatId = info.chatId;
  await firestoreSet(`payments/payment_${info.key}`, payload);
}
