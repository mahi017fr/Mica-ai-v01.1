import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteField, serverTimestamp } from "firebase/firestore";
import { useArcWalletSession } from "../hooks/useArcWalletSession";
import {
  createDeal,
  getLatestDeal,
  patchDeal,
  postDealSystemMessage,
  subscribeLatestDeal,
  transitionDeal,
  transitionFundingLeg,
  writeAgreementSnapshot,
  computeContentHash,
  nowIso,
} from "./dealFirestore";
import {
  canFund,
  consentComplete,
  deriveDealStatus,
  isReviewElapsed,
  reviewRemainingMs,
  roleConsented,
} from "./dealStatusMachine";
import {
  DealAgreementSnapshot,
  DealDoc,
  DealRole,
  DealTerms,
  fmtUsdc,
} from "./types";
import { analyzeDeal, draftAgreement, askMicaAboutDeal, askDisputeAdvice } from "./micaDealService";
import {
  buyerReleaseEscrow,
  createEscrowForDeal,
  depositEscrowLeg,
  disputeEscrow,
  refundEscrowLeg,
  startReviewPeriod,
  triggerAutoRelease as execAutoRelease,
} from "./dealEscrowService";

export interface DealWorkflowParams {
  roomId: string;
  currentUid: string | undefined;
  buyerUid: string;
  sellerUid: string;
  buyerWallet?: string;
  sellerWallet?: string;
  buyerName?: string;
  sellerName?: string;
}

