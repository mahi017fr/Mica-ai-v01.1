import React, { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
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

      <div>
        <FieldLabel>Deal Type</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {DEAL_TYPE_SUGGESTIONS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setDealType(t)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                dealType === t
                  ? "bg-[#6C5CE0]/20 border-[#6C5CE0]/50 text-white"
                  : "bg-[#12172A] border-white/[0.08] text-[#94A3B8] hover:text-white hover:border-[#6C5CE0]/30"
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
          className={`${inputCls} mt-1.5 text-xs`}
        />
      </div>

      <div>
        <FieldLabel>Description</FieldLabel>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the deliverables, scope, and any deadlines…"
          className={`${inputCls} resize-none h-24 text-xs`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
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
            className={`${inputCls} font-mono font-bold`}
          />
        </div>
        <div>
          <FieldLabel>Mutual Collateral</FieldLabel>
          <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500/[0.05] border border-emerald-500/15 text-[11px] text-emerald-300 font-mono font-bold">
            100% of deal amount
          </div>
          <p className="text-[9px] text-[#94A3B8] mt-1">
            Both buyer and seller post the same collateral into the escrow.
          </p>
        </div>
      </div>

      {error && <p className="text-[11px] text-rose-400 font-medium">{error}</p>}

      <ActionButton onClick={handleSave} disabled={busy} busy={busy}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {busy ? "Mica is analyzing…" : deal?.terms ? "Re-analyze with Mica" : "Analyze with Mica"}
      </ActionButton>
    </Section>
  );
}
