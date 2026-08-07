import React, { useState } from "react";
import { Timer, CheckCircle2, Rocket, ShieldCheck, Flag } from "lucide-react";
import { DealDoc, DealRole } from "../../deals/types";
import { ActionButton, Section, WarnBanner, formatMs } from "./dealUi";

export default function DealReview({
  deal,
  busy,
  myRole,
  reviewRemaining,
  onRelease,
  onAutoRelease,
  onReport,
}: {
  deal: DealDoc | null;
  busy: string | null;
  myRole: DealRole | null;
  reviewRemaining: number;
  onRelease: () => void;
  onAutoRelease: () => void;
  onReport: (reason: string) => void;
}) {
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const hasReviewDeadline = !!deal?.escrow?.reviewDeadlineAt;
  const state = hasReviewDeadline && deal?.state !== "COMPLETED" && deal?.state !== "DISPUTED"
    ? (reviewRemaining <= 0 ? "AUTO_RELEASE_DUE" : "BUYER_REVIEW")
    : deal?.state;
  const inReview =
    state === "BUYER_REVIEW" || state === "AUTO_RELEASE_DUE" || state === "RELEASE_PENDING";
  const completed = state === "COMPLETED";
  if (!inReview && !completed) return null;

  if (completed) {
    return (
      <Section title="7 · Settlement" subtitle="The escrow settled.">
        <div className="flex items-center gap-2 text-emerald-300">
          <CheckCircle2 className="w-4 h-4" />
          <p className="text-[12px] font-bold">
            Deal completed — {deal?.escrow?.releaseMethod === "auto_release" ? "auto-released to the seller" : "released by the buyer"}.
          </p>
        </div>
        {deal?.escrow?.releasedAt && (
          <p className="text-[10px] font-mono text-[#94A3B8]">
            {deal.escrow.releaseTxHash ? `tx ${deal.escrow.releaseTxHash}` : ""}
          </p>
        )}
      </Section>
    );
  }

  const elapsed = state === "AUTO_RELEASE_DUE" || reviewRemaining <= 0;

  return (
    <Section
      title="7 · 24-HOUR REVIEW"
      subtitle="Approve the delivery, or dispute before the window ends."
    >
      <div className="grid gap-1.5 text-[11px] text-emerald-300">
        <p className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5" /> Escrow fully funded</p>
        <p className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" /> Deal moved to review</p>
        <p className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" /> Funds locked in escrow</p>
      </div>
      <div className="flex items-center gap-3 p-3 rounded-xl bg-black/30 border border-white/[0.05]">
        <Timer className="w-5 h-5 text-[#A78BFA]" />
        <div>
          <p className="text-[9px] font-mono uppercase tracking-wider text-[#94A3B8]">
            {elapsed ? "Review window elapsed" : "Time remaining"}
          </p>
          <p className={`font-mono font-black ${elapsed ? "text-amber-300 text-lg" : "text-white text-lg"}`}>
            {elapsed ? "Auto-release due" : formatMs(reviewRemaining)}
          </p>
        </div>
      </div>

      {state === "AUTO_RELEASE_DUE" && (
        <WarnBanner>
          The buyer did not respond within 24 hours. The escrow can now be auto-released to the
          seller — anyone can trigger it, and the contract enforces that it cannot be triggered
          early.
        </WarnBanner>
      )}

      <div className="flex flex-wrap gap-2">
        {myRole === "buyer" && (<>
          <ActionButton onClick={onRelease} disabled={!!busy} busy={busy === "release"} variant="success">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Release
          </ActionButton>
          <ActionButton onClick={() => setShowReport((v) => !v)} disabled={!!busy} variant="danger">
            <Flag className="w-3.5 h-3.5" /> Report
          </ActionButton>
        </>)}
        {elapsed && (
          <ActionButton onClick={onAutoRelease} disabled={!!busy} busy={busy === "autoRelease"}>
            <Rocket className="w-3.5 h-3.5" />
            Execute Auto-Release
          </ActionButton>
        )}
      </div>

      {myRole === "buyer" && showReport && (
        <div className="space-y-2">
          <textarea value={reportReason} onChange={(e) => setReportReason(e.target.value)} placeholder="Describe the problem…" className="w-full h-20 resize-none rounded-xl bg-[#12172A] border border-white/10 px-3 py-2 text-xs text-white" />
          <ActionButton onClick={() => onReport(reportReason.trim())} disabled={!!busy || !reportReason.trim()} busy={busy === "dispute"} variant="danger" className="w-full">Submit Report</ActionButton>
        </div>
      )}

      {myRole === "seller" && !elapsed && (
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <p className="text-[11px] font-bold text-white">WAITING FOR BUYER RELEASE</p>
          <p className="text-[10px] text-[#94A3B8] mt-1">The buyer can release the funds during the review period. If no dispute is opened before the deadline, auto-release becomes available under the escrow contract.</p>
        </div>
      )}

      {myRole !== "buyer" && !elapsed && (
        <p className="text-[10px] text-[#94A3B8]">
          Waiting for the buyer to review. If the buyer does nothing for 24h, the escrow
          auto-releases to the seller.
        </p>
      )}
    </Section>
  );
}
