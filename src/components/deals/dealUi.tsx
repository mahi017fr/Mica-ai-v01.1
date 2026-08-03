import React from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { DealStatus, DEAL_STATUS_LABELS, DealRole, shortAddress } from "../../deals/types";

export function formatMs(ms: number): string {
  if (ms <= 0) return "0:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}`;
}

const STATUS_STYLES: Record<DealStatus, string> = {
  SETUP: "bg-slate-500/10 text-slate-300 border-slate-400/20",
  AI_ANALYSIS: "bg-[#6C5CE0]/10 text-[#A78BFA] border-[#6C5CE0]/30",
  NEGOTIATING: "bg-sky-500/10 text-sky-300 border-sky-400/20",
  AWAITING_ACCEPTANCE: "bg-amber-500/10 text-amber-300 border-amber-400/25",
  LOCKED: "bg-indigo-500/10 text-indigo-300 border-indigo-400/25",
  AWAITING_FUNDING: "bg-amber-500/10 text-amber-300 border-amber-400/25",
  FUNDING: "bg-amber-500/10 text-amber-300 border-amber-400/25",
  FUNDED: "bg-emerald-500/10 text-emerald-300 border-emerald-400/25",
  ACTIVE: "bg-emerald-500/10 text-emerald-300 border-emerald-400/25",
  DELIVERED: "bg-sky-500/10 text-sky-300 border-sky-400/25",
  BUYER_REVIEW: "bg-violet-500/10 text-violet-300 border-violet-400/25",
  RELEASE_PENDING: "bg-cyan-500/10 text-cyan-300 border-cyan-400/25",
  AUTO_RELEASE_DUE: "bg-orange-500/10 text-orange-300 border-orange-400/25",
  DISPUTED: "bg-red-500/10 text-red-300 border-red-400/25",
  RESOLVED: "bg-teal-500/10 text-teal-300 border-teal-400/25",
  COMPLETED: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
  CANCELLED: "bg-slate-500/10 text-slate-400 border-slate-400/20",
  EXPIRED: "bg-red-500/10 text-red-400 border-red-400/20",
};

export function StatusBadge({ status }: { status: DealStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border font-mono text-[9px] font-bold uppercase tracking-wider ${STATUS_STYLES[status]}`}
    >
      {DEAL_STATUS_LABELS[status]}
    </span>
  );
}

export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[#12172A]/60 border border-white/[0.06] rounded-2xl p-4 space-y-3">
      <div>
        <h3 className="text-[11px] font-black text-white uppercase tracking-widest font-mono">{title}</h3>
        {subtitle && <p className="text-[10px] text-[#94A3B8] mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function MicaBubble({ text }: { text: string }) {
  return (
    <div className="flex gap-2.5 items-start">
      <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-[#6C5CE0] to-[#8B5CF6] flex items-center justify-center shrink-0 text-[11px] font-black text-white">
        M
      </div>
      <div className="flex-1 rounded-2xl bg-[#6C5CE0]/[0.08] border border-[#6C5CE0]/20 px-3.5 py-2.5">
        <p className="text-[11px] text-[#E0DAFF] leading-relaxed whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
}

export function RoleTag({ role }: { role: DealRole }) {
  return role === "buyer" ? (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
      Buyer
    </span>
  ) : (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase bg-[#6C5CE0]/10 text-[#A78BFA] border border-[#6C5CE0]/30">
      Seller
    </span>
  );
}

export function WalletChip({ address }: { address?: string | null }) {
  if (!address) return <span className="text-[10px] font-mono text-[#94A3B8]">—</span>;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#161A2B] border border-white/10 text-[9px] font-mono text-[#94A3B8]">
      {shortAddress(address)}
    </span>
  );
}

export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-rose-500/[0.08] border border-rose-500/25">
      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
      <p className="flex-1 text-[11px] text-rose-200 leading-relaxed">{message}</p>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="text-rose-300/70 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-sky-500/[0.07] border border-sky-400/20">
      <p className="flex-1 text-[11px] text-sky-200 leading-relaxed">{children}</p>
    </div>
  );
}

export function WarnBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/[0.07] border border-amber-400/20">
      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
      <p className="flex-1 text-[11px] text-amber-100 leading-relaxed">{children}</p>
    </div>
  );
}

export function ActionButton({
  onClick,
  disabled,
  busy,
  children,
  variant = "primary",
  className = "",
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "danger" | "success";
  className?: string;
}) {
  const styles =
    variant === "primary"
      ? "bg-[#6C5CE0] hover:bg-[#5B4BD0] text-white"
      : variant === "success"
      ? "bg-emerald-500 hover:bg-emerald-600 text-white"
      : variant === "danger"
      ? "bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25"
      : "bg-white/[0.04] border border-white/10 text-[#94A3B8] hover:text-white hover:bg-white/[0.08]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#6C5CE0] mb-1.5">
      {children}
    </label>
  );
}

export const inputCls =
  "w-full bg-[#12172A] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#6C5CE0]/60 focus:ring-1 focus:ring-[#6C5CE0]/20 transition-all";
