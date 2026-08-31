import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteField, serverTimestamp } from "firebase/firestore";
import { useChat } from "../context/ChatContext";
import { ARC_NETWORK } from "../payments/arcNetwork";
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
  claimEscrowCreation,
  releaseEscrowCreation,
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
  fetchEscrowOnChainStatus,
  fetchEscrowDeposit,
  fetchEscrowFunded,
  decodeEscrowAddressFromReceipt,
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

  // Circle Developer-Controlled Wallet (server-side MPC): all Deal escrow
  // signing is routed through the server. There is no browser/Privy signing in
  // the payment path anymore.
  const { circleWallet, getCircleSigningContext } = useChat();

  // Shape the wallet object consumed by the workflow (and by DealFunding) to
  // mirror the old `{ getSigningContext, primaryAddress }` seam.
  const wallet = useMemo(
    () => ({
      // Accepts an optional expectedAddress for API compat, but Circle signing
      // always resolves the acting user's wallet from their uid server-side.
      getSigningContext: getCircleSigningContext,
      primaryAddress: circleWallet.status === "linked" ? circleWallet.from ?? null : null,
      session: circleWallet,
      // Server-managed wallet never needs a browser reconnect.
      reconnect: async () => {},
      reconnecting: false,
    }),
    [getCircleSigningContext, circleWallet]
  );

  const [deal, setDeal] = useState<DealDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyMessage, setBusyMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [reviewNow, setReviewNow] = useState(() => Date.now());

  const dealRef = useRef<DealDoc | null>(null);
  const escrowCreationInFlightRef = useRef(false);
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
    const effectiveBuyerUid = deal?.buyerUid || buyerUid;
    const effectiveSellerUid = deal?.sellerUid || sellerUid;
    if (currentUid === effectiveBuyerUid) return "buyer";
    if (currentUid === effectiveSellerUid) return "seller";

    // Realtime chat props can briefly carry a stale participant UID. Fall back
    // to the user's Circle wallet address stored on the deal so the correct
    // controls still render, while the escrow contract itself enforces roles
    // via msg.sender (the Circle wallet address is the participant address).
    const connected = wallet.primaryAddress?.toLowerCase();
    if (connected && connected === deal?.buyerWallet?.toLowerCase()) return "buyer";
    if (connected && connected === deal?.sellerWallet?.toLowerCase()) return "seller";
    return null;
  }, [currentUid, buyerUid, sellerUid, deal?.buyerUid, deal?.sellerUid, deal?.buyerWallet, deal?.sellerWallet, wallet.primaryAddress]);

  const derivedState = useMemo(() => deriveDealStatus(deal) ?? null, [deal]);
  useEffect(() => {
    if (!deal?.escrow?.reviewDeadlineAt) return;
    setReviewNow(Date.now());
    const timer = window.setInterval(() => setReviewNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deal?.escrow?.reviewDeadlineAt]);
  const reviewRemaining = useMemo(() => reviewRemainingMs(deal, reviewNow), [deal, reviewNow]);
  const reviewElapsed = useMemo(() => isReviewElapsed(deal, reviewNow), [deal, reviewNow]);

  // Reconcile Firestore funding labels with the read-only on-chain source of
  // truth. This runs when the realtime deal snapshot changes; it does not poll
  // and never submits a transaction. Existing deposit hashes are preserved.
  useEffect(() => {
    const current = deal;
    const address = current?.escrow?.escrowAddress;
    if (
      !current ||
      !address ||
      !current.buyerWallet ||
      !current.sellerWallet ||
      current.escrow?.custodyMode !== "contract"
    ) return;

    const buyerStatus = current.escrow.funding.buyer?.status;
    const sellerStatus = current.escrow.funding.seller?.status;
    if (buyerStatus === "confirmed" && sellerStatus === "confirmed" && current.state === "FUNDED") return;

    let active = true;
    (async () => {
      try {
        const buyer = await fetchEscrowDeposit(address, current.buyerWallet!);
        const seller = await fetchEscrowDeposit(address, current.sellerWallet!);
        const buyerExpected = BigInt(Math.round((current.terms?.amount || 0) * 1_000_000));
        const sellerExpected = BigInt(Math.round(((current.terms?.amount || 0) * (current.terms?.collateralPercent || 0) / 100) * 1_000_000));
        if (!active) return;
        const patch: Record<string, unknown> = {};
        if (buyer === buyerExpected) patch["escrow.funding.buyer.status"] = "confirmed";
        if (seller === sellerExpected) patch["escrow.funding.seller.status"] = "confirmed";
        if (await fetchEscrowFunded(address)) patch.state = "FUNDED";
        if (Object.keys(patch).length) await patchDeal(roomId, current.dealId, patch);
      } catch (err) {
        console.warn("[DealEscrow] funding verification pending; RPC read failed", err);
      }
    })();
    return () => { active = false; };
  }, [
    roomId,
    deal?.dealId,
    deal?.escrow?.escrowAddress,
    deal?.escrow?.funding?.buyer?.status,
    deal?.escrow?.funding?.seller?.status,
    deal?.state,
    deal?.buyerWallet,
    deal?.sellerWallet,
  ]);

  useEffect(() => {
    const current = deal;
    const txHash = current?.escrow?.factoryTxHash;
    if (!current || current.escrow?.escrowAddress || !txHash || current.escrow.custodyMode !== "contract") return;
    let active = true;
    (async () => {
      for (const delay of [0, 500, 1000, 2000, 4000]) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          const address = await decodeEscrowAddressFromReceipt(txHash);
          if (active && address) {
            await patchDeal(roomId, current.dealId, { "escrow.escrowAddress": address, state: "AWAITING_FUNDING" });
            return;
          }
        } catch (err) { console.warn("[DealEscrow] creation verification pending", err); }
      }
    })();
    return () => { active = false; };
  }, [roomId, deal?.dealId, deal?.escrow?.factoryTxHash, deal?.escrow?.escrowAddress, deal?.escrow?.custodyMode]);

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
    // Always accept against the latest persisted agreement. This matters when
    // the agreement was just generated or the other participant accepted at
    // nearly the same time on another client.
    const current = await getLatestDeal(roomId);
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
        // Re-read after persisting this participant's consent. If the other
        // participant accepted concurrently, only advance once both persisted
        // consent records are present.
        const latest = await getLatestDeal(roomId);
        if (latest && latest.state === "AWAITING_ACCEPTANCE" && consentComplete(latest)) {
          const locked: DealAgreementSnapshot = { ...latest.agreement!, state: "locked", lockedAt: nowIso() };
          await writeAgreementSnapshot(roomId, latest.dealId, locked);
          await transitionDeal(roomId, latest.dealId, "AWAITING_ACCEPTANCE", "LOCKED", {
            "agreement.lockedAt": locked.lockedAt,
            "agreement.state": "locked",
          });
          await postDealSystemMessage(roomId, "🔒 Agreement locked. Both parties accepted. Escrow funding can now begin.");
          return;
        }
        await postDealSystemMessage(
          roomId,
          `${myRole === "buyer" ? "Buyer" : "Seller"} accepted agreement v${version}. Waiting for the other party…`
        );
      }
    });
  }, [runAction, roomId, myRole]);

  const beginFunding = useCallback(async () => {
    if (escrowCreationInFlightRef.current) return;
    const current = dealRef.current;
    if (!current?.terms) return;
    escrowCreationInFlightRef.current = true;
    await runAction("beginFunding", async () => {
      if (!myRole) throw new Error("Only a deal participant can create the escrow contract.");
      if (!currentUid) return;
      const claimed = await claimEscrowCreation(roomId, current.dealId, currentUid);
      if (!claimed) throw new Error("Escrow creation has already been started by the other participant.");
      try {
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
        onSubmitted: async (hash) => {
          await patchDeal(roomId, current.dealId, {
            escrow: {
              custodyMode: "contract",
              factoryTxHash: hash,
              funding: { buyer: { status: "pending" }, seller: { status: "pending" } },
            },
          });
          setInfo("Escrow creation submitted. Verifying on Arc…");
        },
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
      } finally {
        await releaseEscrowCreation(roomId, current.dealId, currentUid);
      }
    }).finally(() => { escrowCreationInFlightRef.current = false; });
  }, [runAction, roomId, wallet, amountFor, myRole, currentUid]);

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
        if (res.mode === "seam" || (!res.mainTxHash && !res.alreadyDeposited)) {
          throw new Error("On-chain funding unavailable (escrow contract not deployed).");
        }

        const expectedWei = BigInt(Math.round(amount * 1_000_000));
        let recordedWei: bigint;
        try {
          recordedWei = await fetchEscrowDeposit(current.escrow!.escrowAddress, from);
        } catch {
          throw new Error("Transaction confirmed. Verifying escrow state…");
        }
        if (recordedWei !== expectedWei) throw new Error("The confirmed escrow deposit amount does not match the expected obligation.");

        const toState = "FUNDING" as const;
        const fromState = current.state === "FUNDED" ? "FUNDED" : current.state;

        await transitionFundingLeg({
          roomId,
          dealId: current.dealId,
          role,
          from: fromState,
          to: toState,
          patch: {
            status: "confirmed",
            txHash: res.mainTxHash || current.escrow!.funding[role]?.txHash || null,
            amount,
            at: nowIso(),
            error: null,
          },
        });
        if (!res.mainTxHash) {
          await postDealSystemMessage(roomId, `${role === "buyer" ? "Buyer" : "Seller"} funding was recovered and verified on-chain.`);
        } else {
        await postDealSystemMessage(
          roomId,
          `${role === "buyer" ? "🛒 Buyer" : "🛍 Seller"} funded ${fmtUsdc(amount)} USDC (tx ${res.mainTxHash.slice(0, 10)}…).`
        );
        }
        if (await fetchEscrowFunded(current.escrow!.escrowAddress)) {
          await patchDeal(roomId, current.dealId, { state: "FUNDED" });
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
      let reviewTxHash: string | null = null;
      let deadline: number | null = null;
      if (current.escrow!.custodyMode === "contract" && current.escrow!.escrowAddress) {
        setBusyMessage("Starting the 24h review window on-chain…");
        const chain = await fetchEscrowOnChainStatus(current.escrow!.escrowAddress, current.buyerWallet || "", current.sellerWallet || "");
        if (!chain?.funded) throw new Error("Escrow is not fully funded on Arc Testnet yet.");
        deadline = chain.deadline || null;
        if (!deadline) {
        const { provider, from } = await wallet.getSigningContext(current.sellerWallet);
        if (from.toLowerCase() !== (current.sellerWallet || "").toLowerCase()) {
          throw new Error("Connect the seller wallet to start the review window.");
        }
        const res = await startReviewPeriod({
          escrowAddress: current.escrow!.escrowAddress,
          provider,
          from,
        });
        reviewTxHash = res.txHash;
        const after = await fetchEscrowOnChainStatus(current.escrow!.escrowAddress, current.buyerWallet || "", current.sellerWallet || "");
        deadline = after?.deadline || null;
        if (!deadline) throw new Error("Review started, but the on-chain deadline could not be verified.");
        }
      }

      const fromState = current.state === "DELIVERED" ? "DELIVERED" : "FUNDED";
      await transitionDeal(roomId, current.dealId, fromState, "BUYER_REVIEW", {
        delivery: current.delivery || { markedBy: "seller", at: nowIso() },
        "escrow.reviewStartedAt": deadline ? new Date(deadline * 1000).toISOString() : serverTimestamp(),
        "escrow.reviewDeadlineAt": deadline ? new Date(deadline * 1000).toISOString() : null,
        "escrow.reviewTxHash": reviewTxHash,
      });
      await postDealSystemMessage(
        roomId,
        `📦 Seller marked the deal as delivered. The 24-hour buyer review window has started${reviewTxHash ? ` (tx ${reviewTxHash.slice(0, 10)}…)` : ""}.`
      );
    });
  }, [runAction, roomId, wallet, myRole]);

  const continueToReview = useCallback(async () => {
    const current = dealRef.current;
    if (!current?.escrow || myRole !== "seller") return;
    const bothConfirmed =
      current.escrow.funding.buyer?.status === "confirmed" &&
      current.escrow.funding.seller?.status === "confirmed";
    if (!bothConfirmed) return;
    await markDeliveredAndStartReview();
  }, [markDeliveredAndStartReview, myRole]);

  const release = useCallback(async () => {
    const current = dealRef.current;
    if (!current?.escrow || myRole !== "buyer") return;
    let state = current.state;
    const hasReviewDeadline = !!current.escrow.reviewDeadlineAt;
    if (state !== "BUYER_REVIEW" && state !== "AUTO_RELEASE_DUE" && !hasReviewDeadline) return;
    await runAction("release", async () => {
      if (state !== "BUYER_REVIEW" && state !== "AUTO_RELEASE_DUE") {
        await transitionDeal(roomId, current.dealId, state, "BUYER_REVIEW");
        state = "BUYER_REVIEW";
      }
      if (current.escrow!.custodyMode === "seam" || !current.escrow!.escrowAddress) {
        throw new Error("On-chain release unavailable (escrow contract not deployed).");
      }
      setBusyMessage("Releasing funds to the seller…");
      const { provider, from } = await wallet.getSigningContext(current.buyerWallet);
      if (from.toLowerCase() !== (current.buyerWallet || "").toLowerCase()) {
        throw new Error("Connect the buyer wallet to release the escrow.");
      }
      const res = await buyerReleaseEscrow({
        escrowAddress: current.escrow!.escrowAddress,
        provider,
        from,
        onSubmitted: async (hash) => {
          await transitionDeal(roomId, current.dealId, state, "RELEASE_PENDING", {
            "escrow.releaseTxHash": hash,
          });
          state = "RELEASE_PENDING";
        },
      });
      if (res.mode === "seam" || !res.txHash) throw new Error("On-chain release unavailable.");
      let releasedState = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        releasedState = await fetchEscrowOnChainStatus(
          current.escrow!.escrowAddress,
          current.buyerWallet || "",
          current.sellerWallet || ""
        );
        if (releasedState?.released) break;
        if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, Math.min(6000, 1000 * 2 ** attempt)));
      }
      if (!releasedState?.released) {
        throw new Error(`Release submitted and confirmed, but payout verification is still pending. Hash: ${res.txHash}`);
      }
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
    continueToReview,
    release,
    triggerAutoRelease,
    disputeDeal,
    refundMyLeg,
    cancelDeal,
  };
}

export type DealWorkflowApi = ReturnType<typeof useDealWorkflow>;
