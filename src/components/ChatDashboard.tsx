import React, { useState, useEffect, useRef } from "react";
import { useChat } from "../context/ChatContext";
import { useCall } from "../context/CallContext";
import { usePrimaryWallet } from "../hooks/usePrimaryWallet";
import { UserProfile, ChatMessage } from "../types";
import { compressImage } from "../utils/image";
import CallHistory from "./CallHistory";
import DealRoom from "./DealRoom";
import CircleWalletDashboard from "./CircleWalletDashboard";
import SendUsdcModal from "./SendUsdcModal";
import BlockUserModal, { BlockModalMode } from "./BlockUserModal";
import { useBlock } from "../context/BlockContext";
import { getBlockMessage } from "../utils/blocking";
import { ArcPaymentReceipt } from "../payments";
// @ts-ignore
import micaLogo from "../assets/images/micalogo.png";

import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  UserPlus,
  Check,
  X,
  Send,
  Image as ImageIcon,
  LogOut,
  User,
  MessageSquare,
  Sparkles,
  ArrowLeft,
  ChevronRight,
  Activity,
  Upload,
  Loader2,
  Lock,
  Wallet,
  MoreVertical,
  Shield,
  ShieldCheck,
  ShieldOff,
  RefreshCw,
  Info,
  Copy,
  Github,
  Twitter,
  Smile,
  Globe,
  Camera,
  ExternalLink,
  Settings,
  MessageCircle,
  UsersRound,
  Bell,
  BellOff,
  CornerUpLeft,
  Mic,
  Square,
  Volume2,
  Play,
  Pause,
  Bot,
  Coins,
  Cpu,
  CreditCard,
  Trash2,
  Pencil,
  Phone,
  Video,
  Handshake,
} from "lucide-react";

interface VoiceMessagePlayerProps {
  audioUrl: string;
  isSelf: boolean;
}

