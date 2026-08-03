import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  usePrivy,
  useWallets,
  useActiveWallet,
  type ConnectedWallet,
  type EIP1193Provider,
} from "@privy-io/react-auth";
import { ARC_NETWORK, ensureWalletArcChain } from "../payments/arcNetwork";

/**
 * WALLET SESSION REHYDRATION
 * --------------------------
 * A wallet address stored in Privy / Firestore is ONLY an address. It is never
 * proof that a wallet is CURRENTLY connected and capable of signing.
 *
 * Every time the user logs in, returns to the app, or opens the send flow this
 * hook re-establishes the REAL wallet session:
 *   1. finds the live connected wallet(s) from Privy (`useWallets`),
 *   2. promotes the connected wallet matching the verified primary wallet,
 *   3. obtains a FRESH EIP-1193 provider from that wallet,
 *   4. verifies the provider actually exposes the primary account
 *      (`eth_requestAccounts` / `eth_accounts`),
 *   5. verifies the connected address matches the saved primary wallet,
 *   6. ensures the wallet is on Arc Network before any transaction.
 *
 * It never relies on stale React state or a stored address alone.
 */

// Development-only console logging for the wallet session lifecycle. Never
// logs private keys, seed phrases, auth tokens, or other secrets.
function debug(...args: unknown[]): void {
  if ((import.meta as any).env?.DEV) {
    console.info(`[ArcWallet] [${new Date().toISOString()}]`, ...args);
  }
}

export type ArcWalletSession =
  | { status: "checking" }
  | { status: "no_primary"; primaryAddress: string | null }
  | { status: "disconnected"; primaryAddress: string }
  | { status: "mismatch"; primaryAddress: string; connectedAddress: string }
  | {
      status: "connected";
      primaryAddress: string;
      connectedAddress: string;
      provider: EIP1193Provider;
      wallet: ConnectedWallet;
      chainId: number | null;
    };

// The verified primary wallet address, always read from Privy's verified user
// object (never from manual input or a stored string).
function getPrimaryAddress(user: any): string | null {
  if (!user) return null;
  if (user.wallet?.address) return user.wallet.address.toLowerCase();
  const first = (user.linkedAccounts || []).find((a: any) => a?.type === "wallet");
  return first?.address?.toLowerCase() ?? null;
}

function isEmbeddedWallet(w: ConnectedWallet): boolean {
  const client = w.walletClientType || "";
  return client === "privy" || client === "privy-v2";
}

/**
 * Classify the live connected wallets against the saved primary wallet:
 * - `connected`    -> a connected wallet matches the primary (signing capable).
 * - `mismatch`     -> at least one NON-embedded wallet is connected, but none
 *                     matches the primary (a different external account/wallet).
 * - `disconnected` -> no non-embedded wallet is connected (e.g. the external
 *                     wallet has not been reconnected this session; the
 *                     auto-created embedded wallet alone does not count).
 */
function classifyWallet(
  primaryAddress: string,
  wallets: ConnectedWallet[]
): "connected" | "mismatch" | "disconnected" {
  const eth = wallets.filter((w) => w.type === "ethereum");
  if (eth.some((w) => w.address.toLowerCase() === primaryAddress)) return "connected";
  if (eth.some((w) => !isEmbeddedWallet(w))) return "mismatch";
  return "disconnected";
}

