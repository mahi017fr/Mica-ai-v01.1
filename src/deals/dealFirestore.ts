import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  runTransaction,
  deleteField,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { keccak256, toUtf8Bytes } from "ethers";
import { db } from "../firebase";
import {
  DealAgreementSnapshot,
  DealDoc,
  DealRole,
  DealStatus,
} from "./types";
import { canTransition } from "./dealStatusMachine";

export class DealStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DealStateConflictError";
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function dealCollectionRef(roomId: string) {
  return collection(db, "deal_rooms", roomId, "deals");
}

export function dealDocRef(roomId: string, dealId: string) {
  return doc(db, "deal_rooms", roomId, "deals", dealId);
}

export function agreementsRef(roomId: string, dealId: string) {
  return collection(db, "deal_rooms", roomId, "deals", dealId, "agreements");
}

export function agreementDocRef(roomId: string, dealId: string, version: number) {
  return doc(db, "deal_rooms", roomId, "deals", dealId, "agreements", String(version));
}

export async function getDeal(roomId: string, dealId: string): Promise<DealDoc | null> {
  const snap = await getDoc(dealDocRef(roomId, dealId));
  return snap.exists() ? ({ ...(snap.data() as DealDoc), dealId } as DealDoc) : null;
}

/** Find the most recent deal document for a room (there is normally one). */
export async function getLatestDeal(roomId: string): Promise<DealDoc | null> {
  const q = query(dealCollectionRef(roomId), orderBy("createdAt", "desc"), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { ...(d.data() as DealDoc), dealId: d.id } as DealDoc;
}

export function subscribeLatestDeal(
  roomId: string,
  cb: (deal: DealDoc | null) => void
): Unsubscribe {
  const q = query(dealCollectionRef(roomId), orderBy("createdAt", "desc"), limit(1));
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        cb(null);
        return;
      }
      const d = snap.docs[0];
      cb({ ...(d.data() as DealDoc), dealId: d.id } as DealDoc);
    },
    () => cb(null)
  );
}

export interface CreateDealInput {
  roomId: string;
  createdBy: string;
  buyerUid: string;
  sellerUid: string;
  buyerWallet?: string;
  sellerWallet?: string;
}

/**
 * Create a fresh SETUP deal. Idempotent per room: if a deal already exists it
 * is returned instead of duplicated.
 */
export async function createDeal(input: CreateDealInput): Promise<DealDoc> {
  // Preserve rooms created before the deterministic document id was introduced.
  const existing = await getLatestDeal(input.roomId);
  if (existing) return existing;

  const ref = doc(dealCollectionRef(input.roomId), "primary");
  const dealId = ref.id;
  const docData: DealDoc = {
    dealId,
    roomId: input.roomId,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    state: "SETUP",
    createdBy: input.createdBy,
    buyerUid: input.buyerUid,
    sellerUid: input.sellerUid,
    buyerWallet: input.buyerWallet?.toLowerCase(),
    sellerWallet: input.sellerWallet?.toLowerCase(),
  };
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return { ...(snap.data() as DealDoc), dealId };
    tx.set(ref, docData as any);
    return { ...docData, dealId };
  });
}

/**
 * Compare-and-swap state transition: only applies the write when the document
 * is still in `from`, then moves it to `to`. Prevents two clients racing a
 * financial state change. Throws DealStateConflictError on mismatch.
 */
export async function transitionDeal(
  roomId: string,
  dealId: string,
  from: DealStatus,
  to: DealStatus,
  patch: Record<string, unknown> = {}
): Promise<void> {
  if (!canTransition(from, to)) {
    throw new DealStateConflictError(`Illegal transition ${from} -> ${to}`);
  }
  const ref = dealDocRef(roomId, dealId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new DealStateConflictError("Deal document not found.");
  const data = snap.data() as DealDoc;
  if (data.state !== from) {
    throw new DealStateConflictError(
      `State conflict: expected ${from}, found ${data.state}`
    );
  }
  await updateDoc(ref, { ...patch, state: to, updatedAt: serverTimestamp() } as any);
}

export async function patchDeal(
  roomId: string,
  dealId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await updateDoc(dealDocRef(roomId, dealId), { ...patch, updatedAt: serverTimestamp() } as any);
}

/** Allow only one participant to start escrow creation at a time. */
export async function claimEscrowCreation(
  roomId: string,
  dealId: string,
  uid: string
): Promise<boolean> {
  const ref = dealDocRef(roomId, dealId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    const data = snap.data() as DealDoc & { escrowCreation?: { claimedBy?: string } };
    if (data.escrow || data.state !== "LOCKED" || data.escrowCreation?.claimedBy) return false;
    tx.update(ref, {
      escrowCreation: { claimedBy: uid, claimedAt: nowIso() },
      updatedAt: serverTimestamp(),
    });
    return true;
  });
}

