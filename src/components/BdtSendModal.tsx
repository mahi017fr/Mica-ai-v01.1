import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Lock,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { fmtBdt, useAppCurrency } from "../context/CurrencyContext";
import { BD_PAYMENT_METHODS, type BdPaymentMethodId } from "../payments/bdt";
import type { BdTransfer } from "../payments/bdt";
import type { UserProfile } from "../types";
import { BdtApiError, checkBdRecipientPaymentProfile, createBdtTransfer } from "../api/bdt";

type Stage =
  | "check" // verifying the recipient has a payable number (backend)
  | "blocked" // recipient has no payment number — transfer cannot start
  | "form" // amount / note / method
  | "confirm" // review before submitting
  | "processing" // backend + bKash provider in flight
  | "success" // only reached on backend-verified SUCCESS
  | "failed"; // provider/validation error — never a fake success

interface BdtSendModalProps {
  open: boolean;
  senderProfile: UserProfile | null;
  recipient: UserProfile | null;
  chatId?: string | null;
  onClose: () => void;
  onSendSuccess: (amount: number) => void;
}

export default function BdtSendModal({
  open,
  senderProfile,
  recipient,
  chatId,
  onClose,
  onSendSuccess,
}: BdtSendModalProps) {
  const { symbol } = useAppCurrency();
  const [stage, setStage] = useState<Stage>("check");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<BdPaymentMethodId>("BKASH");
  const [recipientHasNumber, setRecipientHasNumber] = useState(false);
  const [blockedReason, setBlockedReason] = useState("");
  const [stepText, setStepText] = useState("");
  const [transfer, setTransfer] = useState<BdTransfer | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [errorCode, setErrorCode] = useState("");
  // Synchronous re-entry guard: React state updates are async, so two rapid
  // clicks on Confirm can both pass `stage === "confirm"` before the stage
  // lands on "processing". This ref drops the second call before it reaches
  // the payment endpoint.
  const submitInFlightRef = useRef(false);

  // Reset every time the modal opens, then ask the backend whether the
  // recipient has a payable number. The number itself is never exposed here.
  useEffect(() => {
    if (!open) return;
    submitInFlightRef.current = false;
    setStage("check");
    setAmount("");
    setNote("");
    setMethod("BKASH");
    setRecipientHasNumber(false);
    setBlockedReason("");
    setStepText("");
    setTransfer(null);
    setErrorMsg("");
    setErrorCode("");
    if (!recipient?.uid) {
      setBlockedReason("No recipient selected.");
      setStage("blocked");
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        const result = await checkBdRecipientPaymentProfile(recipient.uid);
        if (cancelled) return;
        setRecipientHasNumber(result.recipientHasPaymentNumber);
        if (result.recipientHasPaymentNumber) {
          setStage("form");
        } else {
          setBlockedReason(result.hint || "This user has not added a payment number to their account yet.");
          setStage("blocked");
        }
      } catch (err) {
        if (cancelled) return;
        setBlockedReason(
          err instanceof BdtApiError ? err.message : "Could not verify the recipient's payment profile."
        );
        setStage("blocked");
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [open, recipient]);

  const parsedAmount = useMemo(() => {
    const n = parseFloat(amount);
    return !Number.isNaN(n) && n > 0 ? n : null;
  }, [amount]);

  const amountError = useMemo(() => {
    if (!parsedAmount && amount.trim() !== "") return "Enter a valid amount";
    if (parsedAmount && parsedAmount > 10000000) return "Amount exceeds the ৳10,000,000 limit";
    return null;
  }, [parsedAmount, amount]);

  const canSubmit = !!parsedAmount && !amountError && !!recipient;

  const handleClose = () => {
    if (stage === "processing") return;
    setStage("check");
    onClose();
  };

  const handleSendClick = () => {
    if (!canSubmit) return;
    setStage("confirm");
  };

  const handleConfirm = async () => {
    if (!parsedAmount || !recipient) return;
    if (submitInFlightRef.current) return; // double-click re-entry guard
    submitInFlightRef.current = true;
    setStage("processing");
    setStepText("Submitting payment…");
    setErrorMsg("");
    setErrorCode("");
    try {
      const amountStr = Number.isInteger(parsedAmount)
        ? String(parsedAmount)
        : parsedAmount.toFixed(2);
      const result = await createBdtTransfer({
        recipientUid: recipient.uid,
        amount: amountStr,
        method,
        note: note.trim() ? note.trim() : undefined,
        chatId: chatId ?? null,
        onStep: setStepText,
      });
      setTransfer(result);
      // ONLY reached when the backend confirmed SUCCESS with the provider.
      setStage("success");
      onSendSuccess(parsedAmount);
    } catch (err) {
      if (err instanceof BdtApiError) {
        setErrorMsg(err.message);
        setErrorCode(err.code);
      } else {
        setErrorMsg("The payment could not be completed.");
        setErrorCode("TRANSFER_FAILED");
      }
      setStage("failed");
    }
  };

  const transferId = transfer?.transferId ?? "";

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="absolute inset-0 bg-[#0B0F17]/85 backdrop-blur-md"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="bg-[#0D111D]/95 border border-[#6C5CE0]/40 rounded-3xl w-full max-w-md p-6 shadow-2xl relative z-10 overflow-hidden backdrop-blur-xl"
          >
            {stage === "check" && (
              <div className="space-y-4">
                <div className="flex flex-col items-center justify-center gap-2.5 py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                  <span className="text-xs font-black font-mono text-emerald-400 tracking-widest uppercase animate-pulse">
                    Checking recipient…
                  </span>
                  <p className="text-[10px] text-[#94A3B8]">Verifying the payout profile with the payment server.</p>
                </div>
              </div>
            )}

            {stage === "blocked" && (
              <div className="space-y-4">
                <div className="flex flex-col items-center justify-center gap-2.5 py-6">
                  <Lock className="w-10 h-10 text-amber-400" />
                  <h3 className="text-[15px] font-black tracking-tight text-white text-center">
                    {recipient?.displayName || "This user"} can&apos;t receive money yet
                  </h3>
                  <p className="text-[12px] text-[#94A3B8] font-mono text-center max-w-xs">
                    {blockedReason}
                  </p>
                </div>
                <p className="flex items-start gap-1.5 text-[10px] text-amber-300/80 bg-amber-500/[0.06] border border-amber-500/10 rounded-xl px-3 py-2.5">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />
                  The recipient&apos;s payment number stays private. Ask them to add one in
                  Settings → Payment → Mobile Number.
                </p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500/90 to-emerald-500 text-white hover:brightness-110 text-xs font-black font-mono tracking-widest uppercase transition-all cursor-pointer"
                >
                  Done
                </button>
              </div>
            )}

            {stage === "form" && (
              <div className="space-y-4">
                <div className="flex items-start justify-between border-b border-white/5 pb-4 mb-1">
                  <div>
                    <h3 className="text-[17px] font-black tracking-tight text-[#F8FAFC] flex items-center gap-2">
                      <Banknote className="w-5 h-5 text-emerald-400" />
                      Send Money
                    </h3>
                    <p className="text-[10px] text-[#94A3B8] mt-0.5">
                      Bangladesh fiat transfer · bKash payout.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-2.5 py-1 rounded-lg bg-[#161A2B] hover:bg-[#1E2235] border border-white/[0.06] text-[#94A3B8] hover:text-white text-[9px] font-bold font-mono uppercase cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>

                {/* Recipient — the payment number is never shown here. */}
                <div className="flex items-center justify-between p-3 rounded-2xl bg-[#12172A]/60 border border-white/[0.06]">
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={recipient?.avatarUrl}
                      alt={recipient?.displayName || "Recipient"}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full bg-[#0B0F17] border border-white/[0.06] object-cover shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-black text-white truncate">{recipient?.displayName || "Recipient"}</p>
                      <p className="text-[10px] text-[#94A3B8] font-mono truncate">@{recipient?.username || "unknown"}</p>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-md border text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-300 border-emerald-500/25">
                      <ShieldCheck className="w-3 h-3" />
                      Payment number added
                    </span>
                    <span className="px-2 py-0.5 rounded-md border text-[9px] font-mono font-bold bg-[#6C5CE0]/10 text-[#A78BFA] border-[#6C5CE0]/25">
                      BDT
                    </span>
                  </div>
                </div>

                {/* Payment method selector — bKash active only. */}
                <div>
                  <label className="block text-[#94A3B8] text-[9px] font-extrabold uppercase tracking-widest mb-1.5 pl-0.5">
                    Payment Method
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {BD_PAYMENT_METHODS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        disabled={!m.active}
                        onClick={() => setMethod(m.id as BdPaymentMethodId)}
                        className={`rounded-xl px-2 py-2 border text-[9px] font-bold text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                          m.active
                            ? method === m.id
                              ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
                              : "bg-[#0B0F17]/60 border-white/10 text-[#94A3B8] hover:border-emerald-500/30 hover:text-white"
                            : "bg-[#0B0F17]/40 border-white/[0.04] text-[#6C5CE0] cursor-not-allowed"
                        }`}
                      >
                        <Smartphone className="w-4 h-4" />
                        <span>{m.label}</span>
                        <span className={`font-mono ${m.active ? "text-emerald-400/80" : "text-[#6C5CE0]"}`}>
                          {m.badge}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-[#94A3B8] text-[9px] font-extrabold uppercase tracking-widest mb-1.5 pl-0.5">
                    Amount · BDT
                  </label>
                  <div className="flex items-center gap-2 bg-[#0B0F17]/70 border border-white/[0.06] focus-within:border-[#6C5CE0]/50 rounded-xl px-3 py-3 transition-all">
                    <span className="text-xl font-black font-mono text-emerald-400">{symbol}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="0.00"
                      className="flex-1 bg-transparent text-2xl font-black font-mono text-white placeholder:text-slate-600 focus:outline-none tracking-tight"
                    />
                  </div>
                  {amountError && <p className="text-[10px] text-rose-400 mt-1 pl-0.5">{amountError}</p>}
                </div>

                {/* Note */}
                <div>
                  <label className="block text-[#94A3B8] text-[9px] font-extrabold uppercase tracking-widest mb-1.5 pl-0.5">
                    Note <span className="text-[#6C5CE0] normal-case">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Payment for freelance work"
                    className="w-full bg-[#0B0F17]/70 border border-white/[0.06] focus:border-[#6C5CE0]/50 rounded-xl px-3 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none transition-all"
                  />
                </div>

                {/* Summary */}
                <div className="space-y-2 bg-[#12172A]/40 border border-white/[0.05] rounded-2xl p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#94A3B8] font-mono">You Send</span>
                    <span className="text-[13px] font-black font-mono text-white">{parsedAmount ? fmtBdt(parsedAmount) : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#94A3B8] font-mono">Payment Method</span>
                    <span className="text-[10px] font-bold text-emerald-300 font-mono">bKash</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#94A3B8] font-mono">Transfer Fee</span>
                    <span className="text-[10px] font-bold text-[#94A3B8] font-mono">৳0</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSendClick}
                  disabled={!canSubmit}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500/90 to-emerald-500 text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-black font-mono tracking-widest uppercase flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  Send {parsedAmount ? fmtBdt(parsedAmount) : "Amount"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {stage === "confirm" && (
              <div className="space-y-4">
                <h3 className="text-[17px] font-black tracking-tight text-[#F8FAFC]">
                  Send {parsedAmount ? fmtBdt(parsedAmount) : "—"} to @{recipient?.username}?
                </h3>

                <div className="space-y-2 bg-[#12172A]/40 border border-white/[0.05] rounded-2xl p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#94A3B8] font-mono">Recipient</span>
                    <span className="text-[10px] font-bold text-white font-mono">@{recipient?.username}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#94A3B8] font-mono">Recipient payment number</span>
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-300 font-mono">
                      <Lock className="w-3 h-3" /> Protected · hidden
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#94A3B8] font-mono">Method</span>
                    <span className="text-[10px] font-bold text-emerald-300 font-mono">bKash</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#94A3B8] font-mono">Fee</span>
                    <span className="text-[10px] font-bold text-[#94A3B8] font-mono">৳0</span>
                  </div>
                  {note && (
                    <div className="pt-1.5 border-t border-white/[0.05]">
                      <span className="text-[10px] text-[#94A3B8] font-mono block">Note</span>
                      <span className="text-[11px] text-white/80">{note}</span>
                    </div>
                  )}
                </div>

                <p className="flex items-center gap-1.5 text-[10px] text-amber-300/70 bg-amber-500/[0.06] border border-amber-500/10 rounded-xl px-3 py-2">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  Confirm the amount — the payment is submitted to bKash and processed by the server.
                </p>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStage("form")}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-[#0D111D] border border-white/[0.06] hover:border-neutral-500 text-[#94A3B8] hover:text-white text-xs font-bold transition-all cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500/90 to-emerald-500 text-white hover:brightness-110 text-xs font-black font-mono tracking-widest uppercase transition-all cursor-pointer"
                  >
                    Confirm {parsedAmount ? fmtBdt(parsedAmount) : ""}
                  </button>
                </div>
              </div>
            )}

            {stage === "processing" && (
              <div className="py-6 space-y-5">
                <div className="flex flex-col items-center justify-center gap-2.5">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                  <span className="text-xs font-black font-mono text-emerald-400 tracking-widest uppercase animate-pulse">
                    PROCESSING BDT PAYMENT…
                  </span>
                  <p className="text-[10px] text-[#94A3B8] font-mono text-center">{stepText || "Submitted to bKash…"}</p>
                </div>
                <div className="space-y-3 font-mono text-[10px] px-2 bg-black/40 p-4 rounded-2xl border border-white/5">
                  <StepRow label="Verifying recipient & amount (server)" active />
                  <StepRow label="Submitting payout to bKash" active />
                  <StepRow label="Waiting for provider confirmation" />
                  <StepRow label="Recording transfer history" />
                </div>
              </div>
            )}

            {stage === "success" && (
              <div className="py-4 space-y-4">
                <div className="flex flex-col items-center justify-center gap-2">
                  <CheckCircle2 className="w-14 h-14 text-emerald-400" />
                  <h3 className="text-[16px] font-black tracking-tight text-white mt-1">
                    {parsedAmount ? fmtBdt(parsedAmount) : ""} Sent
                  </h3>
                  <p className="text-[12px] text-[#94A3B8] font-mono">
                    to @{recipient?.username} · via bKash
                  </p>
                </div>

                <div className="flex items-center justify-between bg-black/40 border border-white/5 rounded-xl px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[8px] uppercase text-[#6C5CE0] font-mono font-bold">Transfer ID</p>
                    <p className="text-[11px] font-mono text-white truncate">{transferId}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.clipboard) navigator.clipboard.writeText(transferId);
                    }}
                    className="p-1.5 rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                    title="Copy transfer ID"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>

                {note && (
                  <p className="text-[10px] text-[#6C5CE0] font-mono bg-[#6C5CE0]/[0.06] border border-[#6C5CE0]/10 rounded-xl px-3 py-2">
                    Note: {note}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleClose}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500/90 to-emerald-500 text-white hover:brightness-110 text-xs font-black font-mono tracking-widest uppercase transition-all cursor-pointer"
                >
                  Done
                </button>
              </div>
            )}

            {stage === "failed" && (
              <div className="py-4 space-y-4">
                <div className="flex flex-col items-center justify-center gap-2">
                  <Lock className="w-10 h-10 text-rose-400" />
                  <h3 className="text-[15px] font-black tracking-tight text-white">Payment not completed</h3>
                  <p className="text-[11px] text-[#94A3B8] font-mono text-center">{errorMsg}</p>
                </div>
                {errorCode && (
                  <p className="text-center text-[9px] text-[#6C5CE0] font-mono">CODE · {errorCode}</p>
                )}
                <div className="flex gap-3">
                  {errorCode !== "BKASH_NOT_CONFIGURED" && errorCode !== "RECIPIENT_NO_PAYMENT_NUMBER" && (
                    <button
                      type="button"
                      onClick={() => setStage("form")}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-[#0D111D] border border-white/[0.06] hover:border-neutral-500 text-[#94A3B8] hover:text-white text-xs font-bold transition-all cursor-pointer"
                    >
                      Try Again
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClose}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500/90 to-emerald-500 text-white hover:brightness-110 text-xs font-black font-mono tracking-widest uppercase transition-all cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {stage === "check" && (
              <p className="text-center text-[9px] text-[#6C5CE0] mt-3 font-mono">
                Secure server-side check — no payment numbers leave the backend.
              </p>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function StepRow({ label, active }: { label: string; active?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={active ? "text-emerald-400 font-bold" : "text-[#6C5CE0]"}>{label}</span>
      <span>{active ? <Loader2 className="w-3 h-3 animate-spin text-emerald-400" /> : <Check className="w-3 h-3 text-emerald-400/60" />}</span>
    </div>
  );
}