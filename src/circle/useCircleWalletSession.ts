// React hook exposing the Circle Developer-Controlled Wallet lifecycle for the
// signed-in Firebase user.
//
// Lifecycle:
//   checking -> idle (no wallet) -> linking (server ensure) -> linked
//   checking -> linked (wallet already exists in profile)
//
// `ensure()` calls POST /api/wallet/ensure to create or restore the wallet
// server-side via Circle's Developer-Controlled Wallet API. No browser-side
// Passkey/WebAuthn prompt is ever triggered.
//
// `getSigningContext()` mirrors the existing `useArcWalletSession` seam so the
// Circle wallet can drive the same `{ provider, from }` transaction pipeline in
// later phases.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CircleEip1193Provider,
  CircleWalletMetadata,
  CircleWalletResult,
  CircleWalletSession,
} from "./types";
import { EMPTY_CIRCLE_WALLET_METADATA } from "./types";
import { ensureServerWallet } from "../api/wallet";
import { executeDealEscrow } from "../api/dealEscrow";
import { getSharedArcReadProvider } from "../payments/arcRpc";
import { ARC_NETWORK } from "../payments/arcNetwork";

function debug(...args: unknown[]): void {
  if ((import.meta as any).env?.DEV) {
    console.info(`[CircleWalletHook] [${new Date().toISOString()}]`, ...args);
  }
}

/** Deterministic idempotency key from the signing context + calldata. */
function escrowIdempotencyKey(from: string, to: string, data: string): string {
  let hash = 2166136261;
  const src = `${from.toLowerCase()}|${to.toLowerCase()}|${data}`;
  for (let i = 0; i < src.length; i++) {
    hash ^= src.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `dsc_${hash.toString(16).padStart(8, "0")}_${src.length}`;
}

const DEAL_WRITE_POLL_BUDGET_MS = 60_000;
const DEAL_WRITE_POLL_INTERVAL_MS = 2_500;

/**
 * Stub EIP-1193 provider for the server-managed Developer-Controlled Wallet.
 *
 * The server (Circle MPC) holds the signing keys — the browser CANNOT sign
 * transactions directly. This stub routes the few provider calls the Deal
 * escrow pipeline makes:
 *
 *   - `eth_sendTransaction`  → POST /api/deal/escrow (Circle MPC signing). The
 *     SAME deterministic idempotency key is reused across retries/polls so the
 *     server never double-submits a blockchain write.
 *   - `eth_chainId`          → static Arc chain id (read-only constant).
 *   - `eth_getCode`          → read-only Arc RPC (no wallet involved).
 *   - `eth_estimateGas`      → no-op; Circle handles fee/gas estimation.
 *   - anything else          → throws; browser-side signing is impossible.
 */
function createDealProviderStub(address: string): CircleEip1193Provider {
  const from = address.toLowerCase();
  return {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case "eth_sendTransaction": {
          const tx = (params?.[0] ?? {}) as Record<string, unknown>;
          const to = String(tx.to ?? "");
          const data = String(tx.data ?? "");
          if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
            throw new Error("Invalid contract address for server-signed escrow write.");
          }
          if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(data)) {
            throw new Error("Invalid calldata for server-signed escrow write.");
          }
          const idempotencyKey = escrowIdempotencyKey(from, to, data);
          const deadline = Date.now() + DEAL_WRITE_POLL_BUDGET_MS;
          let firstAttempt = true;
          while (Date.now() < deadline) {
            let txResult;
            try {
              txResult = await executeDealEscrow({
                action: "contract_exec",
                contractAddress: to,
                callData: data,
                idempotencyKey,
              });
            } catch (err: any) {
              const retryable =
                err?.code === "DUPLICATE_REQUEST" || err?.code === "TRANSPORT_ERROR";
              if (retryable && Date.now() < deadline) {
                firstAttempt = false;
                await new Promise((r) => setTimeout(r, DEAL_WRITE_POLL_INTERVAL_MS));
                continue;
              }
              throw err;
            }
            firstAttempt = false;
            if (txResult.transactionHash) {
              return txResult.transactionHash.toLowerCase();
            }
            // Submitted but no on-chain hash yet — continue status polling.
            await new Promise((r) => setTimeout(r, DEAL_WRITE_POLL_INTERVAL_MS));
          }
          throw new Error("Escrow write submitted, but still confirming on Arc. Try again shortly.");
        }
        case "eth_chainId":
          return ARC_NETWORK.chainIdHex;
        case "eth_getCode": {
          const addr = String((params?.[0] ?? "") as string);
          const provider = getSharedArcReadProvider();
          return await provider.getCode(addr);
        }
        case "eth_estimateGas":
          // Gas is handled server-side by Circle; a decoded call's gas limit
          // is not required to scope the write.
          return undefined;
        default:
          throw new Error(
            `[MICA] Server wallet (${address}) is MPC-managed and cannot sign from the browser. ` +
              `Use the server-side Circle Developer-Controlled Wallet API for transactions. ` +
              `(method: ${method})`
          );
      }
    },
  };
}