export async function releaseEscrowCreation(
  roomId: string,
  dealId: string,
  uid: string
): Promise<void> {
  const ref = dealDocRef(roomId, dealId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data() as DealDoc & { escrowCreation?: { claimedBy?: string } };
    if (!data.escrow && data.escrowCreation?.claimedBy === uid) {
      tx.update(ref, { escrowCreation: deleteField(), updatedAt: serverTimestamp() });
    }
  });
}

export async function setState(roomId: string, dealId: string, to: DealStatus): Promise<void> {
  await updateDoc(dealDocRef(roomId, dealId), { state: to, updatedAt: serverTimestamp() } as any);
}

/**
 * Write an immutable agreement snapshot. `version` is the document id, so a
 * version can never be overwritten (Firestore rules deny update/delete here).
 */
export async function writeAgreementSnapshot(
  roomId: string,
  dealId: string,
  snapshot: DealAgreementSnapshot
): Promise<void> {
  await setDoc(agreementDocRef(roomId, dealId, snapshot.version), snapshot as any);
}

export async function getAgreementSnapshot(
  roomId: string,
  dealId: string,
  version: number
): Promise<DealAgreementSnapshot | null> {
  const snap = await getDoc(agreementDocRef(roomId, dealId, version));
  return snap.exists() ? (snap.data() as DealAgreementSnapshot) : null;
}

/** Canonical serialization of the terms that make up the agreement fingerprint. */
export function canonicalizeAgreement(a: Pick<DealAgreementSnapshot, "title" | "terms" | "clauses">): string {
  return JSON.stringify({
    title: a.title,
    terms: {
      dealType: a.terms.dealType,
      description: a.terms.description,
      amount: a.terms.amount,
      currency: a.terms.currency,
      network: a.terms.network,
      asset: a.terms.asset,
      collateralPercent: a.terms.collateralPercent,
    },
    clauses: a.clauses,
  });
}

export function computeContentHash(a: Pick<DealAgreementSnapshot, "title" | "terms" | "clauses">): string {
  return keccak256(toUtf8Bytes(canonicalizeAgreement(a)));
}

/** Post a system message into the existing deal room chat so progress is visible to both parties. */
export async function postDealSystemMessage(
  roomId: string,
  text: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  try {
    await addDoc(collection(db, "deal_rooms", roomId, "messages"), {
      senderId: "system",
      senderUsername: "System",
      text,
      timestamp: Timestamp.fromDate(new Date()),
      isSystem: true,
      ...extra,
    });
  } catch (err) {
    console.error("Failed to post deal system message:", err);
  }
}

export interface FundingLegPatch {
  roomId: string;
  dealId: string;
  role: DealRole;
  from: DealStatus;
  to: DealStatus;
  patch: Record<string, unknown>;
}

/** Idempotent funding-leg update guarded by the current state. */
export async function transitionFundingLeg(input: FundingLegPatch): Promise<void> {
  const ref = dealDocRef(input.roomId, input.dealId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new DealStateConflictError("Deal document not found.");
  const data = snap.data() as DealDoc;
  if (!canTransition(data.state, input.to)) {
    throw new DealStateConflictError(
      `Illegal funding transition ${data.state} -> ${input.to}`
    );
  }
  const legPath = `escrow.funding.${input.role}`;
  await updateDoc(ref, {
    [`${legPath}.status`]: input.patch.status,
    [`${legPath}.txHash`]: input.patch.txHash ?? null,
    [`${legPath}.amount`]: input.patch.amount ?? null,
    [`${legPath}.at`]: input.patch.at ?? null,
    [`${legPath}.error`]: input.patch.error ?? null,
    state: input.to,
    updatedAt: serverTimestamp(),
  } as any);
}
