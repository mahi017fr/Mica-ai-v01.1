import { auth } from "../firebase";

export interface EnsureWalletResponse {
  ok: boolean;
  wallet?: {
    walletId: string;
    address: string;
    blockchain: string;
    state: string;
    ensuredAt: string;
  };
  error?: string;
}

/**
 * Ask the server to ensure a Circle Developer-Controlled Wallet exists for the
 * currently signed-in Firebase user. The server will:
 *   1. Verify the Firebase ID token.
 *   2. Check Firestore + Circle for an existing wallet (idempotent).
 *   3. Create one if needed and persist to Firestore.
 *
 * Returns the wallet address + metadata, or throws on auth / server errors.
 *
 * SECURITY: Only the Firebase ID token (from the client SDK) is sent.
 * No Circle API key or entity secret is ever exposed to the browser.
 */
export async function ensureServerWallet(): Promise<EnsureWalletResponse> {
  const user = auth.currentUser;
  if (!user) {
    return { ok: false, error: "No authenticated user." };
  }

  const idToken = await user.getIdToken();

  const res = await fetch("/api/wallet/ensure", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  const body: EnsureWalletResponse = await res.json().catch(() => ({
    ok: false,
    error: "Failed to parse server response.",
  }));

  if (!res.ok) {
    return {
      ok: false,
      error: body.error || `Server returned ${res.status}`,
    };
  }

  return body;
}
