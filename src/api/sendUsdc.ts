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

  const res = await fetch("/api/wallet/send-usdc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    throw new SendUsdcApiError("Server returned an invalid response.", "SERVER_ERROR");
  }

  if (!res.ok || data?.ok !== true) {
    throw new SendUsdcApiError(
      data?.error || `Transfer failed (${res.status}).`,
      data?.code || "SERVER_ERROR"
    );
  }
  return data.transaction as ServerSendTransaction;
}

const TERMINAL_POLL_MS = 120_000; // give the chain ~2 minutes total
const POLL_INTERVAL_MS = 3_000;

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
  const idempotencyKey =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

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
      // The exact same request may briefly collide with itself while the
      // server is still submitting; retry with the SAME key (never resubmits).
      if (
        err instanceof SendUsdcApiError &&
        err.code === "DUPLICATE_REQUEST" &&
        Date.now() < deadline
      ) {
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
