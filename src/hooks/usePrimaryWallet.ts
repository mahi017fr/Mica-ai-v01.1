import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useModalStatus } from "@privy-io/react-auth";

/**
 * A wallet address that has been verified by Privy (via the user's
 * `linkedAccounts` / `user.wallet`). NEVER constructed from manual input.
 */
export interface VerifiedWallet {
  address: string;
  provider: string;
  connectorType?: string;
  linkedAt: string | null;
}

interface PrivyWalletAccount {
  type: string;
  address: string;
  walletClientType?: string;
  connectorType?: string;
  firstVerifiedAt?: Date | string | null;
  latestVerifiedAt?: Date | string | null;
}

function getWalletAccounts(user: any): PrivyWalletAccount[] {
  return (user?.linkedAccounts || []).filter((a: any) => a?.type === "wallet");
}

function toVerifiedWallet(acc: PrivyWalletAccount): VerifiedWallet {
  const linkedAt = acc.latestVerifiedAt || acc.firstVerifiedAt || null;
  return {
    address: acc.address.toLowerCase(),
    provider: acc.walletClientType || acc.connectorType || "wallet",
    connectorType: acc.connectorType,
    linkedAt: linkedAt ? new Date(linkedAt).toISOString() : null,
  };
}

function walletAddresses(user: any): string[] {
  return getWalletAccounts(user).map((a) => a.address.toLowerCase());
}

interface PendingToken {
  resolve: (w: VerifiedWallet | null) => void;
  snapshot: Set<string>;
}

/**
 * Source of truth for the user's primary wallet.
 *
 * The primary wallet is always read from Privy's verified user object
 * (`user.wallet` / `user.linkedAccounts`) — it can never be typed in by the
 * user. Ownership is established by Privy when the wallet is linked (which
 * requires signing a challenge from that wallet).
 */
export function usePrimaryWallet() {
  const { user, ready, authenticated, login, linkWallet } = usePrivy();
  const { isOpen } = useModalStatus();

  const privyUserId = user?.id ?? null;

  // The first verified wallet is the canonical primary wallet. Prefer
  // `user.wallet` (Privy's "first verified wallet"), then fall back to the
  // first wallet-type linked account.
  const primaryWallet = useMemo<VerifiedWallet | null>(() => {
    if (!user) return null;
    if (user.wallet?.address) {
      return {
        address: user.wallet.address.toLowerCase(),
        provider: user.wallet.walletClientType || user.wallet.connectorType || "wallet",
        connectorType: user.wallet.connectorType,
        linkedAt: null,
      };
    }
    const first = getWalletAccounts(user)[0];
    return first ? toVerifiedWallet(first) : null;
  }, [user]);

  const [connecting, setConnecting] = useState(false);
  const pendingRef = useRef<PendingToken[]>([]);
  const prevIsOpenRef = useRef(false);

  // Resolve pending connect requests once a brand-new wallet (one that was NOT
  // present when `connectWallet` was called) appears in `linkedAccounts`.
  // Compared against the connect-time snapshot so the first render after
  // linking can't accidentally swallow the new wallet.
  useEffect(() => {
    if (pendingRef.current.length === 0) return;
    const addrs = walletAddresses(user);

    const freshAccounts = getWalletAccounts(user)
      .filter((a) => {
        const lower = a.address.toLowerCase();
        return pendingRef.current.every((t) => !t.snapshot.has(lower));
      })
      .sort((a, b) => {
        const ta = new Date(a.latestVerifiedAt || a.firstVerifiedAt || 0).getTime();
        const tb = new Date(b.latestVerifiedAt || b.firstVerifiedAt || 0).getTime();
        return tb - ta;
      });

    if (freshAccounts.length === 0) return;

    const resolved = toVerifiedWallet(freshAccounts[0]);
    const tokens = pendingRef.current;
    pendingRef.current = [];
    setConnecting(false);
    tokens.forEach((t) => t.resolve(resolved));
  }, [user]);

  // If the Privy modal closes without a new wallet being linked, cancel any
  // pending connect request so the UI doesn't hang forever.
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;
    if (wasOpen && !isOpen && pendingRef.current.length > 0) {
      const tokens = pendingRef.current;
      pendingRef.current = [];
      setConnecting(false);
      tokens.forEach((t) => t.resolve(null));
    }
  }, [isOpen, user]);

  /**
   * Opens the Privy modal to obtain a verified wallet:
   * - No Privy session yet  -> `login()` (embedded wallet is auto-created on
   *   login; an external wallet may also be chosen).
   * - Authenticated         -> `linkWallet()` so the user can connect a new
   *   external wallet.
   *
   * Resolves with the newly linked `VerifiedWallet`, or `null` if the user
   * cancels / closes the modal without linking a wallet.
   */
  const connectWallet = useCallback(async (): Promise<VerifiedWallet | null> => {
    if (!ready) return null;
    if (pendingRef.current.length > 0) return null;

    setConnecting(true);
    const snapshot = new Set(walletAddresses(user));
    if (!authenticated) {
      login();
    } else {
      linkWallet();
    }

    return new Promise<VerifiedWallet | null>((resolve) => {
      const token: PendingToken = { resolve, snapshot };
      pendingRef.current.push(token);

      // Safety timeout so a never-resolving modal can't wedge the UI.
      window.setTimeout(() => {
        const idx = pendingRef.current.indexOf(token);
        if (idx >= 0) {
          pendingRef.current.splice(idx, 1);
          setConnecting(false);
          resolve(null);
        }
      }, 5 * 60 * 1000);
    });
  }, [ready, authenticated, login, linkWallet, user]);

  return {
    primaryWallet,
    privyUserId,
    connecting,
    connectWallet,
  };
}
