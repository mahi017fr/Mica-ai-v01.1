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
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#0D111D]/50 border border-white/[0.04]">
      <div className="flex items-center gap-2 min-w-0">
        <RoleTag role={role} />
        <span className="text-[10px] text-[#94A3B8] truncate">{name || (role === "buyer" ? "Buyer" : "Seller")}</span>
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
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-3xl border border-white/10 bg-[#0B0F1E]/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
          <div>
            <h2 className="text-[14px] font-black text-white tracking-wide">What are you buying or selling?</h2>
            <p className="text-[10px] text-[#94A3B8]">
              Both parties must confirm the same terms before Mica analyzes the deal.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-[#94A3B8] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-3">
          <div className="space-y-1.5">
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