export function useArcWalletSession() {
  const { user, ready, authenticated } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const {
    wallet: activeWallet,
    setActiveWallet,
    connect: openWalletConnectModal,
  } = useActiveWallet();

  const [session, setSession] = useState<ArcWalletSession>({ status: "checking" });
  const [reconnecting, setReconnecting] = useState(false);

  const sessionRef = useRef<ArcWalletSession>({ status: "checking" });
  sessionRef.current = session;

  const primaryAddress = useMemo(() => getPrimaryAddress(user), [user]);
  const primaryAddressRef = useRef(primaryAddress);
  primaryAddressRef.current = primaryAddress;

  const resolveWallet = useCallback((requiredAddress?: string | null): ConnectedWallet | null => {
    const eth = wallets.filter((w) => w.type === "ethereum");
    if (eth.length === 0) return null;
    const required = requiredAddress?.toLowerCase();
    if (required) return eth.find((w) => w.address.toLowerCase() === required) ?? null;
    // Prefer the active ethereum wallet.
    const active =
      activeWallet && activeWallet.type === "ethereum" ? (activeWallet as ConnectedWallet) : null;
    // Then prefer a connected wallet matching the primary address.
    if (primaryAddressRef.current) {
      const match = eth.find((w) => w.address.toLowerCase() === primaryAddressRef.current);
      if (match) return match;
    }
    return active || eth[0];
  }, [activeWallet, wallets]);

  const refresh = useCallback(async () => {
    if (!authenticated || !ready) {
      setSession({ status: "checking" });
      return;
    }

    const primary = primaryAddressRef.current;
    debug("refreshing wallet session", {
      authenticated,
      primaryAddress: primary,
      wallets: wallets.map((w) => ({
        address: w.address,
        type: w.type,
        walletClientType: w.walletClientType,
        connectorType: w.connectorType,
      })),
      activeWallet: activeWallet ? { address: activeWallet.address, type: activeWallet.type } : null,
    });

    if (!primary) {
      debug("no primary wallet found on Privy user");
      setSession({ status: "no_primary", primaryAddress: null });
      return;
    }

    // Promote the wallet that matches the primary to the ACTIVE wallet so the
    // transaction is signed by the correct account.
    if (walletsReady && activeWallet?.type !== "ethereum") {
      const match = wallets.find(
        (w) => w.type === "ethereum" && w.address.toLowerCase() === primary
      );
      if (match) {
        debug("promoting matching wallet to active", match.address);
        setActiveWallet(match);
      }
    }

    const kind = classifyWallet(primary, wallets);
    if (kind !== "connected") {
      if (kind === "mismatch") {
        const connected = wallets.find((w) => w.type === "ethereum" && !isEmbeddedWallet(w));
        debug("address mismatch", {
          primaryAddress: primary,
          connectedAddress: connected?.address ?? "unknown",
        });
        setSession({
          status: "mismatch",
          primaryAddress: primary,
          connectedAddress: connected?.address?.toLowerCase() ?? "unknown",
        });
      } else {
        debug("no connected wallet for primary", { primaryAddress: primary });
        setSession({ status: "disconnected", primaryAddress: primary });
      }
      return;
    }

    const wallet = resolveWallet();
    if (!wallet) {
      setSession({ status: "disconnected", primaryAddress: primary });
      return;
    }

    const connectedAddress = wallet.address.toLowerCase();

    // Obtain the REAL provider for this session.
    let provider: EIP1193Provider;
    try {
      provider = await wallet.getEthereumProvider();
    } catch (err) {
      console.error("[ArcWallet] getEthereumProvider failed:", err);
      setSession({ status: "disconnected", primaryAddress: primary });
      return;
    }

    // Verify the provider actually exposes an account and that it matches the
    // primary wallet. `eth_accounts` is non-prompting; `getSigningContext`
    // re-establishes access with `eth_requestAccounts` right before sending.
    let providerAccount: string | null = null;
    let chainId: number | null = null;
    try {
      const accounts = await provider.request({ method: "eth_accounts", params: [] });
      const list = Array.isArray(accounts) ? accounts : [];
      providerAccount = list[0]?.toLowerCase?.() ?? null;
      const hex = await provider.request({ method: "eth_chainId", params: [] });
      chainId = typeof hex === "string" ? parseInt(hex, 16) : Number(hex);
    } catch (err) {
      console.error("[ArcWallet] reading provider account/chain failed:", err);
      setSession({ status: "disconnected", primaryAddress: primary });
      return;
    }

    if (!providerAccount) {
      debug("provider reported no account — wallet needs reconnect", { connectedAddress });
      setSession({ status: "disconnected", primaryAddress: primary });
      return;
    }
    if (providerAccount !== primary) {
      debug("provider account differs from primary", { providerAccount, primaryAddress: primary });
      setSession({ status: "mismatch", primaryAddress: primary, connectedAddress: providerAccount });
      return;
    }

    debug("wallet session connected", {
      connectedAddress,
      chainId,
      walletClientType: wallet.walletClientType,
    });
    setSession({
      status: "connected",
      primaryAddress: primary,
      connectedAddress,
      provider,
      wallet,
      chainId: Number.isFinite(chainId) ? chainId : null,
    });
  }, [authenticated, ready, activeWallet, resolveWallet, wallets, walletsReady, setActiveWallet]);

  // Re-run rehydration whenever the underlying wallet sources change
  // (login, wallet connect/disconnect, account switch, page rehydrate).
  useEffect(() => {
    if (!authenticated || !ready) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, authenticated, ready, wallets, walletsReady, activeWallet]);

  /**
   * "Reconnect Wallet" action. Opens the wallet-connect flow so the user can
   * re-establish their external wallet in this session.
   */
  const reconnect = useCallback(async () => {
    if (reconnecting) return;
    setReconnecting(true);
    debug("opening wallet connect modal for reconnect");
    try {
      await openWalletConnectModal();
    } catch (err) {
      console.error("[ArcWallet] wallet reconnect flow failed:", err);
    } finally {
      setReconnecting(false);
      await refresh();
    }
  }, [reconnecting, openWalletConnectModal, refresh]);

  /**
   * Ensure the wallet is connected to Arc Network, requesting a switch / add
   * of the network if needed. No-op (returns true) when already on Arc.
   */
  const ensureArcChain = useCallback(async (): Promise<boolean> => {
    const s = sessionRef.current;
    if (s.status !== "connected") return false;
    if (s.chainId === ARC_NETWORK.chainId) return true;
    debug("requesting wallet switch to Arc", { currentChainId: s.chainId });
    return ensureWalletArcChain(s.provider);
  }, []);

  /**
   * Build a FRESH signing context right before a transaction:
   *   active wallet -> fresh provider -> eth_requestAccounts (re-establish
   *   access, may show the wallet popup) -> verify address matches primary ->
   *   ensure Arc chain.
   *
   * Throws user-facing errors for the disconnected / mismatch / wrong-network
   * cases. This is the ONLY path that produces a signing provider for a
   * transaction.
   */
  const getSigningContext = useCallback(async (expectedAddress?: string): Promise<{ provider: EIP1193Provider; from: string }> => {
    const primary = primaryAddressRef.current;
    const expected = expectedAddress?.toLowerCase() || primary;
    debug("building signing context", { authenticated, ready, primaryAddress: primary });

    if (!authenticated || !ready) {
      throw new Error("You must be signed in to send USDC.");
    }
    if (!expected) {
      throw new Error("Link a verified primary wallet to send USDC.");
    }

    // 1) Live wallet (never a cached/stale one).
    const wallet = resolveWallet(expected);
    if (!wallet) {
      throw new Error("Connect the verified wallet for your deal role to continue.");
    }
    if (wallet.address.toLowerCase() !== expected) {
      throw new Error("Connected wallet does not match the verified wallet for your deal role.");
    }

    // 2) Fresh provider for THIS send.
    let provider: EIP1193Provider;
    try {
      provider = await wallet.getEthereumProvider();
    } catch (err) {
      console.error("[ArcWallet] getEthereumProvider failed at send time:", err);
      throw new Error("Reconnect your wallet to continue.");
    }

    // 3) Re-establish account access (MetaMask/Rabby shows its popup here only
    //    when a connection is actually required).
    let accounts: unknown;
    try {
      await provider.request({ method: "eth_requestAccounts", params: [] });
      accounts = await provider.request({ method: "eth_accounts", params: [] });
    } catch (err: any) {
      console.error("[ArcWallet] eth_requestAccounts failed at send time:", err?.message || err);
      throw new Error("Reconnect your wallet to continue.");
    }
    const account = Array.isArray(accounts) ? accounts[0] : null;
    if (!account) {
      throw new Error("Reconnect your wallet to continue.");
    }
    if (String(account).toLowerCase() !== expected) {
      throw new Error("Connected wallet does not match the verified wallet for your deal role.");
    }

    // 4) Never send on a non-Arc chain.
    let chainId: number | null = null;
    try {
      const hex = await provider.request({ method: "eth_chainId", params: [] });
      chainId = typeof hex === "string" ? parseInt(hex, 16) : Number(hex);
    } catch (err: any) {
      console.error("[ArcWallet] eth_chainId failed at send time:", err?.message || err);
      throw new Error("Reconnect your wallet to continue.");
    }
    if (chainId !== ARC_NETWORK.chainId) {
      debug("wallet not on Arc before send", { chainId });
      const switched = await ensureWalletArcChain(provider);
      if (!switched) {
        throw new Error(
          `Please switch to Arc Network (chain ${ARC_NETWORK.chainId}) in your wallet to send USDC.`
        );
      }
      const switchedHex = await provider.request({ method: "eth_chainId", params: [] });
      const switchedChainId = typeof switchedHex === "string" ? parseInt(switchedHex, 16) : Number(switchedHex);
      if (switchedChainId !== ARC_NETWORK.chainId) {
        throw new Error(`Wallet must be on Arc Testnet (chain ${ARC_NETWORK.chainId}).`);
      }
    }

    debug("signing context ready", { from: expected, chainId: ARC_NETWORK.chainId });
    return { provider, from: expected };
  }, [authenticated, ready, resolveWallet]);

  return {
    session,
    primaryAddress,
    // Exposed so consumers (e.g. the Send USDC debug trace) can log the exact
    // Privy lifecycle: `ready` is true once Privy has finished restoring the
    // session, `authenticated` once the restored user is signed in.
    ready,
    authenticated,
    refresh,
    reconnect,
    reconnecting,
    ensureArcChain,
    getSigningContext,
  };
}