export function useDealWorkflow(params: DealWorkflowParams) {
  const { roomId, currentUid, buyerUid, sellerUid } = params;
  const wallet = useArcWalletSession();

  const [deal, setDeal] = useState<DealDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyMessage, setBusyMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const dealRef = useRef<DealDoc | null>(null);
  dealRef.current = deal;

  useEffect(() => {
    if (!roomId) {
      setLoading(false);
      setDeal(null);
      return;
    }
    setLoading(true);
    const unsub = subscribeLatestDeal(roomId, (d) => {
      setDeal(d);
      setLoading(false);
    });
    return unsub;
  }, [roomId]);

  const myRole: DealRole | null = useMemo(() => {
    if (!currentUid) return null;
    if (currentUid === buyerUid) return "buyer";
    if (currentUid === sellerUid) return "seller";
    return null;
  }, [currentUid, buyerUid, sellerUid]);

  const derivedState = useMemo(() => deriveDealStatus(deal) ?? null, [deal]);
  const reviewRemaining = useMemo(() => reviewRemainingMs(deal), [deal]);
  const reviewElapsed = useMemo(() => isReviewElapsed(deal), [deal]);

  const amountFor = useCallback(
    (role: DealRole): number => {
      const amount = deal?.terms?.amount ?? 0;
      if (role === "buyer") return amount;
      return (amount * (deal?.terms?.collateralPercent ?? 0)) / 100;
    },
    [deal]
  );

  const amountLabel = useMemo(() => fmtUsdc(deal?.terms?.amount), [deal?.terms?.amount]);

  const runAction = useCallback(
    async (key: string, fn: () => Promise<void>, onDone?: () => void) => {
      if (busy) return;
      setBusy(key);
      setError(null);
      setInfo(null);
      try {
        await fn();
        onDone?.();
      } catch (err: any) {
        console.error(`[DealWorkflow] ${key} failed:`, err);
        // State conflicts are benign races (another participant advanced the
        // deal first) — the state machine already resolved them. Don't surface
        // them as user-facing errors.
        if (err?.name !== "DealStateConflictError") {
          setError(err?.message || "Something went wrong. Please try again.");
        }
      } finally {
        setBusy(null);
      }
    },
    [busy]
  );

  const ensureDeal = useCallback(async (): Promise<DealDoc | null> => {
    if (!currentUid) return null;
    try {
      const existing = await getLatestDeal(roomId);
      if (existing) {
        setDeal(existing);
        return existing;
      }
      const created = await createDeal({
        roomId,
        createdBy: currentUid,
        buyerUid,
        sellerUid,
        buyerWallet: params.buyerWallet,
        sellerWallet: params.sellerWallet,
      });
      setDeal(created);
      return created;
    } catch (err) {
      console.error("[DealWorkflow] ensureDeal failed:", err);
      return null;
    }
  }, [roomId, currentUid, buyerUid, sellerUid, params.buyerWallet, params.sellerWallet]);

  useEffect(() => {
    if (currentUid && buyerUid && sellerUid && roomId) {
      ensureDeal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, currentUid, buyerUid, sellerUid]);

  /**
   * Per-participant re-analysis of the CURRENT terms. Unlike the shared
   * analysis transition, this never flips the shared `state`, never clears the
   * other participant's `termsConfirm`, and never deletes the existing
   * recommendation. It only records THIS participant's request
   * (`reanalysis.{uid}`), runs Mica locally, and writes the NEW recommendation
   * (version + 1) back to the shared deal doc — at which point both
   * participants see the same new version.
   */
  const regenerateAnalysis = useCallback(async () => {
    const current = dealRef.current;
    if (!current?.terms || !currentUid || !myRole) return;
    const forVersion = current.ai?.version ?? 0;
    await runAction("reanalyze", async () => {
      await patchDeal(roomId, current.dealId, {
        reanalysis: {
          ...(current.reanalysis ?? {}),
          [currentUid]: { requestedAt: nowIso(), processing: true, version: forVersion },
        },
      });
      setBusyMessage("Mica is re-analyzing…");
      await postDealSystemMessage(roomId, "✨ Mica is re-analyzing this deal…");
      const ai = await analyzeDeal({
        terms: current.terms!,
        buyerName: params.buyerName || "Buyer",
        sellerName: params.sellerName || "Seller",
        amountLabel: fmtUsdc(current.terms!.amount),
      });
      const latest = await getLatestDeal(roomId);
      const nextVersion = (latest?.ai?.version ?? forVersion) + 1;
      await patchDeal(roomId, current.dealId, { ai: { ...ai, version: nextVersion } });
      const fresh = await getLatestDeal(roomId);
      await patchDeal(roomId, current.dealId, {
        reanalysis: {
          ...(fresh?.reanalysis ?? {}),
          [currentUid]: {
            ...(fresh?.reanalysis?.[currentUid] ?? {}),
            processing: false,
            completedAt: nowIso(),
            version: nextVersion,
          },
        },
      });
      await postDealSystemMessage(
        roomId,
        `🛡 Protection plan refreshed (v${nextVersion}). Mica re-analyzed the deal.`
      );
    });
  }, [runAction, roomId, currentUid, myRole, params.buyerName, params.sellerName]);

  const saveTermsAndAnalyze = useCallback(
    async (terms: DealTerms) => {
      const current = dealRef.current;
      if (!current || !currentUid) return;

      const sameTerms =
        !!current.terms &&
        current.terms.amount === terms.amount &&
        current.terms.collateralPercent === terms.collateralPercent &&
        current.terms.dealType === terms.dealType &&
        current.terms.description === terms.description;

      // Same terms with an existing recommendation → this is a per-participant
      // re-analysis, not a new shared terms version. Route to regenerateAnalysis
      // so the other participant keeps their controls until the new version lands.
      if (current.ai && sameTerms && current.state !== "SETUP") {
        await regenerateAnalysis();
        return;
      }

      await runAction("analyze", async () => {
        const previousTerms = current.terms;
        const financialChange =
          !!previousTerms &&
          (previousTerms.amount !== terms.amount ||
            previousTerms.collateralPercent !== terms.collateralPercent ||
            previousTerms.dealType !== terms.dealType ||
            previousTerms.description !== terms.description);

        // A financial term change invalidates BOTH previous approvals and the
        // existing agreement — both parties must consent again from scratch.
        if (current.state === "SETUP") {
          await transitionDeal(roomId, current.dealId, "SETUP", "AI_ANALYSIS", { terms });
        } else {
          const patch: Record<string, unknown> = { terms };
          if (financialChange) {
            patch.agreement = deleteField();
            patch.consent = deleteField();
          }
          await patchDeal(roomId, current.dealId, patch);
          if (current.state !== "AI_ANALYSIS") {
            await patchDeal(roomId, current.dealId, { state: "AI_ANALYSIS" });
          }
        }

        setBusyMessage("Mica is analyzing your deal…");
        await postDealSystemMessage(roomId, "✨ Mica is analyzing this deal…");
        const ai = await analyzeDeal({
          terms,
          buyerName: params.buyerName || "Buyer",
          sellerName: params.sellerName || "Seller",
          amountLabel: fmtUsdc(terms.amount),
        });

        await patchDeal(roomId, current.dealId, { ai });
        await transitionDeal(roomId, current.dealId, "AI_ANALYSIS", "NEGOTIATING", {});
        await postDealSystemMessage(
          roomId,
          `🛡 Protection plan recommended. Mica analyzed the deal (${terms.dealType} · ${fmtUsdc(terms.amount)} USDC). Recommendation: ${ai.recommendation}`
        );
      });
    },
    [runAction, roomId, currentUid, params.buyerName, params.sellerName, regenerateAnalysis]
  );

  const askMica = useCallback(
    async (question: string): Promise<string> => {
      const current = dealRef.current;
      return askMicaAboutDeal(question, {
        role: myRole ?? "buyer",
        state: current?.state ?? "SETUP",
        terms: current?.terms,
        amountLabel,
      });
    },
    [myRole, amountLabel]
  );

  const generateAgreement = useCallback(async () => {
    const current = dealRef.current;
    if (!current?.terms) return;
    await runAction("generateAgreement", async () => {
      const version = (current.agreement?.version ?? 0) + 1;
      setBusyMessage("Mica is drafting the final agreement…");
      const draft = await draftAgreement({
        terms: current.terms!,
        ai: current.ai,
        buyerName: params.buyerName || "Buyer",
        sellerName: params.sellerName || "Seller",
        amountLabel: fmtUsdc(current.terms!.amount),
      });

      const snapshot: DealAgreementSnapshot = {
        version,
        title: draft.title,
        terms: current.terms!,
        ai: current.ai,
        clauses: draft.clauses,
        contentHash: computeContentHash({ title: draft.title, terms: current.terms!, clauses: draft.clauses }),
        writtenBy: currentUid || "",
        writtenAt: nowIso(),
        state: "proposed",
      };

      await writeAgreementSnapshot(roomId, current.dealId, snapshot);
      // New version -> clear BOTH prior approvals.
      await patchDeal(roomId, current.dealId, { agreement: snapshot, consent: deleteField() });
      const latest = dealRef.current;
      const fromState = latest?.state ?? current.state;
      if (fromState === "NEGOTIATING") {
        await transitionDeal(roomId, current.dealId, "NEGOTIATING", "AWAITING_ACCEPTANCE", {});
      } else {
        await patchDeal(roomId, current.dealId, { state: "AWAITING_ACCEPTANCE" });
      }
      await postDealSystemMessage(roomId, `📄 Mica drafted the final agreement (v${version}). Both parties must accept before funding.`);
    });
  }, [runAction, roomId, currentUid, params.buyerName, params.sellerName]);

  const acceptAgreement = useCallback(async () => {
    const current = dealRef.current;
    if (!current?.agreement || !myRole) return;
    await runAction("accept", async () => {
      const version = current.agreement!.version;
      const roleKey = myRole === "buyer" ? "buyer" : "seller";
      const patch: Record<string, unknown> = {
        [`consent.${roleKey}AcceptedVersion`]: version,
        [`consent.${roleKey}AcceptedAt`]: nowIso(),
      };

      const next = { ...current, consent: { ...current.consent, [`${roleKey}AcceptedVersion`]: version, [`${roleKey}AcceptedAt`]: nowIso() } };
      if (consentComplete(next)) {
        const locked: DealAgreementSnapshot = { ...current.agreement!, state: "locked", lockedAt: nowIso() };
        await writeAgreementSnapshot(roomId, current.dealId, locked);
        patch["agreement.lockedAt"] = locked.lockedAt;
        patch["agreement.state"] = "locked";
        await transitionDeal(roomId, current.dealId, "AWAITING_ACCEPTANCE", "LOCKED", patch);
        await postDealSystemMessage(roomId, "🔒 Agreement locked. Both parties accepted. Escrow funding can now begin.");
      } else {
        await patchDeal(roomId, current.dealId, patch);
        await postDealSystemMessage(
          roomId,
          `${myRole === "buyer" ? "Buyer" : "Seller"} accepted agreement v${version}. Waiting for the other party…`
        );
      }
    });
  }, [runAction, roomId, myRole]);

  const beginFunding = useCallback(async () => {
    const current = dealRef.current;
    if (!current?.terms) return;
    await runAction("beginFunding", async () => {
      if (!myRole) throw new Error("Only a deal participant can create the escrow contract.");
      const expectedWallet = (myRole === "buyer" ? current.buyerWallet : current.sellerWallet)?.toLowerCase();
      if (!expectedWallet) throw new Error(`The ${myRole} verified wallet is missing from this deal.`);
      const { provider, from } = await wallet.getSigningContext(expectedWallet);
      setBusyMessage("Creating the on-chain escrow…");
      const res = await createEscrowForDeal({
        dealId: current.dealId,
        buyerWallet: current.buyerWallet || "",
        sellerWallet: current.sellerWallet || "",
        amount: current.terms!.amount,
        collateralAmount: amountFor("seller"),
        provider,
        from,
      });
      const escrow = {
        custodyMode: res.mode,
        factoryTxHash: res.factoryTxHash,
        escrowAddress: res.escrowAddress,
        createdAt: nowIso(),
        funding: {
          buyer: { status: "pending" as const },
          seller: { status: "pending" as const },
        },
      };
      await transitionDeal(roomId, current.dealId, "LOCKED", "AWAITING_FUNDING", { escrow });
      if (res.mode === "seam") {
        await postDealSystemMessage(
          roomId,
          "💰 Escrow funding requested. NOTE: the escrow contract is not deployed yet — funding will become available once it is."
        );
      } else {
        await postDealSystemMessage(roomId, `💰 Escrow contract created at ${res.escrowAddress}. Both parties must now fund their legs.`);
      }
    });
  }, [runAction, roomId, wallet, amountFor, myRole]);

  const fundLeg = useCallback(
    async (role: DealRole) => {
      const current = dealRef.current;
      if (!current?.escrow || !canFund(role, current)) return;
      const amount = amountFor(role);
      await runAction("fund_" + role, async () => {
        if (current.escrow!.custodyMode === "seam" || !current.escrow!.escrowAddress) {
          throw new Error(
            "Escrow contract not deployed yet, so on-chain funding is not available. Deploy the DealEscrowFactory (scripts/deploy-escrow.mjs) to enable real funding."
          );
        }
        const expectedWallet = (role === "buyer" ? current.buyerWallet : current.sellerWallet)?.toLowerCase();
        const { provider, from } = await wallet.getSigningContext();
        if (expectedWallet && from.toLowerCase() !== expectedWallet) {
          throw new Error(`Connect the ${role === "buyer" ? "buyer" : "seller"} wallet (${expectedWallet.slice(0, 6)}…) to fund this leg.`);
        }
        setBusyMessage(`${role === "buyer" ? "Buyer" : "Seller"} depositing ${fmtUsdc(amount)} USDC…`);

        const res = await depositEscrowLeg({
          escrowAddress: current.escrow!.escrowAddress,
          amount,
          provider,
          from,
        });
        if (res.mode === "seam" || !res.mainTxHash) {
          throw new Error("On-chain funding unavailable (escrow contract not deployed).");
        }

        const other = role === "buyer" ? "seller" : "buyer";
        const otherLeg = current.escrow!.funding[other];
        const bothNow = otherLeg?.status === "confirmed";
        const toState = bothNow ? "FUNDED" : "FUNDING";
        const fromState = current.state === "FUNDED" ? "FUNDED" : current.state;

        await transitionFundingLeg({
          roomId,
          dealId: current.dealId,
          role,
          from: fromState,
          to: toState,
          patch: {
            status: "confirmed",
            txHash: res.mainTxHash,
            amount,
            at: nowIso(),
            error: null,
          },
        });
        await postDealSystemMessage(
          roomId,
          `${role === "buyer" ? "🛒 Buyer" : "🛍 Seller"} funded ${fmtUsdc(amount)} USDC (tx ${res.mainTxHash.slice(0, 10)}…).`
        );
        if (bothNow) {
          await postDealSystemMessage(
            roomId,
            "🔐 Funds secured. Both deposits are locked in the escrow. The deal is now active."
          );
        }
      });
    },
    [runAction, roomId, wallet, amountFor]
  );

  const markDeliveredAndStartReview = useCallback(async () => {
    const current = dealRef.current;
    if (!current?.escrow || myRole !== "seller") return;
    await runAction("deliver", async () => {
      await transitionDeal(roomId, current.dealId, current.state === "ACTIVE" ? "ACTIVE" : "FUNDED", "DELIVERED", {
        delivery: { markedBy: "seller", at: nowIso() },
      });

      let reviewTxHash: string | null = null;
      if (current.escrow!.custodyMode === "contract" && current.escrow!.escrowAddress) {
        setBusyMessage("Starting the 24h review window on-chain…");
        const { provider, from } = await wallet.getSigningContext();
        if (from.toLowerCase() !== (current.sellerWallet || "").toLowerCase()) {
          throw new Error("Connect the seller wallet to start the review window.");
        }
        const res = await startReviewPeriod({
          escrowAddress: current.escrow!.escrowAddress,
          provider,
          from,
        });
        reviewTxHash = res.txHash;
      }

      await transitionDeal(roomId, current.dealId, "DELIVERED", "BUYER_REVIEW", {
        "escrow.reviewStartedAt": serverTimestamp(),
        "escrow.reviewTxHash": reviewTxHash,
      });
      await postDealSystemMessage(
        roomId,
        `📦 Seller marked the deal as delivered. The 24-hour buyer review window has started${reviewTxHash ? ` (tx ${reviewTxHash.slice(0, 10)}…)` : ""}.`
      );
    });
  }, [runAction, roomId, wallet, myRole]);

  const release = useCallback(async () => {
    const current = dealRef.current;
    if (!current?.escrow || myRole !== "buyer") return;
    const state = current.state;
    if (state !== "BUYER_REVIEW" && state !== "AUTO_RELEASE_DUE") return;
    await runAction("release", async () => {
      if (current.escrow!.custodyMode === "seam" || !current.escrow!.escrowAddress) {
        throw new Error("On-chain release unavailable (escrow contract not deployed).");
      }
      setBusyMessage("Releasing funds to the seller…");
      const { provider, from } = await wallet.getSigningContext();
      const res = await buyerReleaseEscrow({
        escrowAddress: current.escrow!.escrowAddress,
        provider,
        from,
      });
      if (res.mode === "seam" || !res.txHash) throw new Error("On-chain release unavailable.");
      await transitionDeal(roomId, current.dealId, state, "RELEASE_PENDING", {
        "escrow.releaseTxHash": res.txHash,
      });
      await transitionDeal(roomId, current.dealId, "RELEASE_PENDING", "COMPLETED", {
        "escrow.releasedAt": nowIso(),
        "escrow.releaseMethod": "buyer_release",
        result: { method: "buyer_release", at: nowIso(), txHash: res.txHash },
      });
      await postDealSystemMessage(roomId, `💸 Buyer approved delivery. Funds released to the seller (tx ${res.txHash.slice(0, 10)}…). Deal completed.`);
    });
  }, [runAction, roomId, wallet, myRole]);

  const triggerAutoRelease = useCallback(async () => {
    const current = dealRef.current;
    if (!current?.escrow) return;
    const state = current.state;
    if (state !== "AUTO_RELEASE_DUE" && state !== "BUYER_REVIEW") return;
    await runAction("autoRelease", async () => {
      if (current.escrow!.custodyMode === "seam" || !current.escrow!.escrowAddress) {
        throw new Error("On-chain auto-release unavailable (escrow contract not deployed).");
      }
      if (state === "BUYER_REVIEW" && !reviewElapsed) {
        throw new Error("The 24-hour review window has not elapsed yet.");
      }
      setBusyMessage("Triggering the timelock auto-release…");
      const { provider, from } = await wallet.getSigningContext();
      const res = await execAutoRelease({
        escrowAddress: current.escrow!.escrowAddress,
        provider,
        from,
      });
      if (res.mode === "seam" || !res.txHash) throw new Error("On-chain auto-release unavailable.");
      await transitionDeal(roomId, current.dealId, state, "RELEASE_PENDING", {
        "escrow.releaseTxHash": res.txHash,
      });
      await transitionDeal(roomId, current.dealId, "RELEASE_PENDING", "COMPLETED", {
        "escrow.releasedAt": nowIso(),
        "escrow.releaseMethod": "auto_release",
        result: { method: "auto_release", at: nowIso(), txHash: res.txHash },
      });
      await postDealSystemMessage(roomId, `⏱ Review window elapsed without action. Auto-release executed to the seller (tx ${res.txHash.slice(0, 10)}…).`);
    });
  }, [runAction, roomId, wallet, reviewElapsed]);

  const disputeDeal = useCallback(
    async (reason: string) => {
      const current = dealRef.current;
      if (!current?.escrow || !myRole) return;
      const allowed = ["FUNDED", "ACTIVE", "DELIVERED", "BUYER_REVIEW", "AUTO_RELEASE_DUE", "RELEASE_PENDING", "FUNDING"];
      if (!allowed.includes(current.state)) return;
      await runAction("dispute", async () => {
        let txHash: string | null = null;
        if (current.escrow!.custodyMode === "contract" && current.escrow!.escrowAddress) {
          setBusyMessage("Pausing the escrow for dispute…");
          const { provider, from } = await wallet.getSigningContext();
          const res = await disputeEscrow({
            escrowAddress: current.escrow!.escrowAddress,
            provider,
            from,
          });
          txHash = res.txHash;
        }
        await transitionDeal(roomId, current.dealId, current.state, "DISPUTED", {
          "escrow.dispute": { by: myRole, reason, at: nowIso(), txHash },
        });
        await postDealSystemMessage(
          roomId,
          `⚠ ${myRole === "buyer" ? "Buyer" : "Seller"} opened a dispute: ${reason}. The auto-release clock is paused and funds are frozen until resolved.`
        );
      });
    },
    [runAction, roomId, wallet, myRole]
  );

  const refundMyLeg = useCallback(async () => {
    const current = dealRef.current;
    if (!current?.escrow || !myRole) return;
    const leg = current.escrow.funding[myRole];
    if (!leg || (leg.status !== "confirmed" && leg.status !== "submitted")) return;
    await runAction("refundLeg", async () => {
      if (current.escrow!.custodyMode === "seam" || !current.escrow!.escrowAddress) {
        throw new Error("On-chain refund unavailable (escrow contract not deployed).");
      }
      setBusyMessage("Clawing back your deposit from the escrow…");
      const { provider, from } = await wallet.getSigningContext();
      const res = await refundEscrowLeg({
        escrowAddress: current.escrow!.escrowAddress,
        provider,
        from,
      });
      if (res.mode === "seam" || !res.txHash) throw new Error("On-chain refund unavailable.");
      await patchDeal(roomId, current.dealId, {
        [`escrow.funding.${myRole}.status`]: "refunded",
        [`escrow.funding.${myRole}.at`]: nowIso(),
        [`escrow.funding.${myRole}.txHash`]: res.txHash,
      });
      await postDealSystemMessage(roomId, `${myRole === "buyer" ? "Buyer" : "Seller"} clawed back their escrow deposit (tx ${res.txHash.slice(0, 10)}…).`);
    });
  }, [runAction, roomId, wallet, myRole]);

  const cancelDeal = useCallback(
    async (note: string) => {
      const current = dealRef.current;
      if (!current) return;
      const allowed = ["SETUP", "AI_ANALYSIS", "NEGOTIATING", "AWAITING_ACCEPTANCE", "LOCKED", "AWAITING_FUNDING"];
      if (!allowed.includes(current.state)) return;
      await runAction("cancel", async () => {
        await transitionDeal(roomId, current.dealId, current.state, "CANCELLED", {
          cancelNote: note || "Deal cancelled before funding.",
          result: { method: "cancel_refund", at: nowIso() },
        });
        await postDealSystemMessage(roomId, `Deal cancelled${note ? ` — ${note}` : ""}.`);
      });
    },
    [runAction, roomId]
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    deal,
    loading,
    busy,
    busyMessage,
    error,
    info,
    setInfo,
    clearError,
    myRole,
    derivedState,
    reviewRemaining,
    reviewElapsed,
    amountFor,
    amountLabel,
    consentComplete: consentComplete(deal),
    myConsented: roleConsented(myRole ?? "buyer", deal),
    canFund: (role: DealRole) => canFund(role, deal),
    wallet,
    ensureDeal,
    saveTermsAndAnalyze,
    regenerateAnalysis,
    askMica,
    generateAgreement,
    acceptAgreement,
    beginFunding,
    fundLeg,
    markDeliveredAndStartReview,
    release,
    triggerAutoRelease,
    disputeDeal,
    refundMyLeg,
    cancelDeal,
  };
}

export type DealWorkflowApi = ReturnType<typeof useDealWorkflow>;
