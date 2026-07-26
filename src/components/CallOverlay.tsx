import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useCall } from "../context/CallContext";
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
} from "lucide-react";

const formatDuration = (secs: number) => {
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(secs % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
};

const endReasonLabel: Record<string, string> = {
  declined: "Call declined",
  ended: "Call ended",
  missed: "No answer",
  busy: "User is busy",
  cancelled: "Call cancelled",
  failed: "Connection failed",
};

const CallOverlay: React.FC = () => {
  const {
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
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
    toggleSpeaker,
  } = useCall();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  const isVideoCall = activeCall?.type === "video";
  const isVisible = callStatus !== "idle" && !!activeCall;

  return (
    <>
      <AnimatePresence>
        {callError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-[#0D111D] border border-red-500/40 text-red-300 text-xs font-mono px-4 py-2.5 rounded-xl shadow-2xl"
          >
            {callError}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isVisible && activeCall && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black flex flex-col overflow-hidden"
          >
            {/* Ambient background */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#0D111D] via-[#0B0F17] to-black" />
            <div className="absolute inset-0 opacity-30" style={{
              backgroundImage: "radial-gradient(circle at 30% 20%, rgba(148, 163, 184,0.25), transparent 45%), radial-gradient(circle at 70% 80%, rgba(108, 92, 224,0.2), transparent 45%)",
            }} />

            {/* --- VIDEO CALL: connected/connecting layer with actual media --- */}
            {isVideoCall && (callStatus === "connected" || callStatus === "connecting") && (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
            {!isVideoCall && <audio ref={remoteAudioRef} autoPlay />}

            {/* Overlay dark scrim so controls stay legible over video */}
            {isVideoCall && (callStatus === "connected" || callStatus === "connecting") && (
              <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/70" />
            )}

            {/* Top bar: peer identity + timer */}
            <div className="relative z-10 flex flex-col items-center pt-[calc(2.5rem+env(safe-area-inset-top,0px))] px-6 shrink-0">
              <span className="text-[10px] uppercase tracking-[0.2em] font-mono text-[#94A3B8] mb-1">
                {callStatus === "outgoing" && "Calling"}
                {callStatus === "incoming" && (isVideoCall ? "Incoming video call" : "Incoming voice call")}
                {callStatus === "connecting" && "Connecting"}
                {callStatus === "connected" && (isVideoCall ? "Video call" : "Voice call")}
                {callStatus === "ended" && endReason && endReasonLabel[endReason]}
              </span>
              <h2 className="text-xl font-bold text-white drop-shadow-lg">{activeCall.peerName}</h2>
              {callStatus === "connected" && (
                <span className="text-sm font-mono text-[#F8FAFC] mt-1 tabular-nums">
                  {formatDuration(callDuration)}
                </span>
              )}
            </div>

            {/* Center stage */}
            <div className="relative z-10 flex-1 flex items-center justify-center">
              {(!isVideoCall || (callStatus !== "connected" && callStatus !== "connecting")) && (
                <div className="flex flex-col items-center">
                  <div className="relative">
                    {(callStatus === "outgoing" || callStatus === "incoming") && (
                      <>
                        <motion.span
                          className="absolute inset-0 rounded-full border-2 border-[#94A3B8]/40"
                          animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
                          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                        />
                        <motion.span
                          className="absolute inset-0 rounded-full border-2 border-[#94A3B8]/30"
                          animate={{ scale: [1, 1.8], opacity: [0.5, 0] }}
                          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay: 0.4 }}
                        />
                      </>
                    )}
                    <img
                      src={activeCall.peerAvatar}
                      alt={activeCall.peerName}
                      referrerPolicy="no-referrer"
                      className="w-32 h-32 rounded-full object-cover border-2 border-[#94A3B8]/50 shadow-[0_0_40px_rgba(148, 163, 184,0.35)] relative z-10"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Local video PIP for video calls */}
            {isVideoCall && (callStatus === "connected" || callStatus === "connecting") && (
              <div className="absolute top-24 right-4 z-20 w-20 h-28 sm:w-24 sm:h-32 md:w-28 md:h-36 rounded-2xl overflow-hidden border-2 border-white/20 bg-[#0D111D] shadow-2xl">
                {isCameraOff ? (
                  <div className="w-full h-full flex items-center justify-center bg-[#0D111D]">
                    <VideoOff className="w-6 h-6 text-[#6C5CE0]" />
                  </div>
                ) : (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover -scale-x-100"
                  />
                )}
              </div>
            )}

            {/* Controls */}
            <div className="relative z-10 pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))] pt-4 px-6 flex flex-col items-center gap-6 shrink-0">
              {callStatus === "incoming" ? (
                <div className="flex items-center gap-8 sm:gap-10">
                  <button
                    onClick={declineCall}
                    className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 active:scale-95 flex items-center justify-center shadow-[0_0_25px_rgba(239,68,68,0.5)] transition-all cursor-pointer"
                    title="Decline"
                  >
                    <PhoneOff className="w-6 h-6 text-white" />
                  </button>
                  <button
                    onClick={acceptCall}
                    className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 flex items-center justify-center shadow-[0_0_25px_rgba(34, 197, 94,0.5)] transition-all cursor-pointer"
                    title="Accept"
                  >
                    {isVideoCall ? <Video className="w-6 h-6 text-white" /> : <Phone className="w-6 h-6 text-white" />}
                  </button>
                </div>
              ) : callStatus === "ended" ? (
                <div className="h-16 flex items-center justify-center">
                  <div className="w-14 h-14 rounded-full bg-[#161A2B] flex items-center justify-center">
                    <PhoneOff className="w-5 h-5 text-[#94A3B8]" />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 sm:gap-4">
                  <button
                    onClick={toggleMute}
                    className={`w-[52px] h-[52px] rounded-full border flex items-center justify-center cursor-pointer transition-all active:scale-95 ${
                      isMuted
                        ? "bg-white text-neutral-900 border-white"
                        : "bg-white/10 text-white border-white/20 hover:bg-white/20"
                    }`}
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>

                  {isVideoCall && (
                    <button
                      onClick={toggleCamera}
                      className={`w-[52px] h-[52px] rounded-full border flex items-center justify-center cursor-pointer transition-all active:scale-95 ${
                        isCameraOff
                          ? "bg-white text-neutral-900 border-white"
                          : "bg-white/10 text-white border-white/20 hover:bg-white/20"
                      }`}
                      title={isCameraOff ? "Turn camera on" : "Turn camera off"}
                    >
                      {isCameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                    </button>
                  )}

                  {!isVideoCall && (
                    <button
                      onClick={toggleSpeaker}
                      className={`w-[52px] h-[52px] rounded-full border flex items-center justify-center cursor-pointer transition-all active:scale-95 ${
                        isSpeakerOn
                          ? "bg-white/10 text-white border-white/20 hover:bg-white/20"
                          : "bg-white text-neutral-900 border-white"
                      }`}
                      title={isSpeakerOn ? "Speaker on" : "Speaker off"}
                    >
                      {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                    </button>
                  )}

                  <button
                    onClick={endCall}
                    className="w-[60px] h-[60px] rounded-full bg-red-500 hover:bg-red-400 active:scale-95 flex items-center justify-center shadow-[0_0_25px_rgba(239,68,68,0.5)] transition-all cursor-pointer"
                    title="End call"
                  >
                    <PhoneOff className="w-6 h-6 text-white" />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default CallOverlay;
