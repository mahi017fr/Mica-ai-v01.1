import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { db } from "../firebase";
import {
  doc,
  collection,
  addDoc,
  updateDoc,
  getDoc,
  setDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  DocumentData,
} from "firebase/firestore";
import { useChat } from "./ChatContext";
import { UserProfile } from "../types";
import { isUserBlocked, getBlockMessage } from "../utils/blocking";

export type CallType = "audio" | "video";
export type CallStatus =
  | "idle"
  | "outgoing"
  | "incoming"
  | "connecting"
  | "connected"
  | "ended";

export type CallEndReason =
  | "declined"
  | "ended"
  | "missed"
  | "busy"
  | "cancelled"
  | "failed"
  | null;

interface ActiveCallInfo {
  callId: string;
  type: CallType;
  direction: "outgoing" | "incoming";
  peerId: string;
  peerName: string;
  peerAvatar: string;
}

interface CallContextType {
  callStatus: CallStatus;
  activeCall: ActiveCallInfo | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isCameraOff: boolean;
  isSpeakerOn: boolean;
  callDuration: number;
  endReason: CallEndReason;
  callError: string | null;
  startCall: (friend: UserProfile, type: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleSpeaker: () => void;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export const useCall = () => {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within a CallProvider");
  return ctx;
};

// Public STUN + free community TURN relay (fallback for strict NATs/firewalls).
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ],
};

const RING_TIMEOUT_MS = 40000;

// Lightweight synthesized ring tones so we don't depend on any external audio asset.
class TonePlayer {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private playing = false;

  start(kind: "ringback" | "ringtone") {
    if (this.playing) return;
    this.playing = true;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctx();
    } catch {
      return;
    }
    const freqA = kind === "ringtone" ? 523.25 : 440;
    const freqB = kind === "ringtone" ? 659.25 : 554.37;
    const gap = kind === "ringtone" ? 2600 : 3400;

    const loop = () => {
      if (!this.playing || !this.ctx) return;
      this.beep(freqA, freqB);
      this.timer = setTimeout(loop, gap);
    };
    loop();
  }

  private beep(freqA: number, freqB: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    [0, 0.35].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 0 ? freqA : freqB;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.12, now + offset + 0.04);
      gain.gain.linearRampToValueAtTime(0, now + offset + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.32);
    });
  }

  stop() {
    this.playing = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.ctx) {
      const c = this.ctx;
      this.ctx = null;
      c.close().catch(() => {});
    }
  }
}

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, userProfile } = useChat();

  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [activeCall, setActiveCall] = useState<ActiveCallInfo | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [endReason, setEndReason] = useState<CallEndReason>(null);
  const [callError, setCallError] = useState<string | null>(null);

  const callStatusRef = useRef<CallStatus>("idle");
  callStatusRef.current = callStatus;

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const userProfileRef = useRef(userProfile);
  userProfileRef.current = userProfile;
  const activeCallRef = useRef<ActiveCallInfo | null>(null);
  activeCallRef.current = activeCall;
  const callDurationRef = useRef(0);
  callDurationRef.current = callDuration;

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callDocUnsubRef = useRef<(() => void) | null>(null);
  const candidatesUnsubRef = useRef<(() => void) | null>(null);
  const incomingListenerUnsubRef = useRef<(() => void) | null>(null);
  const remoteDescSetRef = useRef(false);
  const pendingCandidatesRef = useRef<any[]>([]);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const incomingHandledRef = useRef<Set<string>>(new Set());
  const tonePlayerRef = useRef(new TonePlayer());
  const endResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRingTimeout = () => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  };

  const clearDurationTimer = () => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  };

  const stopMediaTracks = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
  };

  // Writes a Messenger/WhatsApp-style call summary into the 1:1 chat thread
  // shared with the peer, so both sides see a record of the call. Only the
  // caller ("outgoing" direction) writes this to avoid duplicate entries.
  const logCallMessage = async (
    peerId: string,
    peerName: string,
    type: CallType,
    status: string,
    durationSecs: number
  ) => {
    const user = currentUserRef.current;
    const profile = userProfileRef.current;
    if (!user || !profile) return;

    try {
      const chatId = [user.uid, peerId].sort().join("_");
      const chatDocRef = doc(db, "chats", chatId);

      const chatSnap = await getDoc(chatDocRef);
      if (!chatSnap.exists()) {
        await setDoc(
          chatDocRef,
          {
            id: chatId,
            participants: [user.uid, peerId].sort(),
            lastMessage: "No messages shared yet",
            lastMessageAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }

      const icon = type === "video" ? "📹" : "📞";
      const label = type === "video" ? "Video call" : "Voice call";
      const fmtDur = (secs: number) => {
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s.toString().padStart(2, "0")}`;
      };

      let text = `${icon} ${label}`;
      if (status === "ended") text = `${icon} ${label} · ${fmtDur(durationSecs)}`;
      else if (status === "missed") text = `${icon} Missed ${label.toLowerCase()}`;
      else if (status === "declined") text = `${icon} ${label} declined`;
      else if (status === "busy") text = `${icon} ${label} not answered`;
      else if (status === "cancelled") text = `${icon} ${label} cancelled`;
      else if (status === "failed") text = `${icon} ${label} failed`;

      await addDoc(collection(db, "chats", chatId, "messages"), {
        senderId: user.uid,
        senderUsername: profile.username,
        text,
        imageUrl: "",
        audioUrl: "",
        isSticker: false,
        seen: false,
        timestamp: new Date().toISOString(),
        callLog: { type, status, durationSecs, peerName },
      });

      await updateDoc(chatDocRef, {
        lastMessage: text,
        lastMessageAt: new Date().toISOString(),
      });
    } catch {
      // Best-effort — never block call teardown on chat logging failures.
    }
  };

  const resetToIdle = useCallback((reason: CallEndReason = null) => {
    const call = activeCallRef.current;
    const priorStatus = callStatusRef.current;
    const duration = callDurationRef.current;

    tonePlayerRef.current.stop();
    clearRingTimeout();
    clearDurationTimer();
    stopMediaTracks();

    if (call && call.direction === "outgoing" && priorStatus !== "idle") {
      let logStatus: string = reason || (priorStatus === "connected" ? "ended" : "cancelled");
      const logDuration = logStatus === "ended" ? duration : 0;
      logCallMessage(call.peerId, call.peerName, call.type, logStatus, logDuration);
    }

    pcRef.current?.close();
    pcRef.current = null;

    callDocUnsubRef.current?.();
    callDocUnsubRef.current = null;
    candidatesUnsubRef.current?.();
    candidatesUnsubRef.current = null;

    remoteDescSetRef.current = false;
    pendingCandidatesRef.current = [];

    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsCameraOff(false);
    setCallDuration(0);

    if (reason) {
      setEndReason(reason);
      setCallStatus("ended");
      if (endResetTimeoutRef.current) clearTimeout(endResetTimeoutRef.current);
      endResetTimeoutRef.current = setTimeout(() => {
        setCallStatus("idle");
        setActiveCall(null);
        setEndReason(null);
      }, 1800);
    } else {
      setCallStatus("idle");
      setActiveCall(null);
      setEndReason(null);
    }
  }, []);

  const createPeerConnection = useCallback(
    (callId: string, candidatesCollectionName: "callerCandidates" | "calleeCandidates") => {
      const pc = new RTCPeerConnection(ICE_SERVERS);

      const remote = new MediaStream();
      setRemoteStream(remote);

      pc.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((track) => {
          if (!remote.getTracks().find((t) => t.id === track.id)) {
            remote.addTrack(track);
          }
        });
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          addDoc(collection(db, "calls", callId, candidatesCollectionName), event.candidate.toJSON()).catch(
            () => {}
          );
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setCallStatus((prev) => (prev === "connecting" || prev === "outgoing" || prev === "incoming" ? "connected" : prev));
        }
        if (pc.connectionState === "failed") {
          resetToIdle("failed");
        }
      };

      pcRef.current = pc;
      return pc;
    },
    [resetToIdle]
  );

  // Start ticking call duration once truly connected
  useEffect(() => {
    if (callStatus === "connected") {
      clearDurationTimer();
      durationIntervalRef.current = setInterval(() => {
        setCallDuration((d) => d + 1);
      }, 1000);
    } else {
      clearDurationTimer();
    }
    return () => clearDurationTimer();
  }, [callStatus]);

  // Update ringtone/ringback based on status
  useEffect(() => {
    if (callStatus === "outgoing") {
      tonePlayerRef.current.start("ringback");
    } else if (callStatus === "incoming") {
      tonePlayerRef.current.start("ringtone");
    } else {
      tonePlayerRef.current.stop();
    }
  }, [callStatus]);

  const watchCallDoc = (callId: string, isCaller: boolean) => {
    // Replace any prior listener on this call doc (e.g. the pre-accept
    // "watch for cancel while incoming" listener) to avoid leaking it.
    callDocUnsubRef.current?.();
    callDocUnsubRef.current = null;

    const unsub = onSnapshot(doc(db, "calls", callId), async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as DocumentData;

      if (isCaller && data.answer && !remoteDescSetRef.current && pcRef.current) {
        try {
          remoteDescSetRef.current = true;
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          const pending = pendingCandidatesRef.current.splice(0);
          for (const c of pending) {
            try {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(c));
            } catch {}
          }
          setCallStatus("connecting");
        } catch {
          resetToIdle("failed");
        }
      }

      if (data.status === "declined") resetToIdle("declined");
      else if (data.status === "busy") resetToIdle("busy");
      else if (data.status === "cancelled") resetToIdle("cancelled");
      else if (data.status === "ended") resetToIdle("ended");
      else if (data.status === "missed") resetToIdle("missed");
    });
    callDocUnsubRef.current = unsub;
  };

  const watchRemoteCandidates = (callId: string, collectionName: "callerCandidates" | "calleeCandidates") => {
    const unsub = onSnapshot(collection(db, "calls", callId, collectionName), (snap) => {
      snap.docChanges().forEach(async (change) => {
        if (change.type !== "added") return;
        const candidate = change.doc.data();
        if (remoteDescSetRef.current && pcRef.current) {
          try {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          } catch {}
        } else {
          pendingCandidatesRef.current.push(candidate);
        }
      });
    });
    candidatesUnsubRef.current = unsub;
  };

  const startCall = async (friend: UserProfile, type: CallType) => {
    if (!currentUser || !userProfile) return;
    if (callStatusRef.current !== "idle") {
      setCallError("You are already on a call.");
      setTimeout(() => setCallError(null), 3000);
      return;
    }

    // Refuse to call someone you cannot interact with (blocked either direction).
    if (isUserBlocked(friend.uid)) {
      setCallError(getBlockMessage(friend.uid) || "Calls are disabled for this user.");
      setTimeout(() => setCallError(null), 4000);
      return;
    }

    setCallError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === "video" ? { facingMode: "user" } : false,
      });
    } catch (e) {
      setCallError("Could not access microphone/camera. Please check permissions.");
      setTimeout(() => setCallError(null), 4000);
      return;
    }

    localStreamRef.current = stream;
    setLocalStream(stream);

    const callDocRef = await addDoc(collection(db, "calls"), {
      callerId: currentUser.uid,
      callerName: userProfile.displayName,
      callerAvatar: userProfile.avatarUrl,
      calleeId: friend.uid,
      calleeName: friend.displayName,
      calleeAvatar: friend.avatarUrl,
      type,
      status: "ringing",
      createdAt: serverTimestamp(),
    });

    const callId = callDocRef.id;

    setActiveCall({
      callId,
      type,
      direction: "outgoing",
      peerId: friend.uid,
      peerName: friend.displayName,
      peerAvatar: friend.avatarUrl,
    });
    setCallStatus("outgoing");

    const pc = createPeerConnection(callId, "callerCandidates");
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await updateDoc(callDocRef, { offer: { type: offer.type, sdp: offer.sdp } });
    } catch {
      resetToIdle("failed");
      return;
    }

    watchCallDoc(callId, true);
    watchRemoteCandidates(callId, "calleeCandidates");

    ringTimeoutRef.current = setTimeout(async () => {
      if (callStatusRef.current === "outgoing") {
        try {
          await updateDoc(doc(db, "calls", callId), { status: "missed" });
        } catch {}
        resetToIdle("missed");
      }
    }, RING_TIMEOUT_MS);
  };

  const acceptCall = async () => {
    if (!activeCall || callStatusRef.current !== "incoming") return;
    const { callId, type } = activeCall;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === "video" ? { facingMode: "user" } : false,
      });
    } catch {
      setCallError("Could not access microphone/camera. Please check permissions.");
      setTimeout(() => setCallError(null), 4000);
      await declineCall();
      return;
    }

    localStreamRef.current = stream;
    setLocalStream(stream);
    clearRingTimeout();

    try {
      const callSnap = await getDoc(doc(db, "calls", callId));
      const callSnapData = callSnap.exists() ? callSnap.data() : null;

      if (!callSnapData || !callSnapData.offer) {
        resetToIdle("failed");
        return;
      }

      const pc = createPeerConnection(callId, "calleeCandidates");
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(callSnapData.offer));
      remoteDescSetRef.current = true;
      const pending = pendingCandidatesRef.current.splice(0);
      for (const c of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch {}
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await updateDoc(doc(db, "calls", callId), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: "accepted",
        acceptedAt: serverTimestamp(),
      });

      setCallStatus("connecting");
      watchCallDoc(callId, false);
      watchRemoteCandidates(callId, "callerCandidates");
    } catch {
      resetToIdle("failed");
    }
  };

  const declineCall = async () => {
    if (!activeCall) return;
    try {
      await updateDoc(doc(db, "calls", activeCall.callId), { status: "declined" });
    } catch {}
    resetToIdle(null);
  };

  const endCall = async () => {
    if (!activeCall) return;
    try {
      const isOutgoingUnanswered = callStatusRef.current === "outgoing";
      await updateDoc(doc(db, "calls", activeCall.callId), {
        status: isOutgoingUnanswered ? "cancelled" : "ended",
        endedAt: serverTimestamp(),
      });
    } catch {}
    resetToIdle(null);
  };

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = isMuted));
    setIsMuted((m) => !m);
  };

  const toggleCamera = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = isCameraOff));
    setIsCameraOff((c) => !c);
  };

  const toggleSpeaker = () => {
    setIsSpeakerOn((s) => !s);
  };

  // Listen for incoming calls addressed to the current user
  useEffect(() => {
    incomingListenerUnsubRef.current?.();
    incomingListenerUnsubRef.current = null;

    if (!currentUser) return;

    const q = query(collection(db, "calls"), where("calleeId", "==", currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((change) => {
        const data = change.doc.data() as DocumentData;
        const callId = change.doc.id;

        if (data.status !== "ringing") return;
        if (incomingHandledRef.current.has(callId)) return;

        // Never surface calls from users you have blocked — auto-decline.
        if (isUserBlocked(data.callerId)) {
          incomingHandledRef.current.add(callId);
          updateDoc(change.doc.ref, { status: "declined" }).catch(() => {});
          return;
        }

        if (callStatusRef.current !== "idle") {
          // Busy on another call — auto reject
          updateDoc(change.doc.ref, { status: "busy" }).catch(() => {});
          return;
        }

        incomingHandledRef.current.add(callId);

        setActiveCall({
          callId,
          type: data.type,
          direction: "incoming",
          peerId: data.callerId,
          peerName: data.callerName,
          peerAvatar: data.callerAvatar,
        });
        setCallStatus("incoming");

        // Watch this call doc in case caller cancels before we answer
        const unsubDoc = onSnapshot(doc(db, "calls", callId), (docSnap) => {
          const d = docSnap.data();
          if (!d) return;
          if (["cancelled", "missed", "ended"].includes(d.status) && callStatusRef.current === "incoming") {
            unsubDoc();
            resetToIdle(d.status === "cancelled" ? "cancelled" : d.status === "missed" ? "missed" : "ended");
          }
        });
        // Store this temporary unsub so watchCallDoc (used post-accept) can override it safely
        callDocUnsubRef.current = unsubDoc;
      });
    });

    incomingListenerUnsubRef.current = unsub;
    return () => unsub();
  }, [currentUser, resetToIdle]);

  // Cleanup if user logs out mid-call
  useEffect(() => {
    if (!currentUser && callStatusRef.current !== "idle") {
      resetToIdle(null);
    }
  }, [currentUser, resetToIdle]);

  return (
    <CallContext.Provider
      value={{
        callStatus,
        activeCall,
        localStream,
        remoteStream,
        isMuted,
        isCameraOff,
        isSpeakerOn,
        callDuration,
        endReason,
        callError,
        startCall,
        acceptCall,
        declineCall,
        endCall,
        toggleMute,
        toggleCamera,
        toggleSpeaker,
      }}
    >
      {children}
    </CallContext.Provider>
  );
};
