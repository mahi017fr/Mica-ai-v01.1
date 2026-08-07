import React, { useMemo } from "react";
import { motion } from "motion/react";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { useDealGuideContext } from "../../../deals/DealGuideContext";
import DealAIRecommendation from "../DealAIRecommendation";
import { DealAgreement, DealConsent } from "../DealAgreement";
import DealFunding from "../DealFunding";
import DealDelivery from "../DealDelivery";
import DealReview from "../DealReview";
import DealDispute from "../DealDispute";
import { ErrorBanner, InfoBanner, Section, StatusBadge, WarnBanner } from "../dealUi";

const LOCKED_ONWARD = ["LOCKED", "AWAITING_FUNDING", "FUNDING", "FUNDED", "ACTIVE", "DELIVERED", "BUYER_REVIEW", "AUTO_RELEASE_DUE", "RELEASE_PENDING", "DISPUTED", "RESOLVED"];
const TERMINAL = ["CANCELLED", "EXPIRED", "COMPLETED", "RESOLVED"];

export default function DealPanelPopup({ onClose }: { onClose: () => void }) {
  const guide = useDealGuideContext();
  const { deal, derivedState, busy, busyMessage, error, clearError, myRole, reviewRemaining, wallet, regenerateAnalysis, generateAgreement, acceptAgreement, beginFunding, fundLeg, refundMyLeg, cancelDeal, continueToReview, markDeliveredAndStartReview, release, triggerAutoRelease, disputeDeal, askMica } = guide;

  const state = derivedState;
  const showFunding = ["LOCKED", "AWAITING_FUNDING", "FUNDING", "FUNDED", "ACTIVE", "DELIVERED"].includes(state || "");

  const termination = useMemo(() => {
    if (state === "CANCELLED")
      return { title: "Deal Cancelled", note: deal?.cancelNote || "This deal was cancelled before funding." };
    if (state === "EXPIRED")
      return { title: "Deal Expired", note: "This deal expired before completion." };
    if (state === "RESOLVED")
      return { title: "Dispute Resolved", note: deal?.result ? `Resolved via ${deal.result.method}.` : "This dispute was resolved." };
    return null;
  }, [state, deal]);

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
        className="relative w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden rounded-[28px] border border-[#29324B] bg-[#0A0F1E]/[0.98] font-sans shadow-[0_28px_100px_rgba(0,0,0,0.62)] backdrop-blur-xl"
      >
        <div className="flex items-start justify-between px-6 py-5 border-b border-white/[0.07] shrink-0 bg-gradient-to-b from-[#12172A]/65 to-transparent">
          <div className="flex items-center gap-3">
            <div>
              <span className="inline-block mb-1.5 text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#9B8AFB]">Arc escrow workspace</span>
              <h2 className="text-[18px] font-extrabold leading-tight text-[#F8FAFC] tracking-[-0.025em]">Live Deal Panel</h2>
              <p className="mt-1 text-[11px] text-[#8F9BB2]">
                {guide.buyerName || "Buyer"} ↔ {guide.sellerName || "Seller"} · Arc USDC Escrow
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {state && <StatusBadge status={state} />}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-[#94A3B8] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-4">
          {guide.loading && !deal ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-[#6C5CE0]" />
              <p className="text-[11px] font-mono text-[#94A3B8]">Loading deal…</p>
            </div>
          ) : (
            <>
              {deal && (
                <>
                  {state && !TERMINAL.includes(state) && (
                    <InfoBanner>
                      {state === "SETUP"
                        ? "Define the deal. Mica will analyze it and draft a dual-signed agreement held in an Arc USDC escrow."
                        : state === "BUYER_REVIEW" || state === "AUTO_RELEASE_DUE"
                        ? "The buyer has 24 hours to review the delivery. If no action is taken, the escrow auto-releases to the seller."
                        : state === "DISPUTED"
                        ? "Dispute active — the auto-release clock is paused and funds are frozen."
                        : state === "NEGOTIATING" || state === "AWAITING_ACCEPTANCE"
                        ? "Review Mica's protection plan, then both parties accept the final agreement."
                        : state === "FUNDED" || state === "ACTIVE" || state === "DELIVERED"
                        ? "Both deposits are secured. The seller delivers, then the buyer reviews within 24h."
                        : undefined}
                    </InfoBanner>
                  )}

                  {termination && (
                    <Section title="·" subtitle="This deal has ended.">
                      <div className="flex items-start gap-2">
                        {state === "CANCELLED" ? (
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

                  {deal.ai && (state === "NEGOTIATING" || state === "AWAITING_ACCEPTANCE") && !deal.agreement && (
                    <DealAIRecommendation
                      deal={deal}
                      busy={busy === "reanalyze"}
                      onRegenerate={regenerateAnalysis}
                      onContinue={generateAgreement}
                      onAskMica={askMica}
                      myRole={myRole}
                    />
                  )}

                  {deal && (state === "NEGOTIATING" || state === "AWAITING_ACCEPTANCE" || state === "LOCKED") && (
                    <DealAgreement deal={deal} busy={busy === "generateAgreement"} onGenerate={generateAgreement} myRole={myRole} />
                  )}

                  {deal && (state === "AWAITING_ACCEPTANCE" || state === "LOCKED" || state === "AWAITING_FUNDING") && (
                    <DealConsent deal={deal} busy={busy === "accept"} onAccept={acceptAgreement} myRole={myRole} />
                  )}

                  {deal && showFunding && (
                    <DealFunding
                      deal={deal}
                      busy={busy}
                      myRole={myRole}
                      onBeginFunding={beginFunding}
                      onFund={fundLeg}
                      onRefundMyLeg={refundMyLeg}
                      onCancel={cancelDeal}
                      onNext={continueToReview}
                      wallet={wallet}
                    />
                  )}

                  {deal && (state === "BUYER_REVIEW" || state === "AUTO_RELEASE_DUE" || state === "RELEASE_PENDING" || state === "COMPLETED") && (
                    <DealReview
                      deal={deal}
                      busy={busy}
                      myRole={myRole}
                      reviewRemaining={reviewRemaining}
                      onRelease={release}
                      onAutoRelease={triggerAutoRelease}
                      onReport={disputeDeal}
                    />
                  )}

                  {deal && (state === "BUYER_REVIEW" || state === "AUTO_RELEASE_DUE" || state === "RELEASE_PENDING" || state === "DISPUTED" || state === "FUNDED" || state === "ACTIVE" || state === "DELIVERED") && (
                    <DealDispute deal={deal} busy={busy} myRole={myRole} onDispute={disputeDeal} onAskMica={askMica} />
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
                  the DealEscrowFactory is deployed and VITE_ESCROW_FACTORY_ADDRESS is set.
                </WarnBanner>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end px-6 py-3.5 border-t border-white/[0.07] bg-[#0B1020]/95 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-bold bg-white/[0.04] border border-white/10 text-[#94A3B8] hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer"
          >
            <X className="w-3.5 h-3.5" /> Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