/**
 * Normalize a raw profile snapshot into the 4-field Circle metadata block,
 * treating any missing field as "not created yet".
 */
export function toCircleWalletMetadata(
  profile: any
): CircleWalletMetadata {
  if (!profile) return { ...EMPTY_CIRCLE_WALLET_METADATA };
  return {
    circleWalletAddress:
      profile.circleWalletAddress ?? EMPTY_CIRCLE_WALLET_METADATA.circleWalletAddress,
    circleWalletCredentialId:
      profile.circleWalletCredentialId ?? EMPTY_CIRCLE_WALLET_METADATA.circleWalletCredentialId,
    circleWalletStatus:
      profile.circleWalletStatus ?? EMPTY_CIRCLE_WALLET_METADATA.circleWalletStatus,
    circleWalletLinkedAt:
      profile.circleWalletLinkedAt ?? EMPTY_CIRCLE_WALLET_METADATA.circleWalletLinkedAt,
  };
}

interface UseCircleWalletSessionArgs {
  /** Firebase uid. When null, the wallet is not applicable. */
  uid: string | null;
  /** Raw user profile snapshot; normalized internally. */
  profile: any;
  /** Display username (unused for server wallet but kept for API compat). */
  username?: string | null;
}

export function useCircleWalletSession({
  uid,
  profile,
  username,
}: UseCircleWalletSessionArgs) {
  const metadata = useMemo(() => toCircleWalletMetadata(profile), [profile]);

  const [session, setSession] = useState<CircleWalletSession>({ status: "checking" });

  const sessionRef = useRef(session);
  sessionRef.current = session;

  const uidRef = useRef(uid);
  uidRef.current = uid;

  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;

  const usernameRef = useRef(username);
  usernameRef.current = username;

  const inFlight = useRef<Promise<CircleWalletResult | null> | null>(null);

  const ensure = useCallback(async (): Promise<CircleWalletResult | null> => {
    const currentUid = uidRef.current;
    if (!currentUid) {
      debug("ensure skipped: no uid");
      return null;
    }

    // Share ONE in-flight attempt instead of silently bailing: concurrent
    // callers (auto-ensure + button click + StrictMode double-effects) await
    // the SAME attempt, so two triggers can NEVER start two registrations.
    if (inFlight.current) {
      debug("ensure skipped: attempt already in flight (awaiting shared promise)");
      return inFlight.current;
    }

    const attempt = (async (): Promise<CircleWalletResult | null> => {
      setSession({
        status: "linking",
        uid: currentUid,
        metadata: { ...metadataRef.current, circleWalletStatus: "linking" },
      });

      try {
        debug("calling POST /api/wallet/ensure");
        const result = await ensureServerWallet();

        if (!result.ok || !result.wallet) {
          throw new Error(result.error || "Server wallet creation failed");
        }

        const addr = result.wallet.address;
        const linkedMetadata: CircleWalletMetadata = {
          circleWalletAddress: addr,
          circleWalletCredentialId: null,
          circleWalletStatus: "linked",
          circleWalletLinkedAt: result.wallet.ensuredAt,
        };

        debug("wallet ensured via server", { uid: currentUid, address: addr });

        // No client-side Firestore write needed — server already persisted
        // circleWalletId, circleWalletAddress, circleWalletStatus, and
        // circleWalletLinkedAt via the admin SDK.

        setSession({
          status: "linked",
          uid: currentUid,
          metadata: linkedMetadata,
          address: addr,
          credentialId: "",
          from: addr,
          provider: createDealProviderStub(addr),
        });

        return {
          address: addr,
          credentialId: "",
          linkedAt: result.wallet.ensuredAt,
          provider: createDealProviderStub(addr),
          from: addr,
          restored: Boolean(metadataRef.current.circleWalletAddress),
        };
      } catch (error: any) {
        console.error("[CircleWallet] ensure failed:", error?.message || error);
        setSession({
          status: "error",
          uid: currentUid,
          metadata: { ...metadataRef.current, circleWalletStatus: "error" },
          message: String(error?.message || error),
        });
        return null;
      }
    })();

    inFlight.current = attempt;
    try {
      return await attempt;
    } finally {
      if (inFlight.current === attempt) {
        inFlight.current = null;
      }
    }
  }, []);

  /**
   * Build a signing context for a transaction. For the server-managed wallet,
   * this returns the wallet address as `from` and a provider stub that routes
   * `eth_sendTransaction` to the server (Circle MPC signing).
   *
   * `expectedAddress` is accepted for API compatibility with the Privy seam but
   * ignored for signing: the acting user's Circle wallet is fixed to their uid
   * and resolved server-side. Callers that WANT a role check should compare the
   * returned `from` against the registered buyer/seller Circle address.
   */
  const getSigningContext = useCallback(async (expectedAddress?: string): Promise<{
    provider: CircleEip1193Provider;
    from: string;
  }> => {
    const s = sessionRef.current;
    if (s.status === "checking") {
      throw new Error("Wallet session is still loading. Please try again.");
    }
    if (s.status !== "linked") {
      throw new Error("Your MICA Wallet is not set up. Click 'Set up MICA Wallet' to continue.");
    }
    if (expectedAddress && s.from.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error("Connected wallet does not match the verified wallet for your deal role.");
    }
    return { provider: s.provider, from: s.from };
  }, []);

  // Auto-ensure once per authenticated uid. Runs as soon as the uid is known.
  // If the profile already has a wallet address (created server-side via
  // ensureServerWallet in ChatContext), mark as linked immediately.
  // Otherwise, call ensure() to create one via the server endpoint.
  useEffect(() => {
    if (!uid) {
      debug("auto-ensure: no uid yet — session checking");
      setSession({ status: "checking" });
      return;
    }

    // Profile already has a server wallet address — mark linked immediately.
    if (metadata.circleWalletAddress) {
      debug("auto-ensure: wallet address found in profile", {
        address: metadata.circleWalletAddress,
      });
      setSession({
        status: "linked",
        uid,
        metadata,
        address: metadata.circleWalletAddress,
        credentialId: "",
        from: metadata.circleWalletAddress,
        provider: createDealProviderStub(metadata.circleWalletAddress),
      });
      return;
    }

    const s = sessionRef.current;
    if (s.status === "linked" && s.uid === uid) {
      debug("auto-ensure: already linked for this uid — skipping");
      return;
    }

    // No wallet address in profile yet — ensure via server.
    debug("auto-ensure: no wallet address, calling server ensure");
    void ensure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, metadata.circleWalletAddress]);

  return {
    session,
    ensure,
    getSigningContext,
    metadata,
    /** Mirrors `useArcWalletSession.primaryAddress`: the Circle wallet address. */
    primaryAddress: session.status === "linked" ? (session.from ?? null) : null,
    /** Mirrors `useArcWalletSession`: the EIP-1193 provider, or null. */
    provider: session.status === "linked" ? session.provider : null,
    from: session.status === "linked" ? session.from : null,
    isConfigured: true,
  };
}
