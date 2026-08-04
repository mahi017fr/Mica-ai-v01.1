import React from "react";
import { motion } from "motion/react";
import { Check, X } from "lucide-react";
import { useDealGuideContext } from "../../../deals/DealGuideContext";
import DealSetup from "../DealSetup";
import { RoleTag } from "../dealUi";

export default function DealInfoPopup({ onClose }: { onClose: () => void }) {
  const guide = useDealGuideContext();
  const { deal, busy, myRole, myTermsConfirmed, termsConfirm, submitDealInfo, buyerName, sellerName } = guide;

  const Row = ({ role, name, confirmed }: { role: "buyer" | "seller"; name?: string; confirmed: boolean }) => (
    <div className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border ${confirmed ? "bg-emerald-500/[0.05] border-emerald-400/15" : "bg-[#11172A]/75 border-white/[0.07]"}`}>
      <div className="flex items-center gap-2 min-w-0">
        <RoleTag role={role} />
        <span className="text-[11px] font-semibold tracking-[-0.01em] text-[#CBD5E1] truncate">{name || (role === "buyer" ? "Buyer" : "Seller")}</span>
      </div>
      {confirmed ? (
        <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-emerald-300 uppercase">
          <Check className="w-3 h-3" /> Confirmed
        </span>
      ) : (
        <span className="text-[9px] font-mono text-[#94A3B8] uppercase">Pending</span>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 16, scale: 0.98, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 16, scale: 0.98, opacity: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 260 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden rounded-[28px] border border-[#29324B] bg-[#0A0F1E]/[0.98] font-sans shadow-[0_28px_100px_rgba(0,0,0,0.62)] backdrop-blur-xl"
      >
        <div className="flex items-start justify-between px-6 py-5 border-b border-white/[0.07] shrink-0 bg-gradient-to-b from-[#12172A]/65 to-transparent">
          <div className="pr-4">
            <span className="inline-block mb-2 text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#9B8AFB]">Deal setup</span>
            <h2 className="text-[18px] font-extrabold leading-tight text-[#F8FAFC] tracking-[-0.025em]">What are you buying or selling?</h2>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#8F9BB2]">
              Both parties must confirm the same terms before Mica analyzes the deal.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl border border-transparent flex items-center justify-center text-[#7F8BA3] hover:text-white hover:bg-white/[0.05] hover:border-white/[0.07] transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-4">
          <div className="space-y-2">
            <Row role="buyer" name={buyerName} confirmed={!!termsConfirm.buyer?.at} />
            <Row role="seller" name={sellerName} confirmed={!!termsConfirm.seller?.at} />
          </div>

          {myRole && myTermsConfirmed && (
            <p className="text-[10px] text-emerald-300 font-medium">
              You confirmed these terms. Waiting for the {myRole === "buyer" ? "seller" : "buyer"} to
              confirm…
            </p>
          )}

          <DealSetup
            deal={deal}
            busy={busy === "analyze"}
            onSave={(terms) => submitDealInfo(terms)}
          />
        </div>
      </motion.div>
    </div>
  );
}
