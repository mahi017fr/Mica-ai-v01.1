import { useCallback, useEffect, useState } from "react";
import { deleteField, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useDealWorkflow } from "./useDealWorkflow";
import { getLatestDeal, nowIso, patchDeal } from "./dealFirestore";
import { DealTerms } from "./types";
import { roleConsented } from "./dealStatusMachine";

// Live AI deal-mediator UX layer.
//
// This hook wraps the EXISTING useDealWorkflow (all escrow / agreement /
// consent / funding / release logic is untouched and reused) and adds the two
// new pre-flow interactions that drive the progressive experience:
//
//   1. "Ready to deal?" — both parties confirm independently. Persisted on the
//      deal_room doc (`readiness.{uid}`) so it survives refresh / re-login.
//   2. "What are you dealing?" — deal terms are entered and then confirmed by
//      BOTH parties (`deal.termsConfirm`) before Mica analyzes them.
//
// Everything else derives its UI from the persisted deal doc / readiness, so
// the flow always resumes exactly where it left off.

export type ReadinessMap = Record<string, { ready?: boolean; at?: string }>;

export interface DealGuideParams {
  roomId: string | null;
  currentUid?: string;
  buyerUid?: string | null;
  sellerUid?: string | null;
  buyerWallet?: string;
  sellerWallet?: string;
  buyerName?: string;
  sellerName?: string;
}

