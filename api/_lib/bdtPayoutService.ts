// BDT transfer + payout orchestration — server-side only.
//
// Endpoints:
//   POST /api/bdt/recipient-check  → "does the recipient have a payable number?"
//   POST /api/bdt/transfers         → create/continue a BDT transfer (idempotent)
//   GET  /api/bdt/transfers/:id     → read transfer state
//
// Pipeline for a transfer:
//   verify Firebase ID token → validate request → resolve the RECIPIENT's
//   private payout profile (server-side, never returned to the client)
//   → race-free idempotency claim → create `transfers/{transferId}` (PENDING)
//   → bKash provider createPayout() → poll to a terminal provider state
//   → flip to SUCCESS (with completedAt) or FAILED (with failureReason)
//   → write BDT_TRANSFER history once.
//
// SECURITY:
//   - The recipient's mobile number is read from `user_pay_profiles/{uid}` and
//     NEVER appears in any response or log. Clients only get booleans.
//   - Provider credentials live in server env vars only (see fiatPaymentProvider).
//   - If bKash is NOT configured, we surface the "not configured" state and
//     never fabricate a success.
//   - No PIN/OTP/credential is ever accepted, stored, or forwarded.

import {
  firestoreCreate,
  firestoreGet,
  firestoreSet,
  verifyFirebaseToken,
} from "./circleWalletService.js";
import { getBkashProvider, type FiatPaymentProvider } from "./fiatPaymentProvider.js";

const PAY_PROFILES_COLLECTION = "user_pay_profiles";
const TRANSFERS_COLLECTION = "transfers";
const IDEMPOTENCY_COLLECTION = "bdt_transfer_idempotency";
const PAYMENTS_COLLECTION = "payments";

const NORMALIZED_MOBILE = /^\+8801\d{9}$/;

// Per-invocation polling budget — mirrors the USDC send pattern. If the
// provider has not reached a terminal state in time, the response is PENDING
// and the client re-posts the SAME idempotency key, which continuation-polling
// picks up without ever re-submitting the payout.
const POLL_BUDGET_MS = 8_000;
const POLL_INTERVAL_MS = 1_500;

const MAX_AMOUNT = 10_000_000;

export class BdtError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function logStep(step: string, detail: Record<string, unknown> = {}) {
  console.log("[BdtPayout]", JSON.stringify({ step, ...detail }));
}

function isValidUid(uid: unknown): uid is string {
  return typeof uid === "string" && /^[a-zA-Z0-9_\-]{1,128}$/.test(uid);
}

function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && /^[a-zA-Z0-9_\-]{8,64}$/.test(key);
}

function isSafeTransferId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_\-]{1,128}$/.test(id);
}

function parseBdtAmount(raw: unknown): string {
  let s: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new BdtError("INVALID_AMOUNT", "Amount must be a finite number.");
    s = raw.toString();
  } else if (typeof raw === "string") {
    s = raw.trim().replace(",", ".");
  } else {
    throw new BdtError("INVALID_AMOUNT", "Amount is required.");
  }
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) {
    throw new BdtError("INVALID_AMOUNT", "Amount must be a positive BDT value with at most 2 decimals.");
  }
  const numeric = Number(s);
  if (!(numeric > 0)) {
    throw new BdtError("INVALID_AMOUNT", "Amount must be greater than zero.");
  }
  if (numeric > MAX_AMOUNT) {
    throw new BdtError("AMOUNT_TOO_LARGE", "Amount exceeds the ৳10,000,000 limit.");
  }
  return numeric.toFixed(2).replace(/\.?0+$/, "");
}

// ---------------------------------------------------------------------------
// Safe response builders — the recipient mobile number is NEVER serialized.
// ---------------------------------------------------------------------------

function safeTransferSummary(doc: Record<string, unknown>): Record<string, unknown> {
  const status = String(doc.status ?? "FAILED").toUpperCase();
  return {
    transferId: doc.transferId,
    senderId: doc.senderId,
    recipientId: doc.recipientId,
    amount: typeof doc.amount === "number" ? doc.amount : Number(doc.amount ?? 0),
    currency: "BDT",
    method: doc.method ?? "BKASH",
    status,
    provider: doc.provider,
    providerTransactionId: doc.providerTransactionId ?? null,
    note: doc.note ?? null,
    chatId: doc.chatId ?? null,
    failureReason: doc.failureReason ?? null,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
    completedAt: doc.completedAt ?? null,
  };
}

