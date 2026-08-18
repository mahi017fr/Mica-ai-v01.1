// MICA Circle Wallet Dashboard (Phase 2).
//
// Read-only view of the Circle Modular Wallet created/restored in Phase 1
// (`useCircleWalletSession`). It NEVER creates a wallet — on mount it simply
// observes the existing session for the authenticated Firebase uid and reads:
//   - wallet address + status (from the Phase 1 session metadata),
//   - the REAL Circle USDC balance for THAT address (Arc chain, 5042002) via
//     the existing `fetchArcUsdcBalance` infrastructure,
//   - the user's MICA payment records that involve this Circle wallet address,
//   - safe-only security/recovery status.
//
// SECURITY: Nothing sensitive is rendered. No private key, seed phrase,
// passkey, keyshare, or recovery secret is ever displayed — only public
// metadata (address, credential id) and the on-chain balance.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  ArrowLeft,
  Check,
  CircleDollarSign,
  Copy,
  CreditCard,
  ExternalLink,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wallet as WalletIcon,
} from "lucide-react";
import { db } from "../firebase";
import { useChat } from "../context/ChatContext";
import type { PaymentRecord } from "../payments";
import {
  ARC_NETWORK,
  getTxExplorerUrl,
} from "../payments/arcNetwork";
import { fetchArcUsdcBalance, type ArcBalanceStatus } from "../payments/arcUsdcBalance";

interface CircleWalletDashboardProps {
  onBack: () => void;
}

