import { collection, addDoc } from "firebase/firestore";
import { db } from "../firebase";
import { PaymentRecord } from "./types";

/**
 * Persists a completed Arc USDC transfer so it can later be surfaced in
 * Wallet History / Payment History / Deal History (those pages are out of
 * scope for now — the storage layer is what this function establishes).
 *
 * Security notes:
 * - The record is created by the authenticated sender only (enforced in
 *   firestore.rules) and carries the verified wallets resolved from the DB.
 * - The transaction hash originates from the Arc App Kit (or, today, the
 *   placeholder adapter) — never from the client's manual input.
 */
export async function recordArcPayment(
  record: Omit<PaymentRecord, "id" | "type" | "network" | "asset" | "timestamp">
): Promise<PaymentRecord | null> {
  try {
    const payload: any = {
      type: "usdc_transfer",
      network: "arc",
      asset: "circle_usdc",
      senderId: record.senderId,
      senderUsername: record.senderUsername,
      senderWallet: (record.senderWallet || "").toLowerCase(),
      recipientId: record.recipientId,
      recipientUsername: record.recipientUsername,
      recipientWallet: (record.recipientWallet || "").toLowerCase(),
      amount: record.amount,
      fee: record.fee,
      transactionHash: record.transactionHash,
      status: record.status,
      timestamp: new Date().toISOString(),
    };
    if (record.chatId) payload.chatId = record.chatId;
    const docRef = await addDoc(collection(db, "payments"), payload);
    return { ...payload, id: docRef.id, type: "usdc_transfer" } as PaymentRecord;
  } catch (err) {
    console.error("Failed to record Arc payment:", err);
    return null;
  }
}
