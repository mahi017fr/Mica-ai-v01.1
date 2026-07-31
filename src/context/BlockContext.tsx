import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { BlockRecord } from "../types";
import { useChat } from "./ChatContext";
import { setBlockCache, clearBlockCache } from "../utils/blocking";

interface BlockContextType {
  /** Uids the current user has blocked. */
  blockedUids: string[];
  /** Uids that have blocked the current user. */
  blockedByUids: string[];
  /** True once the initial Firestore snapshots have resolved. */
  blocksLoaded: boolean;
  iBlocked: (uid: string | undefined | null) => boolean;
  blockedBy: (uid: string | undefined | null) => boolean;
  canInteractWith: (uid: string | undefined | null) => boolean;
  blockUser: (uid: string) => Promise<void>;
  unblockUser: (uid: string) => Promise<void>;
}

const BlockContext = createContext<BlockContextType | null>(null);

export const useBlock = (): BlockContextType => {
  const ctx = useContext(BlockContext);
  if (!ctx) {
    throw new Error("useBlock must be used within a BlockProvider");
  }
  return ctx;
};

export const BlockProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { currentUser, userProfile } = useChat();
  const uid = userProfile?.uid ?? currentUser?.uid ?? null;

  const [blockedUids, setBlockedUids] = useState<string[]>([]);
  const [blockedByUids, setBlockedByUids] = useState<string[]>([]);
  const [blocksLoaded, setBlocksLoaded] = useState(false);

  const uidRef = useRef<string | null>(uid);
  const blockedUidsRef = useRef<string[]>([]);
  const blockedByUidsRef = useRef<string[]>([]);

  useEffect(() => {
    uidRef.current = uid;
  }, [uid]);
  useEffect(() => {
    blockedUidsRef.current = blockedUids;
  }, [blockedUids]);
  useEffect(() => {
    blockedByUidsRef.current = blockedByUids;
  }, [blockedByUids]);

  // Real-time listeners mirroring the `blocks` collection in both directions.
  useEffect(() => {
    setBlocksLoaded(false);
    clearBlockCache();

    if (!uid) {
      setBlockedUids([]);
      setBlockedByUids([]);
      return;
    }

    const apply = (
      blocked: string[],
      blockedBy: string[]
    ) => {
      blockedUidsRef.current = blocked;
      blockedByUidsRef.current = blockedBy;
      setBlockedUids(blocked);
      setBlockedByUids(blockedBy);
      setBlockCache(blocked, blockedBy);
      setBlocksLoaded(true);
    };

    const qBlockedByMe = query(
      collection(db, "blocks"),
      where("blockerUid", "==", uid)
    );
    const qBlockedMe = query(
      collection(db, "blocks"),
      where("blockedUid", "==", uid)
    );

    const unsubBlockedByMe = onSnapshot(
      qBlockedByMe,
      (snap) => {
        const blocked = snap.docs
          .map((d) => (d.data() as BlockRecord).blockedUid)
          .filter(Boolean);
        apply(blocked, blockedByUidsRef.current);
      },
      () => {}
    );

    const unsubBlockedMe = onSnapshot(
      qBlockedMe,
      (snap) => {
        const blockedBy = snap.docs
          .map((d) => (d.data() as BlockRecord).blockerUid)
          .filter(Boolean);
        apply(blockedUidsRef.current, blockedBy);
      },
      () => {}
    );

    return () => {
      unsubBlockedByMe();
      unsubBlockedMe();
      clearBlockCache();
    };
  }, [uid]);

  const blockUser = useCallback(
    async (targetUid: string) => {
      if (!uidRef.current || !targetUid || targetUid === uidRef.current) return;
      const blockId = `${uidRef.current}_${targetUid}`;
      // Optimistic local update; server rules keep the doc canonical.
      setBlockedUids((prev) =>
        prev.includes(targetUid) ? prev : [...prev, targetUid]
      );
      await setDoc(doc(db, "blocks", blockId), {
        blockerUid: uidRef.current,
        blockedUid: targetUid,
        blockedAt: serverTimestamp(),
      });
    },
    []
  );

  const unblockUser = useCallback(async (targetUid: string) => {
    if (!uidRef.current || !targetUid) return;
    const blockId = `${uidRef.current}_${targetUid}`;
    setBlockedUids((prev) => prev.filter((id) => id !== targetUid));
    await deleteDoc(doc(db, "blocks", blockId));
  }, []);

  const value = useMemo<BlockContextType>(
    () => ({
      blockedUids,
      blockedByUids,
      blocksLoaded,
      iBlocked: (targetUid) =>
        !!targetUid && blockedUids.includes(targetUid),
      blockedBy: (targetUid) =>
        !!targetUid && blockedByUids.includes(targetUid),
      canInteractWith: (targetUid) =>
        !!targetUid &&
        !blockedUids.includes(targetUid) &&
        !blockedByUids.includes(targetUid),
      blockUser,
      unblockUser,
    }),
    [blockedUids, blockedByUids, blocksLoaded, blockUser, unblockUser]
  );

  return (
    <BlockContext.Provider value={value}>{children}</BlockContext.Provider>
  );
};
