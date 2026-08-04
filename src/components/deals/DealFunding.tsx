import React, { useEffect, useState } from "react";
import { Coins, Loader2, PlugZap, ShieldCheck, Wallet } from "lucide-react";
import { DealDoc, DealRole, fmtUsdc } from "../../deals/types";
import { canFund, isDisputed } from "../../deals/dealStatusMachine";
import {
  ArcBalanceStatus,
  ARC_NETWORK,
  fetchArcUsdcBalance,
} from "../../payments";
import type { ArcWalletSession } from "../../hooks/useArcWalletSession";
import { ActionButton, InfoBanner, Section, WarnBanner, WalletChip } from "./dealUi";

function useUsdcBalance(address: string | null | undefined, chainId: number | null) {
  const [state, setState] = useState<ArcBalanceStatus>({ status: "checking" });
  useEffect(() => {
    let alive = true;
    setState({ status: "checking" });
    if (!address) {
      setState({ status: "no_wallet" });
      return;
    }
    fetchArcUsdcBalance(address, chainId)
      .then((r) => {
        if (alive) setState(r);
      })
      .catch(() => alive && setState({ status: "error", message: "Balance check failed" }));
    return () => {
      alive = false;
    };
  }, [address, chainId]);
  return state;
}

interface Props {
  deal: DealDoc | null;
  busy: string | null;
  myRole: DealRole | null;
  onBeginFunding: () => void;
  onFund: (role: DealRole) => void;
  onRefundMyLeg: () => void;
  onCancel: (note: string) => void;
  onNext: () => void;
  wallet: {
    session: ArcWalletSession;
    primaryAddress: string | null;
    reconnect: () => Promise<void>;
    reconnecting: boolean;
  };
}

