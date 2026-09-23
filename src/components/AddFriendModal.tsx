import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, X, UserPlus, Loader2, Check, RefreshCw } from "lucide-react";
import { useChat } from "../context/ChatContext";
import { useBlock } from "../context/BlockContext";
import { getBlockMessage } from "../utils/blocking";
import { UserProfile } from "../types";

const normalize = (s: string) => s.trim().toLowerCase();

// Rank matches: exact username > exact display name > prefix > partial.
// Short queries (1 char) only surface exact matches so random users never show.
const rankMatch = (query: string, u: UserProfile): number => {
  const uname = normalize(u.username);
  const dname = normalize(u.displayName);
  const q = normalize(query);

  if (uname === q) return 0;
  if (dname === q) return 1;
  if (q.length < 2) return -1;
  if (uname.startsWith(q)) return 2;
  if (dname.startsWith(q)) return 3;
  if (uname.includes(q)) return 4;
  if (dname.includes(q)) return 5;
  return -1;
};

const AddFriendModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const {
    currentUser,
    friends,
    friendRequests,
    searchUsers,
    sendFriendRequest,
    acceptFriendRequest,
  } = useChat();
  const { canInteractWith } = useBlock();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(0);

  useEffect(() => {
    if (!open) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      activeRef.current += 1;
      setQuery("");
      setResults([]);
      setLoading(false);
      setSearched(false);
      setError(false);
      setSendingId(null);
      setAcceptingId(null);
    }
  }, [open]);

  // Debounced search so we don't hit Firestore on every keystroke.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const term = query.trim();
    if (!term) {
      activeRef.current += 1;
      setResults([]);
      setLoading(false);
      setSearched(false);
      setError(false);
      return;
    }

    setLoading(true);
    setError(false);
    debounceRef.current = setTimeout(async () => {
      const token = ++activeRef.current;
      try {
        const candidates = await searchUsers(term);
        if (token !== activeRef.current || !open) return;
        const ranked = candidates
          .map((u) => ({ u, rank: rankMatch(term, u) }))
          .filter((x) => x.rank >= 0)
          .sort(
            (a, b) =>
              a.rank - b.rank || a.u.displayName.localeCompare(b.u.displayName)
          )
          .slice(0, 12)
          .map((x) => x.u);
        setResults(ranked);
        setSearched(true);
      } catch (err) {
        console.error("AddFriend search failed:", err);
        if (token === activeRef.current) {
          setResults([]);
          setSearched(false);
          setError(true);
        }
      } finally {
        if (token === activeRef.current) setLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, searchUsers]);

  const handleSend = async (uid: string) => {
    if (!canInteractWith(uid)) return;
    setSendingId(uid);
    try {
      await sendFriendRequest(uid);
    } catch (err) {
      console.error("Send friend request failed:", err);
    } finally {
      setSendingId(null);
    }
  };

  const handleAccept = async (requestId: string, uid: string) => {
    if (!canInteractWith(uid)) return;
    setAcceptingId(requestId);
    try {
      await acceptFriendRequest(requestId);
    } catch (err) {
      console.error("Accept friend request failed:", err);
    } finally {
      setAcceptingId(null);
    }
  };

  const primaryBtnClass =
    "min-h-0 shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[#8B5CF6]/30 bg-[#8B5CF6]/10 px-3 py-2 text-[11px] font-semibold text-[#C4B5FD] hover:bg-[#8B5CF6]/20 hover:border-[#8B5CF6]/50 hover:text-[#EDE9FE] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:pointer-events-none";
  const mutedBtnClass =
    "min-h-0 shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-[#7E8AA6]";

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-[#0B0F17]/80 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 w-full max-w-[620px] sm:max-w-[540px] md:max-w-[620px] max-h-[85vh] flex flex-col bg-[#0C121B] border border-white/[0.08] rounded-[20px] shadow-[0_25px_90px_rgba(0,0,0,0.6),0_0_50px_rgba(108,92,224,0.08)] overflow-hidden backdrop-blur-xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between p-5 sm:p-7 pb-4">
              <div className="flex items-start gap-3">
                <UserPlus className="w-4 h-4 text-[#E8EAF2] mt-0.5 shrink-0" />
                <div>
                  <h3 className="text-[17px] sm:text-lg font-bold tracking-tight text-[#F8FAFC] leading-tight">
                    Add Friend
                  </h3>
                  <p className="text-[11px] sm:text-xs text-[#7E8AA6] mt-0.5">
                    Find people and connect on MICA
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                title="Close"
                className="min-h-0 p-1.5 -mr-1 rounded-lg text-[#7E8AA6] hover:text-white transition-colors duration-150 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search bar */}
            <div className="px-5 sm:px-7 pb-1">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by username or display name..."
                  autoComplete="off"
                  autoFocus
                  className="w-full h-[50px] bg-[#12172A] border border-white/[0.08] rounded-[14px] pl-11 pr-4 text-sm text-[#E8EAF2] placeholder-[#64748B] focus:outline-none focus:border-[#8B5CF6]/40 focus:ring-2 focus:ring-[#8B5CF6]/15 transition-all"
                />
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar mt-4 px-3 sm:px-5 min-h-0">
              {loading && (
                <div className="divide-y divide-white/[0.04]">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 sm:gap-3.5 py-3 px-1">
                      <div className="w-10 h-10 rounded-full bg-white/[0.06] animate-pulse shrink-0" />
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="h-3.5 w-28 max-w-[55%] rounded-full bg-white/[0.06] animate-pulse" />
                        <div className="h-2.5 w-20 max-w-[40%] rounded-full bg-white/[0.05] animate-pulse" />
                      </div>
                      <div className="w-20 h-8 rounded-lg bg-white/[0.06] animate-pulse shrink-0" />
                    </div>
                  ))}
                </div>
              )}

              {!loading && error && (
                <div className="py-10 px-4 text-center">
                  <RefreshCw className="w-6 h-6 text-[#475569] mx-auto mb-3" />
                  <p className="text-sm font-semibold text-[#E8EAF2]">
                    Something went wrong
                  </p>
                  <p className="text-[11px] text-[#7E8AA6] mt-1">
                    Please try again.
                  </p>
                </div>
              )}

              {!loading && !error && searched && results.length === 0 && (
                <div className="py-10 px-4 text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-white/[0.03] border border-white/[0.05] flex items-center justify-center">
                    <UserPlus className="w-5 h-5 text-[#475569]" />
                  </div>
                  <p className="text-sm font-semibold text-[#E8EAF2]">
                    No users found
                  </p>
                  <p className="text-[11px] text-[#7E8AA6] mt-1">
                    Try searching with a different username or display name.
                  </p>
                </div>
              )}

              {!loading && !searched && (
                <div className="py-10 px-4 text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-white/[0.03] border border-white/[0.05] flex items-center justify-center">
                    <Search className="w-5 h-5 text-[#475569]" />
                  </div>
                  <p className="text-sm font-semibold text-[#E8EAF2]">
                    Search the MICA community
                  </p>
                  <p className="text-[11px] text-[#7E8AA6] mt-1">
                    Find people by username or display name.
                  </p>
                </div>
              )}

              {!loading && !error && results.length > 0 && (
                <div className="divide-y divide-white/[0.04]">
                  {results.map((u) => {
                    const isFriend = friends.some((f) => f.uid === u.uid);
                    const isSent = friendRequests.some(
                      (r) =>
                        r.status === "pending" &&
                        r.senderId === currentUser?.uid &&
                        r.receiverId === u.uid
                    );
                    const incomingReq = friendRequests.find(
                      (r) =>
                        r.status === "pending" &&
                        r.receiverId === currentUser?.uid &&
                        r.senderId === u.uid
                    );
                    const blockedState = canInteractWith(u.uid);
                    const isOnline = u.status === "online";

                    return (
                      <div
                        key={u.uid}
                        className="flex items-center gap-3 sm:gap-3.5 py-3 px-1 rounded-[14px] hover:bg-white/[0.03] transition-colors duration-150"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="relative shrink-0">
                            <img
                              src={u.avatarUrl}
                              alt={u.displayName}
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover bg-[#0B0F17] border border-white/[0.05]"
                            />
                            <span
                              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0C121B] ${
                                isOnline ? "bg-emerald-400" : "bg-[#475569]"
                              }`}
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] sm:text-sm font-semibold text-[#F8FAFC] truncate">
                              {u.displayName}
                            </p>
                            <p className="text-[11px] text-[#7E8AA6] truncate font-mono mt-0.5">
                              @{u.username}
                            </p>
                            <p
                              className={`text-[9px] uppercase tracking-wider font-semibold mt-1 ${
                                isOnline ? "text-emerald-400/80" : "text-[#475569]"
                              }`}
                            >
                              {isOnline ? "Online" : "Offline"}
                            </p>
                          </div>
                        </div>

                        {isFriend ? (
                          <span className={mutedBtnClass}>
                            <Check className="w-3.5 h-3.5 text-emerald-400/80" />
                            Friends
                          </span>
                        ) : isSent ? (
                          <span className={mutedBtnClass}>
                            <Check className="w-3.5 h-3.5 text-[#A78BFA]" />
                            Request Sent
                          </span>
                        ) : incomingReq ? (
                          <button
                            type="button"
                            onClick={() => handleAccept(incomingReq.id, u.uid)}
                            disabled={acceptingId === incomingReq.id}
                            className={primaryBtnClass}
                          >
                            {acceptingId === incomingReq.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <UserPlus className="w-3.5 h-3.5" />
                            )}
                            Accept Request
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSend(u.uid)}
                            disabled={sendingId === u.uid || !blockedState}
                            title={
                              blockedState
                                ? `Add ${u.displayName}`
                                : getBlockMessage(u.uid) || "Cannot send a friend request to this user."
                            }
                            className={`${primaryBtnClass} ${
                              blockedState ? "" : "opacity-40"
                            }`}
                          >
                            {sendingId === u.uid ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <UserPlus className="w-3.5 h-3.5" />
                            )}
                            Add Friend
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 mt-4 pt-3 pb-4 border-t border-white/[0.04] px-5 sm:px-7">
              <p className="text-[10px] text-[#475569] text-center">
                Connect with people and build your network on MICA.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default AddFriendModal;