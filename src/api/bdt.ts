// Client bridge for BDT Send Money — POST /api/bdt/transfers.
//
// SECURITY: only the Firebase ID token + recipientUid/amount/note/method leave
// the browser. The recipient's payout number, provider credentials and the
// actual bKash call are entirely server-side. BDT is NEVER marked successful
// here — only the backend (after the provider confirms) may report SUCCESS.

import { auth } from "../firebase";
import type { BdPaymentMethodId, BdTransfer, DealFundingRecord } from "../payments/bdt";

export class BdtApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

interface RecipientCheckResult {
  recipientHasPaymentNumber: boolean;
  hint?: string;
}

async function postBdt(
  path: string,
  body: Record<string, unknown>
): Promise<any> {
  const user = auth.currentUser;
  if (!user) throw new BdtApiError("You must be signed in to send money.", "UNAUTHORIZED");
  const idToken = await user.getIdToken();

  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new BdtApiError("Could not reach the payment server.", "TRANSPORT_ERROR");
  }

  const rawText = await res.text().catch(() => null);
  let data: any = null;
  try {
    data = rawText === null ? undefined : JSON.parse(rawText);
  } catch {
    console.error("[Bdt] Non-JSON response from server", {
      httpStatus: res.status,
      contentType: res.headers.get("content-type"),
    });
    throw new BdtApiError("Server returned an invalid response.", "TRANSPORT_ERROR");
  }

  if (!res.ok || data?.ok !== true) {
    const code = data?.code || "SERVER_ERROR";
    const error = data?.error || `Transfer failed (${res.status}).`;
    console.error("[Bdt] server rejected request", { httpStatus: res.status, code, error });
    throw new BdtApiError(error, code);
  }
  return data;
}

/** Pre-check: does the recipient have a payable number? Never the number. */
export async function checkBdRecipientPaymentProfile(
  recipientUid: string
): Promise<RecipientCheckResult> {
  const data = await postBdt("/api/bdt/recipient-check", { recipientUid });
  return {
    recipientHasPaymentNumber: Boolean(data.recipientHasPaymentNumber),
    hint: typeof data.hint === "string" ? data.hint : undefined,
  };
}

function makeIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency-key persistence (sessionStorage) + single-flight guard.
//
// WHY: if the user refreshes or double-clicks while a payment is processing,
// the idempotency key must SURVIVE — otherwise the page generates a fresh key,
// the server creates a SECOND logical transfer, and the merchant payout runs
// twice. The key is keyed by a fingerprint of the exact payment details, kept
// for a short TTL, and cleared when the payment reaches a terminal state.
// sessionStorage is per-tab, so different tabs still behave independently.
// ─────────────────────────────────────────────────────────────────────────────

const PENDING_PREFIX = "mica_bdt_pending_";
const PENDING_TTL_MS = 5 * 60_000;

function hashFingerprint(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function pendingStorageKey(scope: string, fingerprint: string): string {
  return `${PENDING_PREFIX}${scope}_${fingerprint}`;
}

function readPendingKey(scope: string, fingerprint: string): string | null {
  try {
    const stored = sessionStorage.getItem(pendingStorageKey(scope, fingerprint));
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { key?: string; expiresAt?: number };
    if (typeof parsed.key !== "string" || typeof parsed.expiresAt !== "number") {
      sessionStorage.removeItem(pendingStorageKey(scope, fingerprint));
      return null;
    }
    if (Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(pendingStorageKey(scope, fingerprint));
      return null;
    }
    return parsed.key;
  } catch {
    return null;
  }
}

function savePendingKey(scope: string, fingerprint: string, key: string): void {
  try {
    sessionStorage.setItem(
      pendingStorageKey(scope, fingerprint),
      JSON.stringify({ key, expiresAt: Date.now() + PENDING_TTL_MS })
    );
  } catch {
    // storage unavailable — the per-call key still works; persistence is best-effort
  }
}

function clearPendingKey(scope: string, fingerprint: string): void {
  try {
    sessionStorage.removeItem(pendingStorageKey(scope, fingerprint));
  } catch {
    // best-effort
  }
}

/** Reuse an in-tab single-flight promise so two rapid calls share one attempt. */
function singleFlight<T>(map: Map<string, Promise<T>>, key: string, factory: () => Promise<T>): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;
  const promise = factory().finally(() => map.delete(key));
  map.set(key, promise);
  return promise;
}

const transferInFlight = new Map<string, Promise<BdTransfer>>();
const fundingInFlight = new Map<string, Promise<DealFundingRecord>>();

const TERMINAL_POLL_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

/**
 * Submit a BDT transfer and poll until the backend reports a terminal state.
 *
 * The SAME idempotencyKey is reused for every poll round-trip (and across a
 * refresh, via sessionStorage) so the server NEVER re-submits the payout — it
 * only continues provider status polling. Rapid duplicate calls share a single
 * in-flight attempt.
 */