interface IdempotencyDoc {
  key: string;
  senderUid: string;
  recipientUid: string;
  amount: string;
  method: string;
  transferId: string;
}

function asIdemDoc(id: string, data: Record<string, unknown> | null): IdempotencyDoc | null {
  if (!data) return null;
  return {
    key: id,
    senderUid: String(data.senderUid ?? ""),
    recipientUid: String(data.recipientUid ?? ""),
    amount: String(data.amount ?? ""),
    method: String(data.method ?? ""),
    transferId: String(data.transferId ?? ""),
  };
}

/** Read the recipient's private payout number. Throws when absent/invalid. */
async function resolveRecipientMobile(recipientUid: string): Promise<string> {
  const profile = await firestoreGet(`${PAY_PROFILES_COLLECTION}/${recipientUid}`);
  const mobile = typeof profile?.mobile === "string" ? profile.mobile : "";
  if (!mobile || !NORMALIZED_MOBILE.test(mobile)) {
    throw new BdtError(
      "RECIPIENT_NO_PAYMENT_NUMBER",
      "This user has not added a payment number to their account yet. Ask them to add one in Settings → Payment.",
      400
    );
  }
  return mobile;
}

// ---------------------------------------------------------------------------
// Handler: does the recipient have a payable number? (boolean only)
// ---------------------------------------------------------------------------

export interface RecipientCheckBody {
  recipientUid?: unknown;
}

export async function handleBdtRecipientCheck(
  authHeader: string | undefined,
  body: RecipientCheckBody
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  try {
    const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) throw new BdtError("UNAUTHORIZED", "Missing Firebase ID token.", 401);
    let senderUid: string;
    try {
      ({ uid: senderUid } = await verifyFirebaseToken(idToken));
    } catch {
      throw new BdtError("UNAUTHORIZED", "Invalid or expired Firebase ID token.", 401);
    }
    if (!isValidUid(body.recipientUid)) {
      throw new BdtError("INVALID_REQUEST", "recipientUid is required.");
    }
    if (body.recipientUid === senderUid) {
      throw new BdtError("SELF_TRANSFER", "You cannot send money to yourself.");
    }

    const profile = await firestoreGet(`${PAY_PROFILES_COLLECTION}/${body.recipientUid}`);
    const mobile = typeof profile?.mobile === "string" ? profile.mobile : "";
    const hasPaymentNumber = Boolean(mobile && NORMALIZED_MOBILE.test(mobile));
    logStep("recipient_check", {
      recipientHasPaymentNumber: hasPaymentNumber,
      // NEVER log the number itself.
    });
    return {
      httpStatus: 200,
      body: {
        ok: true,
        recipientHasPaymentNumber: hasPaymentNumber,
        // If missing, send a safe copy hint (never the number).
        hint: hasPaymentNumber
          ? undefined
          : "This user has not added a payment number to their account yet.",
      },
    };
  } catch (err: unknown) {
    if (err instanceof BdtError) {
      return { httpStatus: err.httpStatus, body: { ok: false, code: err.code, error: err.message } };
    }
    const message = err instanceof Error ? err.message : String(err ?? "unknown error");
    console.error("[BdtPayout] recipient-check unexpected:", message.slice(0, 300));
    return { httpStatus: 500, body: { ok: false, code: "SERVER_ERROR", error: "Internal error checking the recipient." } };
  }
}

// ---------------------------------------------------------------------------
// Handler: create / continue a BDT transfer (idempotent)
// ---------------------------------------------------------------------------

export interface CreateTransferBody {
  recipientUid?: unknown;
  amount?: unknown;
  method?: unknown;
  idempotencyKey?: unknown;
  note?: unknown;
  chatId?: unknown;
}

