// Deal escrow orchestration — server-side only.
//
// POST /api/deal/escrow pipeline:
//   verify Firebase ID token → resolve the ACTING user's Circle
//   Developer-Controlled Wallet (server-side MPC, never browser signing) →
//   validate the requested contract interaction against an allow-list →
//   idempotency (race-free) → Circle Developer-Controlled Wallet contract
//   execution (MPC signing) → poll until Circle yields an on-chain txHash.
//
// This is the Deal / Deal Room payment migration: every escrow write that the
// old flow signed in the BROWSER via Privy / an external wallet
// (createDeal / approve / deposit / startReviewPeriod / buyerRelease /
// autoRelease / dispute / refund on DealEscrow.sol) is now signed by Circle's
// server-side MPC infrastructure.
//
// SECURITY:
//   - The SIGNING wallet is ALWAYS resolved from users/{authenticatedUid}.
//   - Client-supplied wallets / ids / Circle credentials are never read.
//   - The target contract address must be allow-listed (escrow / USDC /
//     factory) so the acting user can only drive interactions that match their
//     own deal escrow, never an arbitrary address.
//   - CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET / CIRCLE_WALLET_SET_ID stay here.
//   - Firebase ID tokens are verified, never logged.
//   - The escrow contract itself enforces business rules via msg.sender
//     (onlyParty / only buyer), so signing as the acting user's Circle wallet
//     can never move funds that do not belong to that deal/role.

import {
  createCircleContractExecution,
  firestoreCreate,
  firestoreGet,
  firestoreRunTransaction,
  firestoreSet,
  getCircleTransaction,
  resolveUserCircleWallet,
  verifyFirebaseToken,
} from "./circleWalletService.js";

const IDEMPOTENCY_COLLECTION = "deal_escrow_idempotency";

// Per-invocation polling budget — deliberately below Vercel's function timeout.
// If Circle has not produced an on-chain txHash yet, the response reports
// PENDING and the client re-posts the SAME idempotency key, which continues
// status polling without ever re-submitting the blockchain write.
const POLL_BUDGET_MS = 15_000;
const POLL_INTERVAL_MS = 1_500;

// ---------------------------------------------------------------------------
// Errors mapped to HTTP responses by the handler.
// ---------------------------------------------------------------------------

export class DealEscrowError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface DealEscrowRequest {
  /** Canonical action name. */
  action?: unknown;
  /** Target contract address (escrow, USDC, or factory). */
  contractAddress?: unknown;
  /** Raw encoded calldata for the interaction (0x-prefixed even-length hex). */
  callData?: unknown;
  /** Idempotency key; must be stable per logical blockchain write. */
  idempotencyKey?: unknown;
}

interface DealEscrowSuccess {
  ok: true;
  transaction: {
    id: string;
    transactionHash: string | null;
    status: "COMPLETE" | "PENDING";
    action: string;
    from: string; // acting user's Circle wallet address
    contractAddress: string;
  };
}

interface DealEscrowFailure {
  ok: false;
  error: string;
  code: string;
}

type DealEscrowResult =
  | { httpStatus: number; body: DealEscrowSuccess }
  | { httpStatus: number; body: DealEscrowFailure };

// ---------------------------------------------------------------------------
// Validation helpers (string-exact, no float arithmetic).
// ---------------------------------------------------------------------------

function isValidAction(unknown: unknown): unknown is string {
  return (
    typeof unknown === "string" &&
    /^[A-Za-z0-9_]{1,64}$/.test(unknown) &&
    !unknown.includes("..")
  );
}

function isHexData(unknown: unknown): unknown is string {
  return (
    typeof unknown === "string" &&
    /^0x(?:[0-9a-fA-F]{2}){1,}$/.test(unknown) &&
    unknown.length % 2 === 0
  );
}

function isEvmAddress(unknown: unknown): unknown is string {
  return typeof unknown === "string" && /^0x[a-fA-F0-9]{40}$/.test(unknown);
}

function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && /^[a-zA-Z0-9_\-]{8,64}$/.test(key);
}

