import React, { useState } from "react";
import { RefreshCw, FileText, Send } from "lucide-react";
import { DealDoc, DealRole, fmtUsdc } from "../../deals/types";
import { ActionButton, MicaBubble, Section, inputCls } from "./dealUi";

interface Props {
  deal: DealDoc | null;
  busy: boolean;
  onRegenerate: () => void;
  onContinue: () => void;
  onAskMica: (question: string) => Promise<string>;
  myRole: DealRole | null;
}

export default function DealAIRecommendation({
  deal,
  busy,
  onRegenerate,
  onContinue,
  onAskMica,
  myRole,
}: Props) {
  const ai = deal?.ai;
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const handleAsk = async () => {
    if (!question.trim() || asking) return;
    setAsking(true);
    try {
      const a = await onAskMica(question.trim());
      setAnswer(a);
    } finally {
      setAsking(false);
    }
  };

  const dot = (c: string) => (
    <span className={`inline-block w-1.5 h-1.5 rounded-full ${c} shrink-0 mt-1`} />
  );

  return (
    <Section
      title="2 · Mica AI Recommendation"
      subtitle="Advisory only — Mica never touches your funds."
    >
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
            <ActionButton onClick={onRegenerate} disabled={busy} busy={busy} variant="ghost">
              <RefreshCw className="w-3.5 h-3.5" />
              Re-analyze
            </ActionButton>
            <ActionButton onClick={onContinue} disabled={busy}>
              <FileText className="w-3.5 h-3.5" />
              Draft Final Agreement
            </ActionButton>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-[#94A3B8]">
          Define the deal above and Mica will recommend the safest escrow structure.
        </p>
      )}

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
    </Section>
  );
}
