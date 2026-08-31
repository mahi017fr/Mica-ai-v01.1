import React, { useState, useEffect, useRef } from "react";
import { useChat } from "../context/ChatContext";
import { db } from "../firebase";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  runTransaction,
  onSnapshot,
  query,
  where,
  orderBy,
  deleteDoc,
  Timestamp,
} from "firebase/firestore";
import { DealRoomDoc, DealRoomMessage, DealRoomInvitation, UserProfile } from "../types";
import DealGuidePanel from "./deals/guide/DealGuide";
import { ReadyDealGate } from "./deals/guide/ReadyDealCard";
import { DealGuideProvider } from "../deals/DealGuideContext";
import { isUserBlocked } from "../utils/blocking";
import { motion, AnimatePresence } from "motion/react";
import { Live2DCharacter } from "./Live2DCharacter";
import {
  ArrowLeft,
  Plus,
  Search,
  Send,
  Image as ImageIcon,
  Clock,
  Users,
  Shield,
  Check,
  X,
  Loader2,
  Handshake,
  Timer,
  Trash2,
  AlertTriangle,
  Lock,
  Hash,
  Camera,
  Mic,
  MapPin,
} from "lucide-react";

interface DealRoomProps {
  onBack: () => void;
}

type DealRoomView = "list" | "create" | "room";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s}s`;
}

function formatCreatedTime(ts: any): string {
  if (!ts) return "";
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getInviteRemainingMs(inv: DealRoomInvitation): number {
  if (inv.createdAt) {
    const createdMs = inv.createdAt?.toDate ? inv.createdAt.toDate().getTime() : new Date(inv.createdAt).getTime();
    return Math.max(0, createdMs + 24 * 60 * 60 * 1000 - Date.now());
  }
  return 0;
}

const DealRoom: React.FC<DealRoomProps> = ({ onBack }) => {
  const { currentUser, userProfile, friends, searchUsers } = useChat();

  const [view, setView] = useState<DealRoomView>("list");
  const [rooms, setRooms] = useState<DealRoomDoc[]>([]);
  const [invitations, setInvitations] = useState<DealRoomInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeRoom, setActiveRoom] = useState<DealRoomDoc | null>(null);

  // Create room state
  const [newRoomTitle, setNewRoomTitle] = useState("");
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteResults, setInviteResults] = useState<UserProfile[]>([]);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [selectedInvitees, setSelectedInvitees] = useState<UserProfile[]>([]);
  const [creatingRoom, setCreatingRoom] = useState(false);

  // Room view state
  const [roomMessages, setRoomMessages] = useState<DealRoomMessage[]>([]);
  const [msgText, setMsgText] = useState("");
  const [sending, setSending] = useState(false);
  const [roomParticipants, setRoomParticipants] = useState<UserProfile[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [roomExpired, setRoomExpired] = useState(false);
  const [dealSummary, setDealSummary] = useState("");
  const [editingSummary, setEditingSummary] = useState(false);
  const [summarySaving, setSummarySaving] = useState(false);
  const [acceptingInvite, setAcceptingInvite] = useState<string | null>(null);
  const [decliningInvite, setDecliningInvite] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, "buyer" | "seller">>({});

  // Countdown per invitation
  const [inviteCountdowns, setInviteCountdowns] = useState<Record<string, number>>({});

  // Listen for rooms the user is part of
  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);

    const unsubscribes: (() => void)[] = [];

    // Rooms where user is a participant (only accepted participants can see rooms)
    const roomsQuery = query(
      collection(db, "deal_rooms"),
      where("participants", "array-contains", currentUser.uid)
    );
    const unsubRooms = onSnapshot(roomsQuery, (snap) => {
      const roomList: DealRoomDoc[] = [];
      snap.forEach((d) => {
        const data = d.data() as Omit<DealRoomDoc, "id">;
        roomList.push({ ...data, id: d.id });
      });
      setRooms(roomList);
      setLoading(false);
    }, () => setLoading(false));
    unsubscribes.push(unsubRooms);

    // Invitations sent to the user (pending only)
    const invQuery = query(
      collection(db, "deal_room_invitations"),
      where("invitedUserId", "==", currentUser.uid),
      where("status", "==", "pending")
    );
    const unsubInv = onSnapshot(invQuery, (snap) => {
      const invList: DealRoomInvitation[] = [];
      snap.forEach((d) => {
        const inv = d.data() as DealRoomInvitation;
        // Never surface invitations from users you have blocked.
        if (isUserBlocked(inv.invitedBy)) return;
        invList.push({ ...inv, id: d.id });
      });
      setInvitations(invList);
    });
    unsubscribes.push(unsubInv);

    return () => unsubscribes.forEach((u) => u());
  }, [currentUser?.uid]);

  // Countdown for invitations
  useEffect(() => {
    if (invitations.length === 0) return;
    const tick = () => {
      const next: Record<string, number> = {};
      invitations.forEach((inv) => {
        next[inv.id] = getInviteRemainingMs(inv);
      });
      setInviteCountdowns(next);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [invitations]);

  // Close attachment menu on click outside
  useEffect(() => {
    if (!showAttachmentMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(e.target as Node)) {
        setShowAttachmentMenu(false);
      }
    };
    // Delay adding listener so the same click that opened it doesn't close it
    const timer = setTimeout(() => document.addEventListener("click", handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
    };
  }, [showAttachmentMenu]);

  // Listen for messages in active room
  useEffect(() => {
    if (!activeRoomId) {
      setRoomMessages([]);
      return;
    }
    const msgQuery = query(
      collection(db, "deal_rooms", activeRoomId, "messages"),
      orderBy("timestamp", "asc")
    );
    const unsub = onSnapshot(msgQuery, (snap) => {
      const msgs: DealRoomMessage[] = [];
      snap.forEach((d) => msgs.push({ ...(d.data() as DealRoomMessage), id: d.id }));
      setRoomMessages(msgs);
    });
    return () => unsub();
  }, [activeRoomId]);

  // Keep the active room and role state in sync from the same realtime snapshot.
  useEffect(() => {
    if (!activeRoomId) {
      setSelectedRoles({});
      return;
    }
    const unsub = onSnapshot(doc(db, "deal_rooms", activeRoomId), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as DealRoomDoc;
        setActiveRoom((prev) => prev ? { ...prev, ...data, id: activeRoomId } : { ...data, id: activeRoomId });
        setSelectedRoles(data.selectedRoles || {});
      }
    });
    return () => unsub();
  }, [activeRoomId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [roomMessages]);

  // Countdown timer for active room
  useEffect(() => {
    if (!activeRoom) return;
    const expiresAt = activeRoom.expiresAt?.toDate?.()
      ? activeRoom.expiresAt.toDate().getTime()
      : new Date(activeRoom.expiresAt).getTime();

    const tick = () => {
      const remaining = expiresAt - Date.now();
      setCountdown(Math.max(0, remaining));
      if (remaining <= 0) {
        setRoomExpired(true);
        if (activeRoom.status !== "expired" && activeRoom.status !== "read_only") {
          updateDoc(doc(db, "deal_rooms", activeRoom.id), { status: "expired" }).catch(() => {});
        }
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeRoom]);

  // Fetch room participants profiles
  useEffect(() => {
    if (!activeRoom) return;
    const fetchParticipants = async () => {
      const allUids = [...new Set([activeRoom.createdBy, ...activeRoom.participants])];
      const profiles: UserProfile[] = [];
      for (const uid of allUids) {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          if (snap.exists()) profiles.push(snap.data() as UserProfile);
        } catch {}
      }
      setRoomParticipants(profiles);
    };
    fetchParticipants();
  }, [activeRoom?.id, activeRoom?.participants?.length]);

  // Role-derived data (declared early so all effects and JSX below can reference them)
  const currentUserRole = currentUser ? selectedRoles[currentUser.uid] : undefined;
  const buyerUid = Object.entries(selectedRoles).find(([, r]) => r === "buyer")?.[0];
  const sellerUid = Object.entries(selectedRoles).find(([, r]) => r === "seller")?.[0];
  const rolesComplete = !!buyerUid && !!sellerUid;
  const buyerProfile = buyerUid ? roomParticipants.find((p) => p.uid === buyerUid) : undefined;
  const sellerProfile = sellerUid ? roomParticipants.find((p) => p.uid === sellerUid) : undefined;
  const initializationSent = roomMessages.some(
    (m) => m.isSystem && m.text.startsWith("Deal initialized")
  );

  // Send system message when both roles are first selected
  useEffect(() => {
    if (!activeRoomId || !rolesComplete || initializationSent || roomExpired) return;
    const sendInitMessage = async () => {
      try {
        await addDoc(collection(db, "deal_rooms", activeRoomId, "messages"), {
          senderId: "system",
          senderUsername: "System",
          text: `Deal initialized successfully.\nBuyer: ${buyerProfile?.displayName || "Buyer"}\nSeller: ${sellerProfile?.displayName || "Seller"}`,
          timestamp: Timestamp.fromDate(new Date()),
          isSystem: true,
        });
      } catch (err) {
        console.error("Failed to send initialization message:", err);
      }
    };
    sendInitMessage();
  }, [rolesComplete, activeRoomId, initializationSent, roomExpired, buyerProfile?.displayName, sellerProfile?.displayName]);

  // Create room
  const handleCreateRoom = async () => {
    if (!newRoomTitle.trim() || !currentUser || !userProfile) return;
    // Defensive: never invite users you have blocked.
    const allowedInvitees = selectedInvitees.filter((u) => !isUserBlocked(u.uid));
    if (allowedInvitees.length !== selectedInvitees.length) {
      setSelectedInvitees(allowedInvitees);
    }
    setCreatingRoom(true);
    try {
      const participantUids = allowedInvitees.map((u) => u.uid);
      const now = new Date();
      const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const roomRef = doc(collection(db, "deal_rooms"));
      const roomData: Omit<DealRoomDoc, "id"> = {
        title: newRoomTitle.trim(),
        createdBy: currentUser.uid,
        createdAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(expires),
        status: "active",
        participants: [currentUser.uid],
        invitees: participantUids,
      };
      await setDoc(roomRef, roomData);

      // Send invitations to each invitee
      for (const invitee of allowedInvitees) {
        const invRef = doc(collection(db, "deal_room_invitations"));
        await setDoc(invRef, {
          id: invRef.id,
          dealRoomId: roomRef.id,
          dealRoomTitle: newRoomTitle.trim(),
          invitedUserId: invitee.uid,
          invitedByUsername: userProfile.username,
          invitedBy: currentUser.uid,
          status: "pending",
          createdAt: Timestamp.fromDate(now),
        } as DealRoomInvitation);
      }

      // Reset and enter room
      setNewRoomTitle("");
      setSelectedInvitees([]);
      setInviteSearch("");
      setInviteResults([]);
      setActiveRoomId(roomRef.id);
      setActiveRoom({ ...roomData, id: roomRef.id });
      setRoomExpired(false);
      setCountdown(24 * 60 * 60 * 1000);
      setView("room");
    } catch (err) {
      console.error("Failed to create deal room:", err);
    } finally {
      setCreatingRoom(false);
    }
  };

  // Accept invitation — grant access, add as participant, enter room
  const handleAcceptInvite = async (inv: DealRoomInvitation) => {
    if (!currentUser) return;
    // Never accept an invitation from a user you cannot interact with.
    if (isUserBlocked(inv.invitedBy)) {
      console.warn("Refusing Deal Room invitation from a blocked user:", inv.invitedBy);
      return;
    }
    setAcceptingInvite(inv.id);
    try {
      // Update invitation status
      await updateDoc(doc(db, "deal_room_invitations", inv.id), { status: "accepted" });

      // Add user as approved participant
      const roomSnap = await getDoc(doc(db, "deal_rooms", inv.dealRoomId));
      if (roomSnap.exists()) {
        const roomData = roomSnap.data() as DealRoomDoc;
        const updatedParticipants = [...new Set([...roomData.participants, currentUser.uid])];
        await updateDoc(doc(db, "deal_rooms", inv.dealRoomId), { participants: updatedParticipants });

        // Immediately enter the room
        const fullRoomData: DealRoomDoc = { ...roomData, id: inv.dealRoomId, participants: updatedParticipants };
        setActiveRoomId(inv.dealRoomId);
        setActiveRoom(fullRoomData);
        setDealSummary(fullRoomData.dealSummary || "");
        setRoomExpired(
          fullRoomData.status === "expired" ||
            fullRoomData.status === "read_only" ||
            (fullRoomData.expiresAt?.toDate?.()
              ? fullRoomData.expiresAt.toDate().getTime() <= Date.now()
              : new Date(fullRoomData.expiresAt).getTime() <= Date.now())
        );
        setView("room");
      }
    } catch (err) {
      console.error("Failed to accept invitation:", err);
    } finally {
      setAcceptingInvite(null);
    }
  };

  // Decline invitation — remove it permanently
  const handleDeclineInvite = async (inv: DealRoomInvitation) => {
    setDecliningInvite(inv.id);
    try {
      await deleteDoc(doc(db, "deal_room_invitations", inv.id));
    } catch (err) {
      console.error("Failed to decline invitation:", err);
    } finally {
      setDecliningInvite(null);
    }
  };

  // Delete room (creator only)
  const handleDeleteRoom = async (roomId: string) => {
    try {
      const msgsSnap = await getDocs(collection(db, "deal_rooms", roomId, "messages"));
      for (const m of msgsSnap.docs) {
        await deleteDoc(doc(db, "deal_rooms", roomId, "messages", m.id));
      }
      const invSnap = await getDocs(
        query(collection(db, "deal_room_invitations"), where("dealRoomId", "==", roomId))
      );
      for (const inv of invSnap.docs) {
        await deleteDoc(doc(db, "deal_room_invitations", inv.id));
      }
      await deleteDoc(doc(db, "deal_rooms", roomId));
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
      if (activeRoomId === roomId) {
        setActiveRoomId(null);
        setActiveRoom(null);
        setView("list");
      }
    } catch (err) {
      console.error("Failed to delete room:", err);
    }
  };

  // Send message in room
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgText.trim() || !activeRoomId || !currentUser || !userProfile || roomExpired) return;
    setSending(true);
    try {
      await addDoc(collection(db, "deal_rooms", activeRoomId, "messages"), {
        senderId: currentUser.uid,
        senderUsername: userProfile.username,
        text: msgText.trim(),
        timestamp: Timestamp.fromDate(new Date()),
      });
      setMsgText("");
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  };

  // Send image
  const handleImageSend = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeRoomId || !currentUser || !userProfile || roomExpired) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await addDoc(collection(db, "deal_rooms", activeRoomId, "messages"), {
          senderId: currentUser.uid,
          senderUsername: userProfile.username,
          text: "",
          imageUrl: reader.result as string,
          timestamp: Timestamp.fromDate(new Date()),
        });
      } catch (err) {
        console.error("Failed to send image:", err);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Invite search
  const handleInviteSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteSearch.trim()) return;
    setInviteLoading(true);
    try {
      const results = await searchUsers(inviteSearch.trim());
      const filtered = results.filter(
        (u) => !selectedInvitees.some((s) => s.uid === u.uid) && !isUserBlocked(u.uid)
      );
      setInviteResults(filtered);
    } catch {
    } finally {
      setInviteLoading(false);
    }
  };

  // Select a role in the deal room
  const handleSelectRole = async (role: "buyer" | "seller") => {
    if (!currentUser || !activeRoomId) return;
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "deal_rooms", activeRoomId);
        const snap = await tx.get(ref);
        const roles = (snap.data()?.selectedRoles || {}) as Record<string, string>;
        const occupied = Object.entries(roles).some(([uid, selected]) => uid !== currentUser.uid && selected === role);
        if (occupied) throw new Error(`The ${role} role is already selected.`);
        tx.update(ref, { [`selectedRoles.${currentUser.uid}`]: role });
      });
    } catch (err) {
      console.error("Failed to select role:", err);
    }
  };

  const toggleInvitee = (user: UserProfile) => {
    if (isUserBlocked(user.uid)) return;
    if (selectedInvitees.some((s) => s.uid === user.uid)) {
      setSelectedInvitees((prev) => prev.filter((s) => s.uid !== user.uid));
    } else if (selectedInvitees.length < 3) {
      setSelectedInvitees((prev) => [...prev, user]);
      setInviteSearch("");
      setInviteResults([]);
    }
  };

  // Access control: only approved participants can enter
  const openRoom = (room: DealRoomDoc) => {
    if (!currentUser) return;
    if (!room.participants.includes(currentUser.uid)) {
      return;
    }
    // Never enter a room created by a user you cannot interact with.
    if (isUserBlocked(room.createdBy)) {
      console.warn("Refusing to join Deal Room created by a blocked user:", room.createdBy);
      return;
    }
    setActiveRoomId(room.id);
    setActiveRoom(room);
    setDealSummary(room.dealSummary || "");
    setRoomExpired(
      room.status === "expired" ||
        room.status === "read_only" ||
        (room.expiresAt?.toDate?.()
          ? room.expiresAt.toDate().getTime() <= Date.now()
          : new Date(room.expiresAt).getTime() <= Date.now())
    );
    setView("room");
  };

  const getAvatarUrl = (uid: string) =>
    `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`;

  // ─── LIST VIEW ────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#0D111D]/70 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:px-6 bg-[#12172A]/95 backdrop-blur-md border-b border-white/5 flex items-center justify-between z-10 shrink-0 select-none">
          <div className="flex items-center gap-3 w-full">
            <button
              onClick={onBack}
              className="p-2 rounded-xl bg-[#12172A] border border-white/10 text-sky-200 hover:text-white transition-all hover:border-[#6C5CE0]/50 hover:bg-[#161A2B] cursor-pointer flex items-center justify-center mr-1"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-black text-white uppercase tracking-widest font-mono flex items-center gap-2">
                <Handshake className="w-4 h-4 text-[#6C5CE0] drop-shadow-[0_0_8px_rgba(108,92,224,0.12)]" />
                Deal Room
              </h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-[#94A3B8] font-sans font-medium">
                  Secure Negotiation Workspace
                </span>
              </div>
            </div>
            <button
              onClick={() => setView("create")}
              className="p-2 rounded-xl bg-[#6C5CE0] hover:bg-[#5B4BD0] text-white transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Room</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-[#6C5CE0]" />
            </div>
          ) : (
            <>
              {/* Pending Invitations */}
              {invitations.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-[10px] text-[#F472B6] font-extrabold uppercase tracking-wider px-1">
                    Pending Invitations ({invitations.length})
                  </h3>
                  {invitations.map((inv) => {
                    const remaining = inviteCountdowns[inv.id] ?? 0;
                    const isExpiringSoon = remaining > 0 && remaining < 3600000;
                    const isExpired = remaining <= 0;
                    const isAccepting = acceptingInvite === inv.id;
                    const isDeclining = decliningInvite === inv.id;

                    return (
                      <div
                        key={inv.id}
                        className={`rounded-2xl p-4 border transition-all ${
                          isExpired
                            ? "bg-[#12172A]/20 border-white/[0.04] opacity-60"
                            : "bg-gradient-to-r from-[#F472B6]/[0.06] to-transparent border-[#F472B6]/20"
                        }`}
                      >
                        {/* Top row: title + countdown */}
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Handshake className="w-4 h-4 text-[#F472B6] shrink-0" />
                              <p className="text-sm text-white font-semibold truncate">{inv.dealRoomTitle}</p>
                            </div>
                          </div>
                          <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border font-mono text-[9px] font-bold shrink-0 ${
                            isExpired
                              ? "bg-red-500/10 border-red-500/20 text-red-400"
                              : isExpiringSoon
                              ? "bg-orange-500/10 border-orange-500/20 text-orange-400 animate-pulse"
                              : "bg-[#6C5CE0]/10 border-[#6C5CE0]/20 text-[#A78BFA]"
                          }`}>
                            <Timer className="w-3 h-3" />
                            {isExpired ? "Expired" : formatCountdown(remaining)}
                          </div>
                        </div>

                        {/* Details grid */}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3 px-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] text-[#94A3B8] font-mono uppercase">From</span>
                            <span className="text-[10px] text-white font-medium">@{inv.invitedByUsername}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] text-[#94A3B8] font-mono uppercase">Created</span>
                            <span className="text-[10px] text-white font-medium">{formatCreatedTime(inv.createdAt)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 col-span-2">
                            <Hash className="w-3 h-3 text-[#94A3B8]" />
                            <span className="text-[9px] text-[#94A3B8] font-mono uppercase">Room</span>
                            <span className="text-[10px] text-[#6C5CE0] font-mono">{inv.dealRoomId.slice(0, 12)}...</span>
                          </div>
                        </div>

                        {/* Action buttons */}
                        {!isExpired && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleAcceptInvite(inv)}
                              disabled={isAccepting || isDeclining}
                              className="flex-1 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {isAccepting ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              {isAccepting ? "Accepting..." : "Accept"}
                            </button>
                            <button
                              onClick={() => handleDeclineInvite(inv)}
                              disabled={isAccepting || isDeclining}
                              className="flex-1 px-3 py-2 rounded-xl bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 text-[#94A3B8] hover:text-red-400 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {isDeclining ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <X className="w-3.5 h-3.5" />
                              )}
                              {isDeclining ? "Declining..." : "Decline"}
                            </button>
                          </div>
                        )}
                        {isExpired && (
                          <p className="text-[10px] text-red-400/60 font-medium text-center">Invitation expired</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Active Rooms */}
              <div className="space-y-3">
                <h3 className="text-[10px] text-[#6C5CE0] font-extrabold uppercase tracking-wider px-1">
                  Your Deal Rooms ({rooms.length})
                </h3>
                {rooms.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-white/[0.06] rounded-2xl bg-[#0D111D]/10">
                    <Handshake className="w-8 h-8 text-[#6C5CE0]/40 mx-auto mb-3" />
                    <p className="text-sm text-[#94A3B8] font-medium">No deal rooms yet</p>
                    <p className="text-[10px] text-[#6C5CE0] mt-1">
                      Create a secure workspace to negotiate deals.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rooms.map((room) => {
                      const expiresAt = room.expiresAt?.toDate?.()
                        ? room.expiresAt.toDate().getTime()
                        : new Date(room.expiresAt).getTime();
                      const remaining = expiresAt - Date.now();
                      const isExpired = remaining <= 0;
                      const isCreator = room.createdBy === currentUser?.uid;

                      return (
                        <button
                          key={room.id}
                          onClick={() => openRoom(room)}
                          className={`w-full p-4 rounded-2xl text-left transition-all duration-200 cursor-pointer border ${
                            isExpired
                              ? "bg-[#12172A]/20 border-white/[0.04] opacity-60"
                              : "bg-[#12172A]/40 border-white/[0.06] hover:bg-[#6C5CE0]/[0.06] hover:border-[#6C5CE0]/20"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-bold text-white truncate">{room.title}</h4>
                                {isExpired ? (
                                  <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase bg-red-500/10 text-red-400 border border-red-500/20 shrink-0">
                                    Expired
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                                    Active
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-2">
                                <span className="flex items-center gap-1 text-[10px] text-[#94A3B8]">
                                  <Users className="w-3 h-3" />
                                  {room.participants.length} participant{room.participants.length !== 1 ? "s" : ""}
                                </span>
                                <span className="flex items-center gap-1 text-[10px] text-[#94A3B8]">
                                  <Clock className="w-3 h-3" />
                                  {isExpired ? "Expired" : formatCountdown(remaining)}
                                </span>
                              </div>
                            </div>
                            {isCreator && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm("Delete this deal room permanently?")) {
                                    handleDeleteRoom(room.id);
                                  }
                                }}
                                className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#94A3B8] hover:text-red-400 transition-all cursor-pointer shrink-0"
                                title="Delete room"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── CREATE ROOM VIEW ─────────────────────────────────────────────
  if (view === "create") {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#0D111D]/70 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:px-6 bg-[#12172A]/95 backdrop-blur-md border-b border-white/5 flex items-center gap-3 z-10 shrink-0 select-none">
          <button
            onClick={() => {
              setView("list");
              setNewRoomTitle("");
              setSelectedInvitees([]);
              setInviteSearch("");
              setInviteResults([]);
            }}
            className="p-2 rounded-xl bg-[#12172A] border border-white/10 text-sky-200 hover:text-white transition-all hover:border-[#6C5CE0]/50 hover:bg-[#161A2B] cursor-pointer flex items-center justify-center"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-sm font-black text-white uppercase tracking-widest font-mono">
              Create Deal Room
            </h2>
            <p className="text-[10px] text-[#94A3B8] mt-0.5">Expires in 24 hours</p>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar">
          <div className="max-w-[700px] mx-auto space-y-6">
          {/* Room Title */}
          <div className="space-y-2">
            <label className="text-[10px] text-[#6C5CE0] font-extrabold uppercase tracking-wider">
              Room Title
            </label>
            <input
              type="text"
              value={newRoomTitle}
              onChange={(e) => setNewRoomTitle(e.target.value)}
              placeholder="e.g. NFT Licensing Agreement"
              className="w-full bg-[#12172A] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#6C5CE0]/60 focus:ring-1 focus:ring-[#6C5CE0]/20 transition-all"
              maxLength={80}
            />
          </div>

          {/* Invite Users (max 3) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-[#6C5CE0] font-extrabold uppercase tracking-wider">
                Invite Participants
              </label>
              <span className="text-[10px] text-[#94A3B8] font-mono">
                {selectedInvitees.length}/3
              </span>
            </div>

            {/* Selected invitees */}
            {selectedInvitees.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedInvitees.map((u) => (
                  <div
                    key={u.uid}
                    className="flex items-center gap-2 bg-[#6C5CE0]/10 border border-[#6C5CE0]/30 rounded-lg px-3 py-1.5"
                  >
                    <img
                      src={u.avatarUrl || getAvatarUrl(u.uid)}
                      alt=""
                      className="w-5 h-5 rounded-full bg-[#161A2B] border border-white/10"
                    />
                    <span className="text-xs text-white font-medium">{u.displayName}</span>
                    <button
                      onClick={() => toggleInvitee(u)}
                      className="text-[#94A3B8] hover:text-red-400 transition-colors cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Search */}
            {selectedInvitees.length < 3 && (
              <form onSubmit={handleInviteSearch} className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
                  <input
                    type="text"
                    value={inviteSearch}
                    onChange={(e) => setInviteSearch(e.target.value)}
                    placeholder="Search by username..."
                    className="w-full bg-[#12172A] border border-white/[0.08] rounded-xl pl-9 pr-4 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#6C5CE0]/60 transition-all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={inviteLoading}
                  className="px-4 py-2.5 rounded-xl bg-[#6C5CE0]/20 border border-[#6C5CE0]/30 text-[#6C5CE0] hover:bg-[#6C5CE0]/30 text-xs font-bold transition-all cursor-pointer disabled:opacity-40"
                >
                  {inviteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
                </button>
              </form>
            )}

            {/* Search Results */}
            {inviteResults.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                {inviteResults.map((u) => (
                  <button
                    key={u.uid}
                    onClick={() => toggleInvitee(u)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-[#6C5CE0]/[0.06] transition-all cursor-pointer text-left"
                  >
                    <img
                      src={u.avatarUrl || getAvatarUrl(u.uid)}
                      alt=""
                      className="w-8 h-8 rounded-full bg-[#161A2B] border border-white/10"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white font-semibold truncate">{u.displayName}</p>
                      <p className="text-[10px] text-[#94A3B8] truncate">@{u.username}</p>
                    </div>
                    <Plus className="w-4 h-4 text-[#6C5CE0] shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Create Button */}
          <button
            onClick={handleCreateRoom}
            disabled={!newRoomTitle.trim() || creatingRoom}
            className="w-full py-3 rounded-xl bg-[#6C5CE0] hover:bg-[#5B4BD0] text-white text-sm font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {creatingRoom ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Handshake className="w-4 h-4" />
            )}
            {creatingRoom ? "Creating..." : "Create Deal Room"}
          </button>

          {/* Info */}
          <div className="p-3 rounded-xl bg-[#6C5CE0]/[0.04] border border-[#6C5CE0]/10 flex items-start gap-2.5">
            <Shield className="w-4 h-4 text-[#6C5CE0] mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] text-[#94A3B8] leading-relaxed">
                Deal Rooms are encrypted, temporary workspaces that auto-expire after 24 hours.
                All messages and files are permanently deleted upon expiry.
              </p>
            </div>
          </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── ACTIVE ROOM VIEW ─────────────────────────────────────────────
  if (view === "room" && activeRoom) {
    const isCreator = activeRoom.createdBy === currentUser?.uid;

    return (
      <DealGuideProvider
        roomId={activeRoomId}
        currentUid={currentUser?.uid}
        buyerUid={buyerUid}
        sellerUid={sellerUid}
        buyerWallet={buyerProfile?.circleWalletAddress}
        sellerWallet={sellerProfile?.circleWalletAddress}
        buyerName={buyerProfile?.displayName}
        sellerName={sellerProfile?.displayName}
      >
      <div className="flex-1 flex flex-col h-full bg-[#0D111D]/70 overflow-hidden">
        {/* Room Header */}
        <div className="p-3 sm:px-5 bg-[#12172A]/95 backdrop-blur-md border-b border-white/5 flex items-center gap-3 z-10 shrink-0 select-none">
          <button
            onClick={() => {
              setView("list");
              setActiveRoomId(null);
              setActiveRoom(null);
            }}
            className="p-2 rounded-xl bg-[#12172A] border border-white/10 text-sky-200 hover:text-white transition-all hover:border-[#6C5CE0]/50 cursor-pointer flex items-center justify-center shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-white tracking-widest font-mono truncate">
                {activeRoom.title}
              </h2>
              {roomExpired ? (
                <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase bg-red-500/10 text-red-400 border border-red-500/20 shrink-0 flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" /> Expired
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                  Live
                </span>
              )}
            </div>
          </div>

          {/* Countdown */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-mono text-[11px] font-bold shrink-0 ${
              roomExpired
                ? "bg-red-500/10 border-red-500/20 text-red-400"
                : countdown < 3600000
                ? "bg-orange-500/10 border-orange-500/20 text-orange-400 animate-pulse"
                : "bg-[#6C5CE0]/10 border-[#6C5CE0]/20 text-[#A78BFA]"
            }`}
          >
            <Timer className="w-3.5 h-3.5" />
            {roomExpired ? "Expired" : formatCountdown(countdown)}
          </div>
        </div>

        {/* Room Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Participants Panel (desktop) */}
          <div className="hidden lg:flex w-72 shrink-0 flex-col border-r border-white/5 bg-[#0D111D]/40 overflow-y-auto custom-scrollbar p-3 space-y-3">
            <h4 className="text-[10px] text-[#6C5CE0] font-extrabold uppercase tracking-wider px-1">
              Participants ({roomParticipants.length})
            </h4>
            {roomParticipants.map((p) => (
              <div key={p.uid} className="flex items-center gap-2.5 p-2 rounded-xl bg-[#12172A]/40 border border-white/[0.04]">
                <img
                  src={p.avatarUrl || getAvatarUrl(p.uid)}
                  alt=""
                  className="w-8 h-8 rounded-full bg-[#161A2B] border border-white/10"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-white font-semibold truncate">{p.displayName}</p>
                  <p className="text-[9px] text-[#94A3B8] truncate">@{p.username}</p>
                </div>
                {p.uid === activeRoom.createdBy && (
                  <span className="text-[8px] font-mono text-[#6C5CE0] bg-[#6C5CE0]/10 px-1.5 py-0.5 rounded shrink-0">
                    CREATOR
                  </span>
                )}
                {selectedRoles[p.uid] && (
                  <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                    selectedRoles[p.uid] === "buyer"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-[#6C5CE0]/10 text-[#A78BFA] border border-[#6C5CE0]/20"
                  }`}>
                    {selectedRoles[p.uid] === "buyer" ? "BUYER" : "SELLER"}
                  </span>
                )}
              </div>
            ))}

            {/* Deal Summary */}
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between px-1">
                <h4 className="text-[10px] text-[#6C5CE0] font-extrabold uppercase tracking-wider">
                  Deal Summary
                </h4>
                {isCreator && !roomExpired && (
                  <button
                    onClick={() => {
                      if (editingSummary) {
                        setSummarySaving(true);
                        updateDoc(doc(db, "deal_rooms", activeRoom.id), { dealSummary }).then(() => {
                          setEditingSummary(false);
                          setSummarySaving(false);
                        });
                      } else {
                        setEditingSummary(true);
                      }
                    }}
                    className="text-[9px] text-[#6C5CE0] hover:text-white transition-colors cursor-pointer"
                  >
                    {editingSummary ? (summarySaving ? "Saving..." : "Save") : "Edit"}
                  </button>
                )}
              </div>
              {editingSummary ? (
                <textarea
                  value={dealSummary}
                  onChange={(e) => setDealSummary(e.target.value)}
                  placeholder="Describe the deal terms..."
                  className="w-full bg-[#12172A] border border-white/[0.08] rounded-xl px-3 py-2 text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:border-[#6C5CE0]/60 transition-all resize-none h-24"
                />
              ) : (
                <div className="p-3 rounded-xl bg-[#12172A]/60 border border-white/[0.04] min-h-[40px]">
                  <p className="text-[11px] text-[#94A3B8] leading-relaxed whitespace-pre-wrap">
                    {dealSummary || "No deal summary yet."}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Chat Area */}
          <div className="flex-[3] flex flex-col min-w-0">
            {/* Expired overlay */}
            {roomExpired && (
              <div className="bg-red-500/[0.04] border-b border-red-500/10 px-4 py-2.5 flex items-center gap-2 shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-[11px] text-red-300 font-medium">
                  This deal room has expired. Messages are now read-only.
                </p>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
              {/* Welcome banner */}
              <div className="text-center py-4">
                <div className="inline-flex items-center gap-2 bg-[#6C5CE0]/[0.06] border border-[#6C5CE0]/15 rounded-full px-4 py-2">
                  <Shield className="w-3.5 h-3.5 text-[#6C5CE0]" />
                  <span className="text-[10px] text-[#94A3B8] font-medium">
                    Messages are end-to-end encrypted and auto-delete after expiry
                  </span>
                </div>
              </div>

              {roomMessages.map((msg) => {
                if (msg.isSystem) {
                  return (
                    <div key={msg.id} className="flex justify-center">
                      <div className="bg-[#6C5CE0]/[0.06] border border-[#6C5CE0]/15 rounded-xl px-4 py-2.5 text-center max-w-sm">
                        <p className="text-[11px] text-[#94A3B8] whitespace-pre-line leading-relaxed">{msg.text}</p>
                      </div>
                    </div>
                  );
                }
                const isSelf = msg.senderId === currentUser?.uid;
                const senderProfile = roomParticipants.find((p) => p.uid === msg.senderId);
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-2.5 ${isSelf ? "flex-row-reverse" : "flex-row"}`}
                  >
                    <img
                      src={senderProfile?.avatarUrl || getAvatarUrl(msg.senderId)}
                      alt=""
                      className="w-7 h-7 rounded-full bg-[#161A2B] border border-white/10 shrink-0 mt-1"
                    />
                    <div className={`max-w-[75%] ${isSelf ? "items-end" : "items-start"} flex flex-col`}>
                      <span className={`text-[9px] font-mono mb-1 ${isSelf ? "text-[#6C5CE0]" : "text-[#94A3B8]"}`}>
                        {isSelf ? "You" : `@${msg.senderUsername}`}
                      </span>
                      {msg.imageUrl ? (
                        <img
                          src={msg.imageUrl}
                          alt="Shared"
                          className="rounded-xl max-h-60 border border-white/[0.06] object-cover"
                        />
                      ) : (
                        <div
                          className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
                            isSelf
                              ? "bg-[#6C5CE0] text-white rounded-br-md"
                              : "bg-[#12172A] border border-white/[0.06] text-[#F8FAFC] rounded-bl-md"
                          }`}
                        >
                          {msg.text}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <ReadyDealGate />
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            {roomExpired ? (
              <div className="p-4 border-t border-white/5 bg-[#0D111D]/60 flex items-center justify-center gap-2">
                <Lock className="w-4 h-4 text-red-400/60" />
                <span className="text-xs text-[#94A3B8]/60 font-medium">Room expired — read only</span>
              </div>
            ) : !rolesComplete ? (
              <div className="p-4 border-t border-white/5 bg-[#0D111D]/60 flex items-center justify-center gap-2">
                <Shield className="w-4 h-4 text-[#6C5CE0]/60" />
                <span className="text-xs text-[#94A3B8]/80 font-medium">Waiting for both participants to confirm their roles.</span>
              </div>
            ) : (
              <form
                onSubmit={handleSendMessage}
                className="p-3 sm:p-4 border-t border-white/5 bg-[#0D111D]/60 backdrop-blur-md flex items-center gap-3"
              >
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleImageSend}
                  className="hidden"
                />
                {/* Attachment Button + Menu */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAttachmentMenu(prev => !prev)}
                    className="p-2.5 rounded-xl bg-[#12172A] border border-white/[0.06] text-[#94A3B8] hover:text-white hover:border-[#6C5CE0]/30 transition-all cursor-pointer shrink-0"
                    title="Attach"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <AnimatePresence>
                    {showAttachmentMenu && (
                      <div ref={attachmentMenuRef}>
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.9, y: 10 }}
                          transition={{ duration: 0.15 }}
                          className="absolute bottom-full mb-2 left-0 bg-[#12172A] border border-white/[0.08] rounded-xl p-1.5 shadow-xl backdrop-blur-xl min-w-[170px] z-50 origin-bottom-left"
                        >
                          <button
                            type="button"
                            onClick={() => { fileInputRef.current?.click(); setShowAttachmentMenu(false); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#6C5CE0]/10 transition-all text-xs text-left"
                          >
                            <span className="text-base">🖼</span>
                            <span>Image</span>
                          </button>
                          <button
                            type="button"
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#6C5CE0]/10 transition-all text-xs text-left"
                          >
                            <span className="text-base">📄</span>
                            <span>File</span>
                          </button>
                          <button
                            type="button"
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#6C5CE0]/10 transition-all text-xs text-left"
                          >
                            <span className="text-base">📷</span>
                            <span>Camera</span>
                          </button>
                          <button
                            type="button"
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#6C5CE0]/10 transition-all text-xs text-left"
                          >
                            <span className="text-base">🎤</span>
                            <span>Voice</span>
                          </button>
                          <button
                            type="button"
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#6C5CE0]/10 transition-all text-xs text-left"
                          >
                            <span className="text-base">📍</span>
                            <span>Location</span>
                          </button>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
                <input
                  type="text"
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 bg-[#12172A] border border-white/[0.08] rounded-full px-5 py-2.5 text-[13px] text-white placeholder:text-slate-500 focus:outline-none focus:border-[#6C5CE0]/60 focus:ring-1 focus:ring-[#6C5CE0]/20 transition-all"
                  disabled={sending}
                />
                <button
                  type="submit"
                  disabled={!msgText.trim() || sending}
                  className="p-2.5 rounded-full bg-[#6C5CE0] hover:bg-[#5B4BD0] text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </form>
            )}
          </div>

          {/* AI Assistant Sidebar (desktop/tablet) */}
          <div className="hidden md:flex flex-[1] shrink-0 flex-col border-l border-white/5 bg-[#0D111D]/40 overflow-hidden">
            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b border-white/[0.06] shrink-0">
              <span className="text-xs font-bold text-[#F8FAFC]">Mica AI</span>
            </div>
            {/* Character */}
            <div className="flex flex-col items-center justify-start overflow-hidden shrink-0">
              <div className="-mt-[80px]">
                <Live2DCharacter
                  width={170}
                  height={280}
                  focus="full"
                  lively
                />
              </div>
            </div>
            {/* Deal Roles */}
            <div className="px-3 pb-3 space-y-2">
              <h4 className="text-[10px] text-[#6C5CE0] font-extrabold uppercase tracking-wider px-1">
                Deal Roles
              </h4>
              {rolesComplete && buyerProfile && sellerProfile ? (
                <>
                  <div className="p-2.5 rounded-xl bg-[#12172A]/40 border border-white/[0.04] space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🛒</span>
                      <span className="text-[10px] font-bold text-emerald-400">Buyer</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <img
                        src={buyerProfile.avatarUrl || getAvatarUrl(buyerUid!)}
                        alt=""
                        className="w-7 h-7 rounded-full bg-[#161A2B] border border-white/10"
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] text-white font-semibold truncate">
                          {buyerProfile.displayName}
                        </p>
                        <p className="text-[9px] text-[#94A3B8] truncate">
                          @{buyerProfile.username}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#12172A]/40 border border-white/[0.04] space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🛍</span>
                      <span className="text-[10px] font-bold text-[#A78BFA]">Seller</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <img
                        src={sellerProfile.avatarUrl || getAvatarUrl(sellerUid!)}
                        alt=""
                        className="w-7 h-7 rounded-full bg-[#161A2B] border border-white/10"
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] text-white font-semibold truncate">
                          {sellerProfile.displayName}
                        </p>
                        <p className="text-[9px] text-[#94A3B8] truncate">
                          @{sellerProfile.username}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-[10px] text-[#94A3B8] px-1 leading-relaxed">
                  Waiting for participants to select their roles...
                </p>
              )}
            </div>
            {/* AI Deal Guide */}
            {rolesComplete && buyerProfile && sellerProfile && (
              <DealGuidePanel />
            )}
            {/* Spacer for future AI features */}
            <div className="flex-1" />
          </div>
        </div>
        {/* Role Selection Modal */}
        {view === "room" && !rolesComplete && !roomExpired && activeRoom && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D111D]/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="bg-[#12172A]/95 border border-white/[0.08] rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl backdrop-blur-xl"
            >
              <div className="text-center mb-6">
                <h3 className="text-lg font-black text-white uppercase tracking-widest font-mono">
                  Choose Your Role
                </h3>
                <p className="text-[11px] text-[#94A3B8] mt-2 max-w-sm mx-auto leading-relaxed">
                  Each participant must select a unique role before the deal can begin.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => handleSelectRole("buyer")}
                  disabled={!!buyerUid && buyerUid !== currentUser?.uid}
                  className={`w-full p-4 rounded-2xl border transition-all text-left flex items-center gap-4 ${
                    currentUserRole === "buyer"
                      ? "bg-emerald-500/10 border-emerald-500/30"
                      : buyerUid
                      ? "bg-[#12172A]/30 border-white/[0.04] opacity-50 cursor-not-allowed"
                      : "bg-[#12172A]/40 border-white/[0.06] hover:bg-emerald-500/[0.06] hover:border-emerald-500/20 cursor-pointer"
                  }`}
                >
                  <span className="text-3xl">🛒</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white">Buyer</p>
                    {buyerProfile ? (
                      <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5">
                        <Check className="w-3 h-3" /> Selected by {buyerProfile.displayName}
                      </p>
                    ) : (
                      <p className="text-[10px] text-[#94A3B8] mt-0.5">Waiting for a participant...</p>
                    )}
                  </div>
                  {currentUserRole === "buyer" && (
                    <span className="text-emerald-400"><Check className="w-5 h-5" /></span>
                  )}
                </button>

                <button
                  onClick={() => handleSelectRole("seller")}
                  disabled={!!sellerUid && sellerUid !== currentUser?.uid}
                  className={`w-full p-4 rounded-2xl border transition-all text-left flex items-center gap-4 ${
                    currentUserRole === "seller"
                      ? "bg-[#6C5CE0]/10 border-[#6C5CE0]/30"
                      : sellerUid
                      ? "bg-[#12172A]/30 border-white/[0.04] opacity-50 cursor-not-allowed"
                      : "bg-[#12172A]/40 border-white/[0.06] hover:bg-[#6C5CE0]/[0.06] hover:border-[#6C5CE0]/20 cursor-pointer"
                  }`}
                >
                  <span className="text-3xl">🛍</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white">Seller</p>
                    {sellerProfile ? (
                      <p className="text-[10px] text-[#A78BFA] flex items-center gap-1 mt-0.5">
                        <Check className="w-3 h-3" /> Selected by {sellerProfile.displayName}
                      </p>
                    ) : (
                      <p className="text-[10px] text-[#94A3B8] mt-0.5">Waiting for another participant...</p>
                    )}
                  </div>
                  {currentUserRole === "seller" && (
                    <span className="text-[#A78BFA]"><Check className="w-5 h-5" /></span>
                  )}
                </button>
              </div>

              {currentUserRole && (
                <p className="text-[10px] text-[#94A3B8] text-center mt-4">
                  Waiting for both participants to confirm their roles.
                </p>
              )}
            </motion.div>
          </div>
        )}

        {/* AI-Guided Deal workflow is now driven progressively by DealGuidePanel
            inside the room view (popups + chat cards + sidebar progress). */}
      </div>
      </DealGuideProvider>
    );
  }

  return null;
};

export default DealRoom;