// ---------------------------------------------------------------------------
// Idempotency record helpers.
// ---------------------------------------------------------------------------

interface IdemDoc {
  key: string;
  actorUid: string;
  action: string;
  contractAddress: string;
  callData: string;
  status: "CREATED" | "SUBMITTING" | "SUBMITTED" | "COMPLETE" | "FAILED";
  circleTransactionId: string | null;
  transactionHash: string | null;
}

function asIdemDoc(id: string, data: Record<string, unknown> | null): IdemDoc | null {
  if (!data) return null;
  return {
    key: id,
    actorUid: String(data.actorUid ?? ""),
    action: String(data.action ?? ""),
    contractAddress: String(data.contractAddress ?? ""),
    callData: String(data.callData ?? ""),
    status: (data.status as IdemDoc["status"]) ?? "CREATED",
    circleTransactionId: typeof data.circleTransactionId === "string" ? data.circleTransactionId : null,
    transactionHash: typeof data.transactionHash === "string" ? data.transactionHash : null,
  };
}

// ---------------------------------------------------------------------------
// Main handler logic.
// ---------------------------------------------------------------------------

export async function handleDealEscrow(
  authHeader: string | undefined,
  body: DealEscrowRequest
): Promise<DealEscrowResult> {
  try {
    // ── 1. Authenticate ──────────────────────────────────────────────
    const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) {
      throw new DealEscrowError("UNAUTHORIZED", "Missing Firebase ID token.", 401);
    }
    let actorUid: string;
    try {
      ({ uid: actorUid } = await verifyFirebaseToken(idToken));
    } catch {
      throw new DealEscrowError("UNAUTHORIZED", "Invalid or expired Firebase ID token.", 401);
    }

    // ── 2. Validate request shape ────────────────────────────────────
    if (!isValidAction(body.action)) {
      throw new DealEscrowError("INVALID_REQUEST", "action is required.");
    }
    if (!isEvmAddress(body.contractAddress)) {
      throw new DealEscrowError("INVALID_REQUEST", "contractAddress is required.");
    }
    if (!isHexData(body.callData)) {
      throw new DealEscrowError("INVALID_REQUEST", "callData must be encoded hex calldata.");
    }
    if (!isValidIdempotencyKey(body.idempotencyKey)) {
      throw new DealEscrowError("INVALID_REQUEST", "idempotencyKey is required.");
    }
    const contractAddress = body.contractAddress.toLowerCase();
    const callData = body.callData;

    // ── 3. Resolve the ACTING user's Circle wallet (MPC signing key).
    const actingWallet = await resolveUserCircleWallet(actorUid);

    // ── 4. Idempotency record (create-or-load, race-free).
    await firestoreCreate(IDEMPOTENCY_COLLECTION, body.idempotencyKey, {
      actorUid,
      action: body.action,
      contractAddress,
      callData,
      status: "CREATED",
      circleTransactionId: null,
      transactionHash: null,
      createdAt: new Date().toISOString(),
    });
    const existing = asIdemDoc(
      body.idempotencyKey,
      await firestoreGet(`${IDEMPOTENCY_COLLECTION}/${body.idempotencyKey}`)
    );

    // A reused key with DIFFERENT parameters is a conflict, never a replay.
    if (
      existing &&
      (existing.actorUid !== actorUid ||
        existing.action !== body.action ||
        existing.contractAddress !== contractAddress ||
        existing.callData !== callData)
    ) {
      throw new DealEscrowError(
        "IDEMPOTENCY_CONFLICT",
        "This escrow write was already used with different parameters.",
        409
      );
    }

    // ── 5. Submit (only if this logical write was never submitted).
    let circleTransactionId: string | null = existing?.circleTransactionId ?? null;

    if (!circleTransactionId) {
      const claimed = await submitClaim({ idempotencyKey: body.idempotencyKey });
      if (!claimed) {
        throw new DealEscrowError("DUPLICATE_REQUEST", "This escrow write is already being processed.", 409);
      }
      try {
        const result = await createCircleContractExecution({
          sourceWalletId: actingWallet.walletId,
          contractAddress,
          callData,
          idempotencyKey: body.idempotencyKey, // Circle-side exactly-once guard
        });
        circleTransactionId = result.transactionId;
      } catch (err: any) {
        const message = err?.message ? String(err.message).slice(0, 300) : "Circle contract execution failed.";
        console.error("[DealEscrow] createContractExecutionTransaction failed:", message);
        // Mark FAILED so a retry can safely re-claim; Circle's idempotency
        // key guarantees this never produced two blockchain writes.
        await firestoreSetStatus(body.idempotencyKey, { status: "FAILED" });
        throw new DealEscrowError("CIRCLE_ERROR", `Escrow write could not be submitted: ${message}`, 502);
      }

      // Persist the Circle transaction id BEFORE any waiting so a crash or
      // timeout can NEVER lead to a second blockchain write for this key.
      await firestoreSetStatus(body.idempotencyKey, {
        status: "SUBMITTED",
        circleTransactionId,
      });
    }

    // ── 6. Poll for an on-chain txHash within this invocation's budget.
    const deadline = Date.now() + POLL_BUDGET_MS;
    let state = "";
    let txHash: string | null = existing?.transactionHash ?? null;
    while (Date.now() < deadline && !txHash) {
      const current = await getCircleTransaction(circleTransactionId);
      if (current) {
        state = current.state;
        txHash = current.txHash ?? txHash;
        if (current.txHash) break;
        if (["FAILED", "DENIED", "CANCELLED"].includes(state)) break;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // ── 7. Terminal handling.
    if (["FAILED", "DENIED", "CANCELLED"].includes(state)) {
      await firestoreSetStatus(body.idempotencyKey, { status: "FAILED" });
      return {
        httpStatus: 502,
        body: {
          ok: false,
          code: "TRANSACTION_FAILED",
          error: `The escrow write was rejected on-chain (${state}). No funds were moved.`,
        },
      };
    }

    if (txHash) {
      await firestoreSetStatus(body.idempotencyKey, {
        status: "COMPLETE",
        transactionHash: txHash,
      });
      return {
        httpStatus: 200,
        body: {
          ok: true,
          transaction: {
            id: circleTransactionId,
            transactionHash: txHash,
            status: "COMPLETE",
            action: body.action,
            from: actingWallet.address.toLowerCase(),
            contractAddress,
          },
        },
      };
    }

    // Submitted but not yet final on-chain — report progress; the client
    // re-posts the same idempotency key to continue status polling.
    return {
      httpStatus: 200,
      body: {
        ok: true,
        transaction: {
          id: circleTransactionId,
          transactionHash: null,
          status: "PENDING",
          action: body.action,
          from: actingWallet.address.toLowerCase(),
          contractAddress,
        },
      },
    };
  } catch (err: unknown) {
    if (err instanceof DealEscrowError) {
      return { httpStatus: err.httpStatus, body: { ok: false, error: err.message, code: err.code } };
    }
    const message = err instanceof Error ? err.message : String(err ?? "unknown error");
    console.error("[DealEscrow] Unexpected error:", message.slice(0, 300));
    return {
      httpStatus: 500,
      body: { ok: false, error: "Internal error while executing the escrow write.", code: "SERVER_ERROR" },
    };
  }
}

/**
 * Atomically claim the right to submit the Circle write for this key.
 *
 * - CREATED / SUBMITTING / FAILED (no tx id yet) → transitions to SUBMITTING
 *   and returns true. Re-claiming is safe: a re-invocation with the SAME
 *   Circle idempotency key returns the ORIGINAL transaction, never a second
 *   blockchain write.
 * - Already SUBMITTED / COMPLETE → returns false; nobody may submit again.
 */
async function submitClaim(params: { idempotencyKey: string }): Promise<boolean> {
  let maySubmit = false;
  await firestoreRunTransaction(async (tx, db) => {
    const ref = db.doc(`${IDEMPOTENCY_COLLECTION}/${params.idempotencyKey}`);
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

async function firestoreSetStatus(key: string, patch: Record<string, unknown>): Promise<void> {
  await firestoreSet(`${IDEMPOTENCY_COLLECTION}/${key}`, {
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}
