import { DealDoc, DealRole, DealStatus, REVIEW_WINDOW_MS } from "./types";

// Deal state machine.
//
// Two layers cooperate:
//   1. EXPLICIT transitions — writes move the doc between states (UI actions,
//      AI analysis complete, consent, funding confirmations, delivery, etc.).
//   2. TIME-DERIVED transitions — `deriveDealStatus` recomputes the
//      authoritative state from Firestore server timestamps so the 24h
//      auto-release is NEVER driven by a client-side timer alone. When the
//      escrow contract is deployed, the contract's own block.timestamp guard is
//      the final enforcement; this layer keeps the UI honest in between.

export const TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  SETUP: ["AI_ANALYSIS", "NEGOTIATING", "EXPIRED", "CANCELLED"],
  AI_ANALYSIS: ["NEGOTIATING", "EXPIRED", "CANCELLED"],
  NEGOTIATING: ["NEGOTIATING", "AWAITING_ACCEPTANCE", "AI_ANALYSIS", "EXPIRED", "CANCELLED"],
  AWAITING_ACCEPTANCE: ["AWAITING_ACCEPTANCE", "LOCKED", "NEGOTIATING", "EXPIRED", "CANCELLED"],
  LOCKED: ["AWAITING_FUNDING", "NEGOTIATING", "EXPIRED", "CANCELLED"],
  AWAITING_FUNDING: ["FUNDING", "FUNDED", "EXPIRED", "CANCELLED"],
  FUNDING: ["FUNDING", "FUNDED", "EXPIRED", "CANCELLED"],
  FUNDED: ["ACTIVE", "DELIVERED", "BUYER_REVIEW", "DISPUTED", "CANCELLED"],
  ACTIVE: ["DELIVERED", "DISPUTED", "CANCELLED"],
  DELIVERED: ["BUYER_REVIEW", "DISPUTED", "CANCELLED"],
  BUYER_REVIEW: ["RELEASE_PENDING", "AUTO_RELEASE_DUE", "DISPUTED", "COMPLETED"],
  RELEASE_PENDING: ["COMPLETED", "DISPUTED", "AUTO_RELEASE_DUE"],
  AUTO_RELEASE_DUE: ["RELEASE_PENDING", "COMPLETED", "DISPUTED"],
  DISPUTED: ["RESOLVED", "CANCELLED"],
  RESOLVED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: DealStatus, to: DealStatus): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] || []).includes(to);
}

function toMs(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts === "number") return ts;
  if (ts.toDate && typeof ts.toDate === "function") return ts.toDate().getTime();
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : null;
}

export function reviewDeadlineMs(doc: DealDoc | undefined | null): number | null {
  // Contract mode: the escrow contract's own deadline (block.timestamp + 24h).
  if (doc?.escrow?.reviewDeadlineAt) return toMs(doc.escrow.reviewDeadlineAt);
  // Seam mode (state layer): deadline = review start + 24h window, computed
  // from the authoritative Firestore server timestamp.
  if (doc?.escrow?.reviewStartedAt) {
    const started = toMs(doc.escrow.reviewStartedAt);
    if (started != null) return started + REVIEW_WINDOW_MS;
  }
  return null;
}

export function reviewRemainingMs(doc: DealDoc | undefined | null, now = Date.now()): number {
  const deadline = reviewDeadlineMs(doc);
  if (deadline == null) return 0;
  return Math.max(0, deadline - now);
}

/**
 * Authoritative state derived from timestamps. Terminal states stay terminal;
 * once the 24h review window has elapsed without a release or a dispute, the
 * deal is due for auto-release regardless of what the stored state says.
 */
export function deriveDealStatus(doc: DealDoc | undefined | null, now = Date.now()): DealStatus | null {
  if (!doc?.state) return null;
  const s = doc.state;
  if (s === "COMPLETED" || s === "CANCELLED" || s === "EXPIRED" || s === "RESOLVED") return s;

  const escrow = doc.escrow;
  const deadline = reviewDeadlineMs(doc);
  const released = !!escrow?.releasedAt;
  const disputed = !!escrow?.dispute;

  if (deadline != null && !released && !disputed && now >= deadline) {
    return "AUTO_RELEASE_DUE";
  }
  if (deadline != null && !released && !disputed && now < deadline) {
    return "BUYER_REVIEW";
  }
  return s;
}

export function isReviewElapsed(doc: DealDoc | undefined | null, now = Date.now()): boolean {
  const deadline = reviewDeadlineMs(doc);
  return deadline != null && now >= deadline;
}

export function canFund(role: DealRole, doc: DealDoc | undefined | null): boolean {
  if (!doc) return false;
  const s = doc.state;
  if (s !== "AWAITING_FUNDING" && s !== "FUNDING" && s !== "FUNDED") return false;
  const leg = doc.escrow?.funding?.[role];
  return !leg || leg.status === "pending";
}

export function bothFunded(doc: DealDoc | undefined | null): boolean {
  if (!doc?.escrow?.funding) return false;
  const b = doc.escrow.funding.buyer;
  const s = doc.escrow.funding.seller;
  return b?.status === "confirmed" && s?.status === "confirmed";
}

export function consentComplete(doc: DealDoc | undefined | null): boolean {
  if (!doc?.consent || !doc.agreement) return false;
  const c = doc.consent;
  return (
    c.buyerAcceptedVersion === doc.agreement.version &&
    c.sellerAcceptedVersion === doc.agreement.version &&
    !!c.buyerAcceptedAt &&
    !!c.sellerAcceptedAt
  );
}

export function roleConsented(role: DealRole, doc: DealDoc | undefined | null): boolean {
  if (!doc?.consent || !doc.agreement) return false;
  const c = doc.consent;
  const key = role === "buyer" ? "buyerAcceptedVersion" : "sellerAcceptedVersion";
  return c[key] === doc.agreement.version && !!c[role === "buyer" ? "buyerAcceptedAt" : "sellerAcceptedAt"];
}

export function isDisputed(doc: DealDoc | undefined | null): boolean {
  return !!doc?.escrow?.dispute;
}

export function isSettled(doc: DealDoc | undefined | null): boolean {
  return (
    doc?.state === "COMPLETED" ||
    doc?.state === "CANCELLED" ||
    doc?.state === "RESOLVED" ||
    !!doc?.escrow?.releasedAt
  );
}

export const REVIEW_WINDOW = REVIEW_WINDOW_MS;

/** Ordered milestones for the timeline UI. */
export const TIMELINE: { status: DealStatus; label: string; icon: string }[] = [
  { status: "SETUP", label: "Setup", icon: "⚙️" },
  { status: "AI_ANALYSIS", label: "AI Analysis", icon: "🤖" },
  { status: "AWAITING_ACCEPTANCE", label: "Agreement", icon: "📄" },
  { status: "LOCKED", label: "Consent Locked", icon: "🔒" },
  { status: "AWAITING_FUNDING", label: "Escrow Funding", icon: "💰" },
  { status: "FUNDED", label: "Funded", icon: "✅" },
  { status: "ACTIVE", label: "Active", icon: "🚀" },
  { status: "BUYER_REVIEW", label: "Review (24h)", icon: "⏱️" },
  { status: "COMPLETED", label: "Completed", icon: "🏁" },
];

export function timelineIndex(status: DealStatus | null | undefined): number {
  if (!status) return 0;
  const idx = TIMELINE.findIndex((t) => t.status === status);
  return idx >= 0 ? idx : TIMELINE.length;
}
