// AI-guided Deal Agreement + Arc USDC Escrow domain types.
//
// The deal document lives at `deal_rooms/{roomId}/deals/{dealId}` and drives a
// strict state machine (see dealStatusMachine.ts). Every financial transition
// (funding leg, review window, release, dispute) is anchored to a REAL Arc
// on-chain transaction hash when the escrow contract is deployed, or is
// explicitly recorded as `custodyMode: "seam"` (no contract deployed yet) —
// never faked as confirmed on-chain.

export type DealStatus =
  | "SETUP"
  | "AI_ANALYSIS"
  | "NEGOTIATING"
  | "AWAITING_ACCEPTANCE"
  | "LOCKED"
  | "AWAITING_FUNDING"
  | "FUNDING"
  | "FUNDED"
  | "ACTIVE"
  | "DELIVERED"
  | "BUYER_REVIEW"
  | "RELEASE_PENDING"
  | "AUTO_RELEASE_DUE"
  | "DISPUTED"
  | "RESOLVED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

export type DealRole = "buyer" | "seller";

export type EscrowCustodyMode = "contract" | "seam";

export interface DealTerms {
  dealType: string;
  description: string;
  amount: number;
  currency: "USDC";
  network: "arc";
  asset: "circle_usdc";
  collateralPercent: number;
}

export interface AiRecommendation {
  version: number;
  generatedAt: string;
  recommendation: string;
  mechanism: string;
  protection: string[];
  milestones: string[];
  risks: string[];
  collateralNote: string;
  source: "mica" | "local_fallback";
}

export interface DealConsent {
  buyerAcceptedVersion?: number;
  buyerAcceptedAt?: string;
  sellerAcceptedVersion?: number;
  sellerAcceptedAt?: string;
}

/** Dual confirmation of the deal terms (deal info step) before Mica analyzes. */
export interface DealTermsConfirm {
  buyer?: { at?: string };
  seller?: { at?: string };
}

/**
 * Per-participant re-analysis request state, keyed by the participant UID
 * (`reanalysis.{uid}`). Re-analysis is an INDIVIDUAL action: it must never
 * flip the shared deal state, wipe the other participant's confirmation, or
 * delete the current recommendation before a NEW shared version is generated.
 */
export interface DealReanalysisState {
  requestedAt?: string;
  processing?: boolean;
  version?: number;
  completedAt?: string;
}

export interface FundingLeg {
  status: "pending" | "submitted" | "confirmed" | "refunded";
  txHash?: string;
  amount?: number;
  at?: string;
  error?: string;
}

export interface DealEscrowInfo {
  custodyMode: EscrowCustodyMode;
  factoryTxHash?: string;
  escrowAddress?: string;
  createdAt?: string;
  funding: {
    buyer: FundingLeg;
    seller: FundingLeg;
  };
  reviewStartedAt?: string;
  reviewDeadlineAt?: any;
  releaseTxHash?: string;
  releaseMethod?: "buyer_release" | "auto_release";
  releasedAt?: string;
  dispute?: {
    by: DealRole;
    reason: string;
    at: string;
    txHash?: string;
  };
  resolution?: {
    note?: string;
    at?: string;
    txHash?: string;
  };
}

export interface DealAgreementSnapshot {
  version: number;
  title: string;
  terms: DealTerms;
  ai?: AiRecommendation;
  clauses: string[];
  contentHash: string;
  writtenBy: string;
  writtenAt: string;
  lockedAt?: string;
  state: "draft" | "proposed" | "locked";
}

export interface DealDelivery {
  markedBy: DealRole;
  at: string;
  note?: string;
}

export interface DealResult {
  method: "buyer_release" | "auto_release" | "resolution" | "cancel_refund" | "expired";
  at: string;
  txHash?: string;
  note?: string;
}

export interface DealDoc {
  dealId: string;
  roomId: string;
  createdAt: any;
  updatedAt: any;
  state: DealStatus;
  createdBy: string;
  buyerUid: string;
  sellerUid: string;
  buyerWallet?: string;
  sellerWallet?: string;
  terms?: DealTerms;
  termsConfirm?: DealTermsConfirm;
  reanalysis?: Record<string, DealReanalysisState>;
  ai?: AiRecommendation;
  agreement?: DealAgreementSnapshot;
  consent?: DealConsent;
  escrow?: DealEscrowInfo;
  delivery?: DealDelivery;
  result?: DealResult;
  cancelNote?: string;
  expiryAt?: any;
}

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  SETUP: "Setup",
  AI_ANALYSIS: "AI Analysis",
  NEGOTIATING: "Negotiating",
  AWAITING_ACCEPTANCE: "Awaiting Consent",
  LOCKED: "Agreement Locked",
  AWAITING_FUNDING: "Awaiting Funding",
  FUNDING: "Funding Escrow",
  FUNDED: "Funded",
  ACTIVE: "Active",
  DELIVERED: "Delivered",
  BUYER_REVIEW: "Buyer Review",
  RELEASE_PENDING: "Releasing",
  AUTO_RELEASE_DUE: "Auto-Release Due",
  DISPUTED: "Disputed",
  RESOLVED: "Resolved",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

export function fmtUsdc(n: number | undefined | null): string {
  if (!Number.isFinite(n as number)) return "0.00";
  return (n as number).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function shortAddress(addr?: string | null): string {
  if (!addr) return "—";
  const a = addr.toLowerCase();
  return a.length <= 10 ? a : `${a.slice(0, 6)}...${a.slice(-4)}`;
}