const VoiceMessagePlayer: React.FC<VoiceMessagePlayerProps> = ({ audioUrl, isSelf }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(audioUrl);
    audio.preload = "auto";
    audioRef.current = audio;

    const onLoadedMetadata = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        return;
      }

      // Chrome/MediaRecorder webm quirk: locally-recorded webm blobs often report
      // duration as Infinity because the container has no proper duration header.
      // Forcing a seek near the end makes the browser compute the real duration,
      // after which we jump back to the start so playback works normally.
      const recoverDuration = () => {
        audio.removeEventListener("timeupdate", recoverDuration);
        if (isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration);
        }
        audio.currentTime = 0;
      };
      audio.addEventListener("timeupdate", recoverDuration);
      audio.currentTime = 1e7;
    };

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };

    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);

    // Auto-load
    audio.load();

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioUrl]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.error("Voice note playback failed:", err);
        setIsPlaying(false);
      });
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || !isFinite(secs)) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  const percentage = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 py-1 px-1.5 min-w-[200px] sm:min-w-[240px]">
      <button
        type="button"
        onClick={togglePlay}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 ${
          isSelf 
            ? "bg-white text-[#6C5CE0] hover:scale-105 cursor-pointer" 
            : "bg-white text-[#6C5CE0] hover:scale-105 cursor-pointer"
        }`}
      >
        {isPlaying ? (
          <Pause className="w-3.5 h-3.5 fill-current" />
        ) : (
          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
        )}
      </button>

      <div className="flex-1 flex flex-col gap-1">
        {/* Progress bar */}
        <div className={`h-1.5 rounded-full relative w-full overflow-hidden bg-white/25`}>
          <div
            className={`h-full rounded-full transition-all duration-100 bg-white`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[9px] opacity-75 font-mono">
          <span className="flex items-center gap-1">
            <Volume2 className="w-2.5 h-2.5" />
            Voice Note
          </span>
          <span>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
};

const DEFAULT_GIFS = [
  { id: "g1", title: "Excited Dance", url: "https://media.giphy.com/media/l3vRlT2WlDM38LeHS/giphy.gif" },
  { id: "g2", title: "Thumbs Up Cute Cat", url: "https://media.giphy.com/media/3ntq5Fx67e6A0/giphy.gif" },
  { id: "g3", title: "Coding Hard", url: "https://media.giphy.com/media/13HgwGsXF0bKCY/giphy.gif" },
  { id: "g4", title: "Mind Blown Space", url: "https://media.giphy.com/media/l0IykG0AM7911MrCM/giphy.gif" },
  { id: "g5", title: "Anime Yes Smile", url: "https://media.giphy.com/media/9G1tb6uVcZvk4/giphy.gif" },
  { id: "g6", title: "Doge Happy Orbit", url: "https://media.giphy.com/media/oBQZfQ2TFD4Sk/giphy.gif" },
  { id: "g7", title: "Shocked Pikachu", url: "https://media.giphy.com/media/3kzWut7TLYg7A/giphy.gif" },
  { id: "g8", title: "SpongeBob Hearts", url: "https://media.giphy.com/media/lTQF0ODLLjhza/giphy.gif" }
];

const DEFAULT_STICKERS = [
  { id: "s1", name: "Thumbs Up", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f44d.svg" },
  { id: "s2", name: "Heart Fire", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u2764.svg" },
  { id: "s3", name: "Rocket", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f680.svg" },
  { id: "s4", name: "Fire", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f525.svg" },
  { id: "s5", name: "Party Popper", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f389.svg" },
  { id: "s6", name: "Eyes", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f440.svg" },
  { id: "s7", name: "Glowing Diamond", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f48e.svg" },
  { id: "s8", name: "Flying Money", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f4b8.svg" },
  { id: "s9", name: "Angry Face", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f621.svg" },
  { id: "s10", name: "Crying Face", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f622.svg" },
  { id: "s11", name: "Laughing Face", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f602.svg" },
  { id: "s12", name: "Sparkles", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u2728.svg" },
  { id: "s13", name: "Alien Monster", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f47e.svg" },
  { id: "s14", name: "Ghost", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f47b.svg" },
  { id: "s15", name: "Crown", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f451.svg" },
  { id: "s16", name: "Crystal Ball", url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u1f52e.svg" }
];

/* ------------------------------------------------------------------ */
/* MICA Inbox welcome — clean branded greeting with a typewriter name  */
/* ------------------------------------------------------------------ */

const InboxWelcome: React.FC<{ displayName: string }> = ({ displayName }) => {
  const fullName = (displayName || "").trim() || "there";
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"typing" | "hold" | "deleting">("typing");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      if (text.length < fullName.length) {
        timer = setTimeout(() => setText(fullName.slice(0, text.length + 1)), 88);
      } else {
        timer = setTimeout(() => setPhase("hold"), 1900);
      }
    } else if (phase === "hold") {
      timer = setTimeout(() => setPhase("deleting"), 700);
    } else {
      if (text.length > 0) {
        timer = setTimeout(() => setText(fullName.slice(0, text.length - 1)), 42);
      } else {
        timer = setTimeout(() => setPhase("typing"), 900);
      }
    }
    return () => clearTimeout(timer);
  }, [phase, text, fullName]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-6 select-none relative overflow-hidden">
      {/* Soft purple ambient glow blobs */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 55% at 50% 20%, rgba(124,58,237,0.16) 0%, rgba(76,29,149,0.06) 45%, rgba(5,3,12,0) 75%), radial-gradient(50% 45% at 88% 80%, rgba(139,92,246,0.10) 0%, rgba(5,3,12,0) 70%), radial-gradient(140% 130% at 50% 50%, rgba(5,3,12,0) 35%, rgba(2,1,6,0.9) 100%)",
        }}
      />
      <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[34rem] h-64 bg-[#6D28D9]/[0.18] blur-[120px] rounded-full" />
      <div className="pointer-events-none absolute bottom-0 right-0 w-72 h-72 bg-[#8B5CF6]/[0.12] blur-[130px] rounded-full" />

      {/* Floating particles */}
      {[
        { top: "18%", left: "14%", d: 0 },
        { top: "30%", left: "86%", d: 1.2 },
        { top: "70%", left: "12%", d: 0.6 },
        { top: "80%", left: "88%", d: 1.8 },
        { top: "50%", left: "50%", d: 0.9 },
        { top: "12%", left: "60%", d: 1.4 },
        { top: "62%", left: "28%", d: 2.2 },
      ].map((p, i) => (
        <span
          key={i}
          className="pointer-events-none absolute w-1.5 h-1.5 rounded-full bg-[#A78BFA]/70 blur-[1px] animate-pulse"
          style={{ top: p.top, left: p.left, animationDelay: `${p.d}s` }}
        />
      ))}

      {/* Centered glass welcome card */}
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-xl rounded-3xl border border-[#8B5CF6]/25 bg-[#0B0716]/70 backdrop-blur-2xl px-6 sm:px-10 py-10 sm:py-12 text-center shadow-[0_0_80px_rgba(124,58,237,0.18),0_30px_80px_-30px_rgba(0,0,0,0.9)]"
      >
        {/* top sheen */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#A78BFA]/60 to-transparent"
        />
        <div
          className="pointer-events-none absolute inset-0 rounded-3xl"
          style={{
            background:
              "radial-gradient(90% 70% at 50% 0%, rgba(124,58,237,0.12) 0%, rgba(7,4,15,0) 60%)",
          }}
        />

        <div className="relative">
          {/* MICA logo */}
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7C3AED] to-[#8B5CF6] shadow-[0_0_30px_rgba(124,58,237,0.45)]">
            <img src={micaLogo} alt="MICA" className="w-9 h-9 object-contain rounded-lg" />
          </div>

          <h1 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
            <span className="bg-gradient-to-r from-[#A78BFA] via-[#D8CCFF] to-[#8B5CF6] bg-clip-text text-transparent">
              Welcome to MICA,{" "}
            </span>
            <span className="text-white">&ldquo;</span>
            <span className="bg-gradient-to-r from-[#C084FC] via-[#E9D5FF] to-[#A78BFA] bg-clip-text text-transparent whitespace-nowrap">
              {text}
            </span>
            <span
              className="inline-block w-[2px] h-[1em] align-middle ml-0.5 bg-[#C084FC] animate-pulse"
            />
            <span className="text-white">&ldquo;</span>
          </h1>

          <p className="mt-4 text-xs sm:text-sm text-[#8A96B8] font-medium tracking-wide">
            Your conversations. Your network. Your space.
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default function ChatDashboard() {
  const {
    currentUser,
    userProfile,
    friends,
    friendRequests,
    activeChatId,
    activeChatFriend,
    activeChatMessages,
    setActiveChatId,
    updateProfile,
    searchUsers,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    sendMessage,
    toggleReaction,
    deleteMessage,
    editMessage,
    uploadImage,
    logout,
    completeOnboarding,
    updatePrimaryWallet,
    logPaymentMessage,
    appNotifications,
    chatSessions,
    dismissNotification,
    isFriendTyping,
    setTypingStatus,
    triggerBotResponse,
    circleWallet,
  } = useChat();

  const { startCall } = useCall();

  // Two-way Firestore-backed block state (who I blocked, and who blocked me).
  const {
    blockedUids,
    blockedByUids,
    iBlocked,
    blockedBy,
    canInteractWith,
    blockUser,
    unblockUser,
  } = useBlock();

  // Privy-verified primary wallet. This is the ONLY source of truth for wallet
  // addresses — manual wallet input is never accepted.
  const {
    primaryWallet: privyPrimaryWallet,
    privyUserId,
    connecting: walletConnecting,
    connectWallet,
  } = usePrimaryWallet();

  // Onboarding Screen States
  const [onboardUsername, setOnboardUsername] = useState("");
  const [onboardDisplayName, setOnboardDisplayName] = useState("");
  const [onboardAvatarSeed, setOnboardAvatarSeed] = useState("");
  const [onboardAvatarStyle, setOnboardAvatarStyle] = useState("bottts");
  const [onboardCustomAvatarUrl, setOnboardCustomAvatarUrl] = useState("");
  const [onboardAvatarType, setOnboardAvatarType] = useState<"dicebear" | "custom">("dicebear");
  const [onboardIsUploading, setOnboardIsUploading] = useState(false);
  const [onboardError, setOnboardError] = useState("");
  const [onboardLoading, setOnboardLoading] = useState(false);

  useEffect(() => {
    if (userProfile && userProfile.onboardingCompleted === false) {
      setOnboardUsername(userProfile.username || "");
      setOnboardDisplayName(userProfile?.displayName || "");

      const avUrl = userProfile.avatarUrl || "";
      if (avUrl.includes("api.dicebear.com")) {
        setOnboardAvatarType("dicebear");
        const styleMatch = avUrl.match(/7\.x\/([^/]+)\/svg/);
        setOnboardAvatarStyle(styleMatch ? styleMatch[1] : "bottts");
        const seedMatch = avUrl.match(/seed=([^&]+)/);
        setOnboardAvatarSeed(seedMatch ? seedMatch[1] : `bot_${Math.floor(Math.random() * 1000)}`);
      } else if (avUrl) {
        setOnboardAvatarType("custom");
        setOnboardCustomAvatarUrl(avUrl);
      } else {
        setOnboardAvatarType("dicebear");
        setOnboardAvatarSeed(`bot_${Math.floor(Math.random() * 1000)}`);
      }
    }
  }, [userProfile]);

  const handleConnectOnboardWallet = async () => {
    setOnboardError("");
    const linked = await connectWallet();
    if (!linked) {
      setOnboardError("No wallet was connected. Please try again to link a wallet.");
    }
  };

  const handleOnboardingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOnboardError("");
    setOnboardLoading(true);

    try {
      if (!onboardUsername.trim() || !onboardDisplayName.trim()) {
        throw new Error("Username and Display Name are required");
      }

      const cleanUser = onboardUsername.toLowerCase().trim().replace(/[^a-z0-9_]/g, "");
      if (cleanUser !== onboardUsername.toLowerCase().trim()) {
        throw new Error("Username can only contain alphanumeric characters and underscores");
      }

      const finalAvatarUrl = onboardAvatarType === "custom" && onboardCustomAvatarUrl
        ? onboardCustomAvatarUrl
        : `https://api.dicebear.com/7.x/${onboardAvatarStyle}/svg?seed=${onboardAvatarSeed.trim() || "default"}`;

      await completeOnboarding(
        cleanUser,
        onboardDisplayName.trim(),
        finalAvatarUrl,
        privyPrimaryWallet,
        privyUserId || undefined
      );
    } catch (err: any) {
      setOnboardError(err.message || "Could not complete onboarding configuration.");
    } finally {
      setOnboardLoading(false);
    }
  };

  // Search and invite tab states
  const [searchVal, setSearchVal] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<{ [uid: string]: string }>({});

  // Profile Edit Modal States
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettingsPage, setShowSettingsPage] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [avatarSeed, setAvatarSeed] = useState("");
  const [avatarStyle, setAvatarStyle] = useState("bottts");
  const [customAvatarUrl, setCustomAvatarUrl] = useState("");
  const [avatarType, setAvatarType] = useState<"dicebear" | "custom">("dicebear");
  const [editBio, setEditBio] = useState("");
  const [editMoodEmoji, setEditMoodEmoji] = useState("");
  const [editGithubUrl, setEditGithubUrl] = useState("");
  const [editTwitterUrl, setEditTwitterUrl] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [changingWallet, setChangingWallet] = useState(false);

  // New Preferences & Payment States
  const [notificationSounds, setNotificationSounds] = useState(() => {
    return localStorage.getItem("notification_sounds") !== "false";
  });
  const [doNotDisturb, setDoNotDisturb] = useState(() => {
    return localStorage.getItem("do_not_disturb") === "true";
  });
  const [micaVoiceEnabled, setMicaVoiceEnabled] = useState(() => {
    return localStorage.getItem("mica_voice_enabled") !== "false";
  });
  const [micaWidgetEnabled, setMicaWidgetEnabled] = useState(() => {
    return localStorage.getItem("mica_widget_enabled") !== "false";
  });
  const [micaVoiceIntervalMs, setMicaVoiceIntervalMs] = useState(() => {
    return localStorage.getItem("mica_voice_interval_ms") || "15000";
  });
  const [walletBalance, setWalletBalance] = useState(() => {
    const val = localStorage.getItem("wallet_balance_sol");
    return val ? parseFloat(val).toFixed(2) : "2.50";
  });
  const [activeTipRate, setActiveTipRate] = useState(() => {
    return localStorage.getItem("active_tip_rate") || "0.05";
  });
  const [paymentAutoApprove, setPaymentAutoApprove] = useState(() => {
    return localStorage.getItem("payment_auto_approve") === "true";
  });

  const handleSimulateDeposit = () => {
    const nextBal = (parseFloat(walletBalance) + 1.50).toFixed(2);
    setWalletBalance(nextBal);
    localStorage.setItem("wallet_balance_sol", nextBal);
    showToast("Simulated Airdrop: +1.50 SOL added to your node's wallet!", "success");
  };

  // Expandable Chat Partner Details layout indicator
  const [showDetailsSidebar, setShowDetailsSidebar] = useState(true);

  // Chat Input Text state
  const [msgText, setMsgText] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [activeMessagePopupId, setActiveMessagePopupId] = useState<string | null>(null);

  // Voice recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const recordingTimerRef = useRef<any>(null);

  // Mobile floating toolbar toggle
  const [showMobileToolbar, setShowMobileToolbar] = useState(false);

  // GIF and Sticker select modal/popups states
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [gifSearchQuery, setGifSearchQuery] = useState("");
  const [gifResults, setGifResults] = useState<any[]>([]);
  const [isLoadingGifs, setIsLoadingGifs] = useState(false);

  // AI Agent Deployment states
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [agentName, setAgentName] = useState("Sovereign Arb Node v1");
  const [agentModel, setAgentModel] = useState("gemini-2.5-flash");
  const [agentDirective, setAgentDirective] = useState("Maximize arbitrage yields across DEXes, monitor meme liquidity, and report on chain state.");
  const [agentFunding, setAgentFunding] = useState("0.5");
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentLogs, setDeploymentLogs] = useState<string[]>([]);

  // Web3 Secure Payment states
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("0.1");
  const [paymentRecipient, setPaymentRecipient] = useState("");
  const [paymentMemo, setPaymentMemo] = useState("Secure state synchronization fee");
  const [paymentSpeed, setPaymentSpeed] = useState("fast");
  const [isPaying, setIsPaying] = useState(false);
  const [paymentStep, setPaymentStep] = useState(0);
  const [paymentTxId, setPaymentTxId] = useState("");

  // Arc USDC "Send USDC" payment popup (Chat Profile Details -> Pay)
  const [showUsdcPaymentModal, setShowUsdcPaymentModal] = useState(false);

  // Inbox-style UI state (contact search, notes, block/transfer session controls)
  const [inboxSearchQuery, setInboxSearchQuery] = useState("");
  const [notesByChatId, setNotesByChatId] = useState<{ [chatId: string]: { id: string; label: string; text: string }[] }>(() => {
    try {
      const stored = localStorage.getItem("mica_chat_notes");
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState("");

  // Block / Unblock confirmation modal state
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [blockConfirmMode, setConfirmBlockMode] = useState<BlockModalMode>("block");
  const [blockConfirmTarget, setBlockConfirmTarget] = useState<{ uid: string; displayName: string } | null>(null);
  const [mutedChatIds, setMutedChatIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("mica_muted_chat_ids");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [showTransferPicker, setShowTransferPicker] = useState(false);

  const persistNotes = (updated: { [chatId: string]: { id: string; label: string; text: string }[] }) => {
    setNotesByChatId(updated);
    try {
      localStorage.setItem("mica_chat_notes", JSON.stringify(updated));
    } catch {
      // ignore storage errors
    }
  };

  const persistMutedChatIds = (updated: string[]) => {
    setMutedChatIds(updated);
    try {
      localStorage.setItem("mica_muted_chat_ids", JSON.stringify(updated));
    } catch {
      // ignore storage errors
    }
  };

  const handleToggleMuteChat = (chatId: string, displayName: string) => {
    const isMuted = mutedChatIds.includes(chatId);
    const updated = isMuted ? mutedChatIds.filter((id) => id !== chatId) : [...mutedChatIds, chatId];
    persistMutedChatIds(updated);
    showToast(isMuted ? `Unmuted conversation with ${displayName}` : `Muted conversation with ${displayName}`, "success");
  };

  const handleAddNote = (chatId: string) => {
    if (!newNoteText.trim()) return;
    const existing = notesByChatId[chatId] || [];
    const newNote = {
      id: `note_${Date.now()}`,
      label: newNoteText.trim().slice(0, 24) || "Note",
      text: newNoteText.trim(),
    };
    const updated = { ...notesByChatId, [chatId]: [newNote, ...existing] };
    persistNotes(updated);
    setSelectedNoteId(newNote.id);
    setNewNoteText("");
    showToast("Note added", "success");
  };

  const handleDeleteNote = (chatId: string, noteId: string) => {
    const existing = notesByChatId[chatId] || [];
    const updated = { ...notesByChatId, [chatId]: existing.filter((n) => n.id !== noteId) };
    persistNotes(updated);
    if (selectedNoteId === noteId) setSelectedNoteId(null);
  };

  const handleToggleBlockUser = (uid: string, displayName: string) => {
    const isBlocked = blockedUids.includes(uid);
    setConfirmBlockMode(isBlocked ? "unblock" : "block");
    setBlockConfirmTarget({ uid, displayName });
    setBlockConfirmOpen(true);
  };

  const handleConfirmBlockAction = async () => {
    if (!blockConfirmTarget) return;
    const { uid, displayName } = blockConfirmTarget;
    if (blockConfirmMode === "block") {
      await blockUser(uid);
      showToast(`${displayName} has been blocked`, "error");
    } else {
      await unblockUser(uid);
      showToast(`${displayName} has been unblocked`, "success");
    }
    setBlockConfirmOpen(false);
    setBlockConfirmTarget(null);
  };

  // Guarded wrappers that refuse communication with a blocked user (either
  // direction) while keeping the underlying features (calls, payments) fully
  // intact otherwise.
  const isFriendBlocked = (friend: UserProfile | null | undefined) =>
    !!friend && !canInteractWith(friend.uid);

  const handleStartCall = (friend: UserProfile, type: "audio" | "video") => {
    if (isFriendBlocked(friend)) {
      showToast(
        getBlockMessage(friend.uid) || "Calls are disabled for this conversation.",
        "error"
      );
      return;
    }
    startCall(friend, type);
  };

  const handleOpenUsdcPayment = () => {
    if (isFriendBlocked(activeChatFriend)) {
      showToast(
        getBlockMessage(activeChatFriend?.uid) || "Payment requests are disabled for this conversation.",
        "error"
      );
      return;
    }
    setShowUsdcPaymentModal(true);
  };

  const handleTransferChat = (targetFriendId: string, targetName: string) => {
    const targetChatId = getChatIdForFriend(targetFriendId);
    handleSelectFriendChat(targetChatId);
    setShowTransferPicker(false);
    showToast(`Chat transferred to ${targetName}`, "success");
  };

  // Start Voice Recording
  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast("Microphone recording is not supported in this browser/environment", "error");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      } catch (e) {
        // Fallback for Safari/iOS
        try {
          recorder = new MediaRecorder(stream, { mimeType: "audio/mp4" });
        } catch (e2) {
          recorder = new MediaRecorder(stream);
        }
      }
      
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        setVoiceBlob(blob);
        // Clean up tracks
        stream.getTracks().forEach(track => track.stop());
      };

      setAudioChunks([]);
      setMediaRecorder(recorder);
      recorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      setVoiceBlob(null);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Microphone access failed", err);
      showToast("Could not access microphone: " + (err.message || err), "error");
    }
  };

  // Stop Voice Recording
  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  // Cancel Voice Recording without saving
  const cancelRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      // Temporarily overwrite onstop to discard chunks
      mediaRecorder.onstop = () => {
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorder.stop();
    }
    setIsRecording(false);
    setVoiceBlob(null);
    setMediaRecorder(null);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setRecordingDuration(0);
  };

  // Send the recorded voice message via Cloudinary
  const handleSendVoiceMessage = async () => {
    if (!voiceBlob) return;
    setIsUploadingVoice(true);
    try {
      const file = new File([voiceBlob], "voicemessage.webm", { type: voiceBlob.type });

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Voice upload failed");
      }

      const audioUrl = data.url;

      await sendMessage(
        "", 
        undefined, 
        replyingToMessage ? { id: replyingToMessage.id, senderUsername: replyingToMessage.senderUsername, text: replyingToMessage.text } : undefined, 
        audioUrl
      );
      setReplyingToMessage(null);
      setVoiceBlob(null);
      playSendSound();
      showToast("Voice note sent successfully!", "success");
    } catch (err: any) {
      console.error(err);
      showToast("Failed to send voice note: " + err.message, "error");
    } finally {
      setIsUploadingVoice(false);
    }
  };

  // Search GIFs from Giphy
  const searchGifs = async (query: string) => {
    setIsLoadingGifs(true);
    try {
      const apiKey = "dc6zaTOxFJmzC"; // Giphy public beta API key
      const endpoint = query 
        ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=12&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=12&rating=g`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data && data.data && data.data.length > 0) {
        const gifs = data.data.map((item: any) => ({
          id: item.id,
          title: item.title,
          url: item.images.fixed_height.url,
          previewUrl: item.images.fixed_height_small_still.url,
        }));
        setGifResults(gifs);
      } else {
        // Fallback to defaults
        setGifResults([]);
      }
    } catch (err) {
      console.error("Failed to fetch GIFs:", err);
      setGifResults([]);
    } finally {
      setIsLoadingGifs(false);
    }
  };

  // Trigger loading trending GIFs when GIF picker is shown
  useEffect(() => {
    if (showGifPicker) {
      searchGifs(gifSearchQuery);
    }
  }, [showGifPicker]);

  // Clean up recording timer on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, []);

  // Sync DND mode from database
  useEffect(() => {
    if (userProfile && userProfile.dndMode !== undefined) {
      if (userProfile.dndMode !== doNotDisturb) {
        setDoNotDisturb(userProfile.dndMode);
        localStorage.setItem("do_not_disturb", String(userProfile.dndMode));
      }
    }
  }, [userProfile]);

  // Sync recipient username when payment modal is displayed
  useEffect(() => {
    if (showPaymentModal && activeChatFriend) {
      setPaymentRecipient(`@${activeChatFriend.username}`);
    }
  }, [showPaymentModal, activeChatFriend]);

  const executeAgentDeployment = async () => {
    if (isDeploying) return;
    const fundingNum = parseFloat(agentFunding) || 0;
    const currentBal = parseFloat(walletBalance);
    if (fundingNum > currentBal) {
      showToast("Insufficient node wallet balance for deployment funding!", "error");
      return;
    }

    setIsDeploying(true);
    setDeploymentLogs([
      "▶ STARTING SECURE AGENT PROVISIONING...",
      "[VM-NODE] Requesting Virtual Shard allocation...",
    ]);

    const stepLogs = [
      "[SHARD] Virtual Machine shard #82c5 initialized successfully.",
      "[MEM] Allocation: 2.0GB Virtual RAM, 10 Shard compute capacity.",
      "[KEYS] Generating ephemeral ECDSA asymmetric credentials...",
      "[CHAIN] Simulating Solana Smart Contract integration...",
      `[AI] Connecting to Gemini 2.5 Node proxy...`,
      `[AI] Priming intelligence guidelines...`,
      `[FUNDS] Securing ${fundingNum.toFixed(2)} SOL in escrow smart contract...`,
      "▶ BROADCASTING AGENT SIGNATURE TO ORE PROTOCOL...",
      "✓ AGENT DEPLOYMENT COMPLETED SECURELY!"
    ];

    for (let i = 0; i < stepLogs.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 300));
      setDeploymentLogs((prev) => [...prev, stepLogs[i]]);
    }

    // After success, deduct the balance
    const nextBal = (currentBal - fundingNum).toFixed(2);
    setWalletBalance(nextBal);
    localStorage.setItem("wallet_balance_sol", nextBal);

    // Send chat message with metadata tag [AI_AGENT_DEPLOY]
    const payload = {
      name: agentName,
      model: agentModel,
      directive: agentDirective,
      funding: fundingNum.toFixed(2),
      status: "active",
      uptime: "99.98%",
      yield: "+1.25%",
    };
    await sendMessage(`[AI_AGENT_DEPLOY]${JSON.stringify(payload)}`);
    
    showToast(`AI Agent "${agentName}" deployed successfully!`, "success");
    setIsDeploying(false);
    setShowDeployModal(false);
    setDeploymentLogs([]);
  };

  const executeWeb3Payment = async () => {
    if (isPaying) return;
    const amountNum = parseFloat(paymentAmount) || 0;
    const currentBal = parseFloat(walletBalance);
    if (amountNum > currentBal) {
      showToast("Insufficient node wallet balance for this payment!", "error");
      return;
    }

    setIsPaying(true);
    setPaymentStep(1); // Signing

    await new Promise((resolve) => setTimeout(resolve, 1000));
    setPaymentStep(2); // Broadcasting

    await new Promise((resolve) => setTimeout(resolve, 1200));
    setPaymentStep(3); // Confirmed

    await new Promise((resolve) => setTimeout(resolve, 800));

    // Deduct balance
    const nextBal = (currentBal - amountNum).toFixed(2);
    setWalletBalance(nextBal);
    localStorage.setItem("wallet_balance_sol", nextBal);

    // Generate simulated tx signature
    const txId = "0x" + Array.from({length: 40}, () => Math.floor(Math.random()*16).toString(16)).join("");
    setPaymentTxId(txId);

    // Send message with tag [WEB3_PAYMENT]
    const payload = {
      amount: amountNum.toFixed(2),
      memo: paymentMemo || "Services & data state exchange fee",
      recipient: paymentRecipient || `@${activeChatFriend?.username || "peer"}`,
      speed: paymentSpeed === "instant" ? "Instant (Turbo-gas)" : paymentSpeed === "fast" ? "Fast (Priority)" : "Standard",
      txId,
    };
    await sendMessage(`[WEB3_PAYMENT]${JSON.stringify(payload)}`);

    showToast(`Successfully transferred ${amountNum.toFixed(2)} SOL to ${payload.recipient}!`, "success");
    setIsPaying(false);
    setPaymentStep(0);
    setShowPaymentModal(false);
  };

  // Typing status logic with debounce safety
  const typingTimeoutRef = useRef<any>(null);
  const isTypingRef = useRef<boolean>(false);

  const handleInputChange = () => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      setTypingStatus(true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      setTypingStatus(false);
    }, 3000);
  };

  const clearTypingStatusImmediately = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (isTypingRef.current) {
      isTypingRef.current = false;
      setTypingStatus(false);
    }
  };

  useEffect(() => {
    setActiveMessagePopupId(null);
    return () => {
      clearTypingStatusImmediately();
    };
  }, [activeChatId]);
  
  // Mobile responsive helper
  const [viewChatOnMobile, setViewChatOnMobile] = useState(false);

  // Dynamic Tab state representing bottom navigation (mimics uploaded interface)
  const [activeTab, setActiveTab] = useState<"chats" | "calls" | "friends" | "notifications" | "settings" | "analytics" | "dealroom" | "wallet">("chats");

  const handleSelectTab = (tab: "chats" | "calls" | "friends" | "notifications" | "settings" | "analytics" | "dealroom" | "wallet") => {
    setActiveTab(tab);
    setViewChatOnMobile(false);
    
    if (tab === "settings") {
      if (userProfile) {
        setEditDisplayName(userProfile.displayName || "");
        setEditBio(userProfile.bio || "");
        setEditGithubUrl(userProfile.githubUrl || "");
        setEditTwitterUrl(userProfile.twitterUrl || "");
        setEditMoodEmoji(userProfile.moodEmoji || "✨");
        if (userProfile.avatarUrl && !userProfile.avatarUrl.includes("dicebear")) {
          setCustomAvatarUrl(userProfile.avatarUrl);
          setAvatarType("custom");
        } else {
          setCustomAvatarUrl("");
          setAvatarType("bottts");
        }
      }
      setShowSettingsPage(true);
      setActiveChatId(null);
    } else {
      setShowSettingsPage(false);
    }
  };

  // Listen for deal room navigation events from notification banner
  useEffect(() => {
    const handler = () => handleSelectTab("dealroom");
    window.addEventListener("navigate-dealroom", handler);
    return () => window.removeEventListener("navigate-dealroom", handler);
  }, []);

  // Dynamic Non-blocking top corner Toast indicators
  const [toastMsg, setToastMsg] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMsg({ text, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToastMsg(null);
    }, 3500);
  };

  // Reference for message stream autolink scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendOnStopRef = useRef<boolean>(false);

  // "Stop & Send" sets sendOnStopRef and stops the recorder, but the recorder finishes
  // encoding the blob asynchronously (onstop -> setVoiceBlob). This effect watches for
  // that blob to actually arrive and fires the send once it does — without it, "Stop & Send"
  // silently did nothing beyond stopping the mic.
  useEffect(() => {
    if (voiceBlob && sendOnStopRef.current) {
      sendOnStopRef.current = false;
      handleSendVoiceMessage();
    }
  }, [voiceBlob]);

  const avatarUploadRef = useRef<HTMLInputElement>(null);
  const onboardAvatarUploadRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingAvatar(true);
    try {
      const base64DataUrl = await compressImage(file);
      setCustomAvatarUrl(base64DataUrl);
      setAvatarType("custom");
      showToast("Avatar image processed successfully!", "success");
    } catch (err: any) {
      console.error("Avatar compression failed:", err);
      showToast("Avatar upload failed: " + err.message, "error");
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleOnboardAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOnboardIsUploading(true);
    try {
      const base64DataUrl = await compressImage(file);
      setOnboardCustomAvatarUrl(base64DataUrl);
      setOnboardAvatarType("custom");
      showToast("Onboarding avatar processed!", "success");
    } catch (err: any) {
      console.error("Onboard avatar compression failed:", err);
      showToast("Avatar upload failed: " + (err.message || err), "error");
    } finally {
      setOnboardIsUploading(false);
    }
  };

  // Initialize edit profile form onSettings click deterministically
  const handleOpenSettings = () => {
    if (userProfile) {
      setEditDisplayName(userProfile.displayName || "");
      setEditBio(userProfile.bio || "");
      setEditMoodEmoji(userProfile.moodEmoji || "🚀");
      setEditGithubUrl(userProfile.githubUrl || "");
      setEditTwitterUrl(userProfile.twitterUrl || "");
      
      const avUrl = userProfile.avatarUrl || "";
      if (avUrl.includes("api.dicebear.com")) {
        setAvatarType("dicebear");
        const styleMatch = avUrl.match(/7\.x\/([^/]+)\/svg/);
        setAvatarStyle(styleMatch ? styleMatch[1] : "bottts");
        const seedMatch = avUrl.match(/seed=([^&]+)/);
        setAvatarSeed(seedMatch ? seedMatch[1] : "seed1");
        setCustomAvatarUrl("");
      } else {
        setAvatarType("custom");
        setCustomAvatarUrl(avUrl);
        setAvatarSeed("seed1");
        setAvatarStyle("bottts");
      }
    }
    setShowSettingsPage(true);
    setActiveChatId(null);
    setViewChatOnMobile(true);
    setActiveTab("settings");
  };

  // Autoscroll to bottom when messages list is altered or friend starts typing
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeChatMessages, isFriendTyping]);

  const playNotificationSound = () => {
    if (!notificationSounds || doNotDisturb) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      // Cute futuristic peer-to-peer digital alert
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12); // A5

      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.22);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.22);
    } catch (err) {
      console.error("Failed to play synthesis sound:", err);
    }
  };

  // Play a short outgoing "sent" blip whenever the current user dispatches a message.
  // Deliberately a different timbre/pitch shape than the incoming alert above so the two are distinguishable by ear.
  const playSendSound = () => {
    if (!notificationSounds) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      // Quick upward "whoosh" — snappier and lower-pitched than the incoming chime
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(420, audioCtx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(760, audioCtx.currentTime + 0.09);

      gainNode.gain.setValueAtTime(0.07, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.15);
    } catch (err) {
      console.error("Failed to play send sound:", err);
    }
  };

  // Monitor incoming signals and alert peer if active friend dispatches a message
  const lastMsgAlertRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeChatMessages.length > 0) {
      const lastMsg = activeChatMessages[activeChatMessages.length - 1];
      if (lastMsg.id !== lastMsgAlertRef.current) {
        lastMsgAlertRef.current = lastMsg.id;
        if (currentUser && lastMsg.senderId !== currentUser.uid) {
          playNotificationSound();
        }
      }
    } else {
      lastMsgAlertRef.current = null;
    }
  }, [activeChatMessages]);

  // Toggle active chat on mobile views
  const handleSelectFriendChat = (chatId: string) => {
    setShowSettingsPage(false);
    setActiveChatId(chatId);
    setViewChatOnMobile(true);
  };

  const handleBackToChats = () => {
    setViewChatOnMobile(false);
    setActiveChatId(null);
    setShowSettingsPage(false);
    setActiveTab("chats");
  };

  // Search execution
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchVal.trim()) return;

    setSearchLoading(true);
    setSearchResults([]);
    try {
      const results = await searchUsers(searchVal.trim());
      setSearchResults(results);
      if (results.length === 0) {
        setInviteStatus({});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSearchLoading(false);
    }
  };

  // Dispatch friend requests inside lookup results
  const handleSendInvite = async (receiverId: string) => {
    if (!canInteractWith(receiverId)) {
      setInviteStatus(prev => ({ ...prev, [receiverId]: "failed" }));
      showToast(getBlockMessage(receiverId) || "Friend requests are disabled for this user.", "error");
      return;
    }
    setInviteStatus(prev => ({ ...prev, [receiverId]: "sending" }));
    try {
      await sendFriendRequest(receiverId);
      setInviteStatus(prev => ({ ...prev, [receiverId]: "sent" }));
      setSearchVal("");
      setSearchResults([]);
    } catch (err) {
      console.error(err);
      setInviteStatus(prev => ({ ...prev, [receiverId]: "failed" }));
    }
  };

  // Save profile updates
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    try {
      const finalAvatarUrl = customAvatarUrl || userProfile?.avatarUrl || "";

      await updateProfile({
        displayName: editDisplayName.trim(),
        avatarUrl: finalAvatarUrl,
        bio: editBio.trim() ? editBio.trim() : undefined,
        moodEmoji: editMoodEmoji.trim() ? editMoodEmoji.trim() : undefined,
        githubUrl: editGithubUrl.trim() ? editGithubUrl.trim() : undefined,
        twitterUrl: editTwitterUrl.trim() ? editTwitterUrl.trim() : undefined,
        dndMode: doNotDisturb,
      });
      setShowSettingsPage(false);
      setShowProfileModal(false);
      showToast("Profile settings saved successfully!", "success");
    } catch (err: any) {
      console.error("Save profile failed:", err);
      showToast("Failed to save changes: " + (err.message || err), "error");
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Replace the primary wallet via Privy (verifies ownership before swapping).
  const handleChangeWallet = async () => {
    if (changingWallet) return;
    setChangingWallet(true);
    try {
      const linked = await connectWallet();
      if (linked) {
        await updatePrimaryWallet(linked, privyUserId || undefined);
        showToast("Primary wallet updated successfully!", "success");
      } else {
        showToast("Wallet change cancelled — no new wallet linked.", "info");
      }
    } catch (err: any) {
      console.error("Change wallet failed:", err);
      showToast("Failed to change wallet: " + (err.message || err), "error");
    } finally {
      setChangingWallet(false);
    }
  };

  // After a successful Arc USDC transfer: insert a payment system message in
  // the chat. The authoritative payment-history record is persisted SERVER-SIDE
  // (api/wallet/send-usdc) after Circle confirms the transaction — writing it
  // here too would create a duplicate record. Best-effort — never block.
  const handleUsdcPaymentSuccess = async (receipt: ArcPaymentReceipt) => {
    if (!activeChatId || !currentUser || !userProfile) return;
    const recipientUser = activeChatFriend;
    try {
      await logPaymentMessage({
        chatId: activeChatId,
        amount: receipt.amount,
        recipientUsername: recipientUser?.username || "",
        transactionHash: receipt.transactionHash,
      });
    } catch (err) {
      console.error("Failed to persist payment message:", err);
    }
  };

  // Message sending
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgText.trim()) return;

    // Editing an existing message instead of sending a new one
    if (editingMessage) {
      const editedTextSnapshot = msgText.trim();
      const messageIdBeingEdited = editingMessage.id;
      setMsgText("");
      setEditingMessage(null);
      try {
        await editMessage(messageIdBeingEdited, editedTextSnapshot);
      } catch (err) {
        console.error("Failed to edit message:", err);
        showToast("Failed to edit message.", "error");
      }
      return;
    }

    // Refuse sending new messages to a blocked user (the composer is also
    // swapped out for a blocked banner, this is a defensive second gate).
    if (isFriendBlocked(activeChatFriend)) {
      showToast(getBlockMessage(activeChatFriend?.uid) || "Messages are disabled for this conversation.", "error");
      return;
    }

    const snapshotText = msgText.trim();
    const replyPayload = replyingToMessage ? {
      id: replyingToMessage.id,
      senderUsername: replyingToMessage.senderUsername,
      text: replyingToMessage.text
    } : undefined;

    setMsgText(""); // Optimistic input flush
    setReplyingToMessage(null); // Clear reply preview
    clearTypingStatusImmediately();
    playSendSound();

    try {
      await sendMessage(snapshotText, undefined, replyPayload);
    } catch (err) {
      console.error("Failed to deliver message:", err);
      setMsgText(snapshotText); // Re-hook
      if (replyPayload) {
        setReplyingToMessage({
          id: replyPayload.id,
          senderUsername: replyPayload.senderUsername,
          text: replyPayload.text,
          senderId: "", // placeholder
          timestamp: null // placeholder
        });
      }
    }
  };

  // Image upload handling
  const handleImageAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (isFriendBlocked(activeChatFriend)) {
      showToast(getBlockMessage(activeChatFriend?.uid) || "Media sharing is disabled for this conversation.", "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsUploadingImage(true);
    try {
      const imageUrl = await uploadImage(file);
      await sendMessage("", imageUrl);
      playSendSound();
      showToast("Image attachment delivered successfully!", "success");
    } catch (err: any) {
      console.error("Image attachment sending failed:", err);
      showToast("Image upload failed: " + err.message, "error");
    } finally {
      setIsUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Helper to resolve specific direct Chat ID
  const getChatIdForFriend = (friendId: string) => {
    return [currentUser?.uid, friendId].sort().join("_");
  };

  // Split Received vs Sent Pending requests
  const pendingReceived = friendRequests.filter(
    (r) => r.status === "pending" && r.receiverId === currentUser?.uid
  );
  const pendingSent = friendRequests.filter(
    (r) => r.status === "pending" && r.senderId === currentUser?.uid
  );

  // If the user profile is missing or hasn't completed onboarding, display the
  // onboarding setup form. The dashboard opens once the profile setup is done.
  // An external (Privy) wallet is OPTIONAL — Google-only users enter MICA with
  // their internal Circle wallet (auto-created server-side for the Firebase uid).
  if (!userProfile || userProfile.onboardingCompleted !== true) {
    const onboardPreviewUrl = onboardAvatarType === "custom" && onboardCustomAvatarUrl
      ? onboardCustomAvatarUrl
      : `https://api.dicebear.com/7.x/${onboardAvatarStyle}/svg?seed=${onboardAvatarSeed || "default"}`;

    return (
      <div className="min-h-screen w-full bg-[#080B14] text-[#F8FAFC] font-sans flex items-center justify-center relative p-4 flex-col overflow-y-auto" id="onboarding_container">
        {/* Premium dark gradient background — no images */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(88,80,220,0.08)_0%,transparent_50%)] pointer-events-none z-0" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(88,80,220,0.06)_0%,transparent_50%)] pointer-events-none z-0" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,_rgba(99,102,241,0.05)_0%,_transparent_60%)] pointer-events-none z-0" />

        {/* Soft ambient glow blobs */}
        <div className="absolute top-[8%] left-[15%] w-[300px] h-[300px] rounded-full bg-[#6366F1]/[0.06] blur-[130px] pointer-events-none z-0" />
        <div className="absolute bottom-[10%] right-[15%] w-[350px] h-[350px] rounded-full bg-[#8B5CF6]/[0.05] blur-[140px] pointer-events-none z-0" />

        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[420px] relative z-10 my-8"
        >
          {/* Glass card */}
          <div className="backdrop-blur-2xl bg-white/[0.04] border border-white/[0.08] rounded-[28px] p-7 sm:p-9 shadow-[0_8px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.06)] relative overflow-hidden">
            {/* Subtle top-edge prismatic highlight */}
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />

            {/* Header */}
            <div className="text-center mb-8">
              <h2 className="text-[22px] sm:text-2xl font-bold tracking-tight text-white mb-2">
                Initialize Your Account
              </h2>
              <p className="text-[13px] text-white/40 leading-relaxed max-w-[300px] mx-auto">
                Set up your profile to get started. You can update this anytime.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleOnboardingSubmit} className="space-y-6">
              {onboardError && (
                <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-[13px] font-medium text-center">
                  {onboardError}
                </div>
              )}

              {/* Avatar Section — large centered circular preview + upload */}
              <div className="flex flex-col items-center gap-4">
                {/* Large circular avatar preview */}
                <div className="relative group">
                  <div className="w-[100px] h-[100px] rounded-full bg-gradient-to-br from-[#6366F1]/20 to-[#8B5CF6]/20 p-[2px] shadow-[0_0_30px_rgba(99,102,241,0.12)]">
                    <img
                      src={onboardPreviewUrl}
                      alt="Profile preview"
                      className="w-full h-full rounded-full object-cover bg-[#111320]"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  {/* Upload overlay on hover */}
                  <button
                    type="button"
                    onClick={() => onboardAvatarUploadRef.current?.click()}
                    className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center cursor-pointer backdrop-blur-sm"
                  >
                    <Camera className="w-5 h-5 text-white" />
                  </button>
                </div>

                {/* Upload button */}
                <input
                  type="file"
                  accept="image/*"
                  ref={onboardAvatarUploadRef}
                  onChange={handleOnboardAvatarUpload}
                  className="hidden"
                />
                {onboardCustomAvatarUrl ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-emerald-400 font-medium flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> Photo uploaded
                    </span>
                    <button
                      type="button"
                      onClick={() => onboardAvatarUploadRef.current?.click()}
                      className="text-[12px] text-[#818CF8] hover:text-white transition-colors underline underline-offset-2"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onboardAvatarUploadRef.current?.click()}
                    disabled={onboardIsUploading}
                    className="text-[13px] text-white/40 hover:text-white/70 transition-colors font-medium flex items-center gap-1.5 cursor-pointer"
                  >
                    {onboardIsUploading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        Upload photo
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Username */}
              <div>
                <label className="block text-[12px] text-white/50 font-medium mb-2 tracking-wide">
                  Username
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25 font-mono text-[14px]">@</span>
                  <input
                    type="text"
                    required
                    value={onboardUsername}
                    onChange={(e) => setOnboardUsername(e.target.value)}
                    placeholder="choose_username"
                    className="w-full bg-white/[0.04] border border-white/[0.08] focus:border-[#6366F1]/50 focus:bg-white/[0.06] rounded-full pl-9 pr-5 py-3 text-[14px] text-white placeholder-white/20 focus:outline-none transition-all duration-300 font-mono"
                  />
                </div>
                <p className="text-[11px] text-white/25 mt-1.5 pl-4">
                  Lowercase letters, numbers, and underscores only.
                </p>
              </div>

              {/* Visual Nickname */}
              <div>
                <label className="block text-[12px] text-white/50 font-medium mb-2 tracking-wide">
                  Visual Nickname
                </label>
                <input
                  type="text"
                  required
                  value={onboardDisplayName}
                  onChange={(e) => setOnboardDisplayName(e.target.value)}
                  placeholder="e.g. Satoshi Nakamoto"
                  className="w-full bg-white/[0.04] border border-white/[0.08] focus:border-[#6366F1]/50 focus:bg-white/[0.06] rounded-full px-5 py-3 text-[14px] text-white placeholder-white/20 focus:outline-none transition-all duration-300"
                />
              </div>

              {/* Wallet (Optional — internal Circle wallet is the default) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[12px] text-white/50 font-medium tracking-wide">
                    Wallet
                  </label>
                  <span className="text-[10px] text-white/30 font-medium tracking-widest uppercase">Optional</span>
                </div>

                {privyPrimaryWallet ? (
                  <div className="w-full bg-white/[0.04] border border-emerald-400/25 rounded-2xl px-4 py-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center shrink-0">
                      <Wallet className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-white font-mono truncate">
                        {privyPrimaryWallet.address.substring(0, 6)}...{privyPrimaryWallet.address.substring(privyPrimaryWallet.address.length - 4)}
                      </p>
                      <p className="text-[11px] text-white/35 font-medium truncate">
                        {privyPrimaryWallet.provider || "External wallet"} · verified
                      </p>
                    </div>
                    <span className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                      <ShieldCheck className="w-3.5 h-3.5" /> VERIFIED
                    </span>
                  </div>
                ) : (
                  <div className="w-full bg-white/[0.04] border border-white/[0.08] rounded-2xl px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#6366F1]/10 border border-[#6366F1]/20 flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-4 h-4 text-[#818CF8]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-white font-semibold">
                          Circle Wallet (server-secured)
                        </p>
                        <p className="text-[11px] text-white/35 font-medium truncate">
                          Created automatically for your MICA account — no external wallet needed.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleConnectOnboardWallet}
                      disabled={walletConnecting}
                      className="mt-3 w-full bg-white/[0.04] border border-white/[0.08] hover:border-[#6366F1]/50 rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 text-[12px] font-semibold text-white/70 hover:text-white cursor-pointer transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {walletConnecting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-[#818CF8]" />
                          Waiting for wallet confirmation...
                        </>
                      ) : (
                        <>
                          <Wallet className="w-4 h-4 text-[#818CF8]" />
                          Link external wallet (optional)
                        </>
                      )}
                    </button>
                  </div>
                )}
                <p className="text-[11px] text-white/25 mt-1.5 pl-2">
                  Optional: linking an external wallet enables advanced features like Send USDC. Your internal Circle wallet is always available.
                </p>
              </div>

              {/* Buttons */}
              <div className="flex flex-col gap-3 pt-2">
                <button
                  type="submit"
                  disabled={onboardLoading}
                  className="w-full bg-gradient-to-r from-[#6366F1] via-[#7C3AED] to-[#8B5CF6] text-white hover:brightness-110 font-semibold py-3.5 px-6 rounded-full text-[14px] flex items-center justify-center gap-2 cursor-pointer shadow-[0_4px_20px_rgba(99,102,241,0.25)] hover:shadow-[0_4px_30px_rgba(99,102,241,0.35)] hover:scale-[1.01] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {onboardLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-white" />
                      Complete Setup & Enter Chats
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={logout}
                  className="w-auto self-center bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.15] text-white/35 hover:text-white/60 py-2 px-5 rounded-full text-[12px] font-medium cursor-pointer transition-all duration-200 flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3 h-3" />
                  Sign Out
                </button>
              </div>
            </form>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] w-full bg-[#0D111D] text-[#F8FAFC] font-sans flex relative overflow-hidden select-none animate-fadeIn" id="main_dashboard_layout">
      {/* Background Cosmic Starscape */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#161A2B]/35 via-[#0D111D] to-[#0D111D] pointer-events-none z-0" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-[#6C5CE0]/4 via-transparent to-[#6C5CE0]/4 pointer-events-none z-0" />
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-[0.04] mix-blend-screen z-0">
        <img
          src="https://res.cloudinary.com/dzwbn3pvh/image/upload/v1783072499/image_1_1_3_zd9aey.png"
          alt="Cosmic space landscape"
          className="w-full h-full object-cover select-none scale-105 filter blur-[0.5px]"
          referrerPolicy="no-referrer"
        />
      </div>

      {/* Dynamic Purple/Pink Glowing Blur Blobs */}
      <div className="absolute top-[20%] left-[30%] w-[250px] sm:w-[350px] lg:w-[500px] h-[250px] sm:h-[350px] lg:h-[500px] rounded-full bg-[#6C5CE0]/3 blur-[100px] sm:blur-[130px] lg:blur-[160px] pointer-events-none z-0" />
      <div className="absolute bottom-[20%] right-[10%] w-[220px] sm:w-[320px] lg:w-[450px] h-[220px] sm:h-[320px] lg:h-[450px] rounded-full bg-[#6C5CE0]/3 blur-[100px] sm:blur-[130px] lg:blur-[160px] pointer-events-none z-0" />

      {/* FLOATING BANNER OR TOAST CONTAINER ACCESSED THROUGH THE DOM ENGINE */}

      {/* LEFT ICON NAV RAIL (matches uploaded reference image layout) */}
      {!showSettingsPage && (
        <div
          className="hidden md:flex w-[92px] shrink-0 h-screen flex-col items-center bg-[#0D111D]/90 border-r border-white/5 backdrop-blur-xl z-20 relative py-5"
          id="left_nav_rail"
        >
          {/* Mica logo mark */}
          <div className="flex items-center gap-1 mb-8 select-none cursor-pointer" onClick={() => handleSelectTab("chats")} title="Mica AI">
            <img src={micaLogo} alt="Mica AI" className="w-9 h-9 rounded-xl object-cover" />
          </div>

          <div className="flex flex-col items-center gap-2 w-full px-2">
            {([
              { key: "chats", label: "Inbox", icon: MessageSquare },
              { key: "calls", label: "Calls", icon: Phone },
              { key: "friends", label: "Add Friend", icon: UsersRound },
              { key: "notifications", label: "NOTIFICATION", icon: Bell },
              { key: "dealroom", label: "Deal Room", icon: Handshake },
              { key: "wallet", label: "Wallet", icon: Wallet },
              { key: "settings", label: "Settings", icon: Settings },
            ] as { key: "chats" | "calls" | "friends" | "notifications" | "dealroom" | "wallet" | "settings"; label: string; icon: any }[]).map(
              (item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.key;
                const showBadge =
                  (item.key === "friends" && pendingReceived.length > 0) ||
                  (item.key === "notifications" && appNotifications.length > 0);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleSelectTab(item.key)}
                    title={item.label}
                    className={`w-full flex flex-col items-center gap-1.5 py-2.5 rounded-xl transition-all cursor-pointer relative group ${
                      isActive ? "bg-[#6C5CE0]/12 text-white" : "text-[#64748B] hover:text-[#F8FAFC] hover:bg-white/5"
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-[#6C5CE0] rounded-full shadow-[0_0_8px_rgba(108, 92, 224,0.12)]" />
                    )}
                    <span className="relative">
                      <Icon className={`w-5 h-5 ${isActive ? "text-[#6C5CE0]" : ""}`} />
                      {showBadge && (
                        <span className="absolute -top-1 -right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white/[0.06] animate-pulse" />
                      )}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-wide leading-none">
                      {item.label}
                    </span>
                  </button>
                );
              }
            )}
          </div>

          <div className="flex-1" />

          <button
            type="button"
            onClick={logout}
            title="Log out"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-[#6C5CE0] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* SIDEBAR WRAPPER: Responsive view management on mobile */}
      <div
        className={`bg-[#0D111D]/75 border-r border-white/5 flex flex-col h-screen shrink-0 relative backdrop-blur-xl z-10 transition-[width,opacity,margin] duration-300 ease-in-out overflow-hidden ${
          showSettingsPage || activeTab === "dealroom" || activeTab === "wallet"
            ? "w-0 opacity-0 -ml-2 pointer-events-none"
            : `w-full md:w-96 opacity-100 ml-0 ${viewChatOnMobile ? "hidden md:flex" : "flex"}`
        }`}
        id="sidebar_pane"
      >

        {/* CURRENT USER PROFILE CARD */}
        {userProfile && (
          <div className="px-5 py-4 bg-[#161A2B]/55 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div className="relative">
                <img
                  src={userProfile.avatarUrl}
                  alt={userProfile.displayName}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-full bg-[#161A2B] border border-[#6C5CE0]/30 object-cover"
                />
                <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border border-white/[0.06] ${
                  userProfile.status === "online" ? "bg-emerald-500 animate-pulse" : "bg-gray-500"
                }`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-sky-100 truncate leading-snug">
                  {userProfile.displayName}
                </p>
                <p 
                  onClick={() => {
                    navigator.clipboard.writeText(`@${userProfile.username}`);
                    showToast(`Copied username @${userProfile.username}`, "success");
                  }}
                  className="text-[11px] text-sky-300/60 hover:text-sky-100 hover:underline mt-1 truncate font-mono cursor-pointer transition-all"
                  title="Click to copy username"
                >
                  @{userProfile.username}
                </p>
              </div>
            </div>

            {userProfile.walletAddress ? (
              <span 
                onClick={() => {
                  navigator.clipboard.writeText(userProfile.walletAddress);
                  showToast("Copied wallet address to clipboard!", "success");
                }}
                className="text-[10px] font-mono select-all bg-[#6C5CE0]/10 hover:bg-[#6C5CE0]/20 border border-[#6C5CE0]/20 text-sky-300 px-2.5 py-1 rounded-md flex items-center gap-1 cursor-pointer transition-all"
                title="Click to copy full wallet address"
              >
                <Wallet className="w-3 h-3 text-[#6C5CE0]" />
                {`${userProfile.walletAddress.substring(0, 5)}...${userProfile.walletAddress.substring(
                  userProfile.walletAddress.length - 3
                )}`}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-sky-300/40 bg-[#6C5CE0]/5 px-2.5 py-1 rounded border border-white/5">
                No Wallet Linked
              </span>
            )}
          </div>
        )}

        {/* INBOX HEADER (matches reference image title + search + compose) */}
        {activeTab === "chats" && (
          <div className="px-4 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-black tracking-widest text-[#F8FAFC] uppercase">Inbox</h2>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSelectTab("analytics")}
                  title="View inbox analytics"
                  className="p-1.5 rounded-lg text-[#6C5CE0] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                >
                  <Activity className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectTab("friends")}
                  title="Start a new conversation"
                  className="p-1.5 rounded-lg text-[#6C5CE0] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="relative mb-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6C5CE0]" />
              <input
                type="text"
                value={inboxSearchQuery}
                onChange={(e) => setInboxSearchQuery(e.target.value)}
                placeholder="Search contacts"
                className="w-full bg-[#0D111D]/80 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-xs text-[#F8FAFC] placeholder-[#6C5CE0] focus:outline-none focus:border-[#6C5CE0]/50 focus:ring-1 focus:ring-[#6C5CE0]/30 transition-all font-sans"
              />
            </div>
          </div>
        )}

        {/* CALLS HEADER (Messenger/WhatsApp-style call log title) */}
        {activeTab === "calls" && (
          <div className="px-4 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-black tracking-widest text-[#F8FAFC] uppercase">Calls</h2>
              <button
                type="button"
                onClick={() => handleSelectTab("friends")}
                title="Start a new call"
                className="p-1.5 rounded-lg text-[#6C5CE0] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
              >
                <Phone className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* SIDEBAR SCROLL CONTENT */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          <AnimatePresence mode="wait">
          {/* CASE 1: Chats Tab (View Conversation List) */}
          {activeTab === "chats" && (
            <motion.div
              key="sidebar_chats_pane"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-[10px] text-[#6C5CE0] font-extrabold uppercase tracking-wider">
                    Conversations list ({friends.length})
                  </h4>
                </div>

                {friends.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-white/[0.06] rounded-2xl bg-[#0D111D]/10">
                    <MessageSquare className="w-6 h-6 text-[#6C5CE0] mx-auto mb-2" />
                    <p className="text-xs text-[#6C5CE0] font-medium">
                      No conversations active
                    </p>
                    <p className="text-[10px] text-[#6C5CE0] mt-1 leading-normal">
                      Tap the Friends search tab below to meet other users or exact matches.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {[...friends]
                      .filter((f) => !blockedUids.includes(f.uid) && !blockedByUids.includes(f.uid))
                      .filter((f) =>
                        inboxSearchQuery.trim()
                          ? f.displayName.toLowerCase().includes(inboxSearchQuery.trim().toLowerCase()) ||
                            f.username.toLowerCase().includes(inboxSearchQuery.trim().toLowerCase())
                          : true
                      )
                      .sort((a, b) => {
                        const aTime = new Date(
                          chatSessions[getChatIdForFriend(a.uid)]?.lastMessageAt || 0
                        ).getTime();
                        const bTime = new Date(
                          chatSessions[getChatIdForFriend(b.uid)]?.lastMessageAt || 0
                        ).getTime();
                        return bTime - aTime;
                      })
                      .map((friend) => {
                      const chatId = getChatIdForFriend(friend.uid);
                      const isActive = activeChatId === chatId;
                      
                      return (
                        <button
                          key={friend.uid}
                          onClick={() => handleSelectFriendChat(chatId)}
                          id={`chat_friend_${friend.uid}`}
                          className={`w-full p-2.5 rounded-xl flex items-center justify-between hover:bg-[#6C5CE0]/10 transition-all text-left duration-200 cursor-pointer border ${
                            isActive
                              ? "bg-[#6C5CE0]/12 border-white/10 text-white shadow-sm border-l-4 border-l-[#6C5CE0] pl-2"
                              : "bg-[#12172A]/40 border-transparent text-[#94A3B8] hover:text-white"
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {/* Avatar & status layout */}
                            <div className="relative shrink-0">
                              <img
                                src={friend.avatarUrl}
                                alt={friend.displayName}
                                referrerPolicy="no-referrer"
                                className={`w-9.5 h-9.5 rounded-full bg-[#161A2B] border object-cover transition-all duration-300 ${
                                  isActive ? "border-[#6C5CE0]" : "border-white/10"
                                }`}
                              />
                              <span
                                className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-white/[0.06] ${
                                  friend.status === "online"
                                    ? "bg-emerald-500 animate-pulse shadow-[0_0_4px_rgba(34, 197, 94,0.5)]"
                                    : "bg-gray-500"
                                }`}
                              />
                            </div>

                            <div className="min-w-0 pr-1">
                              <p className="text-xs font-bold text-[#F8FAFC] truncate leading-none group-hover:text-white">
                                {friend.displayName}
                              </p>
                              <p className="text-[9px] font-mono mt-1 uppercase tracking-wider leading-relaxed flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${friend.status === "online" ? "bg-emerald-500" : "bg-gray-500"}`} />
                                <span className={friend.status === "online" ? "text-emerald-500/80 font-medium" : "text-gray-400"}>
                                  {friend.status === "online" ? "Online" : "Offline"}
                                </span>
                              </p>
                            </div>
                          </div>

                          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-[#6C5CE0] to-[#6C5CE0] flex items-center justify-center shrink-0 shadow-[0_0_8px_rgba(108, 92, 224,0.12)]">
                            <ChevronRight className="w-3.5 h-3.5 text-white" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* CASE 1B: Calls Tab (Call history, like Messenger/WhatsApp) */}
          {activeTab === "calls" && (
            <motion.div
              key="sidebar_calls_pane"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-[10px] text-[#6C5CE0] font-extrabold uppercase tracking-wider">
                    Recent calls
                  </h4>
                </div>
                <CallHistory friends={friends} />
              </div>
            </motion.div>
          )}

          {/* CASE 2: Friends Tab (Users search & pending Requests) */}
          {activeTab === "friends" && (
            <motion.div
              key="sidebar_friends_pane"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="space-y-4"
            >
              {/* Search Bar */}
              <div className="space-y-2">
                <form onSubmit={handleSearch} className="relative">
                  <input
                    type="text"
                    value={searchVal}
                    onChange={(e) => setSearchVal(e.target.value)}
                    placeholder="Search by username or wallet address..."
                    className="w-full bg-[#0D111D]/80 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-xs text-[#F8FAFC] placeholder-sky-300/20 focus:outline-none focus:border-[#6C5CE0]/50 focus:ring-1 focus:ring-[#6C5CE0]/30 transition-all font-sans"
                  />
                  <Search className="absolute left-3.5 top-3 w-4 h-4 text-sky-300/50" />
                  {searchVal && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchVal("");
                        setSearchResults([]);
                      }}
                      className="absolute right-3 top-2.5 text-[#6C5CE0] hover:text-white p-0.5 rounded"
                    >
                      <X className="w-3.5 h-3.5 font-bold" />
                    </button>
                  )}
                </form>

                {/* SEARCH RESULTS FEED */}
                <AnimatePresence>
                  {searchResults.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="bg-[#12172A]/90 border border-white/5 rounded-xl p-3 divide-y divide-white/5 space-y-2 shadow-[0_0_20px_rgba(108, 92, 224,0.05)]"
                    >
                      <p className="text-[10px] text-[#6C5CE0] uppercase tracking-wider font-bold mb-1">
                        Users Found
                      </p>
                      {searchResults.map((user) => {
                        const isFriend = friends.some((f) => f.uid === user.uid);
                        const isSentPending = pendingSent.some((r) => r.receiverId === user.uid);
                        const isReceivedPending = pendingReceived.some((r) => r.senderId === user.uid);
                        const statusOfInvite = inviteStatus[user.uid];

                        return (
                          <div key={user.uid} className="pt-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <img
                                src={user.avatarUrl}
                                alt={user.displayName}
                                referrerPolicy="no-referrer"
                                className="w-7.5 h-7.5 rounded-full bg-[#0D111D] border border-white/[0.06]"
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-[#F8FAFC] truncate pr-2">
                                  {user.displayName}
                                </p>
                                <p className="text-[9px] text-[#6C5CE0] truncate font-mono">
                                  @{user.username}
                                </p>
                              </div>
                            </div>

                            {isFriend ? (
                              <button
                                onClick={() => handleSelectFriendChat(getChatIdForFriend(user.uid))}
                                className="bg-[#0D111D] border border-white/[0.06] hover:border-neutral-500 text-[#94A3B8] font-bold px-2 py-1 rounded-lg text-[10px]"
                              >
                                Chat
                              </button>
                            ) : isSentPending ? (
                              <span className="text-[9px] text-[#6C5CE0] font-semibold bg-[#0D111D] border border-white/[0.06] px-2 py-1 rounded">
                                Sent
                              </span>
                            ) : isReceivedPending ? (
                              <button
                                onClick={async () => {
                                  if (!canInteractWith(user.uid)) {
                                    showToast(getBlockMessage(user.uid) || "You cannot accept a friend request from this user.", "error");
                                    return;
                                  }
                                  const req = pendingReceived.find(r => r.senderId === user.uid);
                                  if (req) await acceptFriendRequest(req.id);
                                }}
                                className="bg-neutral-200 hover:opacity-90 text-neutral-950 font-bold px-2.5 py-1 rounded-lg text-[10px]"
                              >
                                Accept
                              </button>
                            ) : (
                              <button
                                onClick={() => handleSendInvite(user.uid)}
                                disabled={statusOfInvite === "sending" || !canInteractWith(user.uid)}
                                className={`px-2 py-1.5 rounded-lg text-[10px] flex items-center gap-1 ${
                                  canInteractWith(user.uid)
                                    ? "bg-[#0D111D] border border-white/[0.06] hover:border-neutral-400 text-[#94A3B8] hover:text-white font-semibold cursor-pointer"
                                    : "bg-[#0B0F17]/50 border border-white/[0.04] text-[#334155] opacity-50 pointer-events-none"
                                }`}
                              >
                                {statusOfInvite === "sending" ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : statusOfInvite === "sent" ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <>
                                    <UserPlus className="w-3 h-3" />
                                    Add
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </motion.div>
                  )}

                  {searchVal.trim() && searchResults.length === 0 && !searchLoading && (
                    <div className="p-3 text-center bg-[#0B0F17]/20 border border-white/[0.06] rounded-xl">
                      <p className="text-[10px] text-[#6C5CE0] italic">No user exact matches found</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* Received Friends Requests */}
              {pendingReceived.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-[10px] text-[#6C5CE0] font-bold uppercase tracking-wider pl-1 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-[#94A3B8]" />
                    Incoming Invites ({pendingReceived.length})
                  </h4>

                  <div className="space-y-1.5">
                    {pendingReceived.map((req) => (
                      <motion.div
                        key={req.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="p-2.5 bg-[#0B0F17] border border-white/[0.06] rounded-xl flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <img
                            src={`https://api.dicebear.com/7.x/bottts/svg?seed=${req.senderId}`}
                            alt={req.senderUsername}
                            className="w-7.5 h-7.5 rounded-full bg-[#0D111D]"
                            referrerPolicy="no-referrer"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[#F8FAFC] truncate">
                              @{req.senderUsername}
                            </p>
                            <p className="text-[9px] text-[#6C5CE0] font-medium">Inviting you</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => acceptFriendRequest(req.id)}
                            className="p-1 rounded bg-[#0D111D] border border-white/[0.06] hover:border-neutral-500 text-emerald-400 cursor-pointer"
                            title="Accept Request"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => declineFriendRequest(req.id)}
                            className="p-1 rounded bg-[#0D111D] border border-white/[0.06] hover:border-red-900 text-red-400 cursor-pointer"
                            title="Decline Request"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Complete Active Friend Connections list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-[10px] text-[#6C5CE0] font-bold uppercase tracking-wider">
                    My Contacts ({friends.length})
                  </h4>
                </div>

                {friends.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-white/[0.06] rounded-2xl">
                    <UserPlus className="w-6 h-6 text-[#6C5CE0] mx-auto mb-2" />
                    <p className="text-xs text-[#6C5CE0] font-medium leading-normal">
                      No contacts found
                    </p>
                    <p className="text-[9px] text-[#6C5CE0] mt-1 max-w-[200px] mx-auto leading-normal">
                      Start looking up valid peer usernames above to initiate secure transactions.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {[...friends]
                      .sort((a, b) => {
                        const aOnline = a.status === "online" ? 1 : 0;
                        const bOnline = b.status === "online" ? 1 : 0;
                        return bOnline - aOnline;
                      })
                      .map((friend) => (
                      <div
                        key={friend.uid}
                        className="p-2 bg-[#0B0F17]/40 border border-white/[0.06] rounded-xl flex items-center justify-between hover:bg-[#0D111D]/40 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="relative">
                            <img
                              src={friend.avatarUrl}
                              alt={friend.displayName}
                              referrerPolicy="no-referrer"
                              className="w-8 h-8 rounded-full bg-[#0B0F17] border border-white/[0.06] object-cover"
                            />
                            <span
                              className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border border-white/[0.06] ${
                                friend.status === "online" ? "bg-emerald-500" : "bg-gray-500"
                              }`}
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[#F8FAFC] truncate">
                              {friend.displayName}
                            </p>
                            <p className="text-[9px] text-[#6C5CE0] font-mono">
                              @{friend.username}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => handleSelectFriendChat(getChatIdForFriend(friend.uid))}
                          className="bg-[#0D111D] hover:bg-[#161A2B] text-[#94A3B8] hover:text-white font-bold text-[10px] px-3 py-1.5 rounded-lg border border-white/[0.06] cursor-pointer"
                        >
                          Chat
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* CASE 3: Notifications Tab (Inbox / Log History) */}
          {activeTab === "notifications" && (
            <motion.div
              key="sidebar_notifications_pane"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between px-1">
                <h4 className="text-[10px] text-[#6C5CE0] font-bold uppercase tracking-wider">
                  Notification Feed ({appNotifications.length})
                </h4>
                {appNotifications.length > 0 && (
                  <button
                    onClick={() => {
                      appNotifications.forEach((n) => dismissNotification(n.id));
                      showToast("Notification inbox cleared!", "info");
                    }}
                    className="text-[9px] font-bold text-[#94A3B8] hover:text-white uppercase tracking-wider cursor-pointer bg-[#0B0F17] hover:bg-[#0D111D] px-2 py-1 rounded border border-white/[0.06] transition"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {appNotifications.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-white/[0.06] rounded-2xl bg-[#0B0F17]/10">
                  <div className="w-10 h-10 rounded-full bg-[#0B0F17] border border-white/[0.06] flex items-center justify-center mx-auto mb-3">
                    <Bell className="w-4 h-4 text-[#6C5CE0]" />
                  </div>
                  <p className="text-xs text-[#94A3B8] font-extrabold flex items-center justify-center gap-1">All caught up!</p>
                  <p className="text-[10px] text-[#6C5CE0] mt-1 leading-normal max-w-[200px] mx-auto">
                    No new activities, chat requests, or wallet verifications at this moment.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {appNotifications.map((noti) => (
                    <div
                      key={noti.id}
                      onClick={() => {
                        if (noti.type === "message" && noti.chatId) {
                          handleSelectFriendChat(noti.chatId);
                        } else if (noti.type === "deal_room_invite") {
                          handleSelectTab("dealroom");
                        } else {
                          setActiveTab("friends");
                        }
                        dismissNotification(noti.id);
                      }}
                      className="p-3 bg-[#0B0F17] hover:bg-[#0D111D] border border-white/[0.06] hover:border-white/[0.06] rounded-xl cursor-pointer transition text-left relative overflow-hidden"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="shrink-0 mt-0.5">
                          {noti.senderAvatar ? (
                            <img
                              src={noti.senderAvatar}
                              alt="Avatar"
                              referrerPolicy="no-referrer"
                              className="w-7 h-7 rounded-full object-cover border border-white/[0.06]"
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-[#0D111D] border border-white/[0.06] flex items-center justify-center">
                              <Bell className="w-3.5 h-3.5 text-[#94A3B8]" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-[#F8FAFC] truncate">
                            {noti.title}
                          </p>
                          <p className="text-[10px] text-[#94A3B8] mt-0.5 leading-normal">
                            {noti.body}
                          </p>
                          <span className="text-[8px] text-[#6C5CE0] font-mono block mt-1 uppercase tracking-wider">
                            {noti.type === "message" ? "Direct Message" : noti.type === "deal_room_invite" ? "Deal Room Invitation" : "Peer Request"} • Tap to View
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            dismissNotification(noti.id);
                          }}
                          className="text-[#6C5CE0] hover:text-[#94A3B8] p-0.5 rounded cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* CASE: Analytics Tab (simple live stats derived from real chat/friend data) */}
          {activeTab === "analytics" && (
            <motion.div
              key="sidebar_analytics_pane"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="space-y-4"
            >
              <h4 className="text-[10px] text-[#6C5CE0] font-extrabold uppercase tracking-wider px-1">
                Inbox Analytics
              </h4>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3.5 bg-[#12172A]/60 border border-white/5 rounded-2xl">
                  <span className="text-[8px] uppercase font-mono tracking-widest text-sky-300/50 font-bold block">
                    Total Contacts
                  </span>
                  <span className="text-xl font-black text-[#6C5CE0] font-mono mt-1 block">
                    {friends.length}
                  </span>
                </div>
                <div className="p-3.5 bg-[#12172A]/60 border border-white/5 rounded-2xl">
                  <span className="text-[8px] uppercase font-mono tracking-widest text-sky-300/50 font-bold block">
                    Online Now
                  </span>
                  <span className="text-xl font-black text-emerald-400 font-mono mt-1 block">
                    {friends.filter((f) => f.status === "online").length}
                  </span>
                </div>
                <div className="p-3.5 bg-[#12172A]/60 border border-white/5 rounded-2xl">
                  <span className="text-[8px] uppercase font-mono tracking-widest text-sky-300/50 font-bold block">
                    Pending Requests
                  </span>
                  <span className="text-xl font-black text-sky-200 font-mono mt-1 block">
                    {pendingReceived.length}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-[10px] text-[#6C5CE0] font-extrabold uppercase tracking-wider px-1">
                  Active Conversations
                </h4>
                {[...friends]
                  .sort((a, b) => {
                    const aTime = new Date(chatSessions[getChatIdForFriend(a.uid)]?.lastMessageAt || 0).getTime();
                    const bTime = new Date(chatSessions[getChatIdForFriend(b.uid)]?.lastMessageAt || 0).getTime();
                    return bTime - aTime;
                  })
                  .slice(0, 5)
                  .map((f) => (
                    <button
                      key={f.uid}
                      onClick={() => handleSelectFriendChat(getChatIdForFriend(f.uid))}
                      className="w-full flex items-center justify-between p-2.5 bg-[#12172A]/40 hover:bg-[#6C5CE0]/10 border border-white/5 rounded-xl transition-all cursor-pointer text-left"
                    >
                      <span className="text-xs text-[#94A3B8] truncate">{f.displayName}</span>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${f.status === "online" ? "bg-emerald-500" : "bg-gray-500"}`} />
                    </button>
                  ))}
                {friends.length === 0 && (
                  <p className="text-[10px] text-[#6C5CE0] px-1">No conversations to analyze yet.</p>
                )}
              </div>
            </motion.div>
          )}
          </AnimatePresence>

        </div>

        {/* Persistent High-Fidelity Bottom Navigation Bar (matches uploaded image layout) */}
        <div className="md:hidden bg-[#0D111D] border-t border-white/5 px-4 sm:px-6 py-2 flex items-center justify-between shrink-0 h-16 shadow-[0_-8px_35px_rgba(0,0,0,0.6)] z-10 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]" id="bottom_navbar_tabs">
          <div className="grid grid-cols-7 w-full h-full my-auto items-center">
            {/* Chats Tab Button */}
            <button
              onClick={() => handleSelectTab("chats")}
              className="flex flex-col items-center justify-center relative justify-self-center cursor-pointer group h-full w-11 min-w-[44px]"
              title="Inbox Conversations"
            >
              <div className="relative p-1.5 rounded-xl transition-all duration-200">
                <MessageCircle
                  className={`w-6 h-6 transition-all duration-200 group-hover:scale-110 ${
                    activeTab === "chats"
                      ? "text-[#6C5CE0] fill-[#6C5CE0]/10 drop-shadow-[0_0_12px_rgba(108, 92, 224,0.12)] scale-110"
                      : "text-[#6C5CE0] hover:text-[#94A3B8]"
                  }`}
                />
                {activeTab === "chats" && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-[3px] bg-[#6C5CE0] rounded-full shadow-[0_0_8px_rgba(108, 92, 224,0.12)] animate-pulse" />
                )}
              </div>
            </button>

            {/* Calls Tab Button */}
            <button
              onClick={() => handleSelectTab("calls")}
              className="flex flex-col items-center justify-center relative justify-self-center cursor-pointer group h-full w-11 min-w-[44px]"
              title="Call History"
            >
              <div className="relative p-1.5 rounded-xl transition-all duration-200">
                <Phone
                  className={`w-6 h-6 transition-all duration-200 group-hover:scale-110 ${
                    activeTab === "calls"
                      ? "text-[#6C5CE0] fill-[#6C5CE0]/10 drop-shadow-[0_0_12px_rgba(108, 92, 224,0.12)] scale-110"
                      : "text-[#6C5CE0] hover:text-[#94A3B8]"
                  }`}
                />
                {activeTab === "calls" && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-[3px] bg-[#6C5CE0] rounded-full shadow-[0_0_8px_rgba(108, 92, 224,0.12)] animate-pulse" />
                )}
              </div>
            </button>

            {/* Friends Tab Button - distinctive chip style with red badge alert */}
            <button
              onClick={() => handleSelectTab("friends")}
              className="flex flex-col items-center justify-center relative justify-self-center cursor-pointer group h-full w-11 min-w-[44px]"
              title="Invite Friends"
            >
              <div
                className={`relative p-1.5 rounded-full transition-all duration-200 border ${
                  activeTab === "friends"
                    ? "bg-gradient-to-tr from-[#6C5CE0]/25 to-[#6C5CE0]/25 border-[#6C5CE0]/50 shadow-[0_0_14px_rgba(108, 92, 224,0.12)]"
                    : "bg-white/[0.03] border-white/10 group-hover:border-white/20 group-hover:bg-white/[0.06]"
                }`}
              >
                <UserPlus
                  className={`w-5 h-5 transition-all duration-200 group-hover:scale-110 ${
                    activeTab === "friends"
                      ? "text-[#6C5CE0] drop-shadow-[0_0_10px_rgba(108, 92, 224,0.12)] scale-110"
                      : "text-[#6C5CE0] group-hover:text-[#94A3B8]"
                  }`}
                />
                {pendingReceived.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 border border-white/[0.06] rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                )}
              </div>
              {activeTab === "friends" && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-[3px] bg-[#6C5CE0] rounded-full shadow-[0_0_8px_rgba(108, 92, 224,0.12)] animate-pulse" />
              )}
            </button>

            {/* Notifications Tab Button with red alert indicator */}
            <button
              onClick={() => handleSelectTab("notifications")}
              className="flex flex-col items-center justify-center relative justify-self-center cursor-pointer group h-full w-11 min-w-[44px]"
              title="System Notifications"
            >
              <div className="relative p-1.5 rounded-xl transition-all duration-200">
                <Bell
                  className={`w-6 h-6 transition-all duration-200 group-hover:scale-110 ${
                    activeTab === "notifications"
                      ? "text-[#6C5CE0] fill-[#6C5CE0]/10 drop-shadow-[0_0_12px_rgba(108, 92, 224,0.12)] scale-110"
                      : "text-[#6C5CE0] hover:text-[#94A3B8]"
                  }`}
                />
                {appNotifications.length > 0 && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 border border-white/[0.06] rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                )}
                {activeTab === "notifications" && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-[3px] bg-[#6C5CE0] rounded-full shadow-[0_0_8px_rgba(108, 92, 224,0.12)] animate-pulse" />
                )}
              </div>
            </button>

            {/* Wallet Tab Button */}
            <button
              onClick={() => handleSelectTab("wallet")}
              className="flex flex-col items-center justify-center relative justify-self-center cursor-pointer group h-full w-11 min-w-[44px]"
              title="Circle Wallet"
            >
              <div className="relative p-1.5 rounded-xl transition-all duration-200">
                <Wallet
                  className={`w-6 h-6 transition-all duration-200 group-hover:scale-110 ${
                    activeTab === "wallet"
                      ? "text-[#6C5CE0] fill-[#6C5CE0]/10 drop-shadow-[0_0_12px_rgba(108, 92, 224,0.12)] scale-110"
                      : "text-[#6C5CE0] hover:text-[#94A3B8]"
                  }`}
                />
                {activeTab === "wallet" && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-[3px] bg-[#6C5CE0] rounded-full shadow-[0_0_8px_rgba(108, 92, 224,0.12)] animate-pulse" />
                )}
              </div>
            </button>

            {/* Settings/Menu Tab Button */}
            <button
              onClick={() => handleSelectTab("dealroom")}
              className="flex flex-col items-center justify-center relative justify-self-center cursor-pointer group h-full w-11 min-w-[44px]"
              title="Deal Room"
            >
              <div className="relative p-1.5 rounded-xl transition-all duration-200">
                <Handshake
                  className={`w-6 h-6 transition-all duration-200 group-hover:scale-110 ${
                    activeTab === "dealroom"
                      ? "text-[#6C5CE0] drop-shadow-[0_0_12px_rgba(108, 92, 224,0.12)] scale-110"
                      : "text-[#6C5CE0] hover:text-[#94A3B8]"
                  }`}
                />
                {activeTab === "dealroom" && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-[3px] bg-[#6C5CE0] rounded-full shadow-[0_0_8px_rgba(108, 92, 224,0.12)] animate-pulse" />
                )}
              </div>
            </button>

            {/* Settings/Menu Tab Button */}
            <button
              onClick={() => handleSelectTab("settings")}
              className="flex flex-col items-center justify-center relative justify-self-center cursor-pointer group h-full w-11 min-w-[44px]"
              title="Profile Setup"
            >
              <div className="relative p-1.5 rounded-xl transition-all duration-200">
                <Settings
                  className={`w-6 h-6 transition-all duration-200 group-hover:scale-110 ${
                    activeTab === "settings"
                      ? "text-[#6C5CE0] drop-shadow-[0_0_12px_rgba(108, 92, 224,0.12)] scale-110"
                      : "text-[#6C5CE0] hover:text-[#94A3B8]"
                  }`}
                />
                {(!userProfile?.walletAddress || !userProfile?.bio) && (
                  <span className="absolute top-1 right-1.5 w-2.5 h-2.5 bg-red-500 border border-white/[0.06] rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse" />
                )}
                {activeTab === "settings" && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-[3px] bg-[#6C5CE0] rounded-full shadow-[0_0_8px_rgba(108, 92, 224,0.12)] animate-pulse" />
                )}
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* DETAILED ACTIVE CHAT PANEL (Right portion) */}
      <div
        className={`flex-1 flex flex-col h-screen overflow-hidden bg-[#0D111D]/90 backdrop-blur-md relative ${
          !viewChatOnMobile ? "hidden md:flex" : "flex"
        }`}
        id="active_chat_viewport"
      >
        <AnimatePresence mode="wait">
          {showSettingsPage ? (
            <motion.div
              key="settings_viewport_pane"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="flex-1 flex flex-col h-full bg-[#0D111D]/70 overflow-hidden"
            >
              {/* Settings Page Header */}
              <div className="p-4 sm:px-6 bg-[#12172A]/95 backdrop-blur-md border-b border-white/5 flex items-center justify-between z-10 shrink-0 select-none">
                <div className="flex items-center gap-3 w-full">
                  {/* Back button */}
                  <button
                    onClick={handleBackToChats}
                    className="p-2 rounded-xl bg-[#12172A] border border-white/10 text-sky-200 hover:text-white transition-all hover:border-[#6C5CE0]/50 hover:bg-[#161A2B] cursor-pointer flex items-center justify-center mr-1"
                    title="Back to Conversations"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-black text-white uppercase tracking-widest font-mono flex items-center gap-2">
                      <Settings className="w-4 h-4 text-[#6C5CE0] drop-shadow-[0_0_8px_rgba(108, 92, 224,0.12)]" />
                      Settings
                    </h2>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-[#6C5CE0] font-mono truncate">
                        @{userProfile?.username || "user"}
                      </span>
                      <span className="text-[10px] text-[#6C5CE0]">•</span>
                      <span className="text-[10px] text-[#94A3B8] font-sans font-medium">
                        Node Identity Configuration
                      </span>
                    </div>
                  </div>
                </div>

                <div className="hidden sm:flex items-center gap-2 font-mono text-[9px] bg-[#161A2B] border border-[#6C5CE0]/20 px-3 py-1.5 rounded-xl text-sky-300 shadow-inner">
                  <Shield className="w-3.5 h-3.5 text-sky-400" />
                  EC-384 ENCRYPTION
                </div>
              </div>

              {/* Settings Page Body Form in 3-pane compact grid */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar pb-24 sm:pb-16">
                <div className="max-w-7xl mx-auto">
                  <form onSubmit={handleSaveProfile} className="space-y-5">
                    
                    {/* Bento Layout Grid: 3-columns for no scrolling on desktop */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
                      
                      {/* Column 1: Passport Preview & Security Compliance Info */}
                      <div className="space-y-5">
                        {/* 1. Futuristic Peer Passport Preview */}
                        <div className="bg-gradient-to-b from-[#161A2B] via-[#0D111D] to-[#161A2B] border border-white/10 rounded-[2rem] p-5 shadow-2xl relative overflow-hidden group select-none">
                          {/* Geometric glowing accents */}
                          <div className="absolute top-0 right-0 w-32 h-32 bg-[#6C5CE0]/5 rounded-full blur-3xl pointer-events-none group-hover:bg-[#6C5CE0]/10 transition-colors duration-500" />
                          <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-[#6C5CE0]/5 rounded-full blur-2xl pointer-events-none" />
                          
                          <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
                            <span className="text-[9px] font-mono tracking-widest text-sky-300 uppercase font-black">
                              SENDXXX Passport Preview
                            </span>
                            <span className="text-[8px] font-mono text-emerald-400 uppercase bg-emerald-950/30 border border-emerald-900/35 px-2 py-0.5 rounded-md flex items-center gap-1">
                              <span className="inline-block w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                              Synced
                            </span>
                          </div>

                          {/* Dynamic Passport Card Contents */}
                          <div className="space-y-4">
                            <div className="flex items-start gap-4">
                              <div className="relative shrink-0">
                                <img
                                  src={customAvatarUrl || userProfile?.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser?.uid}`}
                                  alt="Identity Avatar"
                                  referrerPolicy="no-referrer"
                                  className="w-14 h-14 rounded-full bg-[#0B0F17] border-2 border-white/[0.06] p-0.5 object-cover shadow-2xl group-hover:scale-[1.03] transition duration-300"
                                />
                                <div className="absolute -bottom-1 -right-1 bg-[#0B0F17] border border-white/[0.06] w-5 h-5 flex items-center justify-center rounded-full text-emerald-400 text-[10px] shadow" title="Verified Node">
                                  ✓
                                </div>
                              </div>
                              <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-black text-[#F8FAFC] truncate flex items-center gap-1.5">
                                  {editDisplayName || userProfile?.displayName || "Anonymous Peer"}
                                </h3>
                                <p className="text-[10px] text-[#94A3B8] font-mono mt-0.5">
                                  @{userProfile?.username || "unknown_node"}
                                </p>
                                <p className="text-[9px] text-[#6C5CE0] mt-1.5 truncate bg-[#0B0F17] py-1 px-2 rounded-lg border border-white/[0.06] font-mono">
                                  ID: {currentUser?.uid?.substring(0, 14) || "none"}...
                                </p>
                              </div>
                            </div>

                            <div className="pt-1">
                              <span className="text-[8px] uppercase font-mono tracking-wider text-[#6C5CE0] font-bold block mb-1">
                                Node Status Quote:
                              </span>
                              <div className="bg-[#0B0F17]/80 border border-white/[0.06] rounded-xl p-2.5 text-[11px] text-[#94A3B8] italic min-h-[44px] flex items-center leading-relaxed">
                                {editBio ? `"${editBio}"` : '"No verification quote configured."'}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[9px] text-[#94A3B8]">
                              <div className="p-2 bg-[#0B0F17] rounded-lg border border-white/[0.06]">
                                <span className="text-[7px] uppercase tracking-wider text-[#6C5CE0] font-bold block">
                                  Primary Wallet
                                </span>
                                <span className="truncate block mt-0.5 text-[#94A3B8] font-mono text-[8px]">
                                  {userProfile?.walletAddress ? `${userProfile.walletAddress.substring(0, 6)}...${userProfile.walletAddress.substring(userProfile.walletAddress.length - 4)}` : "None configured"}
                                </span>
                              </div>
                              <div className="p-2 bg-[#0B0F17] rounded-lg border border-white/[0.06]">
                                <span className="text-[7px] uppercase tracking-wider text-[#6C5CE0] font-bold block">
                                  Cyber Nodes
                                </span>
                                <span className="truncate block mt-0.5 text-[#94A3B8] font-mono text-[8px]">
                                  {editGithubUrl ? `Github & X` : "None linked"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 2. Security Compliance Note */}
                        <div className="bg-[#0B0F17]/70 border border-white/[0.06] p-4 rounded-xl text-[10px] text-[#6C5CE0] leading-relaxed font-sans space-y-2">
                          <p className="font-bold text-[#94A3B8] flex items-center gap-1">
                            <Shield className="w-3.5 h-3.5 text-[#94A3B8]" /> Secure Communications Guide
                          </p>
                          <p>
                            We enforce cryptographically signed headers on all peer p2p dispatches. Changing your identity profile parameters updates other decentralized peers immediately.
                          </p>
                        </div>

                        {/* 3. Mica Voice Alerts */}
                        <div className="bg-[#12172A]/60 border border-white/10 p-4.5 rounded-[2rem] space-y-3.5 shadow-[0_0_30px_rgba(108, 92, 224,0.03)]">
                          <div className="border-b border-white/5 pb-2 flex items-center justify-between">
                            <div>
                              <h3 className="text-xs font-black text-sky-100 hover:text-white uppercase tracking-widest font-mono">
                                Mica Voice Alerts
                              </h3>
                              <p className="text-[9px] text-[#6C5CE0] mt-0.5 leading-relaxed">
                                Configure her periodic spoken check-ins.
                              </p>
                            </div>
                            <Volume2 className="w-3.5 h-3.5 text-sky-300" />
                          </div>

                          <div className="space-y-2.5">
                            {/* Mica Character Toggle — hides her entirely, keeping the right side clear */}
                            <div className="bg-[#0B0F17]/50 border border-white/5 rounded-xl p-3 flex items-center justify-between">
                              <div className="space-y-0.5">
                                <p className="text-xs font-bold text-[#F8FAFC]">Mica Character</p>
                                <p className="text-[9px] text-[#6C5CE0]">Show or fully hide her from the screen</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextVal = !micaWidgetEnabled;
                                  setMicaWidgetEnabled(nextVal);
                                  localStorage.setItem("mica_widget_enabled", String(nextVal));
                                  window.dispatchEvent(new Event("mica-widget-settings-changed"));
                                  showToast(`Mica character ${nextVal ? "shown" : "hidden"}`, "info");
                                }}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                  micaWidgetEnabled ? "bg-white" : "bg-[#161A2B]"
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[#0B0F17] shadow ring-0 transition duration-200 ease-in-out ${
                                    micaWidgetEnabled ? "translate-x-4" : "translate-x-0"
                                  }`}
                                />
                              </button>
                            </div>

                            {/* Mica Voice Toggle */}
                            <div className={`bg-[#0B0F17]/50 border border-white/5 rounded-xl p-3 flex items-center justify-between transition-opacity duration-150 ${micaWidgetEnabled ? "" : "opacity-40 pointer-events-none"}`}>
                              <div className="space-y-0.5">
                                <p className="text-xs font-bold text-[#F8FAFC]">Mica Voice</p>
                                <p className="text-[9px] text-[#6C5CE0]">Let her speak check-in lines aloud</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextVal = !micaVoiceEnabled;
                                  setMicaVoiceEnabled(nextVal);
                                  localStorage.setItem("mica_voice_enabled", String(nextVal));
                                  window.dispatchEvent(new Event("mica-voice-settings-changed"));
                                  showToast(`Mica voice ${nextVal ? "enabled" : "disabled"}`, "info");
                                }}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                  micaVoiceEnabled ? "bg-white" : "bg-[#161A2B]"
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[#0B0F17] shadow ring-0 transition duration-200 ease-in-out ${
                                    micaVoiceEnabled ? "translate-x-4" : "translate-x-0"
                                  }`}
                                />
                              </button>
                            </div>

                            {/* Check-in Interval */}
                            <div className={`bg-[#0B0F17]/50 border border-white/5 rounded-xl p-3 transition-opacity duration-150 ${micaVoiceEnabled && micaWidgetEnabled ? "" : "opacity-40 pointer-events-none"}`}>
                              <label className="block text-[#94A3B8] text-[9px] font-extrabold uppercase tracking-widest mb-1.5">
                                Check-in Interval
                              </label>
                              <div className="grid grid-cols-4 gap-1">
                                {[
                                  { label: "15s", ms: "15000" },
                                  { label: "30s", ms: "30000" },
                                  { label: "1m", ms: "60000" },
                                  { label: "5m", ms: "300000" },
                                ].map((opt) => (
                                  <button
                                    key={opt.ms}
                                    type="button"
                                    onClick={() => {
                                      setMicaVoiceIntervalMs(opt.ms);
                                      localStorage.setItem("mica_voice_interval_ms", opt.ms);
                                      window.dispatchEvent(new Event("mica-voice-settings-changed"));
                                      showToast(`Mica will check in every ${opt.label}`, "success");
                                    }}
                                    className={`py-1 rounded-md text-[8px] font-bold font-mono border transition-all duration-150 cursor-pointer text-center ${
                                      micaVoiceIntervalMs === opt.ms
                                        ? "bg-white text-neutral-950 border-white font-black shadow"
                                        : "bg-[#0B0F17]/60 text-[#94A3B8] border-[#6C5CE0]/20 hover:bg-[#0D111D] hover:text-white"
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Column 2: Basic Avatar & Moniker & System Audio Alerts */}
                      <div className="space-y-5">
                        {/* Form Bento Section 1: Image & Basic Names */}
                        <div className="bg-[#12172A]/60 border border-white/10 p-4.5 rounded-[2rem] space-y-4 shadow-[0_0_30px_rgba(108, 92, 224,0.03)]">
                          <div className="border-b border-white/5 pb-2.5">
                            <h3 className="text-xs font-black text-sky-100 hover:text-white uppercase tracking-widest font-mono">
                              Basic Avatar & Moniker
                            </h3>
                            <p className="text-[9px] text-[#6C5CE0] mt-0.5 leading-relaxed">
                              Customize standard visual descriptors for peer authentication.
                            </p>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="relative shrink-0 select-none cursor-pointer" onClick={() => avatarUploadRef.current?.click()}>
                              <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-[#5847B8] to-[#6C5CE0] opacity-20 blur-sm animate-pulse" />
                              <img
                                src={customAvatarUrl || userProfile?.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser?.uid}`}
                                alt="Profile Preview"
                                referrerPolicy="no-referrer"
                                className="relative w-14 h-14 rounded-full bg-[#0B0F17] border-2 border-white/[0.06] p-0.5 object-cover hover:scale-105 transition duration-200"
                              />
                            </div>

                            <div className="flex-1 w-full space-y-2">
                              <input
                                type="file"
                                accept="image/*"
                                ref={avatarUploadRef}
                                onChange={handleAvatarUpload}
                                className="hidden"
                              />
                              
                              <div className="flex flex-col gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => avatarUploadRef.current?.click()}
                                  disabled={isUploadingAvatar}
                                  className="bg-[#12172A]/80 hover:bg-[#6C5CE0]/10 border border-white/10 hover:border-[#6C5CE0]/40 text-sky-100 px-3 py-2 text-[10px] font-bold rounded-lg flex items-center justify-center gap-1.5 transition duration-150 cursor-pointer disabled:opacity-50 hover:scale-[1.01]"
                                >
                                  {isUploadingAvatar ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#94A3B8]" />
                                      Verifying...
                                    </>
                                  ) : (
                                    <>
                                      <Upload className="w-3.5 h-3.5 text-[#94A3B8]" />
                                      Upload Image
                                    </>
                                  )}
                                </button>

                                {customAvatarUrl && (
                                  <span className="text-[8px] text-emerald-400 font-bold flex items-center justify-center gap-1 bg-emerald-950/20 border border-emerald-900/30 py-1 px-2 rounded-lg animate-pulse">
                                    <Check className="w-3 h-3 shrink-0" /> Verified Successfully
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Inputs Row */}
                          <div className="space-y-3 pt-1">
                            <div>
                              <label className="block text-[#94A3B8] text-[9px] font-extrabold uppercase tracking-widest mb-1 pl-0.5">
                                Display Name / Moniker
                              </label>
                              <input
                                type="text"
                                required
                                value={editDisplayName}
                                onChange={(e) => setEditDisplayName(e.target.value)}
                                placeholder="e.g. Satoshi"
                                className="w-full bg-[#0B0F17]/70 border border-white/[0.06] focus:border-[#6C5CE0]/40 focus:ring-1 focus:ring-[#6C5CE0]/20 rounded-xl px-3 py-2 text-xs text-[#F8FAFC] focus:outline-none font-sans shadow-inner transition-all duration-150"
                              />
                            </div>

                            <div>
                              <label className="block text-[#94A3B8] text-[9px] font-extrabold uppercase tracking-widest mb-1 pl-0.5">
                                Short Bio Statement
                              </label>
                              <textarea
                                value={editBio}
                                onChange={(e) => setEditBio(e.target.value)}
                                placeholder="Give connections a brief status bio..."
                                rows={2}
                                maxLength={180}
                                className="w-full bg-[#0B0F17]/70 border border-white/[0.06] focus:border-[#6C5CE0]/40 focus:ring-1 focus:ring-[#6C5CE0]/20 rounded-xl px-3 py-2 text-xs text-[#F8FAFC] focus:outline-none font-sans resize-none shadow-inner transition-all duration-150"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Form Bento Section 2: Peer System & Sound Alerts */}
                        <div className="bg-[#12172A]/60 border border-white/10 p-4.5 rounded-[2rem] space-y-3.5 shadow-[0_0_30px_rgba(108, 92, 224,0.03)]">
                          <div className="border-b border-white/5 pb-2 flex items-center justify-between">
                            <div>
                              <h3 className="text-xs font-black text-sky-100 hover:text-white uppercase tracking-widest font-mono">
                                System & Audio Alerts
                              </h3>
                              <p className="text-[9px] text-[#6C5CE0] mt-0.5 leading-relaxed">
                                Manage real-time interactive notification sounds.
                              </p>
                            </div>
                            <Bell className="w-3.5 h-3.5 text-sky-300" />
                          </div>

                          <div className="space-y-2.5">
                            {/* Notification Sounds Toggle */}
                            <div className="bg-[#0B0F17]/50 border border-white/5 rounded-xl p-3 flex items-center justify-between">
                              <div className="space-y-0.5">
                                <p className="text-xs font-bold text-[#F8FAFC]">Notification Sounds</p>
                                <p className="text-[9px] text-[#6C5CE0]">Audio feedback on signals</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextVal = !notificationSounds;
                                  setNotificationSounds(nextVal);
                                  localStorage.setItem("notification_sounds", String(nextVal));
                                  showToast(`Notification sounds ${nextVal ? "enabled" : "disabled"}`, "info");
                                }}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                  notificationSounds ? "bg-white" : "bg-[#161A2B]"
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[#0B0F17] shadow ring-0 transition duration-200 ease-in-out ${
                                    notificationSounds ? "translate-x-4" : "translate-x-0"
                                  }`}
                                />
                              </button>
                            </div>

                            {/* Do Not Disturb Toggle */}
                            <div className="bg-[#0B0F17]/50 border border-white/5 rounded-xl p-3 flex items-center justify-between">
                              <div className="space-y-0.5">
                                <p className="text-xs font-bold text-[#F8FAFC]">Do Not Disturb Mode</p>
                                <p className="text-[9px] text-[#6C5CE0]">Silence all sound ringers</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextVal = !doNotDisturb;
                                  setDoNotDisturb(nextVal);
                                  localStorage.setItem("do_not_disturb", String(nextVal));
                                  updateProfile({
                                    displayName: editDisplayName.trim() || userProfile?.displayName || "",
                                    avatarUrl: customAvatarUrl || userProfile?.avatarUrl || "",
                                    bio: editBio.trim() ? editBio.trim() : undefined,
                                    moodEmoji: editMoodEmoji.trim() ? editMoodEmoji.trim() : undefined,
                                    githubUrl: editGithubUrl.trim() ? editGithubUrl.trim() : undefined,
                                    twitterUrl: editTwitterUrl.trim() ? editTwitterUrl.trim() : undefined,
                                    dndMode: nextVal,
                                  });
                                  showToast(`Do Not Disturb ${nextVal ? "enabled" : "disabled"}`, "info");
                                }}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                  doNotDisturb ? "bg-white" : "bg-[#161A2B]"
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[#0B0F17] shadow ring-0 transition duration-200 ease-in-out ${
                                    doNotDisturb ? "translate-x-4" : "translate-x-0"
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Column 3: Secure Cyber Nodes & Address, Payment Settings */}
                      <div className="space-y-5">
                        {/* Form Bento Section 3: Web3 Credentials and Cyber Keys */}
                        <div className="bg-[#12172A]/60 border border-white/10 p-4.5 rounded-[2rem] space-y-3.5 shadow-[0_0_30px_rgba(108, 92, 224,0.03)]">
                          <div className="border-b border-white/5 pb-2">
                            <h3 className="text-xs font-black text-sky-100 hover:text-white uppercase tracking-widest font-mono">
                              Secure Cyber Nodes & Addresses
                            </h3>
                            <p className="text-[9px] text-[#6C5CE0] mt-0.5 leading-relaxed">
                              Configure web3 wallets and developer handles.
                            </p>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[#94A3B8] text-[9px] font-extrabold uppercase tracking-widest mb-1 pl-0.5">
                                GitHub Identity Node
                              </label>
                              <div className="relative">
                                <Github className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-[#6C5CE0]" />
                                <input
                                  type="text"
                                  value={editGithubUrl}
                                  onChange={(e) => setEditGithubUrl(e.target.value)}
                                  placeholder="satoshinak"
                                  className="w-full bg-[#0B0F17]/70 border border-white/[0.06] focus:border-[#6C5CE0]/40 focus:ring-1 focus:ring-[#6C5CE0]/20 rounded-xl pl-8 pr-2 py-2 text-xs text-[#94A3B8] focus:outline-none font-mono shadow-inner transition duration-150"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-[#94A3B8] text-[9px] font-extrabold uppercase tracking-widest mb-1 pl-0.5">
                                Twitter / X Identity Node
                              </label>
                              <div className="relative">
                                <Twitter className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-[#6C5CE0]" />
                                <input
                                  type="text"
                                  value={editTwitterUrl}
                                  onChange={(e) => setEditTwitterUrl(e.target.value)}
                                  placeholder="@satoshi"
                                  className="w-full bg-[#0B0F17]/70 border border-white/[0.06] focus:border-[#6C5CE0]/40 focus:ring-1 focus:ring-[#6C5CE0]/20 rounded-xl pl-8 pr-2 py-2 text-xs text-[#94A3B8] focus:outline-none font-mono shadow-inner transition duration-150"
                                />
                              </div>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[#94A3B8] text-[9px] font-extrabold uppercase tracking-widest mb-1 pl-0.5">
                              Primary Wallet (Privy Verified)
                            </label>
                            <div className="bg-[#0B0F17]/70 border border-emerald-500/15 rounded-xl px-3 py-2.5 flex items-center gap-2.5">
                              <Wallet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <div className="min-w-0 flex-1">
                                {userProfile?.walletAddress ? (
                                  <>
                                    <p className="text-[10px] text-[#94A3B8] font-mono truncate">
                                      {userProfile.walletAddress.substring(0, 8)}...{userProfile.walletAddress.substring(userProfile.walletAddress.length - 6)}
                                    </p>
                                    <p className="text-[8px] text-emerald-400/70 font-medium truncate mt-0.5 flex items-center gap-1">
                                      <ShieldCheck className="w-2.5 h-2.5" />
                                      {userProfile.walletProvider || "External wallet"} · verified by Privy
                                    </p>
                                  </>
                                ) : (
                                  <p className="text-[10px] text-[#94A3B8] font-mono">No wallet linked</p>
                                )}
                              </div>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={handleChangeWallet}
                                disabled={changingWallet || walletConnecting}
                                className="bg-[#12172A]/80 hover:bg-[#6C5CE0]/10 border border-white/10 hover:border-[#6C5CE0]/40 text-sky-100 py-1.5 px-3 rounded-lg text-[9px] font-bold font-mono cursor-pointer transition hover:scale-[1.01] flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {changingWallet || walletConnecting ? (
                                  <Loader2 className="w-3 h-3 animate-spin text-sky-300" />
                                ) : (
                                  <RefreshCw className="w-3 h-3 text-sky-300" />
                                )}
                                CHANGE WALLET
                              </button>
                              {userProfile?.walletLinkedAt && (
                                <span className="text-[8px] text-[#6C5CE0] font-mono truncate">
                                  linked {new Date(userProfile.walletLinkedAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                            <p className="text-[8px] text-[#6C5CE0]/80 mt-1.5 leading-relaxed pl-0.5">
                              The primary wallet is set by Privy after signing a connection — addresses are never entered manually.
                            </p>
                          </div>
                        </div>

                        {/* Form Bento Section 4: Web3 Wallet & Payment Management */}
                        <div className="bg-[#12172A]/60 border border-white/10 p-4.5 rounded-[2rem] space-y-3.5 shadow-[0_0_30px_rgba(108, 92, 224,0.03)]">
                          <div className="border-b border-white/5 pb-2 flex items-center justify-between">
                            <div>
                              <h3 className="text-xs font-black text-sky-100 hover:text-white uppercase tracking-widest font-mono">
                                Payment Settings & Fuel Keys
                              </h3>
                              <p className="text-[9px] text-[#6C5CE0] mt-0.5 leading-relaxed">
                                Manage Web3 cryptographic tips and balance.
                              </p>
                            </div>
                            <Wallet className="w-3.5 h-3.5 text-sky-300" />
                          </div>

                          <div className="grid grid-cols-1 gap-3">
                            {/* Balance block & Deposit side by side */}
                            <div className="bg-[#0B0F17]/50 border border-white/5 rounded-xl p-3 flex items-center justify-between">
                              <div>
                                <p className="text-[8px] uppercase tracking-wider text-[#6C5CE0] font-bold font-mono">Wallet Fuel</p>
                                <p className="text-lg font-black text-[#F8FAFC] font-mono mt-0.5">{walletBalance} SOL</p>
                              </div>
                              <button
                                type="button"
                                onClick={handleSimulateDeposit}
                                className="bg-[#12172A]/80 hover:bg-[#6C5CE0]/10 border border-white/10 hover:border-[#6C5CE0]/40 text-sky-100 py-1.5 px-3 rounded-lg text-[9px] font-bold font-mono cursor-pointer transition hover:scale-[1.01]"
                              >
                                REQUEST AIRDROP
                              </button>
                            </div>

                            {/* Preference configurations */}
                            <div className="grid grid-cols-2 gap-3 items-center">
                              <div>
                                <label className="block text-[#94A3B8] text-[8px] font-extrabold uppercase tracking-widest mb-1.5">
                                  Tip Rate
                                </label>
                                <div className="grid grid-cols-4 gap-1">
                                  {["0.01", "0.05", "0.10", "0.50"].map((tipVal) => (
                                    <button
                                      key={tipVal}
                                      type="button"
                                      onClick={() => {
                                        setActiveTipRate(tipVal);
                                        localStorage.setItem("active_tip_rate", tipVal);
                                        showToast(`Preferred tipping rate set to ${tipVal} SOL`, "success");
                                      }}
                                      className={`py-1 rounded-md text-[8px] font-bold font-mono border transition-all duration-150 cursor-pointer text-center ${
                                        activeTipRate === tipVal
                                          ? "bg-white text-neutral-950 border-white font-black shadow"
                                          : "bg-[#0B0F17]/60 text-[#94A3B8] border-[#6C5CE0]/20 hover:bg-[#0D111D] hover:text-white"
                                      }`}
                                    >
                                      {tipVal}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Autoapprove toggle */}
                              <div className="bg-[#0B0F17]/50 border border-white/5 rounded-xl p-2 flex items-center justify-between">
                                <div className="space-y-0.5">
                                  <p className="text-[10px] font-bold text-[#F8FAFC]">Auto-Tips</p>
                                  <p className="text-[8px] text-[#6C5CE0]">Auto approve tip</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextVal = !paymentAutoApprove;
                                    setPaymentAutoApprove(nextVal);
                                    localStorage.setItem("payment_auto_approve", String(nextVal));
                                    showToast(`Auto-Approve Tips ${nextVal ? "enabled" : "disabled"}`, "info");
                                  }}
                                  className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                    paymentAutoApprove ? "bg-white" : "bg-[#161A2B]"
                                  }`}
                                >
                                  <span
                                    className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-[#0B0F17] shadow ring-0 transition duration-200 ease-in-out ${
                                      paymentAutoApprove ? "translate-x-3.5" : "translate-x-0"
                                    }`}
                                  />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                    </div>

                    {/* Full-width Actions Bar at bottom */}
                    <div className="mt-4 flex flex-col sm:flex-row gap-4 items-center justify-between p-4 bg-[#12172A]/60 border border-white/10 rounded-2xl shadow-lg">
                      {/* Disconnect on the left */}
                      <div>
                        <button
                          type="button"
                          onClick={logout}
                          className="bg-red-950/20 border border-red-500/20 hover:border-red-500/50 text-red-400 py-2.5 px-4 rounded-xl text-xs font-bold font-mono uppercase tracking-widest cursor-pointer transition-all duration-150 flex items-center gap-2 hover:bg-red-950/30"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          Disconnect Session / Logout
                        </button>
                      </div>
                      
                      {/* Action buttons on the right */}
                      <div className="flex items-center gap-3 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={handleBackToChats}
                          className="flex-1 sm:flex-initial bg-[#0B0F17] border border-white/10 hover:bg-[#161A2B] text-[#94A3B8] hover:text-white py-2.5 px-5 rounded-xl text-xs font-bold font-mono uppercase tracking-widest cursor-pointer transition-all duration-150 active:scale-[0.99] shadow"
                        >
                          Cancel Changes
                        </button>
                        <button
                          type="submit"
                          disabled={isSavingProfile || isUploadingAvatar}
                          className="flex-1 sm:flex-initial bg-gradient-to-r from-neutral-100 via-white to-neutral-400 text-neutral-950 hover:opacity-95 font-black py-2.5 px-7 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-xl hover:scale-[1.01] transition duration-150 disabled:opacity-50"
                        >
                          {isSavingProfile ? (
                            <Loader2 className="w-4 h-4 animate-spin text-neutral-900" />
                          ) : (
                            <>
                              <Check className="w-4 h-4 text-neutral-950" />
                              Save Profile Changes
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            </motion.div>
          ) : activeTab === "wallet" ? (
            <CircleWalletDashboard onBack={handleBackToChats} />
          ) : activeTab === "dealroom" ? (
            <DealRoom onBack={handleBackToChats} />
          ) : activeChatId && activeChatFriend ? (
            <div className="flex-1 flex flex-row h-full overflow-hidden">
              <motion.div
                key={activeChatId}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col h-full overflow-hidden border-r border-white/[0.06]"
              >
                {/* Active Chat Header */}
                <div className="sticky top-0 p-3 sm:p-4 bg-[#0D111D]/90 backdrop-blur-md border-b border-[#6C5CE0]/20 flex items-center gap-2 sm:gap-3 relative z-10 shrink-0">
                  <div
                    className="flex items-center gap-2 sm:gap-3 cursor-pointer select-none group min-w-0 flex-1"
                    onClick={() => setShowDetailsSidebar(!showDetailsSidebar)}
                  >
                    {/* Back button on mobile */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBackToChats();
                      }}
                      className="p-1.5 rounded-lg bg-[#0D111D] border border-white/[0.06] text-[#94A3B8] hover:text-white md:hidden cursor-pointer shrink-0"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>

                    <div className="relative shrink-0">
                      <img
                        src={activeChatFriend.avatarUrl}
                        alt={activeChatFriend.displayName}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#0B0F17] border border-white/[0.06] object-cover group-hover:border-neutral-500 transition-all"
                      />
                      <span
                        className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white/[0.06] ${
                          activeChatFriend.status === "online"
                            ? "bg-emerald-500 animate-pulse"
                            : "bg-gray-500"
                        }`}
                      />
                    </div>

                    <div className="min-w-0">
                      <h2 className="text-sm sm:text-base font-bold text-[#F8FAFC] group-hover:text-white transition-colors truncate leading-tight">
                        {activeChatFriend.displayName}
                      </h2>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-nowrap overflow-hidden">
                        <span 
                          onClick={() => {
                            navigator.clipboard.writeText(`@${activeChatFriend.username}`);
                            showToast(`Copied username @${activeChatFriend.username}`, "success");
                          }}
                          className="text-[10px] sm:text-[10.5px] text-[#94A3B8] font-mono cursor-pointer hover:text-white hover:underline transition-all truncate"
                          title="Click to copy username"
                        >
                          @{activeChatFriend.username}
                        </span>
                        <span className="text-[10px] text-[#6C5CE0] shrink-0">•</span>
                        <span className={`text-[10px] sm:text-[10.5px] font-mono uppercase tracking-wider font-semibold whitespace-nowrap shrink-0 ${
                          activeChatFriend.status === "online" ? "text-emerald-400" : "text-gray-400"
                        }`}>
                          {activeChatFriend.status === "online"
                            ? "Active"
                            : `Offline`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {activeChatFriend.walletAddress && (
                      <span 
                        onClick={() => {
                          navigator.clipboard.writeText(activeChatFriend.walletAddress);
                          showToast("Copied wallet address to clipboard!", "success");
                        }}
                        className="hidden lg:inline-flex text-[10px] font-mono bg-[#0D111D] border border-white/[0.06] hover:border-white/[0.06] text-[#94A3B8] hover:text-white px-2 py-1 rounded-lg items-center gap-1 cursor-pointer transition-all"
                        title="Click to copy full wallet address"
                      >
                        <Wallet className="w-3 h-3 text-[#6C5CE0]" />
                        {activeChatFriend.walletAddress.substring(0, 8)}...
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartCall(activeChatFriend, "audio");
                      }}
                      title="Voice call"
                      disabled={!canInteractWith(activeChatFriend.uid)}
                      className={`flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-xl transition-all cursor-pointer ${
                        !canInteractWith(activeChatFriend.uid)
                          ? "text-[#334155] opacity-40 pointer-events-none"
                          : "text-[#94A3B8] hover:text-white hover:bg-[#6C5CE0]/10"
                      }`}
                    >
                      <Phone className="w-4 h-4" />
                      <span className="hidden sm:block text-[8px] font-bold uppercase tracking-wider">Call</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartCall(activeChatFriend, "video");
                      }}
                      title="Video call"
                      disabled={!canInteractWith(activeChatFriend.uid)}
                      className={`flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-xl transition-all cursor-pointer ${
                        !canInteractWith(activeChatFriend.uid)
                          ? "text-[#334155] opacity-40 pointer-events-none"
                          : "text-[#94A3B8] hover:text-white hover:bg-[#6C5CE0]/10"
                      }`}
                    >
                      <Video className="w-4 h-4" />
                      <span className="hidden sm:block text-[8px] font-bold uppercase tracking-wider">Video Call</span>
                    </button>
                    <button
                      onClick={() => setShowDetailsSidebar(!showDetailsSidebar)}
                      title="Toggle partner details sidebar"
                      className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg border transition-all cursor-pointer flex items-center justify-center ${
                        showDetailsSidebar
                          ? "bg-[#161A2B] text-white border-white/[0.06]"
                          : "text-[#6C5CE0] hover:text-[#94A3B8] hover:bg-[#0D111D] border-transparent hover:border-white/[0.06]"
                      }`}
                    >
                      <Info className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>
                  </div>
                </div>

                {/* MESSAGES THREAD PANELS */}
                <div
                  className="flex-1 overflow-y-auto px-2 py-2 sm:px-5 sm:py-5 space-y-4 custom-scrollbar flex flex-col pt-6 bg-[radial-gradient(circle_at_top,#161A2B_0%,#0D111D_35%,#0B0F17_100%)]"
                  id="message_feed_container"
                  onClick={() => setActiveMessagePopupId(null)}
                >
                  {activeChatMessages.length === 0 ? (
                    <div className="my-auto-only py-24 text-center">
                      <Lock className="w-5 h-5 text-[#6C5CE0] mx-auto mb-2 drop-shadow-[0_0_8px_rgba(108, 92, 224,0.12)]" />
                      <p className="text-xs text-sky-100">Messages are secure and end-to-end synchronized.</p>
                      <p className="text-[10px] text-sky-300/50 mt-1">Start chatting by typing a greeting below.</p>
                    </div>
                  ) : (
                    <>
                      {activeChatMessages.map((msg, index) => {
                        const isSelf = msg.senderId === currentUser?.uid;
                        
                        // Format simple readable time:
                        const dateObj = msg.timestamp ? new Date(msg.timestamp) : new Date();
                        const displayTime = isNaN(dateObj.getTime()) ? "" : dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                        // CALL LOG ENTRY: rendered as a compact pill (Messenger/WhatsApp style),
                        // aligned left/right like a normal chat bubble instead of centered.
                        if (msg.callLog) {
                          const isMissedOrFailed = ["missed", "declined", "busy", "cancelled", "failed"].includes(
                            msg.callLog.status
                          );
                          const CallIcon = msg.callLog.type === "video" ? Video : Phone;
                          return (
                            <div key={msg.id || index} className={`flex my-1 ${isSelf ? "justify-end" : "justify-start"}`}>
                              <div
                                className={`flex items-center gap-2 px-4 py-2 rounded-full border text-[11px] font-medium ${
                                  isMissedOrFailed
                                    ? "bg-red-500/10 border-red-500/20 text-red-300"
                                    : "bg-[#12172A]/60 border-white/10 text-[#94A3B8]"
                                }`}
                              >
                                <CallIcon className="w-3.5 h-3.5 shrink-0" />
                                <span>{msg.text.replace(/^[📞📹]\s*/, "")}</span>
                                {displayTime && <span className="text-[#6C5CE0]/60">· {displayTime}</span>}
                              </div>
                            </div>
                          );
                        }

                        // PAYMENT SYSTEM MESSAGE: centered pill (Messenger/WhatsApp
                        // style) — never rendered as a normal chat bubble.
                        if (msg.payment) {
                          return (
                            <div key={msg.id || index} className="flex justify-center my-1.5">
                              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-medium text-emerald-200/90">
                                <Coins className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                                <span>{msg.text}</span>
                                {displayTime && <span className="text-emerald-400/50">· {displayTime}</span>}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            id={`msg-${msg.id}`}
                            key={msg.id || index}
                            className={`flex items-end gap-2.5 transition-all duration-300 ${isSelf ? "justify-end" : "justify-start"}`}
                          >
                            {!isSelf && (
                              <img
                                src={(msg.senderUsername === "sovereign_bot" || msg.senderUsername === "mahi_bot") ? "https://res.cloudinary.com/dzwbn3pvh/image/upload/v1783072499/image_1_1_3_zd9aey.png" : activeChatFriend.avatarUrl}
                                alt={(msg.senderUsername === "sovereign_bot" || msg.senderUsername === "mahi_bot") ? "MAHI AI" : activeChatFriend.displayName}
                                referrerPolicy="no-referrer"
                                className="w-7 h-7 rounded-full bg-[#0D111D] cursor-pointer select-none object-cover shrink-0 mb-1 border border-[#6C5CE0]/20"
                              />
                            )}

                            <div className={`flex flex-col max-w-[70%] ${isSelf ? "items-end" : "items-start"} relative group`}>
                              {/* Reactions hover picker */}
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className={`absolute -top-9 ${isSelf ? "right-2" : "left-2"} bg-[#0B0F17]/95 backdrop-blur-md border border-white/[0.06] rounded-full py-1.5 px-3 shadow-2xl flex items-center gap-2.5 transition-all duration-200 z-50 origin-bottom ${
                                  activeMessagePopupId === msg.id
                                    ? "opacity-100 scale-100 pointer-events-auto"
                                    : "opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto scale-90 group-hover:scale-100 hover:opacity-100"
                                }`}>
                                <div className="flex items-center gap-1">
                                  {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      onClick={() => {
                                        toggleReaction(msg.id, emoji);
                                        setActiveMessagePopupId(null);
                                      }}
                                      className="hover:scale-125 active:scale-95 transition-transform duration-100 px-1 cursor-pointer text-sm select-none"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                                <div className="w-[1px] h-3 bg-[#161A2B] shrink-0" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReplyingToMessage(msg);
                                    setActiveMessagePopupId(null);
                                    const inputEl = document.getElementById("chat-input-field");
                                    if (inputEl) inputEl.focus();
                                  }}
                                  className="flex items-center gap-1 text-[9px] font-bold text-[#94A3B8] hover:text-white transition-colors duration-100 px-1 cursor-pointer"
                                  title="Reply"
                                >
                                  <CornerUpLeft className="w-3 h-3 shrink-0" />
                                  <span className="font-mono uppercase tracking-wider">REPLY</span>
                                </button>
                                {isSelf && (
                                  <>
                                    {!msg.isSticker && !msg.audioUrl && msg.text && !msg.text.startsWith("[AI_AGENT_DEPLOY]") && (
                                      <>
                                        <div className="w-[1px] h-3 bg-[#161A2B] shrink-0" />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setActiveMessagePopupId(null);
                                            setReplyingToMessage(null);
                                            setEditingMessage(msg);
                                            setMsgText(msg.text);
                                            const inputEl = document.getElementById("chat-input-field");
                                            if (inputEl) inputEl.focus();
                                          }}
                                          className="flex items-center gap-1 text-[9px] font-bold text-[#94A3B8] hover:text-white transition-colors duration-100 px-1 cursor-pointer"
                                          title="Edit"
                                        >
                                          <Pencil className="w-3 h-3 shrink-0" />
                                          <span className="font-mono uppercase tracking-wider">EDIT</span>
                                        </button>
                                      </>
                                    )}
                                    <div className="w-[1px] h-3 bg-[#161A2B] shrink-0" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveMessagePopupId(null);
                                        if (window.confirm("Delete this message? This cannot be undone.")) {
                                          deleteMessage(msg.id);
                                        }
                                      }}
                                      className="flex items-center gap-1 text-[9px] font-bold text-red-400 hover:text-red-300 transition-colors duration-100 px-1 cursor-pointer"
                                      title="Delete"
                                    >
                                      <Trash2 className="w-3 h-3 shrink-0" />
                                      <span className="font-mono uppercase tracking-wider">DELETE</span>
                                    </button>
                                  </>
                                )}
                              </div>

                              {/* Text message box with metallic details */}
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveMessagePopupId(activeMessagePopupId === msg.id ? null : msg.id);
                                }}
                                className={
                                  msg.isSticker
                                    ? "p-1 select-none relative cursor-pointer hover:scale-105 transition-transform duration-200"
                                    : msg.imageUrl && !msg.text && !msg.audioUrl && !msg.replyTo
                                    ? "select-none relative cursor-pointer"
                                    : `p-3 rounded-2xl text-xs leading-relaxed break-words shadow-lg transition-all relative cursor-pointer select-none ${
                                        isSelf
                                          ? "bg-[#6C5CE0] text-white font-medium rounded-[28px] rounded-br-md px-5 py-4 shadow-sm"
                                          : (msg.senderUsername === "sovereign_bot" || msg.senderUsername === "mahi_bot")
                                          ? "bg-[#0D111D]/90 backdrop-blur-xl border border-white/[0.06] text-white rounded-[24px] rounded-bl-md shadow-[0_0_25px_rgba(108, 92, 224,0.12)] px-5 py-4"
                                          : "bg-[#161A2B]/95 backdrop-blur-md border border-white/[0.08] text-white rounded-[24px] rounded-bl-md px-5 py-4 shadow-sm"
                                      }`
                                }
                              >
                                {(msg.senderUsername === "sovereign_bot" || msg.senderUsername === "mahi_bot") && (
                                  <div className="flex items-center gap-1.5 text-[8.5px] font-bold text-[#94A3B8] uppercase tracking-widest mb-1.5 font-mono">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8] animate-pulse" />
                                    MAHI (AI) • MAHIX
                                  </div>
                                )}
                                {msg.replyTo && !msg.isSticker && (
                                  <div
                                    className={`mb-2 px-2 py-1 rounded-lg text-[10px] flex flex-col gap-0.5 border-l-2 select-none cursor-pointer hover:bg-neutral-500/10 transition-colors ${
                                      isSelf
                                        ? "bg-black/15 text-white/90 border-white/30"
                                        : "bg-black/15 text-white/90 border-white/30"
                                    }`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const el = document.getElementById(`msg-${msg.replyTo?.id}`);
                                      if (el) {
                                        el.scrollIntoView({ behavior: "smooth", block: "center" });
                                        el.classList.add("ring-2", "ring-neutral-450", "ring-offset-2", "ring-offset-neutral-950");
                                        setTimeout(() => {
                                          el.classList.remove("ring-2", "ring-neutral-450", "ring-offset-2", "ring-offset-neutral-950");
                                        }, 1500);
                                      }
                                    }}
                                  >
                                    <div className="flex items-center gap-1 font-bold font-mono text-[8.5px] uppercase tracking-wider opacity-85">
                                      <CornerUpLeft className="w-2.5 h-2.5" />
                                      <span>@{msg.replyTo.senderUsername}</span>
                                    </div>
                                    <p className="line-clamp-1 italic font-sans text-[10px] opacity-90">{msg.replyTo.text}</p>
                                  </div>
                                )}
                                {/* Loaded attachment images or Stickers */}
                                {msg.imageUrl && (
                                  msg.isSticker ? (
 <div className="overflow-hidden rounded-xl max-w-[80px] sm:max-w-[100px] aspect-square flex items-center justify-center relative">
                                      <img
                                        src={msg.imageUrl}
                                        alt="Sticker"
                                        className="w-full h-auto object-contain select-none pointer-events-none drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)]"
                                        onLoad={() => {
                                          if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: 'smooth' });
                                        }}
                                      />
                                      <div className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 bg-black/55 backdrop-blur-sm rounded-full px-1.5 py-0.5 select-none">
                                        <span className="text-[6px] text-[#6C5CE0] font-mono tracking-widest uppercase">
                                          {displayTime}
                                        </span>
                                        {isSelf && (
                                          <span className={`text-[6px] font-mono tracking-widest uppercase font-bold ${msg.seen ? "text-blue-400" : "text-yellow-400"}`}>
                                            {msg.seen ? "•Seen" : "•Unseen"}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="mb-2 overflow-hidden rounded-xl max-w-sm relative">
                                      <img
                                        src={msg.imageUrl}
                                        alt="Message graphic"
                                        className="max-w-full max-h-56 rounded-lg object-cover hover:scale-[1.01] transition-transform duration-200 cursor-zoom-in"
                                        onLoad={() => {
                                          if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: 'smooth' });
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setFullscreenImage(msg.imageUrl!);
                                        }}
                                      />
                                      {/* GIF Badge if applicable */}
                                      {(msg.imageUrl.includes(".gif") || msg.imageUrl.includes("giphy.com") || msg.imageUrl.includes("tenor.com")) && (
                                        <div className="absolute bottom-2 right-2 bg-black/70 text-sky-300 border border-sky-400/30 font-bold text-[8px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider shadow">
                                          GIF
                                        </div>
                                      )}
                                    </div>
                                  )
                                )}

                                {/* Audio Voice Note Player */}
                                {msg.audioUrl && (
                                  <VoiceMessagePlayer audioUrl={msg.audioUrl} isSelf={isSelf} />
                                )}
                                
                                {msg.text && (() => {
                                  if (msg.text.startsWith("[AI_AGENT_DEPLOY]")) {
                                    try {
                                      const data = JSON.parse(msg.text.slice("[AI_AGENT_DEPLOY]".length));
                                      return (
                                        <div className="flex flex-col gap-2.5 p-1 w-72 max-w-full text-[#F8FAFC] select-text">
                                          <div className="flex items-center justify-between border-b border-white/10 pb-2">
                                            <div className="flex items-center gap-2">
                                              <Bot className="w-5 h-5 text-sky-400 animate-pulse" />
                                              <div>
                                                <h4 className="text-[11px] font-black tracking-widest font-mono text-white uppercase">{data.name}</h4>
                                                <span className="text-[9px] text-sky-300 font-mono">{data.model}</span>
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-full px-2 py-0.5">
                                              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />
                                              <span className="text-[8px] font-bold font-mono text-green-400 tracking-wider uppercase">ACTIVE</span>
                                            </div>
                                          </div>

                                          <div className="space-y-1.5 text-[10px] font-sans text-[#94A3B8] bg-black/40 p-2.5 rounded-lg border border-white/5">
                                            <p className="font-mono text-[8px] uppercase tracking-wider text-[#6C5CE0]">Node Directives</p>
                                            <p className="leading-relaxed italic">"{data.directive}"</p>
                                          </div>

                                          <div className="grid grid-cols-2 gap-2 text-center font-mono text-[9px]">
                                            <div className="bg-white/5 border border-white/5 rounded-lg p-1.5">
                                              <span className="text-[#6C5CE0] text-[8px] uppercase tracking-wider block mb-0.5">Escrow Funding</span>
                                              <span className="font-black text-white">{data.funding} SOL</span>
                                            </div>
                                            <div className="bg-white/5 border border-white/5 rounded-lg p-1.5">
                                              <span className="text-[#6C5CE0] text-[8px] uppercase tracking-wider block mb-0.5">Est. Yield (APR)</span>
                                              <span className="font-black text-sky-400">{data.yield || "+1.25%"}</span>
                                            </div>
                                            <div className="bg-white/5 border border-white/5 rounded-lg p-1.5">
                                              <span className="text-[#6C5CE0] text-[8px] uppercase tracking-wider block mb-0.5">Node Uptime</span>
                                              <span className="font-black text-[#94A3B8]">{data.uptime || "99.9%"}</span>
                                            </div>
                                            <div className="bg-white/5 border border-white/5 rounded-lg p-1.5">
                                              <span className="text-[#6C5CE0] text-[8px] uppercase tracking-wider block mb-0.5">Virtual Shards</span>
                                              <span className="font-black text-blue-400">10 vCPUs</span>
                                            </div>
                                          </div>

                                          <button
                                            type="button"
                                            onClick={() => showToast(`Synchronized telemetry connection to "${data.name}"`, "info")}
                                            className="w-full mt-1 py-1 px-2 rounded bg-[#6C5CE0]/15 hover:bg-[#6C5CE0]/25 border border-[#6C5CE0]/30 text-sky-300 hover:text-sky-200 text-[9px] font-black font-mono tracking-widest uppercase transition-all cursor-pointer"
                                          >
                                            RE-PING TELEMETRY NODE
                                          </button>
                                        </div>
                                      );
                                    } catch (e) {
                                      // Fallback below
                                    }
                                  }

                                  if (msg.text.startsWith("[WEB3_PAYMENT]")) {
                                    try {
                                      const data = JSON.parse(msg.text.slice("[WEB3_PAYMENT]".length));
                                      return (
                                        <div className="flex flex-col gap-2 p-1 w-64 max-w-full text-[#F8FAFC]">
                                          <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                                            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                                              <Coins className="w-5 h-5 animate-pulse" />
                                            </div>
                                            <div>
                                              <h4 className="text-[10px] font-black tracking-widest font-mono text-emerald-400 uppercase">PAYMENT SUCCESSFUL</h4>
                                              <span className="text-[8px] text-[#6C5CE0] font-mono uppercase tracking-wider">Secured Web3 State</span>
                                            </div>
                                          </div>

                                          <div className="text-center py-2.5 bg-emerald-950/20 border border-emerald-500/10 rounded-xl my-0.5">
                                            <p className="text-[10px] font-mono uppercase text-[#6C5CE0] tracking-wider">Total Transferred</p>
                                            <p className="text-2xl font-black font-mono text-emerald-400 tracking-tight mt-0.5 drop-shadow-[0_0_10px_rgba(34, 197, 94,0.2)]">
                                              {data.amount} SOL
                                            </p>
                                          </div>

                                          <div className="space-y-1.5 text-[9px] font-mono text-[#94A3B8] bg-black/30 p-2 rounded-lg border border-white/5">
                                            <div className="flex justify-between">
                                              <span>RECIPIENT:</span>
                                              <span className="text-white font-bold">{data.recipient}</span>
                                            </div>
                                            <div className="flex justify-between gap-2">
                                              <span>MEMO:</span>
                                              <span className="text-[#94A3B8] text-right truncate max-w-[150px]" title={data.memo}>
                                                {data.memo}
                                              </span>
                                            </div>
                                            <div className="flex justify-between">
                                              <span>SPEED RATE:</span>
                                              <span className="text-sky-300 font-bold uppercase">{data.speed}</span>
                                            </div>
                                          </div>

                                          <div className="flex items-center justify-between text-[8px] font-mono text-[#6C5CE0] bg-white/5 px-2 py-1 rounded-md mt-0.5">
                                            <span className="truncate max-w-[140px]" title={data.txId}>SIGN: {data.txId}</span>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                navigator.clipboard.writeText(data.txId);
                                                showToast("Transaction signature copied to clipboard!", "success");
                                              }}
                                              className="p-1 hover:text-white transition-colors cursor-pointer"
                                              title="Copy Signature"
                                            >
                                              <Copy className="w-3 h-3" />
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    } catch (e) {
                                      // Fallback below
                                    }
                                  }

                                  return <p className="font-sans whitespace-pre-wrap select-text">{msg.text}</p>;
                                })()}
                              </div>

                              {/* Metadata and reactions pill wrapper */}
                              <div className={`flex items-center gap-1.5 mt-0.5 px-1 select-none ${isSelf ? "flex-row-reverse" : "flex-row"}`}>
                                {!msg.isSticker && (
                                  <p className="text-[8px] text-[#6C5CE0] font-mono tracking-widest uppercase select-none">
                                    {displayTime}
                                    {msg.edited && <span className="italic normal-case ml-1 opacity-75">· edited</span>}
                                  </p>
                                )}

                                {isSelf && !msg.isSticker && (
                                  <p
                                    className={`text-[8px] font-mono tracking-widest uppercase select-none font-bold ${
                                      msg.seen ? "text-blue-400" : "text-yellow-400"
                                    }`}
                                  >
                                    {msg.seen ? "Seen" : "Unseen"}
                                  </p>
                                )}

                                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {Object.entries(msg.reactions).map(([emoji, uids]) => {
                                      const uidsList = Array.isArray(uids) ? (uids as string[]) : [];
                                      if (uidsList.length === 0) return null;
                                      const hasReacted = uidsList.includes(currentUser?.uid);
                                      return (
                                        <button
                                          key={emoji}
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleReaction(msg.id, emoji);
                                          }}
                                          title={uidsList.length === 1 ? "1 reaction" : `${uidsList.length} reactions`}
                                          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono border transition-all cursor-pointer ${
                                            hasReacted
                                              ? "bg-white/10 text-white border-white/25 font-bold scale-105"
                                              : "bg-[#0D111D]/65 text-[#94A3B8] border-white/[0.06] hover:border-white/[0.06]"
                                          }`}
                                        >
                                          <span>{emoji}</span>
                                          <span className="text-[8.5px] opacity-80">{uidsList.length}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      <AnimatePresence>
                        {isFriendTyping && (
                          <motion.div
                            id="is-typing-indicator-bubble"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            transition={{ duration: 0.2 }}
                            className="flex items-end gap-2.5 justify-start py-2"
                          >
                            {activeChatFriend && (
                              <img
                                src={activeChatFriend.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${activeChatFriend.uid}`}
                                alt={activeChatFriend.displayName}
                                className="w-[28px] h-[28px] rounded-full border border-white/[0.06] shadow-md object-cover select-none"
                                referrerPolicy="no-referrer"
                              />
                            )}
                            <div className="flex flex-col max-w-[70%] items-start relative">
                              <div className="p-3.5 rounded-2xl bg-[#0D111D] border border-white/[0.06] text-[#F8FAFC] rounded-bl-none shadow-lg flex items-center gap-1.5 animate-pulse">
                                <span className="text-[11px] text-[#94A3B8] font-medium mr-1 select-none">
                                  @{activeChatFriend?.username} is writing
                                </span>
                                <div className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:-0.3s]" />
                                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:-0.15s]" />
                                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-bounce" />
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Anchor ref */}
                      <div ref={scrollRef} />
                    </>
                  )}
                </div>

                {/* MESSAGE SEED INPUT BAR API */}
                <div className="shrink-0 px-4 pb-4 bg-[#0B0F17]">
                  
                  <AnimatePresence>
                    {editingMessage && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mb-3 bg-[#0D111D] border border-[#6C5CE0]/40 rounded-xl p-3 flex items-start gap-4 justify-between select-none overflow-hidden"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="p-1.5 rounded-lg bg-[#0B0F17] text-[#6C5CE0] mt-0.5 shrink-0 border border-[#6C5CE0]/30">
                            <Pencil className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold font-mono text-[#6C5CE0] uppercase tracking-wider">
                              Editing message
                            </p>
                            <p className="text-xs text-[#94A3B8] line-clamp-1 italic mt-0.5 font-sans">
                              {editingMessage.text}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMessage(null);
                            setMsgText("");
                          }}
                          className="p-1 rounded-lg hover:bg-[#161A2B] text-[#6C5CE0] hover:text-white transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <AnimatePresence>
                    {replyingToMessage && !editingMessage && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mb-3 bg-[#0D111D] border border-white/[0.06] rounded-xl p-3 flex items-start gap-4 justify-between select-none overflow-hidden"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="p-1.5 rounded-lg bg-[#0B0F17] text-[#94A3B8] mt-0.5 shrink-0 border border-white/[0.06]">
                            <CornerUpLeft className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold font-mono text-[#94A3B8] uppercase tracking-wider">
                              Replying to <span className="text-white">@{replyingToMessage.senderUsername}</span>
                            </p>
                            <p className="text-xs text-[#94A3B8] line-clamp-1 italic mt-0.5 font-sans">
                              {replyingToMessage.text || (replyingToMessage.imageUrl ? "📷 Image attachment" : "")}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReplyingToMessage(null)}
                          className="p-1 rounded-lg hover:bg-[#161A2B] text-[#6C5CE0] hover:text-white transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Rich Overlay Pickers */}
                  <AnimatePresence>
                    {showGifPicker && (
                      <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 15 }}
                        className="absolute bottom-16 left-0 right-0 bg-[#0D111D]/95 border border-[#6C5CE0]/30 rounded-2xl shadow-2xl z-50 p-3 flex flex-col gap-2.5 max-h-80 max-w-full overflow-hidden backdrop-blur-md"
                      >
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                          <span className="text-xs font-bold font-mono text-sky-300 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5" />
                            GIF SEARCH
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowGifPicker(false)}
                            className="text-[#94A3B8] hover:text-white transition-colors cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="Search Giphy or view trending..."
                          value={gifSearchQuery}
                          onChange={(e) => {
                            setGifSearchQuery(e.target.value);
                            searchGifs(e.target.value);
                          }}
                          className="bg-[#12172A] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-[#F8FAFC] placeholder-[#6C5CE0] focus:outline-none focus:border-[#6C5CE0]/50 w-full"
                        />
                        <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 custom-scrollbar">
                          {isLoadingGifs ? (
                             <div className="col-span-3 flex items-center justify-center py-8">
                               <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
                             </div>
                           ) : gifResults.length > 0 ? (
                             gifResults.map((gif) => (
                               <button
                                 key={gif.id}
                                 type="button"
                                 onClick={async () => {
                                   await sendMessage("", gif.url);
                                   playSendSound();
                                   setShowGifPicker(false);
                                   showToast("GIF sent successfully!", "success");
                                 }}
                                 className="rounded-lg overflow-hidden border border-white/5 hover:border-[#6C5CE0]/50 transition-all aspect-video relative group cursor-pointer"
                               >
                                 <img src={gif.url} alt={gif.title} className="w-full h-full object-cover" />
                                 <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[9px] text-white">
                                   Send GIF
                                 </div>
                               </button>
                             ))
                           ) : (
                             DEFAULT_GIFS.filter(gif => gif.title.toLowerCase().includes(gifSearchQuery.toLowerCase())).map((gif) => (
                               <button
                                 key={gif.id}
                                 type="button"
                                 onClick={async () => {
                                   await sendMessage("", gif.url);
                                   playSendSound();
                                   setShowGifPicker(false);
                                   showToast("GIF sent successfully!", "success");
                                 }}
                                 className="rounded-lg overflow-hidden border border-white/5 hover:border-[#6C5CE0]/50 transition-all aspect-video relative group cursor-pointer"
                               >
                                 <img src={gif.url} alt={gif.title} className="w-full h-full object-cover" />
                                 <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[9px] text-white">
                                   Send GIF
                                 </div>
                               </button>
                             ))
                           )}
                        </div>
                      </motion.div>
                    )}

                    {showStickerPicker && (
                      <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 15 }}
                        className="absolute bottom-16 left-0 right-0 bg-[#0D111D]/95 border border-[#6C5CE0]/30 rounded-2xl shadow-2xl z-50 p-3 flex flex-col gap-2.5 max-h-80 max-w-full overflow-hidden backdrop-blur-md"
                      >
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                          <span className="text-xs font-bold font-mono text-sky-300 flex items-center gap-1.5">
                            <Smile className="w-3.5 h-3.5 text-sky-400" />
                            STICKER EXPRESSIONS
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowStickerPicker(false)}
                            className="text-[#94A3B8] hover:text-white transition-colors cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex-1 overflow-y-auto grid grid-cols-4 gap-3 max-h-56 p-1 custom-scrollbar">
                          {DEFAULT_STICKERS.map((sticker) => (
                            <button
                              key={sticker.id}
                              type="button"
                              onClick={async () => {
                                await sendMessage("", sticker.url, replyingToMessage ? { id: replyingToMessage.id, senderUsername: replyingToMessage.senderUsername, text: replyingToMessage.text } : undefined, undefined, true);
                                playSendSound();
                                setReplyingToMessage(null);
                                setShowStickerPicker(false);
                                showToast("Sticker sent successfully!", "success");
                              }}
                              className="p-1.5 rounded-xl border border-white/5 hover:border-[#6C5CE0]/40 bg-white/5 hover:bg-white/10 transition-all flex flex-col items-center justify-center aspect-square cursor-pointer hover:scale-105"
                              title={sticker.name}
                            >
                              <img src={sticker.url} alt={sticker.name} className="w-10 h-10 object-contain" />
                              <span className="text-[8px] text-[#94A3B8] mt-1 truncate max-w-full font-mono">{sticker.name}</span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {!canInteractWith(activeChatFriend.uid) ? (
                    <div className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-semibold">
                      <Shield className="w-4 h-4 shrink-0" />
                      <span>
                        {blockedBy(activeChatFriend.uid)
                          ? `You have been blocked by ${activeChatFriend.displayName}. You cannot interact with this user because they have blocked you.`
                          : `You blocked ${activeChatFriend.displayName}. You cannot interact with this user while blocked.`}
                      </span>
                    </div>
                  ) : (
                  <div className="relative rounded-[36px] p-[5px] pointer-events-none">
                  <div
  className="absolute inset-0 rounded-[36px]"
  style={{
    background: 'conic-gradient(from var(--composer-glow-angle, 0deg), #6C5CE7, #8B5CF6, #A78BFA, #F472B6, #F9A8D4, #A78BFA, #8B5CF6, #6C5CE7)',
    filter: 'blur(6px)',
    opacity: 0.20,
    animation: 'composer-glow-rotate 10s linear infinite',
  }}
/>
                  <form
  onSubmit={handleSendMessage}
  className="relative flex items-center gap-3 bg-[#0D111D]/90 backdrop-blur-2xl border border-white/[0.06] rounded-[32px] px-4 py-3 shadow-[0_0_30px_rgba(108,92,224,0.12)] pointer-events-auto"
>
                    {isUploadingVoice && (
                      <div className="absolute inset-0 bg-[#0D111D]/90 rounded-xl flex items-center justify-center gap-2 z-30">
                        <Loader2 className="w-4.5 h-4.5 animate-spin text-sky-400" />
                        <span className="text-[10px] text-sky-300 font-mono uppercase tracking-wider">Sending secure voice note...</span>
                      </div>
                    )}

                    {isRecording ? (
                      <div className="flex-1 flex items-center justify-between bg-red-950/20 border border-red-500/20 rounded-xl px-4 py-2 transition-all">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-xs text-red-200 font-mono uppercase tracking-wider">
                            Voice Note: {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, "0")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={cancelRecording}
                            className="px-3 py-1.5 rounded-lg bg-[#0D111D] border border-white/[0.06] text-[#94A3B8] hover:text-white text-xs hover:border-red-500/30 transition-all cursor-pointer"
                          >
                            Discard
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              sendOnStopRef.current = true;
                              stopRecording();
                            }}
                            className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-bold transition-all cursor-pointer shadow-md shadow-red-500/20"
                          >
                            Stop & Send
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Image attachment button */}
                        <input
                          type="file"
                          accept="image/*"
                          ref={fileInputRef}
                          onChange={handleImageAttachment}
                          className="hidden"
                          id="img_upload_trigger"
                        />

                        {/* MOBILE: Floating + button with popup toolbar */}
                        <div className="relative sm:hidden shrink-0">
                          <button
                            type="button"
                            onClick={() => setShowMobileToolbar(!showMobileToolbar)}
                            className={`w-10 h-10 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer ${
                              showMobileToolbar
                                ? "bg-[#6C5CE0] text-white rotate-45 shadow-[0_0_16px_rgba(108, 92, 224,0.12)]"
                                : "bg-gradient-to-b from-white/[0.10] to-white/[0.02] border border-white/[0.14] text-[#94A3B8] hover:text-white"
                            }`}
                          >
                            <span className="text-lg font-light leading-none">+</span>
                          </button>

                          <AnimatePresence>
                            {showMobileToolbar && (
                              <>
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  className="fixed inset-0 z-40"
                                  onClick={() => setShowMobileToolbar(false)}
                                />
                                <motion.div
                                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: 10, scale: 0.9 }}
                                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                  className="absolute bottom-full left-0 mb-3 bg-[#12172A]/95 border border-white/10 rounded-2xl shadow-2xl p-3 backdrop-blur-xl z-50 min-w-[200px]"
                                >
                                  <div className="grid grid-cols-3 gap-2">
                                    <button
                                      type="button"
                                      disabled={isUploadingImage}
                                      onClick={() => {
                                        fileInputRef.current?.click();
                                        setShowMobileToolbar(false);
                                      }}
                                      className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                                    >
                                      {isUploadingImage ? (
                                        <Loader2 className="w-5 h-5 animate-spin text-[#94A3B8]" />
                                      ) : (
                                        <ImageIcon className="w-5 h-5 text-[#94A3B8]" />
                                      )}
                                      <span className="text-[9px] text-[#94A3B8] font-mono">Image</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (activeChatId) triggerBotResponse(activeChatId, "/bot");
                                        setShowMobileToolbar(false);
                                      }}
                                      className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                                    >
                                      <Bot className="w-5 h-5 text-[#94A3B8]" />
                                      <span className="text-[9px] text-[#94A3B8] font-mono">AI</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowPaymentModal(true);
                                        setShowDeployModal(false);
                                        setShowMobileToolbar(false);
                                      }}
                                      className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                                    >
                                      <Coins className="w-5 h-5 text-emerald-400" />
                                      <span className="text-[9px] text-[#94A3B8] font-mono">Pay</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowGifPicker(!showGifPicker);
                                        setShowStickerPicker(false);
                                        setShowMobileToolbar(false);
                                      }}
                                      className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                                    >
                                      <Sparkles className="w-5 h-5 text-sky-300" />
                                      <span className="text-[9px] text-[#94A3B8] font-mono">GIF</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowStickerPicker(!showStickerPicker);
                                        setShowGifPicker(false);
                                        setShowMobileToolbar(false);
                                      }}
                                      className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                                    >
                                      <Smile className="w-5 h-5 text-sky-200" />
                                      <span className="text-[9px] text-[#94A3B8] font-mono">Sticker</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowGifPicker(false);
                                        setShowStickerPicker(false);
                                        setShowMobileToolbar(false);
                                        startRecording();
                                      }}
                                      className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                                    >
                                      <Mic className="w-5 h-5 text-[#94A3B8]" />
                                      <span className="text-[9px] text-[#94A3B8] font-mono">Voice</span>
                                    </button>
                                  </div>
                                </motion.div>
                              </>
                            )}
                          </AnimatePresence>
                        </div>

                        {/* DESKTOP: Full inline toolbar */}
                        <div className="hidden sm:flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={isUploadingImage}
                            onClick={() => fileInputRef.current?.click()}
                            title="Attach image"
                            className="relative w-9 h-9 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center bg-gradient-to-b from-white/[0.10] to-white/[0.02] border border-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(0,0,0,0.35)] text-[#94A3B8] hover:text-white hover:from-white/[0.16] hover:to-white/[0.04] hover:border-white/25 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_14px_rgba(255,255,255,0.15)] hover:scale-[1.08] active:scale-95 transition-all duration-200 cursor-pointer disabled:opacity-50"
                          >
                            {isUploadingImage ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <ImageIcon className="w-[17px] h-[17px]" strokeWidth={2} />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              if (activeChatId) {
                                triggerBotResponse(activeChatId, "/bot");
                              }
                            }}
                            title="Chat with MAHI AI (MAHIX)"
                            className="relative w-9 h-9 rounded-full flex items-center justify-center bg-gradient-to-b from-[#6C5CE0]/25 to-[#6C5CE0]/[0.04] border border-[#6C5CE0]/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(0,0,0,0.35)] text-[#94A3B8] hover:text-[#94A3B8] hover:border-[#6C5CE0]/70 hover:from-[#6C5CE0]/40 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_16px_rgba(108, 92, 224,0.12)] hover:scale-[1.08] active:scale-95 transition-all duration-200 cursor-pointer"
                          >
                            <Bot className="w-[17px] h-[17px] animate-pulse" strokeWidth={2} />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setShowPaymentModal(true);
                              setShowDeployModal(false);
                            }}
                            title="Send Web3 Payment Token"
                            className="relative w-9 h-9 rounded-full flex items-center justify-center bg-gradient-to-b from-emerald-500/25 to-emerald-500/[0.04] border border-emerald-500/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(0,0,0,0.35)] text-emerald-300 hover:text-emerald-200 hover:border-emerald-400/70 hover:from-emerald-500/40 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_16px_rgba(34, 197, 94,0.45)] hover:scale-[1.08] active:scale-95 transition-all duration-200 cursor-pointer"
                          >
                            <Coins className="w-[17px] h-[17px]" strokeWidth={2} />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setShowGifPicker(!showGifPicker);
                              setShowStickerPicker(false);
                            }}
                            title="Send GIF"
                            className={`relative w-9 h-9 rounded-full flex items-center justify-center border text-[9.5px] font-extrabold font-mono tracking-tight transition-all duration-200 cursor-pointer active:scale-95 ${
                              showGifPicker
                                ? "bg-gradient-to-b from-[#6C5CE0]/45 to-[#6C5CE0]/20 border-[#6C5CE0]/70 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_16px_rgba(108, 92, 224,0.12)] scale-[1.08]"
                                : "bg-gradient-to-b from-[#6C5CE0]/20 to-[#6C5CE0]/[0.04] border-[#6C5CE0]/25 text-sky-200/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(0,0,0,0.35)] hover:text-white hover:border-[#6C5CE0]/70 hover:from-[#6C5CE0]/40 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_16px_rgba(108, 92, 224,0.12)] hover:scale-[1.08]"
                            }`}
                          >
                            GIF
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setShowStickerPicker(!showStickerPicker);
                              setShowGifPicker(false);
                            }}
                            title="Send sticker"
                            className={`relative w-9 h-9 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center border transition-all duration-200 cursor-pointer active:scale-95 ${
                              showStickerPicker
                                ? "bg-gradient-to-b from-[#6C5CE0]/45 to-[#6C5CE0]/20 border-[#6C5CE0]/70 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_16px_rgba(108, 92, 224,0.12)] scale-[1.08]"
                                : "bg-gradient-to-b from-[#6C5CE0]/20 to-[#6C5CE0]/[0.04] border-[#6C5CE0]/25 text-sky-200/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(0,0,0,0.35)] hover:text-white hover:border-[#6C5CE0]/70 hover:from-[#6C5CE0]/40 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_16px_rgba(108, 92, 224,0.12)] hover:scale-[1.08]"
                            }`}
                          >
                            <Smile className="w-[17px] h-[17px]" strokeWidth={2} />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setShowGifPicker(false);
                              setShowStickerPicker(false);
                              startRecording();
                            }}
                            title="Record voice note"
                            className="relative w-9 h-9 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center bg-gradient-to-b from-[#6C5CE0]/25 to-[#6C5CE0]/[0.04] border border-[#6C5CE0]/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(0,0,0,0.35)] text-[#94A3B8] hover:text-[#94A3B8] hover:border-[#6C5CE0]/70 hover:from-[#6C5CE0]/40 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_16px_rgba(108, 92, 224,0.12)] hover:scale-[1.08] active:scale-95 transition-all duration-200 cursor-pointer"
                          >
                            <Mic className="w-[17px] h-[17px]" strokeWidth={2} />
                          </button>
                        </div>

                        <input
                          id="chat-input-field"
                          type="text"
                          value={msgText}
                          onChange={(e) => {
                            setMsgText(e.target.value);
                            handleInputChange();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape" && editingMessage) {
                              setEditingMessage(null);
                              setMsgText("");
                            }
                          }}
                          placeholder={
                            isUploadingImage
                              ? "Uploading image..."
                              : editingMessage
                              ? "Edit message..."
                              : `Message @${activeChatFriend.username}...`
                          }
                            className="flex-1 min-w-0 h-12 bg-[#12172A] backdrop-blur-md border border-white/[0.08] rounded-full px-5 text-[14px] text-white placeholder:text-slate-400 focus:outline-none focus:border-[#6C5CE0]/60 focus:ring-1 focus:ring-[#6C5CE0]/20 transition-all duration-150"
                        disabled={isUploadingImage}
                         />

                        <button
                          type="submit"
                          disabled={!msgText.trim()}
                          title={editingMessage ? "Save edit" : "Send"}
                          className="relative w-14 h-14 min-w-[56px] min-h-[56px] rounded-full flex items-center justify-center bg-[#6C5CE0] border border-white/10 text-white hover:brightness-110 hover:scale-[1.02] active:scale-95 transition-all duration-150 disabled:opacity-40"
                        >
                          {editingMessage ? <Check className="w-5 h-5" /> : <Send className="w-5.5 h-5.5"/>}
                        </button>
                      </>
                    )}
                  </form>
                  </div>
                  )}
                </div>
              </motion.div>

              {/* Partner Details Sidebar (High Fidelity Flyout) */}
              <AnimatePresence>
                {showDetailsSidebar && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 320 }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ type: "spring", damping: 28, stiffness: 200 }}
                    className="border-l border-white/[0.06] bg-[#0D111D]/40 backdrop-blur-md h-full flex flex-col shrink-0 overflow-y-auto max-sm:absolute max-sm:right-0 max-sm:top-0 max-sm:bottom-0 max-sm:z-20 max-sm:w-72 max-sm:bg-[#0D111D]/95 max-sm:backdrop-blur-xl"
                    id="partner_sidebar_panel"
                  >
                    {/* Sidebar Header */}
                    <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
                      <span className="text-[10px] text-[#94A3B8] font-bold uppercase tracking-widest flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-[#6C5CE0]" />
                        Chat Profile details
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowDetailsSidebar(false)}
                        className="p-1 rounded hover:bg-[#12172A] text-[#6C5CE0] hover:text-[#94A3B8] transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="p-4 space-y-4">
                      {/* PROFILE HEADER (large centered avatar + name + username + status) */}
                      <div className="flex flex-col items-center text-center pt-2 pb-1">
                        <div className="relative shrink-0">
                          <img
                            src={activeChatFriend.avatarUrl}
                            alt={activeChatFriend.displayName}
                            referrerPolicy="no-referrer"
                            className="w-28 h-28 rounded-full bg-[#0B0F17] border-2 border-[#6C5CE0]/30 object-cover shadow-[0_0_30px_rgba(108, 92, 224,0.12)]"
                          />
                          <span
                            className={`absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full border-2 border-white/[0.06] ${
                              activeChatFriend.status === "online" ? "bg-emerald-500 animate-pulse" : "bg-gray-500"
                            }`}
                          />
                        </div>
                        <h3 className="text-lg font-black text-[#F8FAFC] mt-3 truncate max-w-full">
                          {activeChatFriend.displayName}
                        </h3>
                        <span
                          onClick={() => {
                            navigator.clipboard.writeText(`@${activeChatFriend.username}`);
                            showToast(`Copied username @${activeChatFriend.username}`, "success");
                          }}
                          className="text-xs text-[#6C5CE0] font-mono cursor-pointer hover:underline transition-all truncate max-w-full"
                          title="Click to copy username"
                        >
                          @{activeChatFriend.username}
                        </span>
                        <span
                          className={`text-[10px] font-mono uppercase tracking-wider font-semibold flex items-center gap-1.5 mt-1 ${
                            activeChatFriend.status === "online" ? "text-emerald-400" : "text-gray-400"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${activeChatFriend.status === "online" ? "bg-emerald-500" : "bg-gray-500"}`} />
                          {activeChatFriend.status === "online" ? "Active" : "Offline"}
                        </span>

                        {!canInteractWith(activeChatFriend.uid) && (
                          <span className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-[9px] font-semibold text-red-300 font-mono uppercase tracking-wider">
                            <ShieldOff className="w-3 h-3" />
                            {blockedBy(activeChatFriend.uid)
                              ? "You have been blocked by this user."
                              : "You blocked this user."}
                          </span>
                        )}
                      </div>

                      {/* Quick Actions (Mute / Pay / Block) */}
                      <div className="space-y-2">
                        <span className="text-[9px] text-[#6C5CE0] font-bold uppercase tracking-wider block">
                          Quick Actions
                        </span>
                        <div className="flex items-center justify-center gap-3">
                          {/* Mute */}
                          <div className="relative group">
                            <button
                              type="button"
                              onClick={() => handleToggleMuteChat(activeChatId, activeChatFriend.displayName)}
                              className={`w-11 h-11 rounded-xl flex items-center justify-center border transition-all duration-200 cursor-pointer hover:scale-[1.05] active:scale-95 ${
                                mutedChatIds.includes(activeChatId)
                                  ? "bg-[#12172A]/80 border-white/[0.14] text-white"
                                  : "bg-[#0B0F17]/60 border-white/[0.08] text-[#94A3B8] hover:text-white hover:bg-[#12172A]/80 hover:border-white/[0.14]"
                              }`}
                            >
                              {mutedChatIds.includes(activeChatId) ? (
                                <BellOff className="w-[18px] h-[18px]" strokeWidth={2} />
                              ) : (
                                <Bell className="w-[18px] h-[18px]" strokeWidth={2} />
                              )}
                            </button>
                            <span className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-[#0D111D] border border-white/10 text-[9px] text-white font-medium whitespace-nowrap opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 shadow-xl z-20">
                              Mute Conversation
                            </span>
                          </div>

                          {/* Pay — opens the Arc USDC payment popup */}
                          <div className="relative group">
                            <button
                              type="button"
                              onClick={() => handleOpenUsdcPayment()}
                              disabled={!canInteractWith(activeChatFriend.uid)}
                              className={`w-11 h-11 rounded-xl flex items-center justify-center border transition-all duration-200 ${
                                canInteractWith(activeChatFriend.uid)
                                  ? "border-white/[0.08] bg-[#0B0F17]/60 text-[#94A3B8] hover:text-white hover:bg-[#12172A]/80 hover:border-white/[0.14] hover:scale-[1.05] active:scale-95 cursor-pointer"
                                  : "border-white/[0.04] bg-[#0B0F17]/40 text-[#334155] opacity-40 pointer-events-none"
                              }`}
                            >
                              <Coins className="w-[18px] h-[18px]" strokeWidth={2} />
                            </button>
                            <span className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-[#0D111D] border border-white/10 text-[9px] text-white font-medium whitespace-nowrap opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 shadow-xl z-20">
                              Send USDC
                            </span>
                          </div>

                          {/* Block / Unblock — toggles the blocked state for this user */}
                          <div className="relative group">
                            <button
                              type="button"
                              onClick={() => handleToggleBlockUser(activeChatFriend.uid, activeChatFriend.displayName)}
                              className={`w-11 h-11 rounded-xl flex items-center justify-center border transition-all duration-200 cursor-pointer hover:scale-[1.05] active:scale-95 ${
                                blockedUids.includes(activeChatFriend.uid)
                                  ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40"
                                  : "bg-[#0B0F17]/60 border-white/[0.08] text-[#94A3B8] hover:text-white hover:bg-[#12172A]/80 hover:border-white/[0.14]"
                              }`}
                            >
                              {blockedUids.includes(activeChatFriend.uid) ? (
                                <ShieldCheck className="w-[18px] h-[18px]" strokeWidth={2} />
                              ) : (
                                <ShieldOff className="w-[18px] h-[18px]" strokeWidth={2} />
                              )}
                            </button>
                            <span className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-[#0D111D] border border-white/10 text-[9px] text-white font-medium whitespace-nowrap opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 shadow-xl z-20">
                              {blockedUids.includes(activeChatFriend.uid) ? "Unblock User" : "Block User"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Bio status section */}
                      <div className="space-y-1.5">
                        <span className="text-[9px] text-[#6C5CE0] font-bold uppercase tracking-wider block">
                          Personal Bio
                        </span>
                        <div className="p-3 bg-[#0B0F17]/40 border border-white/[0.06] rounded-xl relative overflow-hidden">
                          <p className="text-xs text-[#94A3B8] leading-normal font-sans italic whitespace-pre-wrap">
                            {activeChatFriend.bio || "No custom status bio provided yet."}
                          </p>
                        </div>
                      </div>

                      {/* Social Integrations */}
                      <div className="space-y-2">
                        <span className="text-[9px] text-[#6C5CE0] font-bold uppercase tracking-wider block">
                          Verified Links
                        </span>

                        <div className="space-y-1.5">
                          {activeChatFriend.githubUrl ? (
                            <a
                              href={`https://github.com/${activeChatFriend.githubUrl}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center justify-between p-2.5 bg-[#0B0F17] hover:bg-[#0D111D] border border-white/[0.06] hover:border-white/[0.06] rounded-xl text-[#94A3B8] hover:text-white transition-all group cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                <Github className="w-4 h-4 text-[#6C5CE0] group-hover:text-[#94A3B8]" />
                                <span className="text-[11px] font-mono">{activeChatFriend.githubUrl}</span>
                              </div>
                              <ExternalLink className="w-3 h-3 text-[#6C5CE0]" />
                            </a>
                          ) : (
                            <div className="p-2.5 bg-[#0B0F17]/30 border border-white/[0.06] border-dashed rounded-xl text-center">
                              <span className="text-[10px] text-[#6C5CE0] italic">No GitHub account linked</span>
                            </div>
                          )}

                          {activeChatFriend.twitterUrl ? (
                            <a
                              href={`https://twitter.com/${activeChatFriend.twitterUrl.replace('@', '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center justify-between p-2.5 bg-[#0B0F17] hover:bg-[#0D111D] border border-white/[0.06] hover:border-white/[0.06] rounded-xl text-[#94A3B8] hover:text-white transition-all group cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                <Twitter className="w-4 h-4 text-[#6C5CE0] group-hover:text-[#94A3B8]" />
                                <span className="text-[11px] font-mono">{activeChatFriend.twitterUrl}</span>
                              </div>
                              <ExternalLink className="w-3 h-3 text-[#6C5CE0]" />
                            </a>
                          ) : (
                            <div className="p-2.5 bg-[#0B0F17]/30 border border-white/[0.06] border-dashed rounded-xl text-center">
                              <span className="text-[10px] text-[#6C5CE0] italic">No Twitter address linked</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Cryptocurrency address card */}
                      {activeChatFriend.walletAddress && (
                        <div className="space-y-1.5">
                          <span className="text-[9px] text-[#6C5CE0] font-bold uppercase tracking-wider block">
                            Cryptocurrency Wallet
                          </span>
                          <div className="bg-[#0B0F17]/60 p-3 border border-white/[0.06] rounded-xl">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-[9px] text-[#94A3B8] font-mono select-all truncate">
                                {activeChatFriend.walletAddress}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(activeChatFriend.walletAddress || "");
                                  showToast("Wallet address copied safely to clipboard!", "success");
                                }}
                                className="p-1 rounded bg-[#0B0F17] hover:bg-[#12172A] text-[#94A3B8] hover:text-white border border-white/[0.06] transition-colors cursor-pointer shrink-0"
                                title="Copy address"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <span className="text-[8px] text-[#6C5CE0] font-bold block mt-1 uppercase tracking-wider">
                              Solana / Ethereum / EVM Address
                            </span>
                          </div>
                        </div>
                      )}

                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <InboxWelcome displayName={userProfile?.displayName || ""} />
          )}
        </AnimatePresence>
      </div>

      {/* Fullscreen Image Viewer */}
      <AnimatePresence>
        {fullscreenImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setFullscreenImage(null)}
            className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex items-center justify-center p-4"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFullscreenImage(null);
              }}
              className="absolute top-4 left-4 z-[210] p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
              aria-label="Close"
            >
              <X className="w-6 h-6" />
            </button>
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              src={fullscreenImage}
              alt="Fullscreen preview"
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full object-contain select-none"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dynamic Non-Blocking Premium Toast */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 right-6 z-[100] max-w-sm w-full bg-[#0D111D]/95 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-4 shadow-2xl flex items-center justify-between gap-3 text-sm select-none pointer-events-auto hover:border-white/[0.06] transition"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                toastMsg.type === "success" ? "bg-emerald-500 shadow-[0_0_8px_rgba(34, 197, 94,0.6)] animate-pulse" :
                toastMsg.type === "error" ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" :
                "bg-blue-500 shadow-[0_0_8px_rgba(108, 92, 224,0.12)]"
              }`} />
              <p className="text-xs font-semibold text-[#F8FAFC] truncate">
                {toastMsg.text}
              </p>
            </div>
            <button
              onClick={() => setToastMsg(null)}
              className="text-[#6C5CE0] hover:text-[#94A3B8] p-0.5 rounded transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Agent Deployment Modal overlay */}
      <AnimatePresence>
        {showDeployModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!isDeploying) setShowDeployModal(false);
              }}
              className="absolute inset-0 bg-[#0B0F17]/85 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-[#0D111D]/95 border border-[#6C5CE0]/45 rounded-3xl w-full max-w-lg p-6 shadow-2xl relative z-10 overflow-hidden backdrop-blur-xl"
            >
              {/* Card headers */}
              <div className="flex items-start justify-between border-b border-white/5 pb-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-[#6C5CE0]/10 border border-[#6C5CE0]/20 text-sky-400">
                    <Bot className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black tracking-widest font-mono text-white uppercase">SHARD AGENT DEPLOYER</h3>
                    <p className="text-[10px] text-sky-300/60 font-mono mt-0.5">Deploy customized smart agents directly to ORE clusters</p>
                  </div>
                </div>
                {!isDeploying && (
                  <button
                    onClick={() => setShowDeployModal(false)}
                    className="p-1.5 rounded-lg border border-white/5 text-[#94A3B8] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Wallet node balance card */}
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/5 mb-5 select-none">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-sky-400" />
                  <span className="text-[10px] font-bold font-mono text-[#94A3B8]">NODE ACTIVE WALLET</span>
                </div>
                <span className="text-xs font-black font-mono text-white">{walletBalance} SOL</span>
              </div>

              {/* Deployment Loading state / Live console logs */}
              {isDeploying ? (
                <div className="space-y-4 py-2">
                  <div className="flex flex-col items-center justify-center py-4 gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
                    <span className="text-xs font-black font-mono text-sky-400 tracking-widest uppercase animate-pulse">PROVISIONING SECURE NODE SHARDS...</span>
                  </div>

                  {/* Terminal emulator container */}
                  <div className="bg-black/80 border border-white/5 rounded-xl p-3.5 h-48 overflow-y-auto font-mono text-[9px] text-[#94A3B8] space-y-1.5 custom-scrollbar">
                    {deploymentLogs.map((log, lIdx) => {
                      const isHeader = log.startsWith("▶") || log.startsWith("✓");
                      return (
                        <div key={lIdx} className={`${isHeader ? "text-sky-400 font-bold" : "text-[#94A3B8]"} leading-relaxed`}>
                          {log}
                        </div>
                      );
                    })}
                    <span className="inline-block w-1.5 h-3 bg-sky-400 animate-pulse ml-1" />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Name field */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black font-mono tracking-widest text-[#94A3B8] uppercase">Agent Identifier</label>
                    <input
                      type="text"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#6C5CE0]/50 focus:ring-1 focus:ring-[#6C5CE0]/30 transition-all font-mono"
                      placeholder="e.g. Arb Miner Node"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Model drop down selector */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-black font-mono tracking-widest text-[#94A3B8] uppercase">Model Core Architecture</label>
                      <select
                        value={agentModel}
                        onChange={(e) => setAgentModel(e.target.value)}
                        className="w-full bg-[#0D111D] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#6C5CE0]/50 transition-all font-mono cursor-pointer"
                      >
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        <option value="gemma-2-9b">Gemma-2 9B</option>
                      </select>
                    </div>

                    {/* Funding amount input */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-black font-mono tracking-widest text-[#94A3B8] uppercase">Shard Funding Escrow (SOL)</label>
                      <input
                        type="number"
                        step="0.05"
                        min="0.05"
                        max={parseFloat(walletBalance)}
                        value={agentFunding}
                        onChange={(e) => setAgentFunding(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#6C5CE0]/50 transition-all font-mono"
                      />
                    </div>
                  </div>

                  {/* Directive field */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black font-mono tracking-widest text-[#94A3B8] uppercase">Node Target Directives</label>
                    <textarea
                      value={agentDirective}
                      onChange={(e) => setAgentDirective(e.target.value)}
                      rows={3}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-[#6C5CE0] focus:outline-none focus:border-[#6C5CE0]/50 transition-all font-sans resize-none leading-relaxed"
                      placeholder="Specify strict operational rules or AI intelligence directives..."
                    />
                  </div>

                  {/* Operational Warnings */}
                  <p className="text-[8.5px] text-sky-300/40 font-mono leading-relaxed bg-[#12172A]/45 p-3 rounded-xl border border-white/5">
                    <span className="font-bold text-sky-300 uppercase tracking-widest block mb-0.5">⚠️ DEPLOYMENT LEDGER NOTICE</span>
                    Deploying this customized AI proxy will immediately transfer and secure your selected SOL amount in an escrow smart contract on-chain. Disassembling active proxies will release the remaining shard credits to your node.
                  </p>

                  {/* Action triggers */}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowDeployModal(false)}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-[#0D111D] border border-white/[0.06] hover:border-neutral-500 text-[#94A3B8] hover:text-white text-xs font-bold transition-all cursor-pointer"
                    >
                      ABORT
                    </button>
                    <button
                      type="button"
                      onClick={executeAgentDeployment}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#6C5CE0] to-[#6C5CE0] text-white hover:brightness-110 shadow-lg shadow-[#6C5CE0]/15 text-xs font-black font-mono tracking-widest uppercase transition-all cursor-pointer"
                    >
                      LAUNCH PROVISION
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Arc USDC Send USDC payment popup (Chat Profile Details -> Pay) */}
      <SendUsdcModal
        open={showUsdcPaymentModal}
        senderProfile={userProfile}
        senderWallet={
          circleWallet.status === "linked"
            ? circleWallet.address
            : userProfile?.circleWalletAddress ?? null
        }
        recipient={activeChatFriend}
        chatId={activeChatId}
        onClose={() => setShowUsdcPaymentModal(false)}
        onPaymentSuccess={handleUsdcPaymentSuccess}
      />

      {/* Block / Unblock confirmation modal (Chat Profile Details -> Block) */}
      <BlockUserModal
        open={blockConfirmOpen}
        mode={blockConfirmMode}
        displayName={blockConfirmTarget?.displayName || ""}
        onCancel={() => {
          setBlockConfirmOpen(false);
          setBlockConfirmTarget(null);
        }}
        onConfirm={handleConfirmBlockAction}
      />

      {/* Web3 Secure Payment Modal overlay */}
      <AnimatePresence>
        {showPaymentModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!isPaying) setShowPaymentModal(false);
              }}
              className="absolute inset-0 bg-[#0B0F17]/85 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-[#0B0F17]/95 border border-emerald-500/40 rounded-3xl w-full max-w-md p-6 shadow-2xl relative z-10 overflow-hidden backdrop-blur-xl"
            >
              {/* Card headers */}
              <div className="flex items-start justify-between border-b border-white/5 pb-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <Coins className="w-5 h-5 animate-bounce" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black tracking-widest font-mono text-emerald-400 uppercase">SECURE PAYMENT DISPATCH</h3>
                    <p className="text-[10px] text-[#6C5CE0] font-mono mt-0.5">Settle instant off-grid smart contract transactions</p>
                  </div>
                </div>
                {!isPaying && (
                  <button
                    onClick={() => setShowPaymentModal(false)}
                    className="p-1.5 rounded-lg border border-white/5 text-[#94A3B8] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Wallet node balance card */}
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/5 mb-5 select-none">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-400" />
                  <span className="text-[10px] font-bold font-mono text-[#94A3B8]">NODE ACTIVE WALLET</span>
                </div>
                <span className="text-xs font-black font-mono text-white">{walletBalance} SOL</span>
              </div>

              {/* Secure Web3 Transaction step processor */}
              {isPaying ? (
                <div className="py-6 space-y-6">
                  <div className="flex flex-col items-center justify-center gap-2.5">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                    <span className="text-xs font-black font-mono text-emerald-400 tracking-widest uppercase animate-pulse">EXECUTING PROTOCOL FLOW...</span>
                  </div>

                  {/* Transaction Steps indicators */}
                  <div className="space-y-3 font-mono text-[10px] px-2 bg-black/40 p-4 rounded-2xl border border-white/5">
                    <div className="flex items-center justify-between">
                      <span className="text-[#6C5CE0]">1. SECURE EPHEMERAL SIGNATURE</span>
                      <span className={paymentStep >= 1 ? "text-emerald-400 font-bold" : "text-[#6C5CE0]"}>
                        {paymentStep === 1 ? "PROCESSING..." : paymentStep > 1 ? "✓ COMPLETED" : "PENDING..."}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#6C5CE0]">2. BROADCASTING TO ORE RPC NODES</span>
                      <span className={paymentStep >= 2 ? "text-emerald-400 font-bold" : "text-[#6C5CE0]"}>
                        {paymentStep === 2 ? "PROCESSING..." : paymentStep > 2 ? "✓ COMPLETED" : "PENDING..."}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#6C5CE0]">3. MEMPOOL BLOCK CONFIRMATION</span>
                      <span className={paymentStep >= 3 ? "text-emerald-400 font-bold animate-pulse" : "text-[#6C5CE0]"}>
                        {paymentStep === 3 ? "CONFIRMING..." : "PENDING..."}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Recipient Field */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black font-mono tracking-widest text-[#94A3B8] uppercase">Recipient Peer Node</label>
                    <input
                      type="text"
                      disabled
                      value={paymentRecipient}
                      className="w-full bg-black/30 border border-white/5 rounded-xl px-3.5 py-2.5 text-xs text-[#94A3B8] font-mono cursor-not-allowed"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Amount Input */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-black font-mono tracking-widest text-[#94A3B8] uppercase">Transfer Amount (SOL)</label>
                      <input
                        type="number"
                        step="0.05"
                        min="0.01"
                        max={parseFloat(walletBalance)}
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50 transition-all font-mono"
                      />
                    </div>

                    {/* Transaction speed selector */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-black font-mono tracking-widest text-[#94A3B8] uppercase">Mempool Priority</label>
                      <select
                        value={paymentSpeed}
                        onChange={(e) => setPaymentSpeed(e.target.value)}
                        className="w-full bg-[#0B0F17] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50 transition-all font-mono cursor-pointer"
                      >
                        <option value="standard">Standard Fee</option>
                        <option value="fast">Priority Fee</option>
                        <option value="instant">Instant (Turbo)</option>
                      </select>
                    </div>
                  </div>

                  {/* Memo description field */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black font-mono tracking-widest text-[#94A3B8] uppercase">Secure Memo Reference</label>
                    <input
                      type="text"
                      value={paymentMemo}
                      onChange={(e) => setPaymentMemo(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50 transition-all font-sans"
                      placeholder="e.g. Services fee or node cluster sync fee"
                    />
                  </div>

                  {/* Security stamp warning footer */}
                  <div className="flex gap-2 p-2.5 bg-emerald-500/5 rounded-xl border border-emerald-500/10 text-[8.5px] text-emerald-400/60 font-mono leading-relaxed select-none">
                    <Shield className="w-4 h-4 shrink-0 text-emerald-400 animate-pulse mt-0.5" />
                    <div>
                      <span className="font-bold text-emerald-400 uppercase block">CRYPTOGRAPHIC COMPLIANCE</span>
                      Transactions are irreversible. Secure private nodes maintain end-to-end consensus. Double check receipt address before dispatching funds.
                    </div>
                  </div>

                  {/* Action triggers */}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowPaymentModal(false)}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-[#0D111D] border border-white/[0.06] hover:border-neutral-500 text-[#94A3B8] hover:text-white text-xs font-bold transition-all cursor-pointer"
                    >
                      ABORT
                    </button>
                    <button
                      type="button"
                      onClick={executeWeb3Payment}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 shadow-lg shadow-emerald-500/15 text-xs font-black font-mono tracking-widest uppercase transition-all cursor-pointer"
                    >
                      DISPATCH FUNDS
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
