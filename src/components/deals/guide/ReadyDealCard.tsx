import React from "react";
import { motion } from "motion/react";
import { Check, Handshake, Loader2 } from "lucide-react";
import { useDealGuideContext } from "../../../deals/DealGuideContext";
import { RoleTag } from "../dealUi";
import micaLogo from "../../../assets/images/micalogo.png";

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
    <div className="flex justify-center px-3 py-2">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 260 }}
        className="relative w-full max-w-[470px] overflow-hidden rounded-[22px] border border-[#8B5CF6]/30 bg-[#111528]/95 p-5 space-y-4 shadow-[0_18px_60px_rgba(0,0,0,0.32),0_0_30px_rgba(108,92,224,0.08)] backdrop-blur-xl"
      >
        <div className="relative flex items-center gap-3">
          <img src={micaLogo} alt="Mica" className="w-10 h-10 object-contain shrink-0" />
          <div className="min-w-0">
            <p className="text-[12px] font-black text-white">Mica AI · Deal Guide</p>
            <p className="text-[9px] font-mono text-[#94A3B8]">
              {bothReady
                ? "Both parties confirmed — moving to deal terms"
                : "Waiting for both parties to confirm"}
            </p>
          </div>
        </div>

        <p className="relative text-[11px] text-[#D8DDF0] leading-[1.7]">
          I&apos;ll mediate this deal live — draft a dual-signed agreement, hold the USDC in an Arc
          escrow, and release it only when both sides are happy. Are you both ready to deal?
        </p>

        <div className="relative space-y-2">
          <Row role="buyer" name={buyerName} ready={buyerReady} />
          <Row role="seller" name={sellerName} ready={sellerReady} />
        </div>

        <div className="relative flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => (myReady ? unready() : confirmReady())}
            disabled={bothReady || !myRole}
            className={`flex-1 min-h-11 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-extrabold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
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
