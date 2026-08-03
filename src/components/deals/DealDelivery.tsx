import React from "react";
import { PackageCheck, Clock, CheckCircle2 } from "lucide-react";
import { DealDoc, DealRole } from "../../deals/types";
import { ActionButton, InfoBanner, Section } from "./dealUi";

export default function DealDelivery({
  deal,
  busy,
  myRole,
  onDeliver,
}: {
  deal: DealDoc | null;
  busy: string | null;
  myRole: DealRole | null;
  onDeliver: () => void;
}) {
  const state = deal?.state;
  const show =
    state === "FUNDED" || state === "ACTIVE" || state === "DELIVERED" || state === "BUYER_REVIEW";

  if (!show) return null;

  const delivered = deal?.delivery?.markedBy === "seller";

  return (
    <Section title="6 · Delivery" subtitle="The seller confirms the work is complete.">
      {delivered ? (
        <InfoBanner>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            Delivered on {deal?.delivery?.at ? new Date(deal.delivery.at).toLocaleString() : "—"}. The
            24h buyer review window is running.
          </span>
        </InfoBanner>
      ) : myRole === "seller" ? (
        <div className="space-y-2">
          <ActionButton onClick={onDeliver} disabled={!!busy} busy={busy === "deliver"} variant="success" className="w-full">
            <PackageCheck className="w-3.5 h-3.5" />
            Mark Delivered & Start 24h Review
          </ActionButton>
          <p className="text-[10px] text-[#94A3B8] flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-[#6C5CE0]" />
            This signs an on-chain transaction that starts the buyer's 24-hour review window.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-[#94A3B8]">
          Waiting for the seller to mark the deal as delivered.
        </p>
      )}
    </Section>
  );
}
