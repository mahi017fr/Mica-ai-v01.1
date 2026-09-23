// BDT DEAL ROOM FUNDING — server-side only.
//
// SEPARATE from the direct Send Money flow (api/_lib/bdtPayoutService.ts).
//
//   SEND MONEY   : sender → bKash payout → recipient            (BkashPaymentProvider)
//   DEAL ROOM    : buyer → Deal funding hold → verified → FUNDED → delivery →
//                  buyer approval → settlement                     (DealFundingProvider)
//
// A Deal Room payment is NOT a personal bKash B2C payout to the seller. Buying
// a deliverable escrows the buyer's funds until the buyer approves delivery.
// That requires a merchant/holding/settlement capability that an ordinary
// personal bKash account does not have. If that capability is not configured
// (or not implemented), this service must NOT fake escrow: it returns
// `BDT_DEAL_PAYMENTS_NOT_CONFIGURED`, never marks anything FUNDED, and NEVER
// sends money straight to the seller's personal number.
//
// Endpoints:
//   POST /api/bdt/deal-funding                         → createDealFunding
//   GET  /api/bdt/deal-funding/:fundingId              → getDealFundingStatus
//   POST /api/bdt/deal-funding/:fundingId/settlement   → requestDealSettlement
//   POST /api/bdt/deal-funding/:fundingId/refund       → requestDealRefund
//
// Status machine for a funding hold:
//   PAYMENT_PENDING → VERIFYING → FUNDED → SETTLEMENT_PENDING → SETTLED
//                                  └→ REFUNDED (buyer cancels / dispute)

import {
  firestoreCreate,
  firestoreGet,
  firestoreRunTransaction,
  firestoreSet,
  verifyFirebaseToken,
} from "./circleWalletService.js";

const DEAL_FUNDING_COLLECTION = "deal_funding";
const DEAL_ROOMS_COLLECTION = "deal_rooms";

export type DealFundingStatus =
  | "PAYMENT_PENDING"
  | "VERIFYING"
  | "FUNDED"
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "REFUNDED"
  | "FAILED";

/** Provider-agnostic contract for a Deal Room funding hold. A real
 * implementation sits behind a merchant/holding integration and NEVER reuses
 * the B2C Send Money payout path. */
export interface DealFundingProvider {
  readonly name: string;
  /** True only when a genuine holding/settlement capability is configured. */
  isConfigured(): boolean;
  holdDealPayment(req: {
    fundingId: string;
    dealRoomId: string;
    dealId: string;
    buyerUid: string;
    sellerUid: string;
    amount: number;
  }): Promise<{ status: DealFundingStatus; reference?: string }>;
  verifyDealHold(ref: string): Promise<DealFundingStatus>;
  releaseDealPayment(ref: string): Promise<DealFundingStatus>;
  refundDealPayment(ref: string): Promise<DealFundingStatus>;
}

export class BdtDealPaymentsNotConfiguredError extends Error {
  readonly code = "BDT_DEAL_PAYMENTS_NOT_CONFIGURED";
  constructor() {
    super("BDT Deal payments are not configured yet. A merchant holding/settlement model is required for escrow-style deal funding.");
    this.name = "BdtDealPaymentsNotConfiguredError";
  }
}

/**
 * The default provider: NO holding/settlement capability is assumed for an
 * ordinary bKash payout contract, so this is always NOT configured. Real
 * merchant/holding integrations would register their own implementation here.
 */
class UnsupportedDealFundingProvider implements DealFundingProvider {
  readonly name = "bKash-merchant-holding (unsupported)";
  isConfigured(): boolean {
    return false;
  }
  async holdDealPayment(): Promise<{ status: DealFundingStatus; reference?: string }> {
    throw new BdtDealPaymentsNotConfiguredError();
  }
  async verifyDealHold(): Promise<DealFundingStatus> {
    throw new BdtDealPaymentsNotConfiguredError();
  }
  async releaseDealPayment(): Promise<DealFundingStatus> {
    throw new BdtDealPaymentsNotConfiguredError();
  }
  async refundDealPayment(): Promise<DealFundingStatus> {
    throw new BdtDealPaymentsNotConfiguredError();
  }
}

