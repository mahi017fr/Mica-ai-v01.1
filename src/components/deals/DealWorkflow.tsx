import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Edit3, Loader2, Sparkles, X, XCircle } from "lucide-react";
import { useDealWorkflow } from "../../deals/useDealWorkflow";
import { DealRole } from "../../deals/types";
import { TIMELINE, timelineIndex } from "../../deals/dealStatusMachine";
import DealTimeline from "./DealTimeline";
import DealSetup from "./DealSetup";
import DealAIRecommendation from "./DealAIRecommendation";
import { DealAgreement, DealConsent } from "./DealAgreement";
import DealFunding from "./DealFunding";
import DealDelivery from "./DealDelivery";
import DealReview from "./DealReview";
import DealDispute from "./DealDispute";
import { ErrorBanner, InfoBanner, Section, StatusBadge, WarnBanner } from "./dealUi";

const LOCKED_ONWARD = ["LOCKED", "AWAITING_FUNDING", "FUNDING", "FUNDED", "ACTIVE", "DELIVERED", "BUYER_REVIEW", "AUTO_RELEASE_DUE", "RELEASE_PENDING", "DISPUTED", "RESOLVED"];
const TERMINAL = ["CANCELLED", "EXPIRED", "COMPLETED", "RESOLVED"];

export default function DealWorkflow({
  roomId,
  currentUid,
  buyerUid,
  sellerUid,
  buyerWallet,
  sellerWallet,
  buyerName,
  sellerName,
  onClose,
}: {
  roomId: string;
  currentUid?: string;
  buyerUid: string;
  sellerUid: string;
  buyerWallet?: string;
  sellerWallet?: string;
  buyerName?: string;
  sellerName?: string;
  onClose: () => void;
}) {
  const wf = useDealWorkflow({
    roomId,
    currentUid,
    buyerUid,
    sellerUid,
    buyerWallet,
    sellerWallet,
    buyerName,
    sellerName,
  });

  const { deal, derivedState, busy, busyMessage, error, clearError, myRole } = wf;
  const [showSetup, setShowSetup] = useState(true);

  useEffect(() => {
    if (derivedState === "SETUP") setShowSetup(true);
    if (derivedState === "NEGOTIATING" || derivedState === "AWAITING_ACCEPTANCE") setShowSetup(false);
  }, [derivedState]);

  const inNegotiation =
    derivedState === "NEGOTIATING" || derivedState === "AWAITING_ACCEPTANCE" || derivedState === "AI_ANALYSIS";
  const showFunding = LOCKED_ONWARD.includes(derivedState || "");

  const termination = useMemo(() => {
    if (derivedState === "CANCELLED")
      return { title: "Deal Cancelled", note: deal?.cancelNote || "This deal was cancelled before funding." };
    if (derivedState === "EXPIRED")
      return { title: "Deal Expired", note: "This deal expired before completion." };
    if (derivedState === "RESOLVED")
      return { title: "Dispute Resolved", note: deal?.result ? `Resolved via ${deal.result.method}.` : "This dispute was resolved." };
    return null;
  }, [derivedState, deal]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 16, scale: 0.98, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          exit={{ y: 16, scale: 0.98, opacity: 0 }}
          transition={{ type: "spring", damping: 26, stiffness: 260 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border border-white/10 bg-[#0B0F1E]/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-[#6C5CE0] to-[#8B5CF6] flex items-center justify-center shadow-lg shadow-[#6C5CE0]/30">
                <Sparkles className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h2 className="text-[14px] font-black text-white tracking-wide">AI-Guided Deal Agreement</h2>
                <p className="text-[10px] text-[#94A3B8]">
                  {buyerName || "Buyer"} ↔ {sellerName || "Seller"} · Arc USDC Escrow
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {derivedState && <StatusBadge status={derivedState} />}
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-[#94A3B8] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-3">
            {wf.loading && !deal ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-[#6C5CE0]" />
                <p className="text-[11px] font-mono text-[#94A3B8]">Loading deal…</p>
              </div>
            ) : (
              <>
                <div className="px-2">
                  <DealTimeline status={derivedState} />
                </div>

                {deal && (
                  <>
                    {derivedState && !TERMINAL.includes(derivedState) && (
                      <InfoBanner>
                        {derivedState === "SETUP"
                          ? "Define the deal. Mica will analyze it and draft a dual-signed agreement held in an Arc USDC escrow."
                          : derivedState === "BUYER_REVIEW" || derivedState === "AUTO_RELEASE_DUE"
                          ? "The buyer has 24 hours to review the delivery. If no action is taken, the escrow auto-releases to the seller."
                          : derivedState === "DISPUTED"
                          ? "Dispute active — the auto-release clock is paused and funds are frozen."
                          : undefined}
                      </InfoBanner>
                    )}

                    {termination && (
                      <Section title="·" subtitle="This deal has ended.">
                        <div className="flex items-start gap-2">
                          {derivedState === "CANCELLED" ? (
                            <XCircle className="w-5 h-5 text-slate-400 shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-5 h-5 text-teal-300 shrink-0" />
                          )}
                          <div>
                            <p className="text-[12px] font-bold text-white">{termination.title}</p>
                            <p className="text-[11px] text-[#94A3B8] mt-0.5">{termination.note}</p>
                          </div>
                        </div>
                      </Section>
                    )}

                    {deal && (derivedState === "SETUP" || inNegotiation) && showSetup && (
                      <DealSetup deal={deal} busy={busy === "analyze"} onSave={wf.saveTermsAndAnalyze} />
                    )}

                    {deal && inNegotiation && !showSetup && (
                      <button
                        type="button"
                        onClick={() => setShowSetup(true)}
                        className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold text-[#6C5CE0] hover:text-[#8B5CF6] transition-colors cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" /> Edit deal terms
                      </button>
                    )}

                    {deal && deal.ai && (derivedState === "NEGOTIATING" || derivedState === "AWAITING_ACCEPTANCE") && (
                      <DealAIRecommendation
                        deal={deal}
                        busy={busy === "reanalyze"}
                        onRegenerate={wf.regenerateAnalysis}
                        onContinue={wf.generateAgreement}
                        onAskMica={wf.askMica}
                        myRole={myRole}
                      />
                    )}

                    {deal && (derivedState === "NEGOTIATING" || derivedState === "AWAITING_ACCEPTANCE" || derivedState === "LOCKED") && (
                      <DealAgreement deal={deal} busy={busy === "generateAgreement"} onGenerate={wf.generateAgreement} myRole={myRole} />
                    )}

                    {deal && (derivedState === "AWAITING_ACCEPTANCE" || derivedState === "LOCKED" || derivedState === "AWAITING_FUNDING") && (
                      <DealConsent deal={deal} busy={busy === "accept"} onAccept={wf.acceptAgreement} myRole={myRole} />
                    )}

                    {deal && showFunding && (
                      <DealFunding
                        deal={deal}
                        busy={busy}
                        myRole={myRole}
                        onBeginFunding={wf.beginFunding}
                        onFund={wf.fundLeg}
                        onRefundMyLeg={wf.refundMyLeg}
                        onCancel={wf.cancelDeal}
                        onNext={wf.continueToReview}
                        wallet={wf.wallet}
                      />
                    )}

                    {deal && (derivedState === "FUNDED" || derivedState === "ACTIVE" || derivedState === "DELIVERED" || derivedState === "BUYER_REVIEW") && (
                      <DealDelivery deal={deal} busy={busy} myRole={myRole} onDeliver={wf.markDeliveredAndStartReview} />
                    )}

                    {deal && (derivedState === "BUYER_REVIEW" || derivedState === "AUTO_RELEASE_DUE" || derivedState === "RELEASE_PENDING" || derivedState === "COMPLETED") && (
                      <DealReview
                        deal={deal}
                        busy={busy}
                        myRole={myRole}
                        reviewRemaining={wf.reviewRemaining}
                        onRelease={wf.release}
                        onAutoRelease={wf.triggerAutoRelease}
                      />
                    )}

                    {deal && (derivedState === "BUYER_REVIEW" || derivedState === "AUTO_RELEASE_DUE" || derivedState === "RELEASE_PENDING" || derivedState === "DISPUTED" || derivedState === "FUNDED" || derivedState === "ACTIVE" || derivedState === "DELIVERED") && (
                      <DealDispute deal={deal} busy={busy} myRole={myRole} onDispute={wf.disputeDeal} onAskMica={wf.askMica} />
                    )}
                  </>
                )}

                {busy && busyMessage && (
                  <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#6C5CE0]/[0.08] border border-[#6C5CE0]/25">
                    <Loader2 className="w-4 h-4 animate-spin text-[#A78BFA] shrink-0" />
                    <p className="text-[11px] text-[#E0DAFF]">{busyMessage}</p>
                  </div>
                )}

                {error && <ErrorBanner message={error} onClose={clearError} />}

                {deal?.escrow?.custodyMode === "seam" && (
                  <WarnBanner>
                    Seam mode: escrow contract not deployed yet. The full workflow, agreement, and
                    consent flow work end-to-end, but real on-chain funding / release is enabled once
                    the DealEscrowFactory is deployed (scripts/deploy-escrow.mjs) and
                    VITE_ESCROW_FACTORY_ADDRESS is set.
                  </WarnBanner>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06]">
            <p className="text-[9px] font-mono text-[#94A3B8]">
              {TIMELINE[Math.max(0, timelineIndex(derivedState))]?.label}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-bold bg-white/[0.04] border border-white/10 text-[#94A3B8] hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer"
            >
              <X className="w-3.5 h-3.5" /> Close
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
