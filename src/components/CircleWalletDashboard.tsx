// MICA Wallet — premium Web3 dashboard redesign (UI layer only).
//
// FUNCTIONAL BASELINE (unchanged): this page observes the existing Phase 1
// server-managed Circle Developer-Controlled Wallet session, reads the REAL
// Arc USDC balance via `fetchArcUsdcBalance`, reads the user's REAL payment
// history from Firestore, and links the EXISTING SendUsdcModal flow.
//
// UI-ONLY additions (explicitly non-functional, clearly labelled):
//   Deposit / Receive / Swap / Bridge / Buy / More placeholders, the Circle
//   Ecosystem "Coming Soon" cards, the decorative portfolio trend area, and
//   the network card. None of these issue API calls.
//
// SECURITY: Nothing sensitive is rendered. No private key, seed phrase,
// passkey, keyshare, or recovery secret is ever displayed — only public
// metadata (address, credential id) and the on-chain balance.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  ArrowDownLeft,
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  CreditCard,
  ExternalLink,
  Info,
  Layers,
  Loader2,
  MoreHorizontal,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  Wallet as WalletIcon,
  X,
  Zap,
} from "lucide-react";
import { db } from "../firebase";
import { useChat } from "../context/ChatContext";
import type { UserProfile } from "../types";
import type { PaymentRecord } from "../payments";
import {
  ARC_NETWORK,
  getTxExplorerUrl,
} from "../payments/arcNetwork";
import { fetchArcUsdcBalance, type ArcBalanceStatus } from "../payments/arcUsdcBalance";
import SendUsdcModal from "./SendUsdcModal";

interface CircleWalletDashboardProps {
  onBack: () => void;
}

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

function shortAddress(address?: string | null): string {
  if (!address) return "";
  const a = address;
  return a.length <= 14 ? a : `${a.slice(0, 8)}…${a.slice(-6)}`;
}