let _dealFundingProvider: DealFundingProvider | null = null;

function getDealFundingProvider(): DealFundingProvider {
  if (!_dealFundingProvider) _dealFundingProvider = new UnsupportedDealFundingProvider();
  return _dealFundingProvider;
}

export class BdtDealError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function logStep(step: string, detail: Record<string, unknown> = {}) {
  console.log("[BdtDealPayout]", JSON.stringify({ step, ...detail }));
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_\-]{1,128}$/.test(id);
}

function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && /^[a-zA-Z0-9_\-]{8,64}$/.test(key);
}

function parseBdtAmount(raw: unknown): number {
  let s: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new BdtDealError("INVALID_AMOUNT", "Amount must be a finite number.");
    s = raw.toString();
  } else if (typeof raw === "string") {
    s = raw.trim().replace(",", ".");
  } else {
    throw new BdtDealError("INVALID_AMOUNT", "Amount is required.");
  }
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) {
    throw new BdtDealError("INVALID_AMOUNT", "Amount must be a positive BDT value with at most 2 decimals.");
  }
  const numeric = Number(s);
  if (!(numeric > 0)) throw new BdtDealError("INVALID_AMOUNT", "Amount must be greater than zero.");
  if (numeric > 10_000_000) throw new BdtDealError("AMOUNT_TOO_LARGE", "Amount exceeds the ৳10,000,000 limit.");
  return numeric;
}

function stateToSafe(doc: Record<string, unknown>): Record<string, unknown> {
  return {
    fundingId: doc.fundingId,
    dealRoomId: doc.dealRoomId ?? null,
    dealId: doc.dealId ?? null,
    buyerUid: doc.buyerUid,
    sellerUid: doc.sellerUid,
    amount: doc.amount,
    status: doc.status,
    provider: doc.provider,
    providerReference: doc.providerReference ?? null,
    reason: doc.reason ?? null,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
    completedAt: doc.completedAt ?? null,
  };
}

async function loadDeal(dealRoomId: string, dealId: string): Promise<Record<string, unknown> | null> {
  return firestoreGet(`${DEAL_ROOMS_COLLECTION}/${dealRoomId}/deals/${dealId}`);
}

/**
 * Read a funding hold's non-terminal state back from the provider. Used when a
 * client continues a pending hold (same idempotency key after a refresh): the
 * SERVER re-asks the provider instead of trusting stale Firestore data. Only a
 * provider-confirmed FUNDED is ever treated as funded.
 */
async function maybeRefreshHold(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
  const provider = getDealFundingProvider();
  if (!provider.isConfigured()) return doc;
  const status = String(doc.status ?? "");
  if (status !== "PAYMENT_PENDING" && status !== "VERIFYING") return doc;
  const ref = typeof doc.providerReference === "string" ? doc.providerReference : String(doc.fundingId ?? "");
  if (!ref) return doc;
  try {
    const verified = await provider.verifyDealHold(ref);
    if (verified !== status) {
      const patch: Record<string, unknown> = { status: verified, updatedAt: new Date().toISOString() };
      if (verified === "FUNDED" || verified === "FAILED" || verified === "SETTLED" || verified === "REFUNDED") {
        patch.completedAt = new Date().toISOString();
      }
      await firestoreSet(`${DEAL_FUNDING_COLLECTION}/${String(doc.fundingId ?? "")}`, patch);
      doc = { ...doc, ...patch };
      logStep("deal_funding_verified", { fundingId: doc.fundingId, status: verified });
    }
    return doc;
  } catch (err: any) {
    console.error("[BdtDealPayout] hold verification pending:", err?.message ? String(err.message).slice(0, 200) : "unknown");
    return doc;
  }
}

/**
 * Race-free conditional status transition guarded by a Firestore transaction.
 * Only ONE concurrent caller may pass an `allowedFrom` gate; every other
 * attempt aborts with a 409 — this is what makes duplicate settlement/refund
 * requests non-duplicating at the payout layer.
 */
