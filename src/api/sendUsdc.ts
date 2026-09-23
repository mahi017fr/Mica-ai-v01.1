// Client bridge for POST /api/wallet/send-usdc.
//
// SECURITY: only the Firebase ID token + recipientUid/amount/idempotencyKey
// leave the browser. Sender wallet resolution, Circle credentials and signing
// are entirely server-side — no passkey, no Privy signing, no wallet popup.

import { auth } from "../firebase";

export interface ServerSendTransaction {
  id: string;
  transactionHash: string;
  status: "COMPLETE" | "PENDING";
  amount: string;
  senderWallet: string;
  recipientWallet: string;
  network: string;
  asset: string;
}

export class SendUsdcApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

interface PostBody {
  recipientUid: string;
  amount: string;
  idempotencyKey: string;
  chatId?: string | null;
}

async function postSendUsdc(body: PostBody): Promise<ServerSendTransaction> {
  const user = auth.currentUser;
  if (!user) throw new SendUsdcApiError("You must be signed in to send USDC.", "UNAUTHORIZED");
  const idToken = await user.getIdToken();

  let res: Response;
  try {
    res = await fetch("/api/wallet/send-usdc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Network-level failure (offline, proxy drop). Treated as a transport
    // error so the polling loop can re-post the SAME idempotency key.
    throw new SendUsdcApiError("Could not reach the payment server.", "TRANSPORT_ERROR");
  }

  // Read as text first so a non-JSON body can be diagnosed safely.
  // Never logged here: the Authorization header / Firebase ID token.
  const rawText = await res.text().catch(() => null);

  let data: any = null;
  try {
    data = rawText === null ? undefined : JSON.parse(rawText);
  } catch {
    console.error("[SendUsdc] Non-JSON response from server", {
      httpStatus: res.status,
      contentType: res.headers.get("content-type"),
      bodyPrefix: rawText === null ? "<body unreadable>" : rawText.slice(0, 500),
    });
    throw new SendUsdcApiError("Server returned an invalid response.", "TRANSPORT_ERROR");
  }

  if (!res.ok || data?.ok !== true) {
    const code = data?.code || "SERVER_ERROR";
    const error = data?.error || `Transfer failed (${res.status}).`;
    // Safe diagnostic — no Authorization header, no token, no secrets.
    console.error("[SendUsdc] server rejected send", { httpStatus: res.status, code, error });
    throw new SendUsdcApiError(error, code);
  }
  return data.transaction as ServerSendTransaction;
}

const TERMINAL_POLL_MS = 120_000; // give the chain ~2 minutes total
const POLL_INTERVAL_MS = 3_000;

/**
 * Produce a valid RFC 4122 UUID v4 idempotency key.
 *
 * Circle's Developer-Controlled Wallet API REQUIRES the idempotency key to be
 * a UUID (it rejects anything else with "API parameter invalid"). `crypto.randomUUID()`
 * is preferred, but must not be assumed present — the fallback builds a
 * standards-compliant v4 UUID manually so the request is never rejected by
 * Circle on key format.
 */
function makeIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Submit a USDC transfer and poll until Circle reports a terminal state.
 *
 * The SAME idempotencyKey is reused for every poll round-trip, so the server
 * NEVER re-submits the blockchain write — it only continues status polling.
 */
export async function sendUsdcViaServer(params: {
  recipientUid: string;
  amount: string;
  chatId?: string | null;
  onStep?: (step: string) => void;
}): Promise<ServerSendTransaction> {
  const idempotencyKey = makeIdempotencyKey();

  const deadline = Date.now() + TERMINAL_POLL_MS;
  let firstRound = true;

  while (true) {
    params.onStep?.(
      firstRound ? "Submitting transfer…" : "Waiting for network confirmation…"
    );
    let tx: ServerSendTransaction;
    try {
      tx = await postSendUsdc({
        recipientUid: params.recipientUid,
        amount: params.amount,
        idempotencyKey,
        chatId: params.chatId ?? null,
      });
    } catch (err) {
      // Transient conditions keep the SAME idempotencyKey in play so the
      // server NEVER re-submits the blockchain write:
      //  - DUPLICATE_REQUEST: another invocation is mid-submission.
      //  - TRANSPORT_ERROR: non-JSON/platform error page or network drop —
      //    e.g. the function was killed after Circle accepted the transfer
      //    but before its JSON response reached us. Re-posting continues
      //    status polling from the persisted idempotency record.
      const retryable =
        err instanceof SendUsdcApiError &&
        (err.code === "DUPLICATE_REQUEST" || err.code === "TRANSPORT_ERROR");
      if (retryable && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      throw err;
    }
    firstRound = false;

    if (tx.status === "COMPLETE") return tx;

    if (Date.now() >= deadline) {
      // Submitted but not yet final — do NOT claim success.
      throw new SendUsdcApiError(
        "The transfer is still confirming. Check your wallet history shortly.",
        "TRANSACTION_PENDING"
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
