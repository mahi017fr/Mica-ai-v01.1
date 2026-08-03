import React from "react";
import { motion } from "motion/react";
import { Check, Handshake, Loader2 } from "lucide-react";
import { useDealGuideContext } from "../../../deals/DealGuideContext";
import { RoleTag } from "../dealUi";

export function ReadyDealGate() {
  const guide = useDealGuideContext();
  const show =
    guide.active &&
    !guide.bothReady &&
    !(guide.deal?.ai || guide.deal?.agreement);
  if (!show) return null;
  return <ReadyDealCard />;
}

export default function ReadyDealCard() {
  const guide = useDealGuideContext();
  const { myRole, myReady, bothReady, buyerReady, sellerReady, confirmReady, unready, buyerName, sellerName } = guide;

  const Row = ({ role, name, ready }: { role: "buyer" | "seller"; name?: string; ready: boolean }) => (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-[#0D111D]/60 border border-white/[0.04]">
      <div className="flex items-center gap-2 min-w-0">
        <RoleTag role={role} />
        <span className="text-[10px] text-[#94A3B8] truncate">{name || (role === "buyer" ? "Buyer" : "Seller")}</span>
      </div>
      {ready ? (
        <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-emerald-300 uppercase shrink-0">
          <Check className="w-3 h-3" /> Ready
        </span>
      ) : (
        <span className="text-[9px] font-mono text-[#94A3B8] uppercase shrink-0">Waiting…</span>
      )}
    </div>
  );

  return (
    <div className="flex justify-center px-2">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 260 }}
        className="w-full max-w-md rounded-2xl border border-[#6C5CE0]/25 bg-gradient-to-br from-[#6C5CE0]/[0.10] to-[#8B5CF6]/[0.05] p-4 space-y-3"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#6C5CE0] to-[#8B5CF6] flex items-center justify-center shrink-0 text-[12px] font-black text-white">
            M
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-black text-white">Mica AI · Deal Guide</p>
            <p className="text-[9px] font-mono text-[#94A3B8]">
              {bothReady
                ? "Both parties confirmed — moving to deal terms"
                : "Waiting for both parties to confirm"}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-[#E0DAFF] leading-relaxed">
          I&apos;ll mediate this deal live — draft a dual-signed agreement, hold the USDC in an Arc
          escrow, and release it only when both sides are happy. Are you both ready to deal?
        </p>

        <div className="space-y-1.5">
          <Row role="buyer" name={buyerName} ready={buyerReady} />
          <Row role="seller" name={sellerName} ready={sellerReady} />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => (myReady ? unready() : confirmReady())}
            disabled={bothReady || !myRole}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              myReady
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                : "bg-gradient-to-br from-[#6C5CE0] to-[#8B5CF6] text-white hover:opacity-90 shadow-lg shadow-[#6C5CE0]/20"
            }`}
          >
            {myReady ? <Check className="w-3.5 h-3.5" /> : <Handshake className="w-3.5 h-3.5" />}
            {myReady ? "I'm ready — waiting for the other party" : bothReady ? "Confirmed" : "I'm Ready to Deal"}
          </button>
          {myReady && !bothReady && (
            <button
              type="button"
              onClick={unready}
              className="px-3 py-2 rounded-xl text-[11px] font-bold bg-white/[0.04] border border-white/10 text-[#94A3B8] hover:text-white transition-all cursor-pointer"
            >
              Not yet
            </button>
          )}
        </div>

        {guide.busy && (
          <p className="flex items-center gap-1.5 text-[9px] font-mono text-[#A78BFA]">
            <Loader2 className="w-3 h-3 animate-spin" /> {guide.busyMessage || "Working…"}
          </p>
        )}
      </motion.div>
    </div>
  );
}