function shortAddress(address: string): string {
  if (!address) return "";
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatHistoryTimestamp(ts: any): string {
  if (!ts) return "";
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CircleWalletDashboard({ onBack }: CircleWalletDashboardProps) {
  const { circleWallet: session, ensureCircleWallet, currentUser, userProfile } = useChat();
  const uid = (currentUser as any)?.uid as string | null | undefined;

  // Phase 1 server-managed wallet (Developer-Controlled Wallet, MPC).
  const serverWalletAddress = userProfile?.circleWalletAddress ?? null;

  // Never create a wallet here — read the Phase 1 session only.
  const address =
    serverWalletAddress
      || (session.status === "linked"
        ? session.address
        : ((session as any).metadata?.circleWalletAddress as string | null | undefined) ?? null);
  const credentialId =
    session.status === "linked"
      ? session.credentialId
      : ((session as any).metadata?.circleWalletCredentialId as string | null | undefined) ?? null;
  const linkedAt =
    session.status === "linked"
      ? session.metadata.circleWalletLinkedAt
      : ((session as any).metadata?.circleWalletLinkedAt as string | null | undefined) ?? null;

  const [balanceStatus, setBalanceStatus] = useState<ArcBalanceStatus | null>(null);
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const balance = useMemo<ArcBalanceStatus | null>(() => balanceStatus, [balanceStatus]);

  // Load the REAL on-chain USDC balance for the exact Circle wallet address on
  // Arc Testnet. Re-runs on: address change, focus return, 15s poll, and the
  // manual refresh button.
  useEffect(() => {
    if (!address) {
      setBalanceStatus(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const result = await fetchArcUsdcBalance(address, ARC_NETWORK.chainId, 4);
      if (!cancelled) setBalanceStatus(result);
    };
    void run();
    const interval = setInterval(() => void run(), 15_000);
    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [address, refreshTick]);

  // Transaction history: the user's MICA payment records (created by the
  // existing `recordArcPayment` layer) that involve THIS Circle wallet address.
  // Read-only + best-effort; errors never surface in the UI.
  useEffect(() => {
    if (!uid || !address) {
      setPaymentRecords([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setHistoryLoading(true);
      try {
        const sentQ = query(collection(db, "payments"), where("senderId", "==", uid));
        const receivedQ = query(collection(db, "payments"), where("recipientId", "==", uid));
        const [sentSnap, receivedSnap] = await Promise.all([getDocs(sentQ), getDocs(receivedQ)]);
        const merged = new Map<string, PaymentRecord>();
        for (const snap of [sentSnap, receivedSnap]) {
          for (const d of snap.docs) {
            merged.set(d.id, { ...(d.data() as PaymentRecord), id: d.id });
          }
        }
        const needle = address.toLowerCase();
        const records = [...merged.values()]
          .filter(
            (r) =>
              String(r.senderWallet || "").toLowerCase() === needle ||
              String(r.recipientWallet || "").toLowerCase() === needle
          )
          .sort(
            (a, b) =>
              new Date(String(b.timestamp ?? 0)).getTime() -
              new Date(String(a.timestamp ?? 0)).getTime()
          )
          .slice(0, 12);
        if (!cancelled) setPaymentRecords(records);
      } catch (err) {
        console.warn("[CircleWallet] history read failed (best-effort):", err);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [uid, address, refreshTick]);

  const handleCopy = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.warn("[CircleWallet] copy failed:", err);
    }
  }, [address]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const statusLabel = useMemo(() => {
    if (serverWalletAddress) {
      return { label: "Server-managed", tone: "text-emerald-400", dot: "bg-emerald-500" };
    }
    switch (session.status) {
      case "checking":
        return { label: "Checking…", tone: "text-sky-300", dot: "bg-sky-400 animate-pulse" };
      case "unconfigured":
        return { label: "Not configured", tone: "text-amber-300", dot: "bg-amber-400" };
      case "idle":
        return { label: "No wallet yet", tone: "text-sky-300", dot: "bg-sky-400" };
      case "linking":
        return { label: "Linking…", tone: "text-sky-300", dot: "bg-sky-400 animate-pulse" };
      case "linked":
        return { label: "Linked", tone: "text-emerald-400", dot: "bg-emerald-500 animate-pulse" };
      case "error":
        return { label: "Error", tone: "text-red-400", dot: "bg-red-500" };
    }
  }, [serverWalletAddress, session.status]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0D111D]/70 overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:px-6 bg-[#12172A]/95 backdrop-blur-md border-b border-white/5 flex items-center justify-between z-10 shrink-0 select-none">
        <div className="flex items-center gap-3 w-full">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-[#12172A] border border-white/10 text-sky-200 hover:text-white transition-all hover:border-[#6C5CE0]/50 hover:bg-[#161A2B] cursor-pointer flex items-center justify-center mr-1"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-black text-white uppercase tracking-widest font-mono flex items-center gap-2">
              <WalletIcon className="w-4 h-4 text-[#6C5CE0] drop-shadow-[0_0_8px_rgba(108,92,224,0.12)]" />
              Circle Wallet
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-[10px] text-[#6C5CE0] font-mono uppercase tracking-wider">
                {ARC_NETWORK.name}
              </span>
              <span className="text-[10px] text-[#6C5CE0]">•</span>
              <span className="text-[10px] text-[#94A3B8] font-mono">chain {ARC_NETWORK.chainId}</span>
            </div>
          </div>
          <span
            className={`hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-md bg-[#0D111D]/70 border border-white/5 ${statusLabel.tone}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${statusLabel.dot}`} />
            {statusLabel.label}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            title="Refresh balance & history"
            className="p-2 rounded-xl bg-[#12172A] border border-white/10 text-sky-200 hover:text-white transition-all hover:border-[#6C5CE0]/50 hover:bg-[#161A2B] cursor-pointer flex items-center justify-center"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar space-y-5">
        {!address ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 bg-[#12172A]/60 border border-white/5 rounded-2xl"
          >
            <div className="flex items-center gap-3">
              <WalletIcon className="w-5 h-5 text-[#6C5CE0]" />
              <div>
                <p className="text-sm font-bold text-[#F8FAFC]">No Circle wallet linked yet</p>
                <p className="text-[11px] text-[#94A3B8] mt-1">
                  Set up your MICA Wallet to get started. Your wallet will be created
                  securely on the server &mdash; no passkey required.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void ensureCircleWallet()}
                disabled={session.status === "linking"}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#6C5CE0] hover:bg-[#7C6CF0] disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
              >
                {session.status === "linking" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <WalletIcon className="w-4 h-4" />
                )}
                {session.status === "linking" ? "Linking…" : "Set up MICA Wallet"}
              </button>
              {session.status === "error" && session.message && (
                <span className="text-[11px] text-red-400 font-mono break-all">
                  {session.message}
                </span>
              )}
            </div>
          </motion.div>
        ) : (
          <>
            {/* Balance + address */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* USDC Balance */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-5 bg-gradient-to-br from-[#161A2B] to-[#12172A] border border-white/5 rounded-2xl lg:col-span-1"
              >
                <div className="flex items-center gap-2 mb-3">
                  <CircleDollarSign className="w-4 h-4 text-[#6C5CE0]" />
                  <span className="text-[9px] uppercase font-mono tracking-widest text-sky-300/50 font-bold">
                    USDC Balance
                  </span>
                </div>
                {balance?.status === "success" ? (
                  <>
                    <span className="text-3xl font-black text-[#F8FAFC] font-mono block">
                      {Number(balance.formatted).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: balance.decimals,
                      })}
                    </span>
                    <span className="text-[11px] text-[#94A3B8] font-mono mt-1 block">
                      Circle USDC · {balance.decimals} decimals
                    </span>
                  </>
                ) : balance?.status === "checking" || !balance ? (
                  <div className="flex items-center gap-2 py-2 text-[#94A3B8]">
                    <Loader2 className="w-4 h-4 animate-spin text-[#6C5CE0]" />
                    <span className="text-[11px] font-mono">Checking balance…</span>
                  </div>
                ) : balance?.status === "no_wallet" ? (
                  <span className="text-sm text-[#94A3B8] font-mono block py-2">No wallet linked</span>
                ) : (
                  <div className="py-2">
                    <span className="text-sm text-amber-300/90 font-mono block">
                      Unable to fetch balance
                    </span>
                    <span className="text-[10px] text-[#64748B] mt-1 block break-words">
                      {"message" in balance ? balance.message : ""}
                    </span>
                  </div>
                )}
              </motion.div>

              {/* Wallet address + copy */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="p-5 bg-[#12172A]/60 border border-white/5 rounded-2xl lg:col-span-2"
              >
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard className="w-4 h-4 text-[#6C5CE0]" />
                  <span className="text-[9px] uppercase font-mono tracking-widest text-sky-300/50 font-bold">
                    Circle Wallet Address
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <code className="flex-1 text-[11px] sm:text-xs font-mono text-sky-100 select-all break-all bg-[#0D111D]/80 border border-white/5 rounded-lg px-3 py-2.5 leading-relaxed">
                    {address}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopy}
                    title="Copy wallet address"
                    className="shrink-0 p-2.5 rounded-lg bg-[#6C5CE0]/15 border border-[#6C5CE0]/30 text-sky-200 hover:text-white hover:bg-[#6C5CE0]/25 transition-all cursor-pointer flex items-center justify-center"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                  <a
                    href={`${ARC_NETWORK.blockExplorerUrl}/address/${address}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    title="View on ArcScan"
                    className="shrink-0 p-2.5 rounded-lg bg-[#0D111D]/80 border border-white/10 text-[#94A3B8] hover:text-white hover:border-[#6C5CE0]/50 transition-all cursor-pointer flex items-center justify-center"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </motion.div>
            </div>

            {/* Status / Security */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="p-5 bg-[#12172A]/60 border border-white/5 rounded-2xl"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <span className="text-[9px] uppercase font-mono tracking-widest text-sky-300/50 font-bold block">
                    Wallet Status
                  </span>
                  <span className={`text-xs font-mono font-bold mt-1.5 flex items-center gap-1.5 ${statusLabel.tone}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusLabel.dot}`} />
                    {statusLabel.label}
                  </span>
                  {session.status === "error" && (
                    <span className="text-[10px] text-[#64748B] mt-1 block break-words">
                      {(session as any).message}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-[9px] uppercase font-mono tracking-widest text-sky-300/50 font-bold block">
                    Linked
                  </span>
                  <span className="text-xs text-[#94A3B8] font-mono mt-1.5 block">
                    {formatDate(linkedAt)}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-mono tracking-widest text-sky-300/50 font-bold block">
                    Signing Method
                  </span>
                  <span className="text-xs text-[#94A3B8] font-mono mt-1.5 block break-all" title={credentialId || ""}>
                    <ShieldCheck className="w-3.5 h-3.5 inline mr-1 text-emerald-400" />
                    Server MPC
                  </span>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-mono tracking-widest text-sky-300/50 font-bold block">
                    Security
                  </span>
                  <span className="text-xs text-emerald-400/90 font-mono mt-1.5 block">
                    <ShieldCheck className="w-3.5 h-3.5 inline mr-1" />
                    MPC-secured (server)
                  </span>
                  <span className="text-[10px] text-[#64748B] mt-1 block">
                    Private keys held by Circle MPC — never exposed
                  </span>
                </div>
              </div>
            </motion.div>

            {/* Portfolio */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="p-5 bg-[#12172A]/60 border border-white/5 rounded-2xl"
            >
              <div className="flex items-center gap-2 mb-3">
                <WalletIcon className="w-4 h-4 text-[#6C5CE0]" />
                <span className="text-[9px] uppercase font-mono tracking-widest text-sky-300/50 font-bold">
                  Portfolio
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 bg-[#0D111D]/60 border border-white/5 rounded-xl">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#6C5CE0]/15 border border-[#6C5CE0]/30 flex items-center justify-center shrink-0">
                      <CircleDollarSign className="w-4 h-4 text-[#6C5CE0]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#F8FAFC]">Circle USDC</p>
                      <p className="text-[10px] text-[#64748B] font-mono break-all">
                        {ARC_NETWORK.usdc.address}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black text-[#F8FAFC] font-mono">
                      {balance?.status === "success"
                        ? Number(balance.formatted).toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: balance.decimals,
                          })
                        : "—"}
                    </p>
                    <p className="text-[10px] text-[#94A3B8] font-mono">USDC</p>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-[#64748B] mt-2.5">
                USDC is Arc&apos;s native token; balances are read on-chain from the USDC ERC-20
                contract for this exact wallet address.
              </p>
            </motion.div>

            {/* Transaction History */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="p-5 bg-[#12172A]/60 border border-white/5 rounded-2xl"
            >
              <div className="flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[#6C5CE0]" />
                <span className="text-[9px] uppercase font-mono tracking-widest text-sky-300/50 font-bold">
                  Transaction History
                </span>
              </div>
              {historyLoading && paymentRecords.length === 0 ? (
                <div className="flex items-center gap-2 py-6 text-[#94A3B8]">
                  <Loader2 className="w-4 h-4 animate-spin text-[#6C5CE0]" />
                  <span className="text-[11px] font-mono">Loading history…</span>
                </div>
              ) : paymentRecords.length === 0 ? (
                <p className="text-[11px] text-[#94A3B8] py-4">
                  No transactions for this wallet yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {paymentRecords.map((record) => {
                    const outgoing =
                      String(record.senderWallet || "").toLowerCase() === address.toLowerCase();
                    const txUrl = getTxExplorerUrl(record.transactionHash);
                    return (
                      <div
                        key={record.id}
                        className="flex items-center justify-between gap-3 p-3 bg-[#0D111D]/60 border border-white/5 rounded-xl"
                      >
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-[#F8FAFC]">
                            {outgoing ? "Sent" : "Received"} USDC
                          </p>
                          <p className="text-[10px] text-[#64748B] truncate">
                            {outgoing
                              ? `to ${record.recipientUsername}`
                              : `from ${record.senderUsername}`}
                            {" · "}
                            {formatHistoryTimestamp(record.timestamp)}
                          </p>
                          {txUrl ? (
                            <a
                              href={txUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-[10px] font-mono text-[#6C5CE0] hover:text-sky-300 inline-flex items-center gap-1 transition-all"
                            >
                              {record.transactionHash.substring(0, 10)}…
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <p className="text-[10px] font-mono text-[#64748B] truncate">
                              {record.transactionHash}
                            </p>
                          )}
                        </div>
                        <span
                          className={`text-sm font-black font-mono shrink-0 ${
                            outgoing ? "text-sky-300" : "text-emerald-400"
                          }`}
                        >
                          {outgoing ? "−" : "+"}
                          {Number(record.amount).toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 6,
                          })}{" "}
                          USDC
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
