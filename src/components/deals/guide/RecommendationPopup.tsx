import React, { useState } from "react";
import { motion } from "motion/react";
import { Edit3, Send, ShieldCheck, X } from "lucide-react";
import { useDealGuideContext } from "../../../deals/DealGuideContext";
import { fmtUsdc } from "../../../deals/types";
import { ActionButton, MicaBubble, inputCls } from "../dealUi";

export default function RecommendationPopup({
  onClose,
  onRequestChanges,
}: {
  onClose: () => void;
  onRequestChanges: () => void;
}) {
  const guide = useDealGuideContext();
  const { deal, busy, myRole, regenerateAnalysis, acceptProtection, askMica } = guide;
  const ai = deal?.ai;

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const handleAsk = async () => {
    if (!question.trim() || asking) return;
    setAsking(true);
    try {
      setAnswer(await askMica(question.trim()));
    } finally {
      setAsking(false);
    }
  };

  const dot = (c: string) => <span className={`inline-block w-1.5 h-1.5 rounded-full ${c} shrink-0 mt-1`} />;

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
            <h2 className="text-[14px] font-black text-white tracking-wide">Mica&apos;s protection plan</h2>
            <p className="text-[10px] text-[#94A3B8]">
              Advisory only — Mica never touches your funds.
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
          {ai ? (
            <div className="space-y-3">
              <MicaBubble
                text={`${ai.recommendation}\n\nMechanism: ${ai.mechanism} · ${fmtUsdc(deal?.terms?.amount)} USDC`}
              />

              {ai.source === "local_fallback" && (
                <p className="text-[9px] font-mono text-amber-300/70">
                  Source: local fallback (Mica AI unreachable).
                </p>
              )}

              {ai.protection.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[9px] font-mono text-emerald-300/80 uppercase tracking-wider font-bold">
                    Protection
                  </p>
                  {ai.protection.map((p, i) => (
                    <div key={i} className="flex gap-2 text-[11px] text-[#D7F5E5] leading-relaxed">
                      {dot("bg-emerald-400/70")} <span>{p}</span>
                    </div>
                  ))}
                </div>
              )}

              {ai.milestones.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[9px] font-mono text-sky-300/80 uppercase tracking-wider font-bold">
                    Milestones
                  </p>
                  {ai.milestones.map((m, i) => (
                    <div key={i} className="flex gap-2 text-[11px] text-[#DCEBFF] leading-relaxed">
                      {dot("bg-sky-400/70")} <span>{m}</span>
                    </div>
                  ))}
                </div>
              )}

              {ai.risks.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[9px] font-mono text-amber-300/80 uppercase tracking-wider font-bold">
                    Risks
                  </p>
                  {ai.risks.map((r, i) => (
                    <div key={i} className="flex gap-2 text-[11px] text-amber-100/90 leading-relaxed">
                      {dot("bg-amber-400/70")} <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}

              {ai.collateralNote && (
                <div className="p-2.5 rounded-xl bg-emerald-500/[0.05] border border-emerald-500/15 text-[11px] text-emerald-200 leading-relaxed">
                  {ai.collateralNote}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <ActionButton
                  onClick={acceptProtection}
                  disabled={!!busy}
                  busy={busy === "generateAgreement" || busy === "accept"}
                  variant="success"
                  className="flex-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Accept Deal Protection
                </ActionButton>
                <ActionButton onClick={onRequestChanges} disabled={!!busy} variant="ghost">
                  <Edit3 className="w-3.5 h-3.5" />
                  Request Changes
                </ActionButton>
              </div>

              <div className="space-y-2 pt-1 border-t border-white/[0.05]">
                <p className="text-[9px] font-mono text-[#6C5CE0] uppercase tracking-wider font-bold">
                  Ask Mica about this deal
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAsk();
                    }}
                    placeholder={`Ask as ${myRole}… e.g. what happens if the seller never delivers?`}
                    className={`${inputCls} text-xs`}
                  />
                  <ActionButton onClick={handleAsk} busy={asking}>
                    {asking ? undefined : <Send className="w-3.5 h-3.5" />}
                    {asking ? "…" : "Ask"}
                  </ActionButton>
                </div>
                {answer && <MicaBubble text={answer} />}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-[#94A3B8]">
              Mica hasn&apos;t analyzed this deal yet.
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