function shortHash(hash?: string | null): string {
  if (!hash) return "";
  return hash.length <= 12 ? hash : `${hash.slice(0, 10)}…${hash.slice(-6)}`;
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

function formatActivityDate(ts: any): string {
  if (!ts) return "";
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtUsdc(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/* ------------------------------------------------------------------ */
/* Design system primitives                                            */
/* ------------------------------------------------------------------ */

/** Consistent premium surface: deep navy, whisper-thin border, soft depth. */
const Card: React.FC<{
  className?: string;
  children: React.ReactNode;
  delay?: number;
}> = ({ className = "", children, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
    className={`relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0A0714]/80 backdrop-blur-xl shadow-[0_16px_50px_-22px_rgba(0,0,0,0.8)] ${className}`}
  >
    {children}
  </motion.div>
);

const SectionLabel: React.FC<{ icon: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }> = ({
  icon,
  children,
  right,
}) => (
  <div className="flex items-center justify-between mb-4">
    <div className="flex items-center gap-2">
      <span className="text-[#7C6CF0]">{icon}</span>
      <span className="text-[10px] uppercase font-mono tracking-[0.18em] text-[#8A96B8] font-bold">
        {children}
      </span>
    </div>
    {right}
  </div>
);

const ShimmerBlock: React.FC<{ className?: string }> = ({ className = "" }) => (
  <div className={`mica-shimmer rounded-lg bg-white/[0.04] ${className}`} />
);

const NetworkBadge: React.FC<{ compact?: boolean }> = ({ compact }) => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#6C5CE0]/15 border border-[#6C5CE0]/30 text-[#A78BFA] text-[9px] font-mono font-bold uppercase tracking-wider">
    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
    {compact ? "Arc" : ARC_NETWORK.name}
  </span>
);

const StatusBadge: React.FC<{ label: string; tone: string; dot: string }> = ({ label, tone, dot }) => (
  <span
    className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/[0.03] border border-white/[0.06] ${tone}`}
  >
    <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
    {label}
  </span>
);

const ComingSoonBadge: React.FC = () => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/25 text-amber-300 text-[8.5px] font-black uppercase tracking-[0.14em]">
    <Clock3 className="w-2.5 h-2.5" />
    Coming Soon
  </span>
);

/* ------------------------------------------------------------------ */
/* Decorative portfolio trend (UI-only, NOT real market data)          */
/* ------------------------------------------------------------------ */

const PortfolioTrend: React.FC<{ live: boolean }> = ({ live }) => {
  // Deterministic decorative curve — deliberately smooth & neutral. This is
  // NOT price history (none exists); historical tracking is a future feature.
  const points = useMemo(() => {
    const w = 100;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 24; i++) {
      const x = (i / 24) * w;
      const y =
        30 +
        Math.sin(i * 0.55) * 4 +
        Math.sin(i * 0.21 + 1.2) * 3 +
        Math.cos(i * 0.83) * 1.6;
      pts.push([x, y]);
    }
    return pts;
  }, []);

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L100,44 L0,44 Z`;

  return (
    <div className="relative select-none pointer-events-none" aria-hidden>
      <svg viewBox="0 0 100 44" preserveAspectRatio="none" className="w-full h-14 sm:h-16">
        <defs>
          <linearGradient id="mica-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6C5CE0" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#6C5CE0" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="mica-trend-line" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stopColor="#8B5CF6" />
<stop offset="55%" stopColor="#A78BFA" />
<stop offset="100%" stopColor="#C084FC" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#mica-trend-fill)" />
        <motion.path
          d={line}
          fill="none"
          stroke="url(#mica-trend-line)"
          strokeWidth="1.4"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.6, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-x-0 -bottom-0.5 flex items-center justify-between px-0.5">
        <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#64748B]">
          Portfolio trend
        </span>
        <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#64748B]/70">
          {live ? "Live balance · history coming soon" : "Awaiting balance"}
        </span>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Decorative purple glowing wallet illustration (UI-only, decorative) */
/* ------------------------------------------------------------------ */

const WalletIllustration: React.FC<{ className?: string }> = ({ className = "" }) => (
  <div className={`pointer-events-none select-none ${className}`} aria-hidden>
    <svg width="150" height="110" viewBox="0 0 150 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mica-wallet-card" x1="0" y1="0" x2="150" y2="110">
          <stop offset="0%" stopColor="#7C6CF0" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#C084FC" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="mica-wallet-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* glowing halo */}
      <circle cx="75" cy="55" r="50" fill="#6C5CE0" opacity="0.28" className="animate-pulse" style={{ filter: "blur(14px)" }} />
      {/* card body */}
      <rect x="18" y="26" width="114" height="62" rx="14" fill="url(#mica-wallet-card)" />
      <rect x="18" y="26" width="114" height="62" rx="14" fill="url(#mica-wallet-shine)" opacity="0.35" />
      {/* chip */}
      <rect x="34" y="44" width="22" height="16" rx="4" fill="#0B0F1C" opacity="0.55" />
      <rect x="37" y="47" width="16" height="10" rx="2" stroke="#FFFFFF" strokeOpacity="0.6" strokeWidth="1" />
      {/* circuit lines */}
      <path d="M78 36 H112" stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
      <path d="M78 52 H96" stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
      <path d="M110 52 H118 M110 60 H118" stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
      {/* contactless dots */}
      <circle cx="118" cy="48" r="2" fill="#FFFFFF" fillOpacity="0.7" />
      <circle cx="124" cy="50" r="2" fill="#FFFFFF" fillOpacity="0.45" />
      {/* magnetic stripe hint */}
      <rect x="34" y="78" width="70" height="4" rx="2" fill="#FFFFFF" opacity="0.5" />
    </svg>
  </div>
);


/* ------------------------------------------------------------------ */
/* Quick action tile                                                   */
/* ------------------------------------------------------------------ */

const QuickActionTile: React.FC<{
  label: string;
  icon: React.ReactNode;
  hot?: boolean;
  onClick: () => void;
}> = ({ label, icon, hot, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`group flex flex-col items-center gap-2 py-3 rounded-2xl transition-all duration-200 cursor-pointer ${
      hot
        ? "bg-[#6C5CE0]/[0.12] border border-[#6C5CE0]/25 hover:bg-[#6C5CE0]/[0.2] hover:border-[#8B5CF6]/45"
        : "bg-white/[0.02] border border-transparent hover:bg-white/[0.045] hover:border-white/[0.07]"
    }`}
  >
    <span
      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-105 ${
        hot
          ? "bg-gradient-to-br from-[#6C5CE0] to-[#8B5CF6] text-white shadow-[0_4px_14px_rgba(108,92,224,0.35)]"
          : "bg-[#0B0F1C]/90 border border-white/[0.06] text-[#C4B5FD] group-hover:text-white group-hover:border-[#6C5CE0]/35"
      }`}
    >
      {icon}
    </span>
    <span className="text-[10px] font-bold text-[#CBD5E1] group-hover:text-white transition-colors duration-200 leading-none">
      {label}
    </span>
  </button>
);

/* ------------------------------------------------------------------ */
/* Main dashboard                                                      */
/* ------------------------------------------------------------------ */

export default function CircleWalletDashboard({ onBack }: CircleWalletDashboardProps) {
  const { circleWallet: session, ensureCircleWallet, currentUser, userProfile, friends } = useChat();
  const uid = (currentUser as any)?.uid as string | null | undefined;

  /* ---------------- Existing wallet session (unchanged logic) -------- */

  const serverWalletAddress = userProfile?.circleWalletAddress ?? null;

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

  /* ---------------- Existing balance fetch (unchanged behaviour) ----- */

  const [balanceStatus, setBalanceStatus] = useState<ArcBalanceStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!address) {
      setBalanceStatus(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const result = await fetchArcUsdcBalance(address, ARC_NETWORK.chainId, 4);
        if (!cancelled) setBalanceStatus(result);
      } catch (err: any) {
        // Transport-level failure (offline / dev-server restart): surface the
        // designed error card instead of spinning forever.
        if (!cancelled) setBalanceStatus({ status: "error", message: err?.message || String(err) });
      }
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

  /* ---------------- Existing payment history (unchanged source) ------ */

  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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
        const records = [...merged.values()].sort(
          (a, b) =>
            new Date(String(b.timestamp ?? 0)).getTime() -
            new Date(String(a.timestamp ?? 0)).getTime()
        );
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

  /* ---------------- Derived display state ---------------------------- */

  const balance = useMemo<ArcBalanceStatus | null>(() => balanceStatus, [balanceStatus]);
  const usdcBalance = balance?.status === "success" ? balance.balance : null;
  const rpcConnected = balance?.status === "success";

  const statusLabel = useMemo(() => {
    if (serverWalletAddress) {
      return { label: "Server-managed", tone: "text-emerald-400", dot: "bg-emerald-500" };
    }
    switch (session.status) {
      case "checking":
        return { label: "Checking…", tone: "text-[#A78BFA]", dot: "bg-[#8B5CF6] animate-pulse" };
      case "unconfigured":
        return { label: "Not configured", tone: "text-amber-300", dot: "bg-amber-400" };
      case "idle":
        return { label: "No wallet yet", tone: "text-[#A78BFA]", dot: "bg-[#8B5CF6]" };
      case "linking":
        return { label: "Linking…", tone: "text-[#A78BFA]", dot: "bg-[#8B5CF6] animate-pulse" };
      case "linked":
        return { label: "Connected", tone: "text-emerald-400", dot: "bg-emerald-500 animate-pulse" };
      case "error":
        return { label: "Error", tone: "text-red-400", dot: "bg-red-500" };
    }
  }, [serverWalletAddress, session.status]);

  /* ---------------- UI-only overlay state ---------------------------- */

  const [copiedAddress, setCopiedAddress] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activityAllOpen, setActivityAllOpen] = useState(false);
  const [sendPickerOpen, setSendPickerOpen] = useState(false);
  const [sendPickerQuery, setSendPickerQuery] = useState("");
  const [sendTarget, setSendTarget] = useState<UserProfile | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [comingSoon, setComingSoon] = useState<{ title: string; blurb: string } | null>(null);
  const [range, setRange] = useState("1D");
  const activityRef = useRef<HTMLDivElement | null>(null);

  const handleCopy = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 1800);
    } catch (err) {
      console.warn("[CircleWallet] copy failed:", err);
    }
  }, [address]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const openComingSoon = useCallback((title: string, blurb: string) => {
    setComingSoon({ title, blurb });
  }, []);

  const openSendPicker = useCallback(() => {
    setSendPickerQuery("");
    setSendPickerOpen(true);
  }, []);

  const handlePaymentSuccess = useCallback(async () => {
    setRefreshTick((t) => t + 1);
  }, []);

  const filteredFriends = useMemo(() => {
    const q = sendPickerQuery.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.displayName?.toLowerCase().includes(q) ||
        f.username?.toLowerCase().includes(q)
    );
  }, [friends, sendPickerQuery]);

  const visibleRecords = paymentRecords.slice(0, 5);

  /* ================================================================== */
  /* Render                                                             */
  /* ================================================================== */

  return (
    <div className="flex-1 flex flex-col h-full bg-[#070511] overflow-hidden relative">
      {/* Atmospheric lighting: large diffused purple light areas, dark edges */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(72% 58% at 50% -14%, rgba(124,58,237,0.15) 0%, rgba(76,29,149,0.06) 45%, rgba(5,3,12,0) 75%), radial-gradient(55% 45% at 90% 32%, rgba(139,92,246,0.09) 0%, rgba(5,3,12,0) 70%), radial-gradient(50% 42% at 8% 76%, rgba(124,58,237,0.08) 0%, rgba(5,3,12,0) 72%), radial-gradient(130% 120% at 50% 50%, rgba(5,3,12,0) 35%, rgba(2,1,6,0.9) 100%)",
        }}
      />
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[46rem] h-80 bg-[#6D28D9]/[0.13] blur-[140px] rounded-full" />
      <div className="pointer-events-none absolute top-40 -right-28 w-[30rem] h-80 bg-[#8B5CF6]/[0.10] blur-[150px] rounded-full" />
      <div className="pointer-events-none absolute bottom-0 -left-24 w-[28rem] h-72 bg-[#A78BFA]/[0.08] blur-[150px] rounded-full" />

      {/* ============================ HEADER (premium, compact) ========= */}
      <header className="shrink-0 z-20 border-b border-white/[0.06] bg-[#0C0820]/85 backdrop-blur-xl">
        <div className="w-full px-3 sm:px-5 py-2.5 sm:py-3 flex items-center gap-2.5 sm:gap-3">
          <button
            onClick={onBack}
            className="h-9 w-9 shrink-0 rounded-xl bg-white/[0.03] border border-white/[0.07] text-[#C4B5FD] hover:text-white transition-all duration-200 hover:border-[#6C5CE0]/50 hover:bg-white/[0.07] cursor-pointer flex items-center justify-center"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="hidden md:flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#6C5CE0] to-[#8B5CF6] flex items-center justify-center shadow-[0_0_18px_rgba(108,92,224,0.35)] shrink-0">
              <WalletIcon className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-sm font-black text-white tracking-tight truncate shrink-0">MICA Wallet</h2>
            <NetworkBadge compact />
          </div>

          {/* Right hand status cluster */}
          <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
            <StatusBadge label={statusLabel.label} tone={statusLabel.tone} dot={statusLabel.dot} />
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-400/[0.08] border border-emerald-400/20 text-emerald-300">
              <ShieldCheck className="w-3 h-3" />
              MPC Secured
            </span>
          </div>

          <div className="flex-1" />

          <div className="hidden lg:flex items-center gap-1.5 text-[9.5px] font-mono text-[#64748B] tracking-wide">
            <span className="inline-flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${rpcConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
              {rpcConnected ? "Connected" : "Checking"}
            </span>
            <span className="text-[#334155]">·</span>
            <span>{ARC_NETWORK.name} · chain {ARC_NETWORK.chainId}</span>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            title="Refresh balance & activity"
            className="h-9 w-9 shrink-0 rounded-xl bg-white/[0.03] border border-white/[0.07] text-[#C4B5FD] hover:text-white transition-all duration-200 hover:border-[#6C5CE0]/50 hover:bg-white/[0.07] cursor-pointer flex items-center justify-center"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin text-[#8B5CF6]" : ""}`} />
          </button>
        </div>
      </header>

      {/* ============================ CONTENT =========================== */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {!address ? (
          /* -------- Not linked: preserve existing setup flow -------- */
          <div className="p-4 sm:p-6 max-w-md mx-auto pt-10">
            <Card className="p-6" delay={0.02}>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[#6C5CE0]/15 border border-[#6C5CE0]/30 flex items-center justify-center shrink-0">
                  <WalletIcon className="w-5 h-5 text-[#A78BFA]" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#F8FAFC]">No Circle wallet linked yet</p>
                  <p className="text-[11px] text-[#94A3B8] mt-1 leading-relaxed">
                    Set up your MICA Wallet to get started. Your wallet is created securely on the
                    server &mdash; no passkey required.
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void ensureCircleWallet()}
                  disabled={session.status === "linking"}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#6C5CE0] to-[#7C6CF0] hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wider transition-all shadow-[0_6px_24px_rgba(108,92,224,0.25)] cursor-pointer"
                >
                  {session.status === "linking" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <WalletIcon className="w-4 h-4" />
                  )}
                  {session.status === "linking" ? "Linking…" : "Set up MICA Wallet"}
                </button>
                {session.status === "error" && session.message && (
                  <span className="text-[11px] text-red-400 font-mono break-all">{session.message}</span>
                )}
              </div>
            </Card>
          </div>
        ) : (
          <div className="w-full p-3 sm:p-5 space-y-4 pb-32 lg:pb-10">
            {/* ==================== MAIN TWO-COLUMN GRID ==================== */}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-4 items-start">
              {/* ---------------- LEFT COLUMN ---------------- */}
              <div className="space-y-4 min-w-0">
                {/* ============ PORTFOLIO OVERVIEW ============ */}
                <Card className="p-5 sm:p-6 overflow-hidden relative !bg-[#0C0717]" delay={0.02}>
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "radial-gradient(95% 70% at 38% 38%, rgba(109,40,217,0.20) 0%, rgba(124,58,237,0.09) 45%, rgba(6,3,14,0) 78%), radial-gradient(60% 55% at 88% 30%, rgba(139,92,246,0.13) 0%, rgba(6,3,14,0) 72%)",
                    }}
                  />
                  <div className="absolute -top-28 -right-20 w-80 h-64 bg-[#8B5CF6]/[0.15] blur-[100px] rounded-full pointer-events-none" />
                  <div className="absolute -bottom-24 left-0 w-72 h-56 bg-[#6D28D9]/[0.12] blur-[100px] rounded-full pointer-events-none" />

                  <div className="relative">
                    <SectionLabel
                      icon={<CircleDollarSign className="w-3.5 h-3.5" />}
                      right={
                        <div className="flex items-center gap-1.5">
                          <NetworkBadge compact />
                          <StatusBadge label={statusLabel.label} tone={statusLabel.tone} dot={statusLabel.dot} />
                        </div>
                      }
                    >
                      Portfolio Overview
                    </SectionLabel>

                    <div className="relative flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        {balance?.status === "success" ? (
                          <>
                            <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
                              <span className="text-[40px] sm:text-[48px] leading-[0.95] font-black text-white font-mono tracking-tight">
                                {fmtUsd(usdcBalance ?? 0)}
                              </span>
                              <span className="inline-flex items-center gap-1 mb-1 text-[11px] font-mono font-bold text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-2 py-0.5">
                                <TrendingUp className="w-3 h-3" />
                                +0.00% today
                              </span>
                            </div>
                            <p className="mt-2.5 text-[13px] font-mono text-[#C4B5FD]/80 font-bold">
                              {fmtUsdc(balance.balance)} <span className="text-[#64748B] font-semibold">USDC</span>
                              <span className="text-[#3B4256] mx-1.5">·</span>
                              <span className="text-[#64748B] font-semibold">{ARC_NETWORK.name}</span>
                            </p>
                            <div className="mt-1 text-[9.5px] font-mono uppercase tracking-wider text-[#64748B]">
                              24h change · history coming soon
                            </div>
                          </>
                        ) : balance?.status === "error" ? (
                          <div className="py-3">
                            <p className="text-sm font-bold text-amber-300 font-mono">Unable to load balance</p>
                            <p className="text-[10px] text-[#64748B] font-mono mt-1 break-all line-clamp-2">
                              {balance.message}
                            </p>
                            <button
                              type="button"
                              onClick={handleRefresh}
                              className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#6C5CE0]/15 border border-[#6C5CE0]/30 text-[#A78BFA] hover:bg-[#6C5CE0]/25 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer"
                            >
                              <RefreshCw className="w-3 h-3" /> Retry
                            </button>
                          </div>
                        ) : (
                          <div className="py-2 space-y-3">
                            <ShimmerBlock className="h-10 w-56" />
                            <ShimmerBlock className="h-3.5 w-32" />
                          </div>
                        )}
                      </div>

                      {/* Decorative wallet illustration */}
                      <div className="hidden sm:block shrink-0 -mt-1 opacity-90">
                        <WalletIllustration />
                      </div>
                    </div>

                    {/* Trend chart */}
                    <div className="mt-5 pt-4 border-t border-white/[0.05]">
                      <PortfolioTrend live={balance?.status === "success"} />
                    </div>

                    {/* Time filters (decorative range selector) */}
                    <div className="mt-3 flex items-center gap-1">
                      {["1H", "1D", "1W", "1M", "1Y", "ALL"].map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRange(r)}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold transition-all duration-200 cursor-pointer ${
                            range === r
                              ? "bg-[#6C5CE0]/20 border border-[#6C5CE0]/40 text-white"
                              : "bg-white/[0.02] border border-transparent text-[#64748B] hover:text-[#CBD5E1] hover:bg-white/[0.05]"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>

                    {/* Send / Deposit */}
                    <div className="mt-5 flex gap-3">
                      <button
                        type="button"
                        onClick={openSendPicker}
                        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#6C5CE0] via-[#7C6CF0] to-[#8B5CF6] text-white text-[13px] font-bold inline-flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] transition-all duration-200 shadow-[0_8px_28px_rgba(108,92,224,0.3)] cursor-pointer"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                        Send
                      </button>
                      <button
                        type="button"
                        onClick={() => setReceiveOpen(true)}
                        className="flex-1 py-3 rounded-xl bg-[#7C3AED]/[0.14] border border-[#A78BFA]/30 text-[#D8CCFF] text-[13px] font-bold inline-flex items-center justify-center gap-2 hover:bg-[#7C3AED]/[0.22] hover:border-[#A78BFA]/50 transition-all duration-200 cursor-pointer"
                      >
                        <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                        Deposit
                      </button>
                    </div>
                  </div>
                </Card>

                {/* ============ ASSETS ============ */}
                <Card className="p-4 sm:p-5 !bg-[#0B0713]" delay={0.08}>
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "radial-gradient(70% 60% at 15% 20%, rgba(124,58,237,0.07) 0%, rgba(6,3,14,0) 70%)",
                    }}
                  />
                  <SectionLabel
                    icon={<CircleDollarSign className="w-3.5 h-3.5" />}
                    right={
                      <span className="text-[9px] font-mono text-[#64748B] uppercase tracking-wider">
                        1 asset
                      </span>
                    }
                  >
                    Assets
                  </SectionLabel>

                  {/* Header row (desktop) */}
                  <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1.3fr] gap-3 px-4 pb-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.16em] text-[#64748B]">
                    <span>Asset</span>
                    <span className="text-right">Balance</span>
                    <span className="text-right">Value</span>
                    <span className="text-right pr-1">Allocation · Network</span>
                  </div>

                  {/* USDC row — the only real asset */}
                  <div className="grid grid-cols-2 md:grid-cols-[2fr_1fr_1fr_1.3fr] gap-3 px-4 py-3.5 items-center rounded-xl hover:bg-white/[0.025] transition-colors duration-200 -mx-1">
                    <div className="flex items-center gap-3 col-span-2 md:col-span-1 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#6D28D9] flex items-center justify-center shrink-0 shadow-[0_0_14px_rgba(124,58,237,0.35)]">
                        <CircleDollarSign className="w-4.5 h-4.5 text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-white truncate">USDC</p>
                        <p className="text-[9.5px] font-mono text-[#64748B] truncate">Circle USDC</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-black text-white font-mono">
                        {usdcBalance != null ? fmtUsdc(usdcBalance) : "—"}
                      </p>
                      <p className="md:hidden text-[9px] font-mono text-[#64748B]">Balance</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-bold text-[#C4B5FD]/90 font-mono">
                        {usdcBalance != null ? fmtUsd(usdcBalance) : "—"}
                      </p>
                      <p className="md:hidden text-[9px] font-mono text-[#64748B]">Value</p>
                    </div>
                    <div className="col-span-2 md:col-span-1 flex items-center gap-3 justify-end">
                      <div className="hidden md:block w-24">
                        <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: usdcBalance != null ? "100%" : "0%" }}
                            transition={{ duration: 0.9, ease: "easeOut" }}
                            className="h-full rounded-full bg-gradient-to-r from-[#6C5CE0] to-[#C084FC]"
                          />
                        </div>
                        <p className="text-right text-[8.5px] font-mono text-[#64748B] mt-1">100%</p>
                      </div>
                      <NetworkBadge compact />
                    </div>
                  </div>

                  {/* Polished empty state for future assets */}
                  <div className="mt-1 px-3 py-2.5 rounded-xl bg-white/[0.015] flex items-center gap-2.5">
                    <Info className="w-3.5 h-3.5 text-[#475569]" />
                    <p className="text-[10.5px] text-[#64748B] font-medium">No other assets yet</p>
                  </div>
                </Card>

                {/* ============ WALLET INSIGHTS ============ */}
                <Card className="p-4 sm:p-5 !bg-[#0F0A1D]" delay={0.12}>
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "radial-gradient(80% 70% at 90% 10%, rgba(139,92,246,0.08) 0%, rgba(10,6,20,0) 72%)",
                    }}
                  />
                  <SectionLabel
                    icon={<Zap className="w-3.5 h-3.5" />}
                    right={
                      <span className="text-[9px] font-mono text-[#64748B] uppercase tracking-wider">
                        Live
                      </span>
                    }
                  >
                    Wallet Insights
                  </SectionLabel>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {/* Current Balance */}
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] min-w-0">
                      <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-[#64748B]">
                        <CircleDollarSign className="w-3 h-3 text-[#7C6CF0]" />
                        Current Balance
                      </div>
                      <p className="mt-2 text-[15px] font-black text-white font-mono truncate">
                        {usdcBalance != null ? fmtUsd(usdcBalance) : "—"}
                      </p>
                      <p className="mt-0.5 text-[9.5px] font-mono text-[#64748B] truncate">
                        {usdcBalance != null ? `${fmtUsdc(usdcBalance)} USDC` : "Awaiting balance"}
                      </p>
                    </div>

                    {/* 24H Performance */}
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] min-w-0">
                      <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-[#64748B]">
                        <TrendingUp className="w-3 h-3 text-[#C084FC]" />
                        24H Performance
                      </div>
                      <p className="mt-2 text-[15px] font-black text-emerald-300 font-mono">
                        +0.00%
                      </p>
                      <p className="mt-0.5 text-[9.5px] font-mono text-[#64748B]">
                        USD value
                      </p>
                    </div>

                    {/* Activity */}
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] min-w-0">
                      <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-[#64748B]">
                        <Clock3 className="w-3 h-3 text-[#FB923C]" />
                        Activity
                      </div>
                      <p className="mt-2 text-[15px] font-black text-white font-mono">
                        {paymentRecords.length}
                      </p>
                      <p className="mt-0.5 text-[9.5px] font-mono text-[#64748B]">
                        {paymentRecords.length === 1 ? "transaction" : "transactions"}
                      </p>
                    </div>

                    {/* Network */}
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] min-w-0">
                      <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-[#64748B]">
                        <Layers className="w-3 h-3 text-[#7C6CF0]" />
                        Network
                      </div>
                      <p className="mt-2 text-[15px] font-black text-white truncate">
                        {ARC_NETWORK.name}
                      </p>
                      <p className={`mt-0.5 text-[9.5px] font-mono font-bold ${rpcConnected ? "text-emerald-400" : "text-amber-300"}`}>
                        {rpcConnected ? "Connected" : "Checking"}
                      </p>
                    </div>
                  </div>
                </Card>
              </div>

              {/* ---------------- RIGHT COLUMN ---------------- */}
              <div className="space-y-4 min-w-0">
                {/* ============ QUICK ACTIONS (2x4 grid) ============ */}
                <Card className="p-4 sm:p-5 !bg-[#0D0819]" delay={0.1}>
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "radial-gradient(70% 55% at 50% 0%, rgba(124,58,237,0.08) 0%, rgba(7,4,15,0) 70%)",
                    }}
                  />
                  <SectionLabel icon={<Zap className="w-3.5 h-3.5" />}>
                    Quick Actions
                  </SectionLabel>
                  <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                    <QuickActionTile label="Send" hot icon={<ArrowUpRight className="w-[18px] h-[18px]" />} onClick={openSendPicker} />
                    <QuickActionTile label="Deposit" icon={<ArrowDownLeft className="w-[18px] h-[18px]" />} onClick={() => setReceiveOpen(true)} />
                    <QuickActionTile label="Receive" icon={<QrCode className="w-[18px] h-[18px]" />} onClick={() => setReceiveOpen(true)} />
                    <QuickActionTile label="Swap" icon={<ArrowLeftRight className="w-[18px] h-[18px]" />} onClick={() => openComingSoon("Circle Swap", "Swap supported assets natively inside MICA.")} />
                    <QuickActionTile label="Bridge" icon={<ArrowDownUp className="w-[18px] h-[18px]" />} onClick={() => openComingSoon("Circle Bridge", "Bridge assets across networks via Circle CCTP.")} />
                    <QuickActionTile label="Buy" icon={<CreditCard className="w-[18px] h-[18px]" />} onClick={() => openComingSoon("Buy USDC", "Fund your wallet with card & bank rails.")} />
                    <QuickActionTile label="Activity" icon={<Clock3 className="w-[18px] h-[18px]" />} onClick={() => activityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />
                    <QuickActionTile label="More" icon={<MoreHorizontal className="w-[18px] h-[18px]" />} onClick={() => setDetailsOpen(true)} />
                  </div>
                </Card>

                {/* ============ RECENT ACTIVITY ============ */}
                <div ref={activityRef}>
                  <SectionLabel
                    icon={<Clock3 className="w-3.5 h-3.5" />}
                    right={
                      paymentRecords.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setActivityAllOpen(true)}
                          className="text-[9px] font-mono font-bold uppercase tracking-widest text-[#A78BFA] hover:text-white transition-colors duration-200 cursor-pointer"
                        >
                          View All Activity
                        </button>
                      ) : undefined
                    }
                  >
                    Recent Activity
                  </SectionLabel>

                  <Card className="divide-y divide-white/[0.04] !bg-[#0A0612]" delay={0.12}>
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{
                        background:
                          "radial-gradient(60% 60% at 85% 15%, rgba(124,58,237,0.06) 0%, rgba(5,3,12,0) 70%)",
                      }}
                    />
                    {historyLoading && paymentRecords.length === 0 ? (
                      <div className="p-4 space-y-3">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="flex items-center gap-3">
                            <ShimmerBlock className="w-9 h-9 !rounded-full" />
                            <div className="flex-1 space-y-1.5">
                              <ShimmerBlock className="h-2.5 w-32" />
                              <ShimmerBlock className="h-2 w-20" />
                            </div>
                            <ShimmerBlock className="h-3 w-16" />
                          </div>
                        ))}
                      </div>
                    ) : visibleRecords.length === 0 ? (
                      <div className="py-12 flex flex-col items-center text-center px-6">
                        <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-3">
                          <Clock3 className="w-5 h-5 text-[#475569]" />
                        </div>
                        <p className="text-[12px] font-bold text-[#94A3B8]">No transactions yet</p>
                        <p className="text-[10px] text-[#64748B] mt-1">
                          Your sent &amp; received USDC will appear here.
                        </p>
                      </div>
                    ) : (
                      visibleRecords.map((record) => {
                        const outgoing = String(record.senderWallet || "").toLowerCase() === address!.toLowerCase();
                        const txUrl = getTxExplorerUrl(record.transactionHash);
                        const counterparty = outgoing ? record.recipientUsername : record.senderUsername;
                        const counterpartyWallet = outgoing ? record.recipientWallet : record.senderWallet;
                        return (
                          <div
                            key={record.id}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.025] transition-colors duration-200"
                          >
                            <div
                              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border ${
                                outgoing
                                  ? "bg-rose-400/10 border-rose-400/25 text-rose-300"
                                  : "bg-emerald-400/10 border-emerald-400/25 text-emerald-300"
                              }`}
                            >
                              {outgoing ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-bold text-white truncate">
                                {outgoing ? "Sent USDC" : "Received USDC"}
                                <span className="ml-1.5 text-[10px] font-medium text-[#94A3B8]">
                                  {outgoing ? "to" : "from"}{" "}
                                  {counterparty ? `@${counterparty}` : shortAddress(counterpartyWallet)}
                                </span>
                              </p>
                              <p className="text-[9.5px] font-mono text-[#64748B] mt-0.5 flex items-center gap-1.5 truncate">
                                {formatActivityDate(record.timestamp)}
                                <span className="text-[#334155]">•</span> Arc
                                {txUrl && (
                                  <>
                                    <span className="text-[#334155]">•</span>
                                    <a
                                      href={txUrl}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className="text-[#6C5CE0] hover:text-[#A78BFA] transition-colors inline-flex items-center gap-0.5 min-h-0"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {shortHash(record.transactionHash)} <ExternalLink className="w-2.5 h-2.5" />
                                    </a>
                                  </>
                                )}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p
                                className={`text-[13px] font-black font-mono ${
                                  outgoing ? "text-rose-300" : "text-emerald-400"
                                }`}
                              >
                                {outgoing ? "−" : "+"}
                                {Number(record.amount).toLocaleString("en-US", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 6,
                                })}
                              </p>
                              <p className="text-[8.5px] font-mono font-bold uppercase tracking-wider text-emerald-400/80">
                                Completed
                              </p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </Card>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== STICKY MOBILE SEND BAR ==================== */}
      {address && (
        <div className="lg:hidden absolute bottom-0 inset-x-0 z-20 p-3 bg-gradient-to-t from-[#080B14] via-[#080B14]/95 to-transparent">
          <button
            type="button"
            onClick={openSendPicker}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#6C5CE0] via-[#7C6CF0] to-[#8B5CF6] text-white text-sm font-bold shadow-[0_10px_30px_rgba(108,92,224,0.35)] inline-flex items-center justify-center gap-2 active:scale-[0.99] transition-transform cursor-pointer"
          >
            <ArrowUpRight className="w-4 h-4" />
            Send USDC
          </button>
        </div>
      )}

      {/* ==================== OVERLAYS ==================== */}

      {/* Recipient picker → existing SendUsdcModal */}
      <AnimatePresence>
        {sendPickerOpen && (
          <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSendPickerOpen(false)}
              className="absolute inset-0 bg-[#070A12]/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className="relative w-full sm:max-w-md bg-[#0D1120]/95 border border-white/[0.08] rounded-t-3xl sm:rounded-3xl shadow-[0_25px_80px_rgba(0,0,0,0.6)] overflow-hidden"
            >
              <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-28 bg-[#6C5CE0]/20 blur-[60px] rounded-full pointer-events-none" />
              <div className="relative p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[15px] font-black text-white">Send USDC</h3>
                  <button
                    type="button"
                    onClick={() => setSendPickerOpen(false)}
                    className="p-1.5 rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#64748B]" />
                  <input
                    autoFocus
                    value={sendPickerQuery}
                    onChange={(e) => setSendPickerQuery(e.target.value)}
                    placeholder="Search your MICA contacts…"
                    className="w-full bg-black/40 border border-white/[0.08] focus:border-[#6C5CE0]/60 rounded-xl pl-9 pr-3 py-2.5 text-[12px] text-white placeholder:text-white/25 focus:outline-none transition-all"
                  />
                </div>

                <div className="max-h-[320px] overflow-y-auto custom-scrollbar space-y-1.5">
                  {filteredFriends.length === 0 ? (
                    <div className="py-10 text-center">
                      <p className="text-[12px] font-bold text-[#94A3B8]">No MICA contacts found</p>
                      <p className="text-[10px] text-[#64748B] mt-1 px-8">
                        Add friends in chat first — transfers require a contact with a verified
                        MICA wallet.
                      </p>
                    </div>
                  ) : (
                    filteredFriends.map((f) => {
                      const eligible = Boolean(f.walletVerified && f.walletAddress);
                      return (
                        <button
                          key={f.uid}
                          type="button"
                          disabled={!eligible}
                          onClick={() => {
                            setSendTarget(f);
                            setSendPickerOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                            eligible
                              ? "bg-white/[0.02] border-white/[0.05] hover:bg-[#6C5CE0]/10 hover:border-[#6C5CE0]/40 cursor-pointer"
                              : "opacity-40 cursor-not-allowed border-transparent"
                          }`}
                        >
                          <img
                            src={f.avatarUrl}
                            alt={f.displayName || f.username}
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-full object-cover border border-[#6C5CE0]/30 bg-[#0D111D] shrink-0"
                          />
                          <div className="min-w-0 flex-1 text-left">
                            <p className="text-[12px] font-bold text-white truncate">
                              {f.displayName || f.username}
                            </p>
                            <p className="text-[9.5px] font-mono text-[#64748B] truncate">
                              @{f.username} · {shortAddress(f.walletAddress)}
                            </p>
                          </div>
                          {eligible ? (
                            <ChevronRight className="w-4 h-4 text-[#64748B]" />
                          ) : (
                            <span className="text-[8.5px] font-mono uppercase tracking-wider text-amber-400/70">
                              No wallet
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Existing Send USDC flow — reused verbatim */}
      <SendUsdcModal
        open={Boolean(sendTarget)}
        senderProfile={userProfile}
        senderWallet={
          session.status === "linked" ? session.address : userProfile?.circleWalletAddress ?? null
        }
        recipient={sendTarget}
        onClose={() => setSendTarget(null)}
        onPaymentSuccess={handlePaymentSuccess}
      />

      {/* Receive / Deposit (UI-only — displays the real address, no API calls) */}
      <AnimatePresence>
        {receiveOpen && (
          <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setReceiveOpen(false)}
              className="absolute inset-0 bg-[#070A12]/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className="relative w-full sm:max-w-sm bg-[#0D1120]/95 border border-white/[0.08] rounded-t-3xl sm:rounded-3xl shadow-[0_25px_80px_rgba(0,0,0,0.6)] overflow-hidden"
            >
              <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-28 bg-emerald-400/10 blur-[60px] rounded-full pointer-events-none" />
              <div className="relative p-6 text-center">
                <button
                  type="button"
                  onClick={() => setReceiveOpen(false)}
                  className="absolute right-4 top-4 p-1.5 rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400/20 to-emerald-400/[0.05] border border-emerald-400/30 flex items-center justify-center">
                  <QrCode className="w-6 h-6 text-emerald-300" />
                </div>
                <h3 className="mt-4 text-[15px] font-black text-white">Deposit / Receive USDC</h3>
                <p className="text-[10.5px] text-[#94A3B8] mt-1 leading-relaxed">
                  Share your MICA wallet address on {ARC_NETWORK.name}. Card &amp; bank deposits via
                  Circle are coming soon.
                </p>
                <div className="mt-4 p-3 rounded-xl bg-black/40 border border-white/[0.07] break-all">
                  <code className="text-[10.5px] font-mono text-[#C4B5FD] select-all leading-relaxed">{address}</code>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-[#D8CCFF] text-[11px] font-bold hover:bg-white/[0.08] transition-all cursor-pointer inline-flex items-center justify-center gap-1.5"
                  >
                    {copiedAddress ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedAddress ? "Copied" : "Copy Address"}
                  </button>
                  <a
                    href={`${ARC_NETWORK.blockExplorerUrl}/address/${address}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="py-2.5 rounded-xl bg-[#6C5CE0]/15 border border-[#6C5CE0]/30 text-[#A78BFA] text-[11px] font-bold hover:bg-[#6C5CE0]/25 hover:text-white transition-all inline-flex items-center justify-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Explorer
                  </a>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Coming Soon (UI-only actions) */}
      <AnimatePresence>
        {comingSoon && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setComingSoon(null)}
              className="absolute inset-0 bg-[#070A12]/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 14 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="relative w-full max-w-xs bg-[#0D1120]/95 border border-white/[0.08] rounded-3xl shadow-[0_25px_80px_rgba(0,0,0,0.6)] p-6 text-center"
            >
              <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-[#6C5CE0]/25 to-[#8B5CF6]/[0.08] border border-[#6C5CE0]/35 flex items-center justify-center">
                <Clock3 className="w-6 h-6 text-[#A78BFA]" />
              </div>
              <h3 className="mt-4 text-[15px] font-black text-white">{comingSoon.title}</h3>
              <ComingSoonBadge />
              <p className="mt-3 text-[11px] text-[#94A3B8] leading-relaxed">
                {comingSoon.blurb} This integration is on the MICA roadmap and will light up here
                first.
              </p>
              <button
                type="button"
                onClick={() => setComingSoon(null)}
                className="mt-5 w-full py-2.5 rounded-xl bg-gradient-to-r from-[#6C5CE0] to-[#7C6CF0] text-white text-[11px] font-bold uppercase tracking-widest hover:brightness-110 transition-all cursor-pointer"
              >
                Got it
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Full activity modal */}
      <AnimatePresence>
        {activityAllOpen && (
          <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActivityAllOpen(false)}
              className="absolute inset-0 bg-[#070A12]/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
              className="relative w-full sm:max-w-lg bg-[#0D1120]/95 border border-white/[0.08] rounded-t-3xl sm:rounded-3xl shadow-[0_25px_80px_rgba(0,0,0,0.6)] overflow-hidden max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between p-5 border-b border-white/[0.06] shrink-0">
                <h3 className="text-[15px] font-black text-white">All Activity</h3>
                <button
                  type="button"
                  onClick={() => setActivityAllOpen(false)}
                  className="p-1.5 rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto custom-scrollbar divide-y divide-white/[0.04]">
                {paymentRecords.map((record) => {
                  const outgoing =
                    String(record.senderWallet || "").toLowerCase() === address!.toLowerCase();
                  const txUrl = getTxExplorerUrl(record.transactionHash);
                  const counterparty = outgoing ? record.recipientUsername : record.senderUsername;
                  return (
                    <div key={record.id} className="flex items-center gap-3 px-5 py-3.5">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${
                          outgoing
                            ? "bg-rose-400/10 border-rose-400/25 text-rose-300"
                            : "bg-emerald-400/10 border-emerald-400/25 text-emerald-300"
                        }`}
                      >
                        {outgoing ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11.5px] font-bold text-white truncate">
                          {outgoing ? "Sent USDC" : "Received USDC"}
                          <span className="ml-1.5 text-[10px] font-medium text-[#94A3B8]">
                            {outgoing ? "to" : "from"}{" "}
                            {counterparty ? `@${counterparty}` : shortAddress(record.transactionHash)}
                          </span>
                        </p>
                        <p className="text-[9px] font-mono text-[#64748B] mt-0.5">
                          {formatActivityDate(record.timestamp)} · Arc · Completed
                          {txUrl && (
                            <>
                              {" · "}
                              <a
                                href={txUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-[#6C5CE0] hover:text-[#A78BFA]"
                              >
                                View tx
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                      <p
                        className={`text-[12px] font-black font-mono shrink-0 ${
                          outgoing ? "text-rose-300" : "text-emerald-400"
                        }`}
                      >
                        {outgoing ? "−" : "+"}
                        {Number(record.amount).toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 6,
                        })}
                      </p>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Wallet details drawer */}
      <AnimatePresence>
        {detailsOpen && (
          <div className="fixed inset-0 z-[140]">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetailsOpen(false)}
              className="absolute inset-0 bg-[#070A12]/85 backdrop-blur-md"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 360, damping: 34 }}
              className="absolute right-0 top-0 bottom-0 w-full sm:w-[400px] bg-[#0D1120] border-l border-white/[0.07] shadow-[-20px_0_60px_rgba(0,0,0,0.5)] flex flex-col"
            >
              <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
                <h3 className="text-[15px] font-black text-white">Wallet Details</h3>
                <button
                  type="button"
                  onClick={() => setDetailsOpen(false)}
                  className="p-1.5 rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-3">
                <DetailRow label="Wallet Address" value={address!} mono copyable />
                <DetailRow
                  label="Credential ID"
                  value={credentialId ? shortHash(credentialId) : ""}
                  hint={credentialId || "Managed server-side"}
                  mono
                />
                <DetailRow label="Circle Wallet ID" value="Managed server-side" dimmed />
                <DetailRow label="Network" value={ARC_NETWORK.name} />
                <DetailRow label="Chain ID" value={String(ARC_NETWORK.chainId)} mono />
                <DetailRow label="Signing Method" value="Server MPC (Circle)" />
                <DetailRow label="Security" value="MPC-secured · keys never exposed" />
                <DetailRow label="Created / Linked" value={formatDate(linkedAt)} />
              </div>
              <div className="p-5 border-t border-white/[0.06]">
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-400/[0.06] border border-emerald-400/20">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <p className="text-[10px] text-emerald-200/90 leading-relaxed">
                    Private keys, seed phrases and keyshares never leave Circle&apos;s MPC
                    infrastructure. Only public metadata is shown here.
                  </p>
                </div>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail row (drawer)                                                 */
/* ------------------------------------------------------------------ */

const DetailRow: React.FC<{
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
  copyable?: boolean;
  dimmed?: boolean;
}> = ({ label, value, hint, mono, copyable, dimmed }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
      <p className="text-[8.5px] font-mono font-bold uppercase tracking-[0.16em] text-[#64748B]">
        {label}
      </p>
      <div className="flex items-center justify-between gap-2 mt-1">
        <p
          className={`text-[11.5px] break-all ${mono ? "font-mono" : "font-bold"} ${
            dimmed ? "text-[#64748B] italic" : "text-[#D8CCFF]"
          }`}
          title={hint || value}
        >
          {value || "—"}
        </p>
        {copyable && value && (
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(hint || value);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              } catch {
                /* clipboard unavailable */
              }
            }}
            className="p-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[#94A3B8] hover:text-white transition-all cursor-pointer shrink-0"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        )}
      </div>
    </div>
  );
};