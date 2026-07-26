import React, { useEffect, useState, useMemo } from "react";
import { db } from "../firebase";
import { collection, query, where, onSnapshot, DocumentData } from "firebase/firestore";
import { useChat } from "../context/ChatContext";
import { useCall } from "../context/CallContext";
import { UserProfile } from "../types";
import { Phone, Video, PhoneMissed, PhoneOutgoing, PhoneIncoming, PhoneCall } from "lucide-react";

type CallDirection = "outgoing" | "incoming";

interface CallLogItem {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatar: string;
  type: "audio" | "video";
  direction: CallDirection;
  status: string;
  createdAt: Date;
  acceptedAt: Date | null;
  endedAt: Date | null;
}

// Terminal call states we surface as "history" — active/ringing calls are handled live by CallOverlay.
const TERMINAL_STATUSES = ["declined", "ended", "missed", "busy", "cancelled"];

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

const formatDuration = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const formatWhen = (date: Date) => {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  if (isYesterday) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
};

interface CallHistoryProps {
  friends: UserProfile[];
}

const CallHistory: React.FC<CallHistoryProps> = ({ friends }) => {
  const { currentUser } = useChat();
  const { startCall } = useCall();

  const [outgoingDocs, setOutgoingDocs] = useState<CallLogItem[]>([]);
  const [incomingDocs, setIncomingDocs] = useState<CallLogItem[]>([]);

  useEffect(() => {
    if (!currentUser) {
      setOutgoingDocs([]);
      setIncomingDocs([]);
      return;
    }

    const mapDoc = (id: string, data: DocumentData, direction: CallDirection): CallLogItem | null => {
      if (!TERMINAL_STATUSES.includes(data.status)) return null;
      const createdAt = toDate(data.createdAt) || new Date(0);
      return {
        id,
        peerId: direction === "outgoing" ? data.calleeId : data.callerId,
        peerName: direction === "outgoing" ? data.calleeName : data.callerName,
        peerAvatar: direction === "outgoing" ? data.calleeAvatar : data.callerAvatar,
        type: data.type,
        direction,
        status: data.status,
        createdAt,
        acceptedAt: toDate(data.acceptedAt),
        endedAt: toDate(data.endedAt),
      };
    };

    const outQ = query(collection(db, "calls"), where("callerId", "==", currentUser.uid));
    const unsubOut = onSnapshot(outQ, (snap) => {
      const items = snap.docs
        .map((d) => mapDoc(d.id, d.data(), "outgoing"))
        .filter((x): x is CallLogItem => x !== null);
      setOutgoingDocs(items);
    });

    const inQ = query(collection(db, "calls"), where("calleeId", "==", currentUser.uid));
    const unsubIn = onSnapshot(inQ, (snap) => {
      const items = snap.docs
        .map((d) => mapDoc(d.id, d.data(), "incoming"))
        .filter((x): x is CallLogItem => x !== null);
      setIncomingDocs(items);
    });

    return () => {
      unsubOut();
      unsubIn();
    };
  }, [currentUser]);

  const calls = useMemo(() => {
    return [...outgoingDocs, ...incomingDocs].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }, [outgoingDocs, incomingDocs]);

  const handleCallBack = (item: CallLogItem, type: "audio" | "video") => {
    const knownFriend = friends.find((f) => f.uid === item.peerId);
    const peer: UserProfile =
      knownFriend ||
      ({
        uid: item.peerId,
        username: item.peerName,
        displayName: item.peerName,
        avatarUrl: item.peerAvatar,
        status: "offline",
        lastActive: new Date(),
        createdAt: new Date(),
      } as UserProfile);
    startCall(peer, type);
  };

  if (calls.length === 0) {
    return (
      <div className="p-6 text-center border border-dashed border-white/[0.06] rounded-2xl bg-[#0D111D]/10">
        <PhoneCall className="w-6 h-6 text-[#6C5CE0] mx-auto mb-2" />
        <p className="text-xs text-[#6C5CE0] font-medium">No call history yet</p>
        <p className="text-[10px] text-[#6C5CE0] mt-1 leading-normal">
          Your audio and video calls with friends will show up here, just like on Messenger or WhatsApp.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {calls.map((item) => {
        const isMissedOrFailed = ["missed", "declined", "busy", "cancelled"].includes(item.status);
        const durationSecs =
          item.status === "ended" && item.acceptedAt && item.endedAt
            ? Math.max(0, Math.round((item.endedAt.getTime() - item.acceptedAt.getTime()) / 1000))
            : null;

        const DirectionIcon =
          item.status === "missed" && item.direction === "incoming"
            ? PhoneMissed
            : item.direction === "outgoing"
            ? PhoneOutgoing
            : PhoneIncoming;

        let statusLabel = "";
        if (item.status === "ended" && durationSecs !== null) {
          statusLabel = `${item.direction === "outgoing" ? "Outgoing" : "Incoming"} • ${formatDuration(durationSecs)}`;
        } else if (item.status === "missed") {
          statusLabel = item.direction === "incoming" ? "Missed call" : "Unanswered";
        } else if (item.status === "declined") {
          statusLabel = item.direction === "outgoing" ? "Declined" : "You declined";
        } else if (item.status === "busy") {
          statusLabel = "Busy";
        } else if (item.status === "cancelled") {
          statusLabel = "Cancelled";
        }

        const TypeIcon = item.type === "video" ? Video : Phone;

        return (
          <div
            key={item.id}
            className="w-full p-2.5 rounded-xl flex items-center justify-between bg-[#12172A]/40 border border-transparent hover:bg-[#6C5CE0]/10 transition-all duration-200"
          >
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={item.peerAvatar}
                alt={item.peerName}
                referrerPolicy="no-referrer"
                className="w-9.5 h-9.5 rounded-full bg-[#161A2B] border border-white/10 object-cover shrink-0"
              />
              <div className="min-w-0 pr-1">
                <p className="text-xs font-bold text-[#F8FAFC] truncate leading-none">{item.peerName}</p>
                <p
                  className={`text-[10px] mt-1.5 flex items-center gap-1 font-medium ${
                    isMissedOrFailed ? "text-red-400" : "text-[#94A3B8]"
                  }`}
                >
                  <DirectionIcon className="w-3 h-3 shrink-0" />
                  <span className="truncate">{statusLabel}</span>
                  <span className="text-[#6C5CE0]/60">· {formatWhen(item.createdAt)}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[#6C5CE0] mr-1">
                <TypeIcon className="w-3.5 h-3.5" />
              </span>
              <button
                type="button"
                onClick={() => handleCallBack(item, "audio")}
                title={`Call ${item.peerName}`}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#6C5CE0] hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              >
                <Phone className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleCallBack(item, "video")}
                title={`Video call ${item.peerName}`}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#6C5CE0] hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              >
                <Video className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default CallHistory;