interface TxTransition {
  ok: boolean;
  previous?: string;
  httpStatus?: number;
  code?: string;
  message?: string;
}

async function transitionFundingState(params: {
  fundingId: string;
  actorUid: string;
  allowedFrom: DealFundingStatus[];
  to: DealFundingStatus;
  patch?: Record<string, unknown>;
}): Promise<TxTransition> {
  let outcome: TxTransition | null = null;
  const path = `${DEAL_FUNDING_COLLECTION}/${params.fundingId}`;
  await firestoreRunTransaction(async (tx: any, db: any) => {
    const ref = db.doc(path);
    const snap = await tx.get(ref);
    if (!snap.exists) {
      outcome = { ok: false, httpStatus: 404, code: "NOT_FOUND", message: "Deal funding not found." };
      return;
    }
    const data = (snap.data?.() as Record<string, unknown> | undefined) ?? null;
    if (!data) {
      outcome = { ok: false, httpStatus: 404, code: "NOT_FOUND", message: "Deal funding not found." };
      return;
    }
    if (data.buyerUid !== params.actorUid) {
      outcome = { ok: false, httpStatus: 403, code: "FORBIDDEN", message: "Only the buyer may perform this action." };
      return;
    }
    const current = String(data.status ?? "");
    if (!(params.allowedFrom as string[]).includes(current)) {
      outcome = {
        ok: false,
        httpStatus: 409,
        code: "INVALID_STATE",
        message: current === params.to
          ? `This action is already in progress (state ${current}). No duplicate payout was created.`
          : `Cannot move a funding hold from ${current} to ${params.to} (duplicate or invalid request).`,
      };
      return;
    }
    tx.update(ref, { status: params.to, updatedAt: new Date().toISOString(), ...(params.patch ?? {}) });
    outcome = { ok: true, previous: current };
  });
  if (!outcome) {
    return { ok: false, httpStatus: 500, code: "SERVER_ERROR", message: "Internal error while transitioning deal funding." };
  }
  return outcome;
}

