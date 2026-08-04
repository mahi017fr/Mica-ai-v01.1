import React from "react";
import { FileText, Lock, Check, PenLine } from "lucide-react";
import { DealDoc, DealRole, fmtUsdc } from "../../deals/types";
import { roleConsented } from "../../deals/dealStatusMachine";
import { ActionButton, MicaBubble, Section, RoleTag, WalletChip } from "./dealUi";

export function DealAgreement({
  deal,
  busy,
  onGenerate,
  myRole,
}: {
  deal: DealDoc | null;
  busy: boolean;
  onGenerate: () => void;
  myRole: DealRole | null;
}) {
  const agreement = deal?.agreement;
  const terms = deal?.terms;

  if (!agreement || !terms) {
    return (
      <Section title="3 · Final Agreement" subtitle="Mica drafts a human-readable agreement from the deal terms.">
        <MicaBubble text="Once you're happy with the deal and my recommendation, I'll draft the final agreement for both of you to review." />
        <ActionButton onClick={onGenerate} disabled={busy || !deal?.ai} busy={busy}>
          <FileText className="w-3.5 h-3.5" />
          Draft Agreement
        </ActionButton>
      </Section>
    );
  }

  const locked = agreement.state === "locked" || !!agreement.lockedAt;

  return (
    <Section
      title={`3 · Final Agreement · v${agreement.version}`}
      subtitle="Every version is an immutable snapshot — it can never be silently changed."
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-bold text-white">{agreement.title}</p>
        {locked ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[9px] font-mono font-bold text-emerald-300 uppercase tracking-wider">
            <Lock className="w-3 h-3" /> Locked
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[9px] font-mono font-bold text-amber-300 uppercase tracking-wider">
            Awaiting consent
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="p-3 rounded-xl bg-[#0A0F1E]/70 border border-white/[0.06]">
          <p className="text-[9px] font-mono text-[#94A3B8] uppercase">Price</p>
          <p className="text-[12px] font-mono font-bold text-white mt-0.5">{fmtUsdc(terms.amount)} USDC</p>
        </div>
        <div className="p-3 rounded-xl bg-[#0A0F1E]/70 border border-white/[0.06]">
          <p className="text-[9px] font-mono text-[#94A3B8] uppercase">Collateral</p>
          <p className="text-[12px] font-mono font-bold text-white mt-0.5">{terms.collateralPercent}%</p>
        </div>
        <div className="p-3 rounded-xl bg-[#0A0F1E]/70 border border-white/[0.06]">
          <p className="text-[9px] font-mono text-[#94A3B8] uppercase">Network</p>
          <p className="text-[12px] font-mono font-bold text-white mt-0.5">Arc · USDC</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.05] bg-[#0A0F1E]/35 p-3.5 space-y-2">
        <p className="text-[9px] font-mono text-[#6C5CE0] uppercase tracking-wider font-bold">Clauses</p>
        {agreement.clauses.map((c, i) => (
          <div key={i} className="flex gap-2 text-[11px] text-[#F8FAFC] leading-relaxed">
            <span className="text-[#6C5CE0] font-mono shrink-0">{i + 1}.</span>
            <span>{c}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[9px] font-mono text-[#94A3B8]">
          fingerprint: <span className="text-[#6C5CE0]">{agreement.contentHash.slice(0, 14)}…</span>
        </p>
        {!locked && (
          <ActionButton onClick={onGenerate} disabled={busy} busy={busy} variant="ghost">
            <PenLine className="w-3.5 h-3.5" />
            Re-draft
          </ActionButton>
        )}
      </div>
    </Section>
  );
}

export function DealConsent({
  deal,
  busy,
  onAccept,
  myRole,
}: {
  deal: DealDoc | null;
  busy: boolean;
  onAccept: () => void;
  myRole: DealRole | null;
}) {
  const agreement = deal?.agreement;
  if (!agreement) return null;
  const consent = deal?.consent;

  const buyerDone = roleConsented("buyer", deal);
  const sellerDone = roleConsented("seller", deal);
  const myDone = myRole ? roleConsented(myRole, deal) : false;
  const locked = agreement.state === "locked" || !!agreement.lockedAt;

  const Row = ({ role, name, done, at }: { role: DealRole; name: string; done: boolean; at?: string }) => (
    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#12172A]/40 border border-white/[0.04]">
      <div className="flex items-center gap-2">
        <RoleTag role={role} />
        <span className="text-[11px] text-white font-semibold">{name}</span>
      </div>
      {done ? (
        <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-emerald-300 uppercase">
          <Check className="w-3 h-3" /> Accepted
        </span>
      ) : (
        <span className="text-[9px] font-mono text-[#94A3B8] uppercase">Pending</span>
      )}
    </div>
  );

  return (
    <Section
      title="4 · Dual Consent"
      subtitle="The agreement locks permanently once both parties accept."
    >
      <Row role="buyer" name="Buyer" done={buyerDone} at={consent?.buyerAcceptedAt} />
      <Row role="seller" name="Seller" done={sellerDone} at={consent?.sellerAcceptedAt} />

      {!locked && myRole && !myDone && (
        <ActionButton onClick={onAccept} disabled={busy} busy={busy} variant="success" className="w-full">
          <Check className="w-3.5 h-3.5" />
          I Accept the Agreement
        </ActionButton>
      )}
      {!locked && myRole && myDone && (
        <p className="text-[11px] text-emerald-300 font-medium">
          You accepted v{agreement.version}. Waiting for the other party…
        </p>
      )}
      {locked && (
        <p className="text-[11px] text-emerald-300 font-medium flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" /> Agreement locked and immutable. Escrow funding can begin.
        </p>
      )}
      <p className="text-[9px] text-[#94A3B8]">
        Your wallet:{" "}
        <WalletChip address={myRole === "seller" ? deal?.sellerWallet : deal?.buyerWallet} />
      </p>
    </Section>
  );
}