export function useDealGuide(params: DealGuideParams) {
  const { roomId, currentUid, buyerUid, sellerUid } = params;
  const active = !!(roomId && buyerUid && sellerUid);

  // The full existing workflow API (deal subscription, funding, release, etc.).
  const wf = useDealWorkflow({
    roomId: roomId || "",
    currentUid,
    buyerUid: buyerUid || "",
    sellerUid: sellerUid || "",
    buyerWallet: params.buyerWallet,
    sellerWallet: params.sellerWallet,
    buyerName: params.buyerName,
    sellerName: params.sellerName,
  });

  // Readiness lives on the deal_room doc (shared, survives refresh).
  const [readiness, setReadiness] = useState<ReadinessMap>({});
  useEffect(() => {
    if (!roomId) {
      setReadiness({});
      return;
    }
    const unsub = onSnapshot(doc(db, "deal_rooms", roomId), (snap) => {
      setReadiness((snap.exists() && snap.data()?.readiness) || {});
    });
    return unsub;
  }, [roomId]);

  const myReady = currentUid ? !!readiness[currentUid]?.ready : false;
  const buyerReady = buyerUid ? !!readiness[buyerUid]?.ready : false;
  const sellerReady = sellerUid ? !!readiness[sellerUid]?.ready : false;
  const bothReady = active ? buyerReady && sellerReady : false;

  const myRole = wf.myRole;

  const confirmReady = useCallback(async () => {
    if (!active || !currentUid || !roomId) return;
    await updateDoc(doc(db, "deal_rooms", roomId), {
      [`readiness.${currentUid}`]: { ready: true, at: nowIso() },
    });
  }, [active, currentUid, roomId]);

  const unready = useCallback(async () => {
    if (!active || !currentUid || !roomId) return;
    await updateDoc(doc(db, "deal_rooms", roomId), {
      [`readiness.${currentUid}`]: { ready: false },
    });
  }, [active, currentUid, roomId]);

  // Deal info (terms) dual confirmation.
  const termsConfirm = wf.deal?.termsConfirm || {};
  const myTermsConfirmed = myRole ? !!termsConfirm[myRole] : false;
  const termsBothConfirmed = !!wf.deal?.terms && !!(termsConfirm.buyer && termsConfirm.seller);

  /**
   * Submit the deal terms. Clears the OTHER party's confirmation (they must
   * re-confirm after an edit) and clears any stale agreement / ai so a fresh
   * analysis is produced. Rewinds the state to SETUP if it already advanced
   * (e.g. "Request Changes" from the recommendation step). When this is the
   * LAST confirmation (the other party already confirmed), it immediately
   * kicks off the Mica analysis.
   */
  const submitDealInfo = useCallback(
    async (terms: DealTerms) => {
      const current = wf.deal;
      if (!current || !myRole || !roomId) return;
      const other = myRole === "buyer" ? "seller" : "buyer";
      const previousTerms = current.terms;
      const termsChanged =
        !!previousTerms &&
        (previousTerms.amount !== terms.amount ||
          previousTerms.collateralPercent !== terms.collateralPercent ||
          previousTerms.dealType !== terms.dealType ||
          previousTerms.description !== terms.description ||
          previousTerms.currency !== terms.currency ||
          previousTerms.network !== terms.network ||
          previousTerms.asset !== terms.asset);
      const patch: Record<string, unknown> = {
        terms,
        [`termsConfirm.${myRole}`]: { at: nowIso() },
      };
      // Preserve the other participant's confirmation when re-submitting the
      // same terms. A changed terms version invalidates the prior agreement
      // and requires the other participant to confirm again.
      if (termsChanged || !previousTerms) {
        patch[`termsConfirm.${other}`] = deleteField();
        if (current.agreement) patch.agreement = deleteField();
        if (current.consent) patch.consent = deleteField();
        if (current.ai) patch.ai = deleteField();
        if (current.state !== "SETUP") patch.state = "SETUP";
      }
      await patchDeal(roomId, current.dealId, patch);

      // Last party to confirm triggers the analysis. The subscription will
      // also confirm shortly after; the state guard in runAnalysis keeps the
      // workflow idempotent.
      const fresh = await getLatestDeal(roomId);
      if (fresh?.terms && fresh.termsConfirm?.buyer?.at && fresh.termsConfirm?.seller?.at) {
        await wf.saveTermsAndAnalyze(fresh.terms);
      }
    },
    [wf, myRole, roomId]
  );

  /**
   * Safety net: if both parties confirmed terms but the analysis never kicked
   * off (e.g. a simultaneous-confirm race), start it here. The state guard
   * (SETUP + no ai yet) makes this idempotent across both clients.
   */
  useEffect(() => {
    const d = wf.deal;
    if (
      active &&
      d &&
      d.terms &&
      d.state === "SETUP" &&
      !d.ai &&
      termsBothConfirmed
    ) {
      wf.saveTermsAndAnalyze(d.terms);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, termsBothConfirmed, wf.deal?.state, wf.deal?.ai, wf.deal?.termsConfirm]);

  const confirmDealInfo = useCallback(async () => {
    const current = wf.deal;
    if (!current || !myRole || !roomId) return;
    await patchDeal(roomId, current.dealId, {
      [`termsConfirm.${myRole}`]: { at: nowIso() },
    });
    // The confirmation control is also a valid final-confirmation path. Once
    // both persisted confirmations exist, kick off the existing analysis flow
    // immediately (the realtime effect remains a safety net).
    const fresh = await getLatestDeal(roomId);
    if (
      fresh?.terms &&
      fresh.termsConfirm?.buyer?.at &&
      fresh.termsConfirm?.seller?.at
    ) {
      await wf.saveTermsAndAnalyze(fresh.terms);
    }
  }, [wf.deal, myRole, roomId]);

  /**
   * "Accept Deal Protection": draft the final agreement (if not yet drafted)
   * and record THIS party's consent. The existing immutable agreement +
   * consent machinery is used unchanged.
   */
  const acceptProtection = useCallback(async () => {
    const current = wf.deal;
    if (!current || !myRole || !roomId) return;
    if (!current.agreement) {
      await wf.generateAgreement();
    }
    const fresh = await getLatestDeal(roomId);
    if (fresh?.agreement && !roleConsented(myRole, fresh)) {
      await wf.acceptAgreement();
    }
  }, [wf, myRole, roomId]);

  /** Manual recovery if analysis finished but the state transition was missed. */
  const continueAfterAnalysis = useCallback(async () => {
    const current = wf.deal;
    if (!current || !roomId) return;
    if (current.ai) {
      await patchDeal(roomId, current.dealId, { state: "NEGOTIATING" });
    } else if (current.terms) {
      await wf.saveTermsAndAnalyze(current.terms);
    }
  }, [wf, roomId]);

  return {
    ...wf,
    active,
    buyerName: params.buyerName,
    sellerName: params.sellerName,
    readiness,
    myReady,
    buyerReady,
    sellerReady,
    bothReady,
    confirmReady,
    unready,
    termsConfirm,
    myTermsConfirmed,
    termsBothConfirmed,
    submitDealInfo,
    confirmDealInfo,
    acceptProtection,
    continueAfterAnalysis,
  };
}

export type DealGuideApi = ReturnType<typeof useDealGuide>;
