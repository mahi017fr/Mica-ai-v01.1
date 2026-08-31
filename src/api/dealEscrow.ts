// Client bridge for POST /api/deal/escrow.
//
// SECURITY: only the Firebase ID token + the target contract address + raw
// calldata + idempotency key leave the browser. The signing wallet is resolved
// server-side from the authenticated uid and signed by Circle's MPC
// infrastructure — no Privy / passkey / browser wallet signing is involved.

import { auth } from "../firebase";

export interface ServerDealEscrowTransaction {
  id: string;
  transactionHash: string | null;
  status: "COMPLETE" | "PENDING";
  action: string;
  from: string;
  contractAddress: string;
}

export class DealEscrowApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Execute ONE escrow contract write via the server (Circle MPC signing).
 *
 * The SAME `idempotencyKey` is reused on retry so the server NEVER re-submits
 * the blockchain write — it only continues status polling.
 */
export async function executeDealEscrow(params: {
  action: string;
  contractAddress: string;
  callData: string;
  idempotencyKey: string;
}): Promise<ServerDealEscrowTransaction> {
  const user = auth.currentUser;
  if (!user) throw new DealEscrowApiError("You must be signed in to execute this escrow action.", "UNAUTHORIZED");
  const idToken = await user.getIdToken();

  let res: Response;
  try {
    res = await fetch("/api/deal/escrow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        action: params.action,
        contractAddress: params.contractAddress,
        callData: params.callData,
        idempotencyKey: params.idempotencyKey,
      }),
    });
  } catch {
    throw new DealEscrowApiError("Could not reach the escrow server.", "TRANSPORT_ERROR");
  }

  const rawText = await res.text().catch(() => null);
  let data: any = null;
  try {
    data = rawText === null ? undefined : JSON.parse(rawText);
  } catch {
    throw new DealEscrowApiError("Server returned an invalid response.", "TRANSPORT_ERROR");
  }

  if (!res.ok || data?.ok !== true) {
    throw new DealEscrowApiError(
      data?.error || `Escrow write failed (${res.status}).`,
      data?.code || "SERVER_ERROR"
    );
  }
  return data.transaction as ServerDealEscrowTransaction;
}
