import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Loader2, PanelRight, Sparkles } from "lucide-react";
import { useDealGuideContext } from "../../../deals/DealGuideContext";
import DealProgress from "./DealProgress";
import DealInfoPopup from "./DealInfoPopup";
import RecommendationPopup from "./RecommendationPopup";
import DealPanelPopup from "./DealPanelPopup";
import micaLogo from "../../../assets/images/micalogo.png";

const LOCKED_ONWARD = ["LOCKED", "AWAITING_FUNDING", "FUNDING", "FUNDED", "ACTIVE", "DELIVERED", "BUYER_REVIEW", "AUTO_RELEASE_DUE", "RELEASE_PENDING", "DISPUTED", "RESOLVED"];
const TERMINAL = ["CANCELLED", "EXPIRED", "COMPLETED", "RESOLVED"];

function AnalyzingPopup({ onClose }: { onClose: () => void }) {
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
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0B0F1E]/95 shadow-2xl shadow-black/50 backdrop-blur-xl p-6 flex flex-col items-center gap-3"
      >
        <img src={micaLogo} alt="Mica" className="w-10 h-10 rounded-2xl object-cover" />
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[#A78BFA]" />
          <p className="text-[13px] font-black text-white">Mica is analyzing your deal…</p>
        </div>
        <p className="text-[10px] text-[#94A3B8] text-center">
          Drafting a recommendation and the safest escrow structure for both parties.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] font-mono text-[#94A3B8] hover:text-white transition-colors cursor-pointer"
        >
          Close
        </button>
      </motion.div>
    </div>
  );
}

export function DealGuideSidebar({ onOpenPanel }: { onOpenPanel: () => void }) {
  const guide = useDealGuideContext();
  const { deal, derivedState, bothReady, termsBothConfirmed } = guide;
  const dealState = deal?.state;

  const canOpenPanel =
    !!deal?.ai || !!deal?.agreement || LOCKED_ONWARD.includes(dealState || "") || TERMINAL.includes(dealState || "");

  return (
    <>
      <DealProgress status={derivedState} deal={deal} bothReady={bothReady} termsBothConfirmed={termsBothConfirmed} />
      {canOpenPanel && (
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={onOpenPanel}
            className="w-full p-3 rounded-xl bg-gradient-to-br from-[#6C5CE0]/20 to-[#8B5CF6]/10 border border-[#6C5CE0]/30 text-left transition-all hover:border-[#8B5CF6]/50 hover:shadow-lg hover:shadow-[#6C5CE0]/10 cursor-pointer"
          >
            <p className="text-[11px] font-bold text-white flex items-center gap-1.5">
              <PanelRight className="w-3.5 h-3.5 text-[#A78BFA]" />
              Open Deal Panel
            </p>
            <p className="text-[9px] text-[#94A3B8] mt-1 leading-relaxed">
              Funding, delivery, review, and dispute controls for the live deal.
            </p>
          </button>
        </div>
      )}
    </>
  );
}

export default function DealGuidePanel() {
  const guide = useDealGuideContext();
  const { active, bothReady, deal, derivedState, termsBothConfirmed } = guide;

  const dealState = deal?.state;
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [manualPanel, setManualPanel] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const showInfo =
    active && !!deal && bothReady && (requestingChanges || (dealState === "SETUP" && !termsBothConfirmed));
  const showAnalyzing = active && !!deal && dealState === "AI_ANALYSIS";
  const showRecommendation =
    active && !!deal && !!deal.ai && !requestingChanges && !deal.agreement &&
    (derivedState === "NEGOTIATING" || derivedState === "AWAITING_ACCEPTANCE");
  const showPanel =
    active && !!deal && !requestingChanges &&
    (!!deal.agreement || LOCKED_ONWARD.includes(dealState || "") || TERMINAL.includes(dealState || ""));

  let currentPopup: "info" | "analyzing" | "recommendation" | "panel" | null = null;
  if (showInfo) currentPopup = "info";
  else if (showAnalyzing) currentPopup = "analyzing";
  else if (showRecommendation) currentPopup = "recommendation";
  else if (showPanel) currentPopup = "panel";

  useEffect(() => {
    setDismissed(null);
    setManualPanel(false);
  }, [currentPopup]);

  const popup = manualPanel ? "panel" : currentPopup && dismissed !== currentPopup ? currentPopup : null;

  const closePopup = () => {
    setManualPanel(false);
    if (currentPopup) setDismissed(currentPopup);
  };

  return (
    <>
      <DealGuideSidebar onOpenPanel={() => setManualPanel(true)} />
      {popup === "info" && (
        <DealInfoPopup
          onClose={() => {
            setRequestingChanges(false);
            closePopup();
          }}
        />
      )}
      {popup === "analyzing" && <AnalyzingPopup onClose={closePopup} />}
      {popup === "recommendation" && (
        <RecommendationPopup onClose={closePopup} onRequestChanges={() => setRequestingChanges(true)} />
      )}
      {popup === "panel" && <DealPanelPopup onClose={closePopup} />}

      {currentPopup && dismissed === currentPopup && !manualPanel && (
        <button
          type="button"
          onClick={() => {
            setDismissed(null);
            setManualPanel(false);
          }}
          className="fixed bottom-24 right-4 z-[55] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold bg-[#6C5CE0] text-white shadow-lg shadow-[#6C5CE0]/30 hover:bg-[#5B4BD0] transition-all cursor-pointer"
        >
          <ArrowRight className="w-3 h-3" /> Resume deal
        </button>
      )}
    </>
  );
}