export async function createBdtTransfer(params: {
  recipientUid: string;
  amount: string;
  method?: BdPaymentMethodId;
  note?: string;
  chatId?: string | null;
  onStep?: (step: string) => void;
}): Promise<BdTransfer> {
  const senderUid = auth.currentUser?.uid ?? "";
  const scope = "transfer";
  const fingerprint = hashFingerprint(
    `${senderUid}|${params.recipientUid}|${params.amount}|${params.method ?? "BKASH"}`
  );
  return singleFlight(transferInFlight, fingerprint, () =>
    runBdtTransfer(scope, fingerprint, params)
  );
}

async function runBdtTransfer(
  scope: string,
  fingerprint: string,
  params: {
    recipientUid: string;
    amount: string;
    method?: BdPaymentMethodId;
    note?: string;
    chatId?: string | null;
    onStep?: (step: string) => void;
  }
): Promise<BdTransfer> {
  let idempotencyKey = readPendingKey(scope, fingerprint);
  if (!idempotencyKey) {
    idempotencyKey = makeIdempotencyKey();
    savePendingKey(scope, fingerprint, idempotencyKey);
  }
  const deadline = Date.now() + TERMINAL_POLL_MS;
  let firstRound = true;

  try {
    while (true) {
      params.onStep?.(
        firstRound ? "Submitting payment…" : "Waiting for bKash confirmation…"
      );
      let data: any;
      try {
        data = await postBdt("/api/bdt/transfers", {
          recipientUid: params.recipientUid,
          amount: params.amount,
          method: params.method ?? "BKASH",
          note: params.note ?? null,
          chatId: params.chatId ?? null,
          idempotencyKey,
        });
      } catch (err) {
        // TRANSPORT_ERROR / SERVER_ERROR keep the same key in play so the server
        // never double-submits the payout — it continues status polling.
        const retryable =
          err instanceof BdtApiError &&
          (err.code === "TRANSPORT_ERROR" || err.code === "SERVER_ERROR");
        if (retryable && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
        throw err;
      }
      firstRound = false;

      const transfer = data.transfer as BdTransfer | undefined;
      if (!transfer) throw new BdtApiError("Server returned no transfer.", "SERVER_ERROR");

      if (transfer.status === "SUCCESS") {
        clearPendingKey(scope, fingerprint);
        return transfer;
      }
      if (transfer.status === "FAILED" || transfer.status === "CANCELLED") {
        clearPendingKey(scope, fingerprint);
        throw new BdtApiError(
          "The payment could not be completed. No money was moved.",
          "TRANSFER_FAILED"
        );
      }
      if (Date.now() >= deadline) {
        // Terminal reached on our side but the money may still settle server-side.
        // Keep the persisted key so a later retry continues THIS transfer instead
        // of creating a duplicate.
        throw new BdtApiError(
          "The payment is still processing. Check your history shortly.",
          "TRANSACTION_PENDING"
        );
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } catch (err) {
    if (err instanceof BdtApiError && err.code === "TRANSACTION_PENDING") throw err;
    clearPendingKey(scope, fingerprint);
    throw err;
  }
}

/** Read a transfer's state directly (GET /api/bdt/transfers/:id). */
export async function fetchBdtTransfer(transferId: string): Promise<BdTransfer> {
  const user = auth.currentUser;
  if (!user) throw new BdtApiError("You must be signed in.", "UNAUTHORIZED");
  const idToken = await user.getIdToken();
  let res: Response;
  try {
    res = await fetch(`/api/bdt/transfers/${encodeURIComponent(transferId)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    throw new BdtApiError("Could not reach the payment server.", "TRANSPORT_ERROR");
  }
  const rawText = await res.text().catch(() => null);
  let data: any = null;
  try {
    data = rawText === null ? undefined : JSON.parse(rawText);
  } catch {
    throw new BdtApiError("Server returned an invalid response.", "TRANSPORT_ERROR");
  }
  if (!res.ok || data?.ok !== true) {
    throw new BdtApiError(data?.error || `Transfer not found (${res.status}).`, data?.code || "SERVER_ERROR");
  }
  return data.transfer as BdTransfer;
}

async function getBdt<T>(path: string): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new BdtApiError("You must be signed in.", "UNAUTHORIZED");
  const idToken = await user.getIdToken();
  let res: Response;
  try {
    res = await fetch(path, { headers: { Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new BdtApiError("Could not reach the payment server.", "TRANSPORT_ERROR");
  }
  const rawText = await res.text().catch(() => null);
  let data: any = null;
  try {
    data = rawText === null ? undefined : JSON.parse(rawText);
  } catch {
    throw new BdtApiError("Server returned an invalid response.", "TRANSPORT_ERROR");
  }
  if (!res.ok || data?.ok !== true) {
    throw new BdtApiError(data?.error || `Request failed (${res.status}).`, data?.code || "SERVER_ERROR");
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// DEAL ROOM FUNDING — escrow-style holding, SEPARATE from Send Money.
// The buyer's deal funds are NOT paid straight to the seller: they are held
// until the buyer approves delivery and a separate settlement step releases
// them (or they are refunded). `BDT_DEAL_PAYMENTS_NOT_CONFIGURED` means the
// server has no merchant holding capability — deals stay unfunded.
// ---------------------------------------------------------------------------

const DEAL_FUNDING_TERMINAL_MS = 120_000;
const DEAL_FUNDING_POLL_MS = 3_000;

export async function createDealFunding(params: {
  dealRoomId: string;
  dealId: string;
  amount: number;
  onStep?: (step: string) => void;
}): Promise<DealFundingRecord> {
  const buyerUid = auth.currentUser?.uid ?? "";
  const scope = "deal-funding";
  const fingerprint = hashFingerprint(
    `${buyerUid}|${params.dealRoomId}|${params.dealId}|${String(params.amount)}`
  );
  return singleFlight(fundingInFlight, fingerprint, () =>
    runDealFunding(scope, fingerprint, params)
  );
}

async function runDealFunding(
  scope: string,
  fingerprint: string,
  params: {
    dealRoomId: string;
    dealId: string;
    amount: number;
    onStep?: (step: string) => void;
  }
): Promise<DealFundingRecord> {
  let idempotencyKey = readPendingKey(scope, fingerprint);
  if (!idempotencyKey) {
    idempotencyKey = makeIdempotencyKey();
    savePendingKey(scope, fingerprint, idempotencyKey);
  }
  const deadline = Date.now() + DEAL_FUNDING_TERMINAL_MS;
  let firstRound = true;

  try {
    while (true) {
      params.onStep?.(
        firstRound ? "Submitting deal funding…" : "Waiting for the deal funding hold to verify…"
      );
      let data: any;
      try {
        data = await postBdt("/api/bdt/deal-funding", {
          dealRoomId: params.dealRoomId,
          dealId: params.dealId,
          amount: String(params.amount),
          idempotencyKey,
        });
      } catch (err) {
        // Continuation-safe retry for transient/probing conditions — the server
        // never creates a second hold for the same idempotency key.
        const retryable =
          err instanceof BdtApiError &&
          (err.code === "TRANSPORT_ERROR" || err.code === "SERVER_ERROR");
        if (retryable && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, DEAL_FUNDING_POLL_MS));
          continue;
        }
        throw err;
      }
      firstRound = false;

      const funding = data.funding as DealFundingRecord | undefined;
      if (!funding) throw new BdtApiError("Server returned no deal funding record.", "SERVER_ERROR");

      if (funding.status === "FUNDED") {
        clearPendingKey(scope, fingerprint);
        return funding;
      }
      if (funding.status === "FAILED") {
        clearPendingKey(scope, fingerprint);
        throw new BdtApiError("The deal payment could not be funded. No money was moved.", "DEAL_PAYMENT_FAILED");
      }
      // VERIFYING / PAYMENT_PENDING / SETTLEMENT_PENDING → keep waiting.
      if (Date.now() >= deadline) {
        // Keep the persisted key so a retry continues THIS hold, not a duplicate.
        throw new BdtApiError(
          "The deal payment is still verifying. Check the deal shortly.",
          "DEAL_PAYMENT_PENDING"
        );
      }
      await new Promise((r) => setTimeout(r, DEAL_FUNDING_POLL_MS));
    }
  } catch (err) {
    if (err instanceof BdtApiError && err.code === "DEAL_PAYMENT_PENDING") throw err;
    clearPendingKey(scope, fingerprint);
    throw err;
  }
}

export async function getDealFundingStatus(fundingId: string): Promise<DealFundingRecord> {
  const data = await getBdt<{ ok: boolean; funding: DealFundingRecord }>(
    `/api/bdt/deal-funding/${encodeURIComponent(fundingId)}`
  );
  return data.funding;
}

export async function requestDealSettlement(fundingId: string): Promise<DealFundingRecord> {
  const data = await postBdt(`/api/bdt/deal-funding/${encodeURIComponent(fundingId)}/settlement`, {});
  return data.funding as DealFundingRecord;
}

export async function requestDealRefund(fundingId: string): Promise<DealFundingRecord> {
  const data = await postBdt(`/api/bdt/deal-funding/${encodeURIComponent(fundingId)}/refund`, {});
  return data.funding as DealFundingRecord;
}