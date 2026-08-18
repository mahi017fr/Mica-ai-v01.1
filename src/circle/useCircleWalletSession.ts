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

function debug(...args: unknown[]): void {
  if ((import.meta as any).env?.DEV) {
    console.info(`[CircleWalletHook] [${new Date().toISOString()}]`, ...args);
  }
}

/**
 * Stub EIP-1193 provider for the server-managed Developer-Controlled Wallet.
 * The server (MPC) holds the signing keys — the browser cannot sign transactions
 * directly. This stub prevents callers from assuming browser-side signing works.
 */
function createServerWalletStub(address: string): CircleEip1193Provider {
  return {
    async request({ method }: { method: string; params?: unknown[] }) {
      throw new Error(
        `[MICA] Server wallet (${address}) is MPC-managed and cannot sign from the browser. ` +
          `Use the server-side Circle Developer-Controlled Wallet API for transactions. ` +
          `(method: ${method})`
      );
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
          provider: createServerWalletStub(addr),
        });

        return {
          address: addr,
          credentialId: "",
          linkedAt: result.wallet.ensuredAt,
          provider: createServerWalletStub(addr),
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
   * this returns the wallet address as `from` and a stub provider.
   */
  const getSigningContext = useCallback(async (): Promise<{
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
        provider: createServerWalletStub(metadata.circleWalletAddress),
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
    /** Mirrors `useArcWalletSession`: the EIP-1193 provider, or null. */
    provider: session.status === "linked" ? session.provider : null,
    from: session.status === "linked" ? session.from : null,
    isConfigured: true,
  };
}
