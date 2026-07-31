/**
 * Modular block/unblock helpers.
 *
 * Source of truth lives in Firestore (`blocks` collection), owned by
 * `BlockContext`. This module is a synchronous in-memory mirror of that state,
 * updated by `BlockContext` via `setBlockCache`. Non-React guards (message
 * send, call start, payments, deal-room invites, friend requests) read through
 * these functions so they stay simple and cheap.
 *
 * Two directions are tracked:
 *  - "blocked"     (uids the current user blocked)
 *  - "blockedBy"   (uids that blocked the current user)
 *
 * `isUserBlocked(uid)` is true for EITHER direction: a blocked relationship is
 * always mutual for interaction purposes (the blocker and the blocked user are
 * both prevented from interacting).
 */

let blockedUids: string[] = [];
let blockedByUids: string[] = [];

export const setBlockCache = (
  blocked: string[],
  blockedBy: string[]
): void => {
  blockedUids = blocked;
  blockedByUids = blockedBy;
};

export const clearBlockCache = (): void => {
  blockedUids = [];
  blockedByUids = [];
};

export const getBlockedUids = (): string[] => blockedUids;

export const getBlockedByUids = (): string[] => blockedByUids;

/** True when the current user has blocked the given user. */
export const iBlocked = (uid: string | undefined | null): boolean => {
  if (!uid) return false;
  return blockedUids.includes(uid);
};

/** True when the given user has blocked the current user. */
export const blockedMe = (uid: string | undefined | null): boolean => {
  if (!uid) return false;
  return blockedByUids.includes(uid);
};

/** True when the relationship is blocked in EITHER direction. */
export const isUserBlocked = (uid: string | undefined | null): boolean =>
  iBlocked(uid) || blockedMe(uid);

/** Human-readable copy for a blocked relationship. */
export const getBlockMessage = (
  uid: string | undefined | null
): string | null => {
  if (!uid) return null;
  if (blockedMe(uid)) {
    return "You cannot interact with this user because they have blocked you.";
  }
  if (iBlocked(uid)) {
    return "You blocked this user.";
  }
  return null;
};