/** Revert a funding hold to a known-good state when the provider does not confirm. */
async function revertFundingState(fundingId: string, status: DealFundingStatus, reason: string): Promise<void> {
  await firestoreSet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`, {
    status,
    reason,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// createDealFunding — the BUYER initiates a Deal funding hold.
// ---------------------------------------------------------------------------

export interface DealFundingCreateBody {
  dealRoomId?: unknown;
  dealId?: unknown;
  amount?: unknown;
  idempotencyKey?: unknown;
}

export async function handleDealFundingCreate(
  authHeader: string | undefined,
  body: DealFundingCreateBody
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  try {
    const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) throw new BdtDealError("UNAUTHORIZED", "Missing Firebase ID token.", 401);
    let buyerUid: string;
    try {
      ({ uid: buyerUid } = await verifyFirebaseToken(idToken));
    } catch {
      throw new BdtDealError("UNAUTHORIZED", "Invalid or expired Firebase ID token.", 401);
    }

    if (!isValidId(body.dealRoomId) || !isValidId(body.dealId)) {
      throw new BdtDealError("INVALID_REQUEST", "dealRoomId and dealId are required.");
    }
    if (!isValidIdempotencyKey(body.idempotencyKey)) {
      throw new BdtDealError("INVALID_REQUEST", "idempotencyKey is required.");
    }
    const amount = parseBdtAmount(body.amount);
    const dealRoomId = body.dealRoomId;
    const dealId = body.dealId;

    // Deal funding requires a real merchant/holding capability. If it isn't
    // configured, DO NOT fake escrow and DO NOT move money.
    const provider = getDealFundingProvider();
    if (!provider.isConfigured()) {
      throw new BdtDealPaymentsNotConfiguredError();
    }

    // Ownership + terms check against the deal document (server read; rules
    // are bypassed for the admin SDK, so the check is explicit).
    const deal = await loadDeal(dealRoomId, dealId);
    if (!deal || deal.buyerUid !== buyerUid) {
      throw new BdtDealError("DEAL_NOT_FOUND", "Deal not found or you are not the buyer.", 404);
    }
    const rawTerms = deal?.terms;
    const dealAmount =
      typeof rawTerms === "object" && rawTerms !== null
        ? Number((rawTerms as Record<string, unknown>).amount ?? -1)
        : -1;
    if (!(dealAmount > 0) || Math.abs(dealAmount - amount) > 0.01) {
      throw new BdtDealError("DEAL_AMOUNT_MISMATCH", "The payment amount does not match the deal agreement amount.");
    }
    const sellerUid = typeof deal.sellerUid === "string" ? deal.sellerUid : "";
    if (!sellerUid) {
      throw new BdtDealError("DEAL_NOT_FOUND", "Deal has no seller.", 404);
    }

    const fundingId = `funding_${body.idempotencyKey}`;
    const existing = await firestoreGet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`);
    if (existing) {
      // Continuation-safe: return the CURRENT hold state — but first re-ask the
      // provider so a pending hold is genuinely verified, never assumed. No
      // money is ever moved twice for the same fundingId key.
      const refreshed = await maybeRefreshHold(existing);
      return { httpStatus: 200, body: { ok: true, funding: stateToSafe(refreshed) } };
    }

    // Race-free create: exactly one of N concurrent same-key requests wins and
    // becomes the holder. Losers return the winner's hold state instead.
    const created = await firestoreCreate(DEAL_FUNDING_COLLECTION, fundingId, {
      fundingId,
      dealRoomId,
      dealId,
      buyerUid,
      sellerUid,
      amount,
      status: "PAYMENT_PENDING",
      provider: provider.name,
      providerReference: null,
      reason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (!created) {
      const winner = await firestoreGet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`);
      if (!winner) {
        throw new BdtDealError("SERVER_ERROR", "Deal funding could not be read after creation conflict.", 500);
      }
      return { httpStatus: 200, body: { ok: true, funding: stateToSafe(winner) } };
    }
    logStep("deal_funding_created_doc", { fundingId });

    const hold = await provider.holdDealPayment({
      fundingId,
      dealRoomId,
      dealId,
      buyerUid,
      sellerUid,
      amount,
    });
    // Only `FUNDED` (verified hold) is a terminal funding success.
    if (hold.status === "FUNDED") {
      await firestoreSet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`, {
        status: "FUNDED",
        providerReference: hold.reference ?? null,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      await firestoreSet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`, {
        status: hold.status === "FAILED" ? "FAILED" : "VERIFYING",
        providerReference: hold.reference ?? null,
        updatedAt: new Date().toISOString(),
      });
    }
    const doc = (await firestoreGet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`)) ?? {};
    logStep("deal_funding_created", { fundingId, status: doc.status });
    return { httpStatus: 200, body: { ok: true, funding: stateToSafe(doc) } };
  } catch (err: unknown) {
    if (err instanceof BdtDealPaymentsNotConfiguredError) {
      logStep("deal_funding_not_configured");
      return { httpStatus: 503, body: { ok: false, code: err.code, error: err.message } };
    }
    if (err instanceof BdtDealError) {
      logStep("deal_funding_failed", { code: err.code, httpStatus: err.httpStatus });
      return { httpStatus: err.httpStatus, body: { ok: false, code: err.code, error: err.message } };
    }
    const message = err instanceof Error ? err.message : String(err ?? "unknown error");
    console.error("[BdtDealPayout] create unexpected:", message.slice(0, 300));
    return { httpStatus: 500, body: { ok: false, code: "SERVER_ERROR", error: "Internal error creating deal funding." } };
  }
}

// ---------------------------------------------------------------------------
// getDealFundingStatus
// ---------------------------------------------------------------------------

