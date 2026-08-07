import React, { useState } from "react";
import { Scale, PauseCircle, Send } from "lucide-react";
import { DealDoc, DealRole } from "../../deals/types";
import { ActionButton, MicaBubble, Section, RoleTag, WarnBanner, inputCls } from "./dealUi";

const DISPUTABLE = ["FUNDING", "FUNDED", "ACTIVE", "DELIVERED", "BUYER_REVIEW", "AUTO_RELEASE_DUE", "RELEASE_PENDING"];

export default function DealDispute({
  deal,
  busy,
  myRole,
  onDispute,
  onAskMica,
}: {
  deal: DealDoc | null;
  busy: string | null;
  myRole: DealRole | null;
  onDispute: (reason: string) => void;
  onAskMica: (q: string) => Promise<string>;
}) {
  const disputed = deal?.escrow?.dispute;
  const state = deal?.state || "";
  const canOpen = !disputed && DISPUTABLE.includes(state) && !!myRole;

  const bothFunded = deal?.escrow?.funding?.buyer?.status === "confirmed" && deal?.escrow?.funding?.seller?.status === "confirmed";
  if (!disputed && (bothFunded || state === "BUYER_REVIEW" || state === "AUTO_RELEASE_DUE" || state === "RELEASE_PENDING")) return null;

  const [reason, setReason] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  if (!disputed && !canOpen) return null;

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

  return (
    <Section
      title={disputed ? "Dispute Active" : "Dispute"}
      subtitle={
        disputed
          ? "The auto-release clock is PAUSED and funds are frozen."
          : "Pause the escrow and flag a problem with the deal."
      }
    >
      {disputed ? (
        <div className="space-y-3">
          <div className="p-3 rounded-xl bg-red-500/[0.06] border border-red-500/20 space-y-1.5">
            <div className="flex items-center gap-2">
              <RoleTag role={disputed.by} />
              <span className="text-[11px] text-white font-semibold">opened this dispute</span>
            </div>
            <p className="text-[11px] text-red-200 leading-relaxed">“{disputed.reason}”</p>
            <p className="text-[9px] font-mono text-[#94A3B8]">
              {disputed.at ? new Date(disputed.at).toLocaleString() : ""}
              {disputed.txHash ? ` · tx ${disputed.txHash.slice(0, 12)}…` : ""}
            </p>
          </div>

          <WarnBanner>
            Disputes are advisory-assisted but resolved off-chain. The escrow contract has no
            arbiter configured, so funds stay locked until both parties agree on a manual
            resolution. No one can move the funds unilaterally.
          </WarnBanner>

          <div className="space-y-2">
            <p className="text-[9px] font-mono text-[#6C5CE0] uppercase tracking-wider font-bold">
              Ask Mica for guidance (advisory)
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAsk();
                }}
                placeholder="e.g. what are my options in this dispute?"
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
        <div className="space-y-2.5">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe what went wrong. This is recorded and shown to the other party…"
            className={`${inputCls} resize-none h-20 text-xs`}
          />
          <ActionButton
            onClick={() => onDispute(reason.trim() || "Dispute opened by participant")}
            disabled={!!busy || !reason.trim()}
            busy={busy === "dispute"}
            variant="danger"
            className="w-full"
          >
            <PauseCircle className="w-3.5 h-3.5" />
            Pause Escrow & Open Dispute
          </ActionButton>
          <p className="text-[10px] text-[#94A3B8] flex items-center gap-1.5">
            <Scale className="w-3 h-3 text-red-400" />
            Opening a dispute immediately pauses the 24h auto-release clock.
          </p>
        </div>
      )}
    </Section>
  );
}
