import React from "react";
import { DealStatus } from "../../deals/types";
import { TIMELINE, timelineIndex } from "../../deals/dealStatusMachine";

export default function DealTimeline({ status }: { status: DealStatus | null }) {
  const idx = timelineIndex(status);
  return (
    <div className="flex items-start gap-1.5 overflow-x-auto custom-scrollbar pb-1">
      {TIMELINE.map((t, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={t.status} className="flex items-center gap-1.5 shrink-0">
            <div className="flex flex-col items-center gap-1">
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] border transition-all ${
                  active
                    ? "bg-[#6C5CE0] border-[#8B5CF6] shadow-[0_0_12px_rgba(108,92,224,0.5)]"
                    : done
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                    : "bg-[#12172A] border-white/[0.08] opacity-40"
                }`}
              >
                {done ? "✓" : t.icon}
              </span>
              <span
                className={`text-[8px] font-mono whitespace-nowrap ${
                  active ? "text-white font-bold" : "text-[#94A3B8]"
                }`}
              >
                {t.label}
              </span>
            </div>
            {i < TIMELINE.length - 1 && (
              <div className={`w-5 h-px mt-3 ${i < idx ? "bg-emerald-500/40" : "bg-white/10"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