export async function handleDealFundingStatus(
  authHeader: string | undefined,
  fundingId: unknown
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  try {
    const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) throw new BdtDealError("UNAUTHORIZED", "Missing Firebase ID token.", 401);
    let uid: string;
    try {
      ({ uid } = await verifyFirebaseToken(idToken));
    } catch {
      throw new BdtDealError("UNAUTHORIZED", "Invalid or expired Firebase ID token.", 401);
    }
    if (!isValidId(fundingId)) {
      throw new BdtDealError("INVALID_REQUEST", "fundingId is invalid.");
    }
    if (!getDealFundingProvider().isConfigured()) {
      throw new BdtDealPaymentsNotConfiguredError();
    }
    const doc = await firestoreGet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`);
    if (!doc || (doc.buyerUid !== uid && doc.sellerUid !== uid)) {
      throw new BdtDealError("NOT_FOUND", "Deal funding not found.", 404);
    }
    // Re-ask the provider for a pending hold so the client always sees the
    // authoritative (server-verified) funding state.
    const refreshed = await maybeRefreshHold(doc);
    return { httpStatus: 200, body: { ok: true, funding: stateToSafe(refreshed) } };
  } catch (err: unknown) {
    if (err instanceof BdtDealPaymentsNotConfiguredError) {
      return { httpStatus: 503, body: { ok: false, code: err.code, error: err.message } };
    }
    if (err instanceof BdtDealError) {
      return { httpStatus: err.httpStatus, body: { ok: false, code: err.code, error: err.message } };
    }
    return { httpStatus: 500, body: { ok: false, code: "SERVER_ERROR", error: "Internal error reading deal funding." } };
  }
}

// ---------------------------------------------------------------------------
// requestDealSettlement — buyer approved delivery → funds released to the seller.
// ---------------------------------------------------------------------------

export async function handleDealFundingSettlement(
  authHeader: string | undefined,
  fundingId: unknown
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  try {
    const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) throw new BdtDealError("UNAUTHORIZED", "Missing Firebase ID token.", 401);
    let uid: string;
    try {
      ({ uid } = await verifyFirebaseToken(idToken));
    } catch {
      throw new BdtDealError("UNAUTHORIZED", "Invalid or expired Firebase ID token.", 401);
    }
    if (!isValidId(fundingId)) {
      throw new BdtDealError("INVALID_REQUEST", "fundingId is invalid.");
    }
    const provider = getDealFundingProvider();
    if (!provider.isConfigured()) {
      throw new BdtDealPaymentsNotConfiguredError();
    }

    // Transactional, once-only gate: settle can ONLY move from FUNDED. Two
    // concurrent/duplicate requests — only the first wins; the rest abort with
    // a 409 and NO payout is attempted again.
    const gate = await transitionFundingState({
      fundingId,
      actorUid: uid,
      allowedFrom: ["FUNDED"],
      to: "SETTLEMENT_PENDING",
    });
    if (!gate.ok) {
      throw new BdtDealError("INVALID_STATE", gate.message ?? "Settlement is not allowed from the current state.", gate.httpStatus ?? 409);
    }

    // Funds are only marked SETTLED when the provider confirms the release.
    // Any absence of confirmation is treated as NOT settled and the hold is
    // reverted to FUNDED so the buyer can retry — never a fake success.
    let final: DealFundingStatus;
    try {
      const doc = (await firestoreGet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`)) ?? {};
      final = await provider.releaseDealPayment(
        typeof doc.providerReference === "string" ? doc.providerReference : fundingId
      );
    } catch (err: any) {
      await revertFundingState(fundingId, gate.previous as DealFundingStatus, "settlement_provider_error");
      console.error("[BdtDealPayout] settlement provider error:", err?.message ? String(err.message).slice(0, 200) : "unknown");
      throw new BdtDealError("SETTLEMENT_FAILED", "The settlement did not confirm with the provider. No funds were released.", 502);
    }
    if (final !== "SETTLED") {
      await revertFundingState(fundingId, gate.previous as DealFundingStatus, "settlement_not_confirmed");
      throw new BdtDealError("SETTLEMENT_FAILED", "The settlement did not confirm with the provider. No funds were released.", 502);
    }
    await firestoreSet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`, {
      status: "SETTLED",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reason: null,
    });
    const updated = (await firestoreGet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`)) ?? {};
    logStep("deal_funding_settled", { fundingId });
    return { httpStatus: 200, body: { ok: true, funding: stateToSafe(updated) } };
  } catch (err: unknown) {
    if (err instanceof BdtDealPaymentsNotConfiguredError) {
      return { httpStatus: 503, body: { ok: false, code: err.code, error: err.message } };
    }
    if (err instanceof BdtDealError) {
      return { httpStatus: err.httpStatus, body: { ok: false, code: err.code, error: err.message } };
    }
    return { httpStatus: 500, body: { ok: false, code: "SERVER_ERROR", error: "Internal error settling deal funding." } };
  }
}