export default function DealFunding({
  deal,
  busy,
  myRole,
  onBeginFunding,
  onFund,
  onRefundMyLeg,
  onCancel,
  onNext,
  wallet,
}: Props) {
  const escrow = deal?.escrow;
  const escrowCreation = (deal as (DealDoc & { escrowCreation?: { claimedBy?: string } }) | null)?.escrowCreation;
  const terms = deal?.terms;
  const [cancelNote, setCancelNote] = useState("");

  const connectedAddress =
    wallet.session.status === "connected" ? wallet.session.connectedAddress : null;
  const balance = useUsdcBalance(connectedAddress || wallet.primaryAddress, wallet.session.status === "connected" ? wallet.session.chainId : null);

  const canCancel = ["SETUP", "AI_ANALYSIS", "NEGOTIATING", "AWAITING_ACCEPTANCE", "LOCKED", "AWAITING_FUNDING"].includes(deal?.state || "");
  const bothDepositsConfirmed =
    escrow?.funding?.buyer?.status === "confirmed" &&
    escrow?.funding?.seller?.status === "confirmed";

  const LegRow = ({ role, amount }: { role: DealRole; amount: number }) => {
    const leg = escrow?.funding?.[role];
    const status = leg?.status || "pending";
    const badge =
      status === "confirmed"
        ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
        : status === "submitted"
        ? "bg-amber-500/10 text-amber-300 border-amber-500/25"
        : status === "refunded"
        ? "bg-slate-500/10 text-slate-400 border-slate-400/20"
        : "bg-white/[0.04] text-[#94A3B8] border-white/[0.06]";
    const isMyLeg = myRole === role;
    return (
      <div className="p-3 rounded-xl bg-[#12172A]/40 border border-white/[0.04] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">
            {role === "buyer" ? "🛒 Buyer · Price" : "🛍 Seller · Collateral"}
          </span>
          <span className={`px-2 py-0.5 rounded-md border font-mono text-[9px] font-bold uppercase ${badge}`}>
            {status}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-mono font-black text-white">{fmtUsdc(amount)} USDC</p>
          <WalletChip address={role === "buyer" ? deal?.buyerWallet : deal?.sellerWallet} />
        </div>
        {leg?.txHash && (
          <p className="text-[9px] font-mono text-[#94A3B8] break-all">tx {leg.txHash}</p>
        )}
        {isMyLeg && canFund(role, deal) && (
          <ActionButton
            onClick={() => onFund(role)}
            disabled={!!busy}
            busy={busy === "fund_" + role}
            variant="success"
            className="w-full"
          >
            <Coins className="w-3.5 h-3.5" />
            Fund {fmtUsdc(amount)} USDC
          </ActionButton>
        )}
        {isMyLeg && leg?.status === "confirmed" && deal?.state !== "FUNDED" && deal?.state !== "ACTIVE" && !escrow?.reviewStartedAt && !isDisputed(deal) && (
          <ActionButton onClick={onRefundMyLeg} disabled={!!busy} busy={busy === "refundLeg"} variant="ghost" className="w-full">
            REFUND YOUR FUND
          </ActionButton>
        )}
      </div>
    );
  };

  return (
    <Section
      title="5 · Escrow Funding"
      subtitle="Real USDC is deposited into the deal escrow from each party's verified wallet."
    >
      {escrow?.custodyMode === "seam" ? (
        <WarnBanner>
          The escrow contract is not deployed yet (scripts/deploy-escrow.mjs). The workflow and
          state layer are ready, but on-chain funding, release, and auto-release will not be
          executable until the DealEscrowFactory is live.
        </WarnBanner>
      ) : escrow?.escrowAddress ? (
        <InfoBanner>
          Escrow contract: <span className="font-mono">{escrow.escrowAddress}</span>
          {escrow.factoryTxHash ? ` · created tx ${escrow.factoryTxHash.slice(0, 12)}…` : ""}
        </InfoBanner>
      ) : (
        <InfoBanner>
          No escrow yet. Once both parties accept, create the on-chain escrow to begin funding.
        </InfoBanner>
      )}

      {!escrow && terms && (
        <ActionButton onClick={onBeginFunding} disabled={!!busy || !!escrowCreation?.claimedBy} busy={busy === "beginFunding"}>
          <ShieldCheck className="w-3.5 h-3.5" />
          {escrowCreation?.claimedBy ? "Escrow Creation In Progress" : "Create Escrow Contract"}
        </ActionButton>
      )}

      {escrow && terms && (
        <div className="grid gap-2.5">
          <LegRow role="buyer" amount={terms.amount} />
          <LegRow role="seller" amount={(terms.amount * terms.collateralPercent) / 100} />
        </div>
      )}

      {bothDepositsConfirmed && myRole === "seller" && !escrow?.reviewStartedAt && (
        <ActionButton
          onClick={onNext}
          disabled={!!busy}
          busy={busy === "continueToReview"}
          variant="success"
          className="w-full"
        >
          NEXT
        </ActionButton>
      )}

      {bothDepositsConfirmed && myRole === "buyer" && !escrow?.reviewStartedAt && (
        <InfoBanner>
          Both payments are complete. Waiting for the seller to continue and start the 24-hour buyer review.
        </InfoBanner>
      )}

      {escrow && escrow.custodyMode === "contract" && (
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-black/30 border border-white/[0.05]">
          <span className="text-[10px] font-mono text-[#94A3B8]">Your USDC balance</span>
          {balance.status === "success" ? (
            <span className="text-[13px] font-mono font-black text-emerald-300">{fmtUsdc(balance.balance)} USDC</span>
          ) : balance.status === "checking" ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#6C5CE0]" />
          ) : (
            <span className="text-[10px] font-mono text-[#94A3B8]">unavailable</span>
          )}
        </div>
      )}

      {wallet.session.status === "disconnected" && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/[0.07] border border-amber-500/20">
          <PlugZap className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="flex-1 text-[11px] text-amber-100">Reconnect your wallet to sign escrow transactions.</p>
          <ActionButton onClick={wallet.reconnect} disabled={wallet.reconnecting} variant="ghost">
            {wallet.reconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
            {wallet.reconnecting ? "…" : "Reconnect"}
          </ActionButton>
        </div>
      )}

      {canCancel && (
        <div className="flex items-end gap-2 pt-1">
          <input
            type="text"
            value={cancelNote}
            onChange={(e) => setCancelNote(e.target.value)}
            placeholder="Optional cancel reason…"
            className="flex-1 bg-[#12172A] border border-white/[0.08] rounded-xl px-3 py-2 text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500/50 transition-all"
          />
          <ActionButton
            onClick={() => onCancel(cancelNote.trim())}
            disabled={!!busy}
            busy={busy === "cancel"}
            variant="danger"
          >
            Cancel Deal
          </ActionButton>
        </div>
      )}

      {ARC_NETWORK && (
        <p className="text-[9px] text-[#94A3B8]">
          Network: Arc ({ARC_NETWORK.chainId}) · Asset: Circle USDC
        </p>
      )}
    </Section>
  );
}
