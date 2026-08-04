import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { DealDoc, DealTerms } from "../../deals/types";
import { DEAL_TYPE_SUGGESTIONS } from "../../deals/micaDealService";
import { ActionButton, FieldLabel, Section, WarnBanner, inputCls } from "./dealUi";

const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;

interface Props {
  deal: DealDoc | null;
  busy: boolean;
  onSave: (terms: DealTerms) => void;
}

export default function DealSetup({ deal, busy, onSave }: Props) {
  const [dealType, setDealType] = useState(deal?.terms?.dealType || "");
  const [description, setDescription] = useState(deal?.terms?.description || "");
  const [amount, setAmount] = useState(deal?.terms?.amount ? String(deal.terms.amount) : "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (deal?.terms) {
      setDealType(deal.terms.dealType || "");
      setDescription(deal.terms.description || "");
      setAmount(deal.terms.amount ? String(deal.terms.amount) : "");
    }
  }, [deal?.terms?.dealType, deal?.terms?.description, deal?.terms?.amount]);

  const hasAgreement = !!deal?.agreement;

  const handleSave = () => {
    setError("");
    if (!dealType.trim()) {
      setError("Choose a deal type.");
      return;
    }
    if (!description.trim()) {
      setError("Describe what is being delivered.");
      return;
    }
    if (!AMOUNT_RE.test(amount.trim())) {
      setError("Amount must be a positive number (up to 6 decimals).");
      return;
    }
    const n = parseFloat(amount);
    if (!(n > 0)) {
      setError("Amount must be greater than 0.");
      return;
    }
    onSave({
      dealType: dealType.trim(),
      description: description.trim(),
      amount: n,
      currency: "USDC",
      network: "arc",
      asset: "circle_usdc",
      collateralPercent: 100,
    });
  };

  return (
    <Section
      title="1 · Define the Deal"
      subtitle="Both parties agree on what is being bought, sold, and delivered."
    >
      {hasAgreement && (
        <WarnBanner>
          Changing any financial term here will invalidate BOTH approvals and re-draft the
          agreement. Both parties must accept again.
        </WarnBanner>
      )}

      <div className="space-y-2">
        <FieldLabel>Deal Type</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {DEAL_TYPE_SUGGESTIONS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setDealType(t)}
              className={`px-3 py-2 rounded-xl text-[10px] font-semibold tracking-[-0.01em] border transition-all cursor-pointer ${
                dealType === t
                ? "bg-[#6C5CE0]/20 border-[#8B7CF6]/60 text-white shadow-sm shadow-[#6C5CE0]/20"
                  : "bg-[#12172A]/80 border-white/[0.09] text-[#94A3B8] hover:text-white hover:border-[#6C5CE0]/40"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={dealType}
          onChange={(e) => setDealType(e.target.value)}
          placeholder="e.g. Custom agreement…"
          className={`${inputCls} mt-1 text-xs !rounded-xl !border-white/[0.09] !bg-[#0D1324] !px-4 !py-3 focus:!border-[#7C6AEE]/60`}
        />
      </div>

      <div className="space-y-2">
        <FieldLabel>Description</FieldLabel>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the deliverables, scope, and any deadlines…"
          className={`${inputCls} resize-none h-28 text-xs !rounded-xl !border-white/[0.09] !bg-[#0D1324] !px-4 !py-3 !leading-relaxed focus:!border-[#7C6AEE]/60`}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <FieldLabel>Amount (USDC)</FieldLabel>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(",", ".");
              if (v === "" || /^\d*(\.\d{0,6})?$/.test(v)) {
                setAmount(v);
                setError("");
              }
            }}
            placeholder="0.00"
            className={`${inputCls} !rounded-xl !border-white/[0.09] !bg-[#0D1324] !px-4 !py-3 font-mono text-sm font-semibold focus:!border-[#7C6AEE]/60`}
          />
        </div>
        <div>
          <FieldLabel>Mutual Collateral</FieldLabel>
          <div className="px-4 py-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-400/20 text-[11px] text-emerald-300 font-semibold tracking-[-0.01em]">
            100% of deal amount
          </div>
          <p className="text-[9px] leading-relaxed text-[#7F8BA3] mt-1.5">
            Both buyer and seller post the same collateral into the escrow.
          </p>
        </div>
      </div>

      {error && <p className="text-[11px] text-rose-400 font-medium">{error}</p>}

      <ActionButton onClick={handleSave} disabled={busy} busy={busy}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        {busy ? "Processing…" : "NEXT"}
      </ActionButton>
    </Section>
  );
}
