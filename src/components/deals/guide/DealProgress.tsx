import React from "react";
import { Check, Coins, FileText, Handshake, PackageCheck, ShieldCheck, Timer } from "lucide-react";
import { DealDoc, DealStatus } from "../../../deals/types";
import { bothFunded, consentComplete, isSettled } from "../../../deals/dealStatusMachine";

interface Props {
  status: DealStatus | null;
  deal: DealDoc | null;
  bothReady: boolean;
  termsBothConfirmed: boolean;
}

const ICONS = [Handshake, FileText, ShieldCheck, ShieldCheck, Coins, PackageCheck, Timer];
const LABELS = ["Ready", "Deal Info", "Protection", "Consent", "Funding", "Delivery", "Review"];

export default function DealProgress({ status, deal, bothReady, termsBothConfirmed }: Props) {
  const state = deal?.state;

  const done = [
    bothReady,
    !!(deal?.terms && termsBothConfirmed),
    !!deal?.ai,
    consentComplete(deal),
    bothFunded(deal),
    !!deal?.delivery?.markedBy,
    isSettled(deal) || state === "BUYER_REVIEW" || state === "AUTO_RELEASE_DUE" || state === "RELEASE_PENDING",
  ];

  const currentIdx = done.findIndex((d) => !d);
  const allDone = currentIdx === -1;

  return (
    <div className="px-3 pb-3">
      <div className="rounded-2xl bg-[#12172A]/50 border border-white/[0.06] p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] text-[#6C5CE0] font-extrabold uppercase tracking-wider">
            Deal Progress
          </h4>
          <span className="text-[8px] font-mono text-[#94A3B8]">
            {allDone ? "Complete" : `${Math.min(currentIdx + 1, 7)} / 7`}
          </span>
        </div>

        <div className="space-y-0.5">
          {LABELS.map((label, i) => {
            const Icon = ICONS[i];
            const isDone = done[i];
            const isActive = !allDone && i === currentIdx;
            return (
              <div
                key={label}
                className={`flex items-center gap-2 px-1.5 py-1 rounded-lg transition-all ${
                  isActive ? "bg-[#6C5CE0]/[0.12]" : ""
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border ${
                    isDone
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : isActive
                      ? "bg-[#6C5CE0] border-[#8B5CF6] text-white shadow-[0_0_8px_rgba(108,92,224,0.5)]"
                      : "bg-[#12172A] border-white/[0.08] text-[#94A3B8] opacity-40"
                  }`}
                >
                  {isDone ? <Check className="w-2.5 h-2.5" /> : <Icon className="w-2.5 h-2.5" />}
                </span>
                <span
                  className={`text-[9px] font-mono font-bold uppercase tracking-wider ${
                    isActive ? "text-white" : isDone ? "text-emerald-300/90" : "text-[#94A3B8]"
                  }`}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-[8px] font-mono text-[#94A3B8] pt-0.5">
          {status ? `Status: ${status}` : "Awaiting roles"}
        </p>
      </div>
    </div>
  );
}