export async function handleBdtCreateTransfer(
  authHeader: string | undefined,
  body: CreateTransferBody
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  try {
    // ── 1. Authenticate ──────────────────────────────────────────────
    const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) throw new BdtError("UNAUTHORIZED", "Missing Firebase ID token.", 401);
    let senderUid: string;
    try {
      ({ uid: senderUid } = await verifyFirebaseToken(idToken));
    } catch {
      throw new BdtError("UNAUTHORIZED", "Invalid or expired Firebase ID token.", 401);
    }
    logStep("create_transfer_received", {
      uidLen: senderUid.length,
      hasRecipient: isValidUid(body.recipientUid),
      hasAmount: typeof body.amount === "string" && String(body.amount).length > 0,
      hasKey: isValidIdempotencyKey(body.idempotencyKey),
    });

    // ── 2. Validate request shape ────────────────────────────────────
    if (!isValidUid(body.recipientUid)) {
      throw new BdtError("INVALID_REQUEST", "recipientUid is required.");
    }
    const recipientUid = body.recipientUid;
    if (recipientUid === senderUid) {
      throw new BdtError("SELF_TRANSFER", "You cannot send money to yourself.");
    }
    const amountDecimal = parseBdtAmount(body.amount);
    if (!isValidIdempotencyKey(body.idempotencyKey)) {
      throw new BdtError("INVALID_REQUEST", "idempotencyKey is required.");
    }
    const method = body.method === "BKASH" ? "BKASH" : null;
    if (!method) {
      throw new BdtError(
        "PAYMENT_METHOD_UNAVAILABLE",
        "Only bKash is active right now. Nagad and Rocket are coming soon.",
        400
      );
    }
    const note = typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, 280)
      : null;
    const chatId = typeof body.chatId === "string" && body.chatId.length <= 200 ? body.chatId : null;

    // ── 3. Recipient private payout number (server-side only) ────────
    const recipientMobile = await resolveRecipientMobile(recipientUid);

    // ── 4. Provider must be genuinely configured — never fake success ─
    const provider: FiatPaymentProvider = getBkashProvider();
    if (!provider.isConfigured()) {
      throw new BdtError(
        "BKASH_NOT_CONFIGURED",
        "bKash payments are not configured yet. Set up BKASH_* server-side credentials to enable real transfers.",
        503
      );
    }

    // ── 5. Idempotency claim (create-or-load, race-free) ─────────────
    const transferId = `transfer_${body.idempotencyKey}`;
    const claimedNow = await firestoreCreate(IDEMPOTENCY_COLLECTION, body.idempotencyKey, {
      senderUid,
      recipientUid,
      amount: amountDecimal,
      method,
      transferId,
      createdAt: new Date().toISOString(),
    });
    const existing = asIdemDoc(
      body.idempotencyKey,
      await firestoreGet(`${IDEMPOTENCY_COLLECTION}/${body.idempotencyKey}`)
    );
    if (
      existing &&
      (existing.senderUid !== senderUid ||
        existing.recipientUid !== recipientUid ||
        existing.amount !== amountDecimal ||
        existing.method !== method)
    ) {
      throw new BdtError("IDEMPOTENCY_CONFLICT", "This payment request was already used with different parameters.", 409);
    }

    // ── 6. Create / reload the transfer document (create-only) ────────
    const transferDoc = await firestoreGet(`${TRANSFERS_COLLECTION}/${transferId}`);
    let transferCreatedNow = false;
    if (!transferDoc) {
      transferCreatedNow = await firestoreCreate(TRANSFERS_COLLECTION, transferId, {
        transferId,
        senderId: senderUid,
        recipientId: recipientUid,
        amount: Number(amountDecimal),
        currency: "BDT",
        method,
        status: "PENDING",
        provider: provider.name,
        providerTransactionId: null,
        note,
        chatId,
        failureReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      logStep("transfer_doc_created", { transferId, method, createdNow: transferCreatedNow });
      if (!transferCreatedNow) {
        // A concurrent same-key request already created it — fall through and let
        // the shared doc (and its transaction id) drive the state.
        logStep("transfer_doc_race_lost", { transferId });
      }
    }

    // ── 7. Submit the payout (ONCE per logical transfer) ──────────────
    const currentDoc = (await firestoreGet(`${TRANSFERS_COLLECTION}/${transferId}`)) ?? {};
    let providerTransactionId: string | null =
      (currentDoc.providerTransactionId as string | null) ?? null;

    // Only THIS transfer may submit the payout if we won either the idempotency
    // claim or the transfer-doc creation — or if the previous submitter crashed
    // (stale doc with no transaction id for over a resume window). A normal
    // same-key continuation never re-submits. This is what stops a duplicate
    // payout from a double-click or a paused-and-resumed request.
    const createdAtMs = currentDoc.createdAt ? Date.parse(String(currentDoc.createdAt)) : 0;
    const resumeWindowMs = 45_000;
    const staleMissingSubmission =
      !providerTransactionId && transferDoc && createdAtMs > 0 && Date.now() - createdAtMs > resumeWindowMs;
    const maySubmit = !providerTransactionId && (claimedNow || transferCreatedNow || staleMissingSubmission);

    let submittedNow = false;
    if (maySubmit) {
      const payout = await provider.createPayout({
        payoutRequestId: body.idempotencyKey,
        recipientMobile,
        amountDecimal,
        reference: note ? `MICA: ${note}` : "MICA BDT payment",
      });
      providerTransactionId = payout.providerTransactionId;
      submittedNow = true;
      await firestoreSet(`${TRANSFERS_COLLECTION}/${transferId}`, {
        status: payout.status === "FAILED" ? "FAILED" : "PROCESSING",
        providerTransactionId,
        updatedAt: new Date().toISOString(),
      });
      logStep("payout_submitted", {
        transferId,
        status: payout.status,
        hasProviderTransactionId: Boolean(providerTransactionId),
      });
      if (payout.status === "FAILED") {
        await firestoreSet(`${TRANSFERS_COLLECTION}/${transferId}`, {
          status: "FAILED",
          failureReason: "The payment provider rejected the payout.",
          updatedAt: new Date().toISOString(),
        });
        return {
          httpStatus: 502,
          body: { ok: false, code: "TRANSFER_FAILED", error: "The payment could not be completed." },
        };
      }
    } else if (!providerTransactionId) {
      // Another in-flight request owns the payout submission right now. Do NOT
      // double-submit — report pending so the client keeps polling.
      logStep("payout_submit_skipped", { transferId, claimedNow, transferCreatedNow });
    }

    // ── 8. Poll to a terminal state within this invocation's budget ──
    const deadline = Date.now() + POLL_BUDGET_MS;
    let status = submittedNow ? "PROCESSING" : (transferDoc?.status as string) ?? "PENDING";
    let pollError: string | null = null;
    while (
      providerTransactionId &&
      Date.now() < deadline &&
      status !== "SUCCESS" &&
      status !== "FAILED"
    ) {
      try {
        const s = await provider.getPayoutStatus(providerTransactionId!);
        status = s;
        if (["SUCCESS", "FAILED"].includes(status)) break;
      } catch (err: any) {
        pollError = err?.message ? String(err.message).slice(0, 200) : "status poll failed";
        console.error("[BdtPayout] status poll error:", pollError);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    logStep("transfer_status", { transferId, status, hasPollError: Boolean(pollError) });

    // ── 9. Terminal handling ─────────────────────────────────────────
    if (status === "SUCCESS") {
      const patch: Record<string, unknown> = {
        status: "SUCCESS",
        updatedAt: new Date().toISOString(),
      };
      if (!(await firestoreGet(`${TRANSFERS_COLLECTION}/${transferId}`))?.completedAt) {
        patch.completedAt = new Date().toISOString();
      }
      await firestoreSet(`${TRANSFERS_COLLECTION}/${transferId}`, patch);
      await writeBdtHistoryOnce({
        key: body.idempotencyKey,
        senderUid,
        recipientUid,
        amountDecimal,
        method,
        providerTransactionId: providerTransactionId ?? "",
        note,
        chatId,
      });
      const doc = (await firestoreGet(`${TRANSFERS_COLLECTION}/${transferId}`)) ?? {};
      return { httpStatus: 200, body: { ok: true, transfer: safeTransferSummary(doc) } };
    }

    if (status === "FAILED") {
      await firestoreSet(`${TRANSFERS_COLLECTION}/${transferId}`, {
        status: "FAILED",
        failureReason: pollError ? "The payment provider could not be reached." : "The payment was not completed.",
        updatedAt: new Date().toISOString(),
      });
      return {
        httpStatus: 502,
        body: { ok: false, code: "TRANSFER_FAILED", error: "The payment could not be completed. No money was moved." },
      };
    }

    // Still pending — client re-posts the SAME key to continue polling.
    const doc = (await firestoreGet(`${TRANSFERS_COLLECTION}/${transferId}`)) ?? {};
    return { httpStatus: 200, body: { ok: true, pending: true, transfer: safeTransferSummary(doc) } };
  } catch (err: unknown) {
    if (err instanceof BdtError) {
      logStep("create_transfer_failed", { code: err.code, httpStatus: err.httpStatus });
      return { httpStatus: err.httpStatus, body: { ok: false, code: err.code, error: err.message } };
    }
    const message = err instanceof Error ? err.message : String(err ?? "unknown error");
    console.error("[BdtPayout] unexpected:", message.slice(0, 300));
    return {
      httpStatus: 500,
      body: { ok: false, code: "SERVER_ERROR", error: "Internal error while processing the transfer." },
    };
  }
}

// ---------------------------------------------------------------------------
// Handler: read a transfer by id (sender or recipient only)
// ---------------------------------------------------------------------------

export async function handleBdtGetTransfer(
  authHeader: string | undefined,
  transferId: unknown
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  try {
    const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) throw new BdtError("UNAUTHORIZED", "Missing Firebase ID token.", 401);
    let uid: string;
    try {
      ({ uid } = await verifyFirebaseToken(idToken));
    } catch {
      throw new BdtError("UNAUTHORIZED", "Invalid or expired Firebase ID token.", 401);
    }
    if (!isSafeTransferId(transferId)) {
      throw new BdtError("INVALID_REQUEST", "transferId is invalid.");
    }
    const doc = await firestoreGet(`${TRANSFERS_COLLECTION}/${transferId}`);
    if (!doc || (doc.senderId !== uid && doc.recipientId !== uid)) {
      throw new BdtError("NOT_FOUND", "Transfer not found.", 404);
    }
    return { httpStatus: 200, body: { ok: true, transfer: safeTransferSummary(doc) } };
  } catch (err: unknown) {
    if (err instanceof BdtError) {
      return { httpStatus: err.httpStatus, body: { ok: false, code: err.code, error: err.message } };
    }
    return { httpStatus: 500, body: { ok: false, code: "SERVER_ERROR", error: "Internal error reading the transfer." } };
  }
}

// ---------------------------------------------------------------------------
// History — one BDT_TRANSFER record per successful transfer, written server-side.
// ---------------------------------------------------------------------------

async function writeBdtHistoryOnce(info: {
  key: string;
  senderUid: string;
  recipientUid: string;
  amountDecimal: string;
  method: string;
  providerTransactionId: string;
  note: string | null;
  chatId: string | null;
}): Promise<void> {
  const [senderProfile, recipientProfile] = await Promise.all([
    firestoreGet(`users/${info.senderUid}`),
    firestoreGet(`users/${info.recipientUid}`),
  ]);
  const payload: Record<string, unknown> = {
    type: "BDT_TRANSFER",
    currency: "BDT",
    method: info.method,
    senderId: info.senderUid,
    senderUsername: String(senderProfile?.username ?? ""),
    recipientId: info.recipientUid,
    recipientUsername: String(recipientProfile?.username ?? ""),
    amount: Number(info.amountDecimal),
    fee: 0,
    status: "succeeded",
    provider: "bKash",
    providerTransactionId: info.providerTransactionId,
    idempotencyKey: info.key,
    timestamp: new Date().toISOString(),
  };
  if (info.note) payload.note = info.note;
  if (info.chatId) payload.chatId = info.chatId;
  await firestoreSet(`${PAYMENTS_COLLECTION}/payment_${info.key}`, payload);
  logStep("bdt_history_written", { hasChatId: Boolean(info.chatId) });
}