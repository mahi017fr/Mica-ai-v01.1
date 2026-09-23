// Bangladesh fiat payment domain — shared client contracts.
//
// Everything about BDT Send Money in one place: the private payment profile,
// the transfer record, the supported methods, and Bangladesh mobile number
// validation/normalization. No banking/PIN/OTP data ever appears here — the
// mobile number is ALWAYS private (stored only in the owner's private
// `user_pay_profiles/{uid}` document and read by the backend during a payout).

/** Payment methods surfaced in the BDT UI. bKash is the only live method. */
export const BD_PAYMENT_METHODS = [
  { id: "BKASH", label: "bKash", active: true, badge: "Active" },
  { id: "NAGAD", label: "Nagad", active: false, badge: "Coming Soon" },
  { id: "ROCKET", label: "Rocket", active: false, badge: "Coming Soon" },
] as const;

export type BdPaymentMethodId = "BKASH" | "NAGAD" | "ROCKET";

/** Server-verified transfer status. Only SUCCESS means money actually moved. */
export type BdTransferStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "CANCELLED";

/**
 * Private payment profile — stored at `user_pay_profiles/{uid}`.
 * The normalized mobile number is NEVER exposed to other users; Firestore rules
 * restrict this document to its owner + backend settlement.
 */
export interface BdPaymentProfile {
  uid: string;
  mobile: string; // canonical +8801XXXXXXXXX
  method: BdPaymentMethodId;
  verified: boolean;
  updatedAt: string;
}

/** A BDT transfer — mirrored from the server's `transfers/{transferId}`. */
export interface BdTransfer {
  transferId: string;
  senderId: string;
  recipientId: string;
  amount: number;
  currency: "BDT";
  method: BdPaymentMethodId;
  status: BdTransferStatus;
  provider: string;
  providerTransactionId?: string | null;
  note?: string | null;
  chatId?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

/**
 * Deal Room funding hold — SEPARATE from Send Money. The buyer's deal funds
 * are held until buyer approval, then settled to the seller (or refunded).
 * Mirrors `deal_funding/{fundingId}` on the server.
 */
export type DealFundingStatus =
  | "PAYMENT_PENDING"
  | "VERIFYING"
  | "FUNDED"
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "REFUNDED"
  | "FAILED";

export interface DealFundingRecord {
  fundingId: string;
  dealRoomId: string | null;
  dealId: string | null;
  buyerUid: string;
  sellerUid: string;
  amount: number;
  status: DealFundingStatus;
  provider: string;
  providerReference?: string | null;
  reason?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Bangladesh mobile number validation + normalization
// ---------------------------------------------------------------------------

export const BD_MOBILE_NORMALIZED = /^\+8801\d{9}$/;
export const BD_MOBILE_DISPLAY = /^1\d{9}$/;

/**
 * Normalize any reasonable Bangladeshi mobile input to the canonical
 * `+8801XXXXXXXXX` form. Accepts "01XXXXXXXXX", "8801XXXXXXXXX", "+8801XXXXXXXXX",
 * with spaces/dashes anywhere. Returns null when the number is not a valid BD
 * mobile number.
 */
export function normalizeBdMobile(raw: string): string | null {
  const digits = String(raw ?? "").replace(/[^0-9]/g, "");
  let national: string;
  if (digits.startsWith("880")) {
    national = digits.slice(3);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else {
    national = digits;
  }
  if (!BD_MOBILE_DISPLAY.test(national)) return null;
  return `+880${national}`;
}

export function isValidBdMobile(raw: string): boolean {
  return normalizeBdMobile(raw) !== null;
}