import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useActiveWallet } from "@privy-io/react-auth";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Coins,
  Wallet,
  ShieldCheck,
  ArrowUpRight,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
  CircleDollarSign,
  RefreshCw,
  PlugZap,
  ExternalLink,
} from "lucide-react";
import { UserProfile } from "../types";
import {
  ArcPaymentReceipt,
  ArcPaymentRequest,
  arcUsdcAdapter,
  ARC_NETWORK,
  chainLabel,
  getTxExplorerUrl,
  ArcBalanceStatus,
  fetchArcUsdcBalance,
  getWalletChainId,
} from "../payments";

type Stage = "form" | "confirm" | "processing" | "success";

interface SendUsdcModalProps {
  open: boolean;
  senderProfile: UserProfile | null;
  senderWallet?: string | null;
  recipient: UserProfile | null;
  chatId?: string | null;
  onClose: () => void;
  onPaymentSuccess: (receipt: ArcPaymentReceipt) => void | Promise<void>;
}

const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;

function shortAddress(addr?: string): string {
  if (!addr) return "—";
  const a = addr.toLowerCase();
  return a.length <= 10 ? a : `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function fmtUsdc(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

// Plain decimal (no thousands separators) for the amount field — must round-trip
// through the AMOUNT_RE validation.
function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(6).replace(/\.?0+$/, "");
}

export default function SendUsdcModal({
  open,
  senderProfile,
  senderWallet,
  recipient,
  chatId,
  onClose,
  onPaymentSuccess,
}: SendUsdcModalProps) {
  const [stage, setStage] = useState<Stage>("form");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ArcPaymentReceipt | null>(null);
  const [copied, setCopied] = useState(false);
  const [procStep, setProcStep] = useState("");

  // Every payment step is logged to the browser console with a timestamp so
  // the real wallet/signature/submission lifecycle can be audited end-to-end.
  const logStep = useCallback((step: string, detail?: string) => {
    console.info(`[Arc] [${new Date().toISOString()}] ${step}${detail ? " — " + detail : ""}`);
  }, []);

  // Connected Privy wallet — the source of truth for the sender's address and
  // current chain (never a manually typed value).
  const { wallet: activeWallet } = useActiveWallet();
  const connectedWallet = activeWallet && activeWallet.type === "ethereum" ? activeWallet : null;

  const [balanceState, setBalanceState] = useState<ArcBalanceStatus>({ status: "checking" });
  const [retryKey, setRetryKey] = useState(0);

  // Verified sender wallet address: prefer the live connected Privy wallet,
  // fall back to the verified profile primary wallet.
  const walletAddress =
    connectedWallet?.address?.toLowerCase() ||
    senderWallet?.toLowerCase() ||
    senderProfile?.walletAddress?.toLowerCase() ||
    null;

  const refreshBalance = useCallback(async () => {
    if (!open) return;
    setBalanceState({ status: "checking" });
    try {
      const chainId = await getWalletChainId(connectedWallet);
      const result = await fetchArcUsdcBalance(walletAddress, chainId);
      setBalanceState(result);
    } catch (err: any) {
      console.error("[Arc] Balance check failed:", err);
      setBalanceState({ status: "error", message: err?.message || String(err) });
    }
  }, [open, connectedWallet, walletAddress]);

  useEffect(() => {
    if (open) {
      refreshBalance();
    }
  }, [open, refreshBalance, retryKey]);

  const handleSwitchToArc = async () => {
    if (!connectedWallet || typeof connectedWallet.switchChain !== "function") return;
    try {
      await connectedWallet.switchChain(ARC_NETWORK.chainId);
      // Re-read the balance once the wallet reports the new chain.
      setRetryKey((k) => k + 1);
    } catch (err: any) {
      console.error(`[Arc] Failed to switch wallet to ${ARC_NETWORK.name}:`, err);
      setError("Could not switch your wallet to Arc Network. Please switch manually.");
    }
  };

  // Available Arc USDC balance — real on-chain value from the connected wallet.
  // Never a mock or a client-editable field.
  const balance = balanceState.status === "success" ? balanceState.balance : 0;
  const balanceReady = balanceState.status === "success";

  // Verified wallets ONLY — always from the database / Privy, never manual input.
  const recipientWallet = recipient?.walletVerified ? recipient.walletAddress || null : null;

  useEffect(() => {
    if (open) {
      setStage("form");
      setAmount("");
      setError("");
      setReceipt(null);
      setCopied(false);
      setProcStep("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && stage !== "processing") onClose();
    },
    [stage, onClose]
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, handleEscape]);

  const handleBackdrop = () => {
    if (stage !== "processing") onClose();
  };

  const parsedAmount = useMemo(() => {
    if (!amount || !AMOUNT_RE.test(amount)) return null;
    const n = parseFloat(amount);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [amount]);

  const validateAmount = (): number | null => {
    if (!amount.trim()) {
      setError("Please enter an amount.");
      return null;
    }
    if (!AMOUNT_RE.test(amount)) {
      setError("Amount must be a positive number (up to 6 decimals).");
      return null;
    }
    const n = parseFloat(amount);
    if (!(n > 0)) {
      setError("Amount must be greater than 0.");
      return null;
    }
    if (n > balance) {
      setError("Amount exceeds your available balance.");
      return null;
    }
    return n;
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(",", ".");
    if (value === "" || /^\d*(\.\d{0,6})?$/.test(value)) {
      setAmount(value);
      setError("");
    }
  };

  const handleMax = () => {
    setError("");
    if (balance <= 0) {
      setError("You don't have any USDC available to send.");
      return;
    }
    setAmount(fmtAmount(balance));
  };

  const handleSendClick = () => {
    setError("");
    const n = validateAmount();
    if (n === null) return;
    setAmount(fmtAmount(n));
    setStage("confirm");
  };

  const handleConfirm = async () => {
    const n = validateAmount();
    if (n === null) return;

    // Requirement 4: a real wallet signature is mandatory. If there is no
    // connected wallet that can sign, DO NOT continue the payment flow.
    if (!connectedWallet) {
      console.error("[Arc] No connected wallet to sign with.");
      setError("Wallet signature required.");
      setStage("form");
      return;
    }
    if (!walletAddress || !recipientWallet || !senderProfile || !recipient) {
      setError("Verified wallets are required to send USDC.");
      setStage("form");
      return;
    }

    setStage("processing");
    setError("");
    setProcStep("Connecting wallet…");
    logStep("Wallet Connected", walletAddress);

    try {
      // Obtain the real signing provider from the connected Privy wallet.
      const provider = await connectedWallet.getEthereumProvider();
      if (!provider) {
        throw new Error("Wallet signature required.");
      }
      logStep("Preparing Transaction", `${n} USDC → @${recipient.username}`);

      const request: ArcPaymentRequest = {
        chatId,
        senderId: senderProfile.uid,
        senderUsername: senderProfile.username,
        senderWallet: walletAddress,
        recipientId: recipient.uid,
        recipientUsername: recipient.username,
        recipientWallet,
        amount: n,
      };

      setProcStep("Awaiting wallet signature…");
      // Real Arc Circle USDC transfer: wallet signature (Privy confirmation
      // modal for embedded wallets) -> eth_sendTransaction -> real hash ->
      // on-chain confirmation. Never simulated.
      const res = await arcUsdcAdapter.sendUsdc(request, {
        provider,
        from: walletAddress,
        log: logStep,
      });

      setReceipt(res);

      // Requirement 5: after success, refresh the sender's balance with a
      // FRESH RPC request — never keep showing cached balances.
      setProcStep("Refreshing balance…");
      logStep("Refreshing Balance", res.transactionHash);
      await refreshBalance();
      logStep("Done");

      setStage("success");

      try {
        await onPaymentSuccess(res);
      } catch (err) {
        // Never block the success screen on post-payment bookkeeping.
        console.error("Post-payment integration failed:", err);
      }
    } catch (err: any) {
      const message = err?.message || "Payment failed. Please try again.";
      logStep("Payment Failed", message);
      console.error("[Arc] Arc USDC transfer failed:", err);
      setError(message);
      setStage("form");
    }
  };

  const handleCopyHash = async () => {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(receipt.transactionHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  const lockForm = !walletAddress || !recipientWallet;

  const renderBalanceCard = () => {
    switch (balanceState.status) {
      case "checking":
        return (
          <div className="flex items-center justify-between p-3.5 bg-emerald-500/[0.05] border border-emerald-500/15 rounded-2xl select-none">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#94A3B8]">
                Available Balance
              </span>
            </div>
            <span className="text-[15px] font-black font-mono text-emerald-300">Checking…</span>
          </div>
        );
      case "no_wallet":
        return (
          <div className="flex items-center justify-between p-3.5 bg-emerald-500/[0.05] border border-emerald-500/15 rounded-2xl select-none">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
                <Coins className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#94A3B8]">
                Available Balance
              </span>
            </div>
            <span className="text-[15px] font-black font-mono text-emerald-300">
              0 <span className="text-[10px] font-semibold text-emerald-400/70">USDC</span>
            </span>
          </div>
        );
      case "wrong_network":
        return (
          <div className="p-3.5 bg-amber-500/[0.06] border border-amber-500/20 rounded-2xl space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PlugZap className="w-4 h-4 text-amber-400" />
                <span className="text-[11px] font-bold text-amber-200">Wrong network</span>
              </div>
              <span className="text-[10px] font-mono text-amber-300/70">
                {chainLabel(balanceState.walletChainId)}
              </span>
            </div>
            <p className="text-[11px] text-amber-200/80 font-medium leading-relaxed">
              Your wallet is connected to a different chain. Switch it to Arc Network to view
              and send USDC.
            </p>
            {connectedWallet && typeof connectedWallet.switchChain === "function" && (
              <button
                type="button"
                onClick={handleSwitchToArc}
                className="w-full py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-100 hover:bg-amber-500/25 text-[11px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <PlugZap className="w-3.5 h-3.5" />
                Switch to Arc Network
              </button>
            )}
          </div>
        );
      case "error":
        return (
          <div className="p-3.5 bg-rose-500/[0.06] border border-rose-500/20 rounded-2xl space-y-2.5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span className="text-[11px] font-bold text-rose-200">Unable to fetch your USDC balance.</span>
            </div>
            {balanceState.message && (
              <p className="text-[10px] font-mono text-rose-300/70 break-all leading-relaxed">
                {balanceState.message}
              </p>
            )}
            <button
              type="button"
              onClick={refreshBalance}
              className="w-full py-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-100 hover:bg-rose-500/25 text-[11px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        );
      case "success":
        return (
          <div className="flex items-center justify-between p-3.5 bg-emerald-500/[0.05] border border-emerald-500/15 rounded-2xl select-none">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
                <Coins className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#94A3B8]">
                Available Balance
              </span>
            </div>
            <span className="text-[15px] font-black font-mono text-emerald-300">
              {fmtUsdc(balance)} <span className="text-[10px] font-semibold text-emerald-400/70">USDC</span>
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          {/* Blurred backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleBackdrop}
            className="absolute inset-0 bg-[#070A12]/80 backdrop-blur-xl"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 18 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="relative w-full max-w-md bg-[#0B0F17]/95 border border-white/10 rounded-3xl shadow-[0_25px_80px_rgba(0,0,0,0.6)] overflow-hidden backdrop-blur-2xl"
          >
            {/* Top gradient glow */}
            <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-40 bg-[#6366F1]/25 blur-[70px] rounded-full pointer-events-none" />
            <div className="absolute -bottom-28 -right-16 w-64 h-40 bg-emerald-500/10 blur-[70px] rounded-full pointer-events-none" />

            <div className="relative">
              {/* Header */}
              <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-white/[0.06]">
                <div className="flex items-center gap-3.5">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-[#6366F1]/25 to-[#6C5CE0]/10 border border-[#6366F1]/30 text-white">
                    <CircleDollarSign className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-[17px] font-black tracking-tight text-[#F8FAFC]">Send USDC</h3>
                    <p className="text-[11px] text-[#94A3B8] font-medium">
                      Transfer USDC securely through Arc Network.
                    </p>
                  </div>
                </div>
                {stage !== "processing" && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-1.5 rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="px-6 py-5">
                {stage === "form" && (
                  <div className="space-y-4">
                    {/* Recipient card */}
                    <div className="flex items-center gap-3 p-3.5 bg-white/[0.03] border border-white/[0.07] rounded-2xl">
                      <img
                        src={recipient?.avatarUrl}
                        alt={recipient?.displayName || "Recipient"}
                        referrerPolicy="no-referrer"
                        className="w-12 h-12 rounded-full object-cover border border-[#6366F1]/30 bg-[#0D111D]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-bold text-white truncate">
                          {recipient?.displayName || "Unknown"}
                        </p>
                        <p className="text-[11px] font-mono text-[#6C5CE0] truncate">
                          @{recipient?.username || "unknown"}
                        </p>
                        <p className="text-[10px] font-mono text-[#94A3B8] truncate mt-0.5 flex items-center gap-1">
                          <Wallet className="w-3 h-3" />
                          {shortAddress(recipientWallet || recipient?.walletAddress)}
                        </p>
                      </div>
                      <span className="shrink-0 flex items-center gap-1 text-[9px] font-bold text-emerald-400 uppercase tracking-wider">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {recipient?.walletVerified ? "Verified" : "No wallet"}
                      </span>
                    </div>

                    {/* Balance card */}
                    {renderBalanceCard()}

                    {/* Amount input */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#94A3B8]">
                        Amount
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={amount}
                          disabled={lockForm}
                          onChange={handleAmountChange}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSendClick();
                          }}
                          className="w-full bg-black/40 border border-white/10 focus:border-[#6366F1]/60 focus:ring-1 focus:ring-[#6366F1]/20 rounded-2xl pl-4 pr-24 py-3.5 text-lg font-mono font-bold text-white placeholder:text-white/20 focus:outline-none transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <button
                          type="button"
                          onClick={handleMax}
                          disabled={lockForm || !balanceReady || balance <= 0}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-[#6366F1]/15 border border-[#6366F1]/30 text-[10px] font-black text-[#A5B4FC] hover:bg-[#6366F1]/30 hover:text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          MAX
                        </button>
                      </div>
                      {error && (
                        <p className="flex items-center gap-1.5 text-[11px] text-rose-400 font-medium pl-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {error}
                        </p>
                      )}
                    </div>

                    {/* Wallet / network notices */}
                    {!walletAddress && (
                      <p className="text-[11px] text-amber-400/90 font-medium flex items-center gap-1.5 px-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        Link a verified primary wallet to send USDC.
                      </p>
                    )}
                    {walletAddress && !recipientWallet && (
                      <p className="text-[11px] text-amber-400/90 font-medium flex items-center gap-1.5 px-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {recipient?.displayName} hasn't linked a verified wallet yet.
                      </p>
                    )}
                    {walletAddress &&
                      recipientWallet &&
                      (balanceState.status === "wrong_network" || balanceState.status === "error") && (
                        <p className="text-[11px] text-amber-400/90 font-medium flex items-center gap-1.5 px-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {balanceState.status === "wrong_network"
                            ? "Please switch to Arc Network."
                            : "Unable to fetch your USDC balance."}
                        </p>
                      )}

                    {/* Summary */}
                    <div className="space-y-2 p-4 bg-black/30 border border-white/[0.06] rounded-2xl">
                      {[
                        { label: "You Send", value: parsedAmount ? `${fmtUsdc(parsedAmount)} USDC` : "—" },
                        { label: "Recipient", value: recipient ? `@${recipient.username}` : "—" },
                        { label: "Network", value: "Arc" },
                        { label: "Asset", value: "Circle USDC" },
                        { label: "Estimated Fee", value: `${fmtUsdc(arcUsdcAdapter.fee)} USDC` },
                      ].map((row) => (
                        <div key={row.label} className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-[#94A3B8]">{row.label}</span>
                          <span className="text-[11px] font-bold text-white font-mono">{row.value}</span>
                        </div>
                      ))}
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3 pt-1">
                      <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-[#94A3B8] hover:text-white hover:bg-white/[0.08] text-[13px] font-semibold transition-all cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSendClick}
                        disabled={lockForm || !balanceReady}
                        className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-[#6366F1] via-[#6C5CE0] to-[#8B5CF6] text-white hover:brightness-110 shadow-[0_6px_24px_rgba(99,102,241,0.3)] text-[13px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:brightness-100"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                        Send USDC
                      </button>
                    </div>
                  </div>
                )}

                {stage === "confirm" && (
                  <div className="space-y-4">
                    <div className="text-center pt-1">
                      <div className="mx-auto w-14 h-14 rounded-2xl bg-[#6366F1]/15 border border-[#6366F1]/30 flex items-center justify-center">
                        <ArrowUpRight className="w-7 h-7 text-[#A5B4FC]" />
                      </div>
                      <h4 className="text-lg font-black text-white mt-3">
                        Send {parsedAmount ? fmtUsdc(parsedAmount) : "—"} USDC
                      </h4>
                      <p className="text-[12px] text-[#94A3B8] font-medium mt-0.5">
                        to {recipient ? `@${recipient.username}` : "recipient"} ?
                      </p>
                    </div>

                    <div className="space-y-2 p-4 bg-black/30 border border-white/[0.06] rounded-2xl">
                      {[
                        { label: "You Send", value: parsedAmount ? `${fmtUsdc(parsedAmount)} USDC` : "—" },
                        { label: "Recipient", value: recipient ? `@${recipient.username}` : "—" },
                        { label: "Recipient Wallet", value: shortAddress(recipientWallet || recipient?.walletAddress) },
                        { label: "Network", value: "Arc" },
                        { label: "Estimated Fee", value: `${fmtUsdc(arcUsdcAdapter.fee)} USDC` },
                      ].map((row) => (
                        <div key={row.label} className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-[#94A3B8]">{row.label}</span>
                          <span className="text-[11px] font-bold text-white font-mono">{row.value}</span>
                        </div>
                      ))}
                    </div>

                    {error && (
                      <p className="flex items-center gap-1.5 text-[11px] text-rose-400 font-medium px-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {error}
                      </p>
                    )}

                    <div className="flex items-center gap-2 px-1 text-[10px] text-rose-400/70 font-medium leading-relaxed">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      Transactions are irreversible after confirmation.
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setError("");
                          setStage("form");
                        }}
                        className="flex-1 py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-[#94A3B8] hover:text-white hover:bg-white/[0.08] text-[13px] font-semibold transition-all cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirm}
                        className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 shadow-[0_6px_24px_rgba(16,185,129,0.3)] text-[13px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
                      >
                        <Check className="w-4 h-4" />
                        Confirm
                      </button>
                    </div>
                  </div>
                )}

                {stage === "processing" && (
                  <div className="py-10 space-y-5">
                    <div className="flex flex-col items-center justify-center gap-4">
                      <div className="relative">
                        <div className="absolute inset-0 rounded-full bg-[#6366F1]/20 blur-xl animate-pulse" />
                        <Loader2 className="w-12 h-12 animate-spin text-[#818CF8] relative" />
                      </div>
                      <div className="text-center">
                        <p className="text-[13px] font-black text-white tracking-wide">
                          {procStep || "Processing Payment"}
                        </p>
                        <p className="text-[11px] text-[#94A3B8] mt-1 font-mono">
                          Arc · Circle USDC ·{" "}
                          {parsedAmount ? `${fmtUsdc(parsedAmount)} USDC` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-1.5 px-6">
                      {[
                        "Connecting wallet & verifying network",
                        "Building transfer on Arc Network",
                        "Awaiting wallet signature",
                        "Broadcasting Circle USDC transaction",
                        "Waiting for confirmation",
                      ].map((step, i) => (
                        <div key={step} className="flex items-center gap-2 text-[11px] font-medium text-[#94A3B8]">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              i === 0 ? "bg-emerald-400 animate-pulse" : "bg-white/10"
                            }`}
                          />
                          {step}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {stage === "success" && receipt && (
                  <div className="space-y-5 pt-1">
                    <div className="text-center">
                      <div className="relative mx-auto w-16 h-16">
                        <div className="absolute inset-0 rounded-full bg-emerald-500/25 blur-xl animate-pulse" />
                        <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.4)]">
                          <Check className="w-8 h-8 text-white" />
                        </div>
                      </div>
                      <h4 className="text-xl font-black text-white mt-4">Payment Successful</h4>
                      <p className="text-[13px] text-emerald-300 font-bold font-mono mt-1">
                        {fmtUsdc(receipt.amount)} USDC Sent
                      </p>
                      <p className="text-[11px] text-[#94A3B8] mt-0.5">
                        to {recipient ? `@${recipient.username}` : "recipient"} · via Arc
                      </p>
                    </div>

                    {/* Transaction hash */}
                    <div className="p-3.5 bg-black/40 border border-white/[0.06] rounded-2xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-[#94A3B8]">
                          Transaction Hash
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyHash}
                          className="flex items-center gap-1 text-[9px] font-bold text-[#6C5CE0] hover:text-white transition-colors cursor-pointer"
                        >
                          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          {copied ? "Copied" : "Copy Hash"}
                        </button>
                      </div>
                      <p className="text-[11px] font-mono text-[#94A3B8] break-all leading-relaxed">
                        {receipt.transactionHash}
                      </p>
                    </div>

                    {(() => {
                      const txUrl = getTxExplorerUrl(receipt.transactionHash);
                      return txUrl ? (
                        <a
                          href={txUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-2.5 rounded-2xl bg-[#6366F1]/15 border border-[#6366F1]/30 text-[11px] font-semibold text-[#A5B4FC] hover:bg-[#6366F1]/25 hover:text-white flex items-center justify-center gap-2 transition-all"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          View Transaction
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="w-full py-2.5 rounded-2xl bg-white/[0.03] border border-white/10 text-[11px] font-semibold text-[#94A3B8] cursor-default"
                        >
                          View Transaction — Explorer unavailable
                        </button>
                      );
                    })()}

                    <button
                      type="button"
                      onClick={onClose}
                      className="w-full py-3 rounded-2xl bg-gradient-to-r from-[#6366F1] via-[#6C5CE0] to-[#8B5CF6] text-white hover:brightness-110 shadow-[0_6px_24px_rgba(99,102,241,0.3)] text-[13px] font-bold transition-all cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