// ---------------------------------------------------------------------------
// requestDealRefund — buyer cancels / dispute → the hold is refunded.
// ---------------------------------------------------------------------------

export async function handleDealFundingRefund(
  authHeader: string | undefined,
  fundingId: unknown
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  try {
    const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) throw new BdtDealError("UNAUTHORIZED", "Missing Firebase ID token.", 401);
    let uid: string;
    try {
      ({ uid } = await verifyFirebaseToken(idToken));
    } catch {
      throw new BdtDealError("UNAUTHORIZED", "Invalid or expired Firebase ID token.", 401);
    }
    if (!isValidId(fundingId)) {
      throw new BdtDealError("INVALID_REQUEST", "fundingId is invalid.");
    }
    const provider = getDealFundingProvider();
    if (!provider.isConfigured()) {
      throw new BdtDealPaymentsNotConfiguredError();
    }

    // Transactional, once-only gate: a refund may start from any held,
    // non-terminal state. Exactly one concurrent/duplicate request wins; every
    // other attempt aborts with a 409 and the provider is never asked twice.
    const gate = await transitionFundingState({
      fundingId,
      actorUid: uid,
      allowedFrom: ["FUNDED", "VERIFYING", "SETTLEMENT_PENDING"],
      to: "PAYMENT_PENDING",
      patch: { reason: "buyer_refund" },
    });
    if (!gate.ok) {
      throw new BdtDealError("INVALID_STATE", gate.message ?? "Refund is not allowed from the current state.", gate.httpStatus ?? 409);
    }

    // A hold is only marked REFUNDED when the provider CONFIRMS the refund.
    // Anything short of that (error or non-confirmed response) is reverted so
    // the buyer can retry — never a fake successful refund.
    let final: DealFundingStatus;
    try {
      const doc = (await firestoreGet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`)) ?? {};
      final = await provider.refundDealPayment(
        typeof doc.providerReference === "string" ? doc.providerReference : fundingId
      );
    } catch (err: any) {
      await revertFundingState(fundingId, gate.previous as DealFundingStatus, "refund_provider_error");
      console.error("[BdtDealPayout] refund provider error:", err?.message ? String(err.message).slice(0, 200) : "unknown");
      throw new BdtDealError("REFUND_FAILED", "The refund did not confirm with the provider. No refund was issued.", 502);
    }
    if (final !== "REFUNDED") {
      await revertFundingState(fundingId, gate.previous as DealFundingStatus, "refund_not_confirmed");
      throw new BdtDealError("REFUND_FAILED", "The refund did not confirm with the provider. No refund was issued.", 502);
    }
    await firestoreSet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`, {
      status: "REFUNDED",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reason: null,
    });
    const updated = (await firestoreGet(`${DEAL_FUNDING_COLLECTION}/${fundingId}`)) ?? {};
    logStep("deal_funding_refunded", { fundingId });
    return { httpStatus: 200, body: { ok: true, funding: stateToSafe(updated) } };
  } catch (err: unknown) {
    if (err instanceof BdtDealPaymentsNotConfiguredError) {
      return { httpStatus: 503, body: { ok: false, code: err.code, error: err.message } };
    }
    if (err instanceof BdtDealError) {
      return { httpStatus: err.httpStatus, body: { ok: false, code: err.code, error: err.message } };
    }
    return { httpStatus: 500, body: { ok: false, code: "SERVER_ERROR", error: "Internal error refunding deal funding." } };
  }
}