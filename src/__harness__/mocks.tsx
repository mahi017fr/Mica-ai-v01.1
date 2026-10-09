/**
 * TEMPORARY layout test harness — NOT part of the app.
 * vite.harness.config.ts aliases the real context modules onto this file so
 * ChatDashboard can be rendered without Firebase/auth. Deleted after testing.
 */
import { useSyncExternalStore } from "react";
import type { ChatMessage, ChatSession, FriendRequest, UserProfile } from "../types";

const AV = (seed: string) => `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;

const ME: UserProfile = {
  uid: "me",
  username: "mica_tester",
  displayName: "Mica Tester",
  avatarUrl: AV("mica"),
  status: "online",
  lastActive: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  onboardingCompleted: true,
  walletAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  bio: "Layout QA account",
  moodEmoji: "\u2728",
  githubUrl: "mica",
  twitterUrl: "@mica",
};

const FRIEND_A: UserProfile = {
  uid: "fa",
  username: "sarah_dev",
  displayName: "Sarah Connor",
  avatarUrl: AV("sarah"),
  status: "online",
  lastActive: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  walletAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA11Ybv2H38AAAA",
  bio: "Building things. Coffee first, standups later.",
};

const FRIEND_B: UserProfile = {
  uid: "fb",
  username: "arjun.k",
  displayName: "Arjun Kapoor",
  avatarUrl: AV("arjun"),
  status: "offline",
  lastActive: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  bio: "Deal room regular.",
};

const FRIEND_C: UserProfile = {
  uid: "fc",
  username: "nova_ai",
  displayName: "Nova",
  avatarUrl: AV("nova"),
  status: "online",
  lastActive: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const FRIENDS = [FRIEND_A, FRIEND_B, FRIEND_C];

const chatIdFor = (uid: string) => ["me", uid].sort().join("_");

const LONG_URL =
  "https://mica.example.com/dealroom/transactions/0x9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a?ref=super_long_query_parameter_that_wraps";

const MESSAGES: Record<string, ChatMessage[]> = FRIENDS.reduce((acc, f) => {
  const id = chatIdFor(f.uid);
  acc[id] = [
    {
      id: `${id}_1`,
      senderId: f.uid,
      senderUsername: f.username,
      text: "Hey! Are you around for the deal room call in a bit?",
      timestamp: new Date(Date.now() - 3600_000).toISOString(),
      seen: true,
    },
    {
      id: `${id}_2`,
      senderId: "me",
      senderUsername: ME.username,
      text: "Yes — finishing the escrow paperwork now, will join in five.",
      timestamp: new Date(Date.now() - 3500_000).toISOString(),
      seen: true,
    },
    {
      id: `${id}_3`,
      senderId: f.uid,
      senderUsername: f.username,
      text: LONG_URL,
      timestamp: new Date(Date.now() - 3400_000).toISOString(),
      seen: true,
    },
    {
      id: `${id}_4`,
      senderId: f.uid,
      senderUsername: f.username,
      text: "Also dropping the payment receipt below.",
      timestamp: new Date(Date.now() - 3300_000).toISOString(),
      seen: true,
      replyTo: {
        id: `${id}_2`,
        senderUsername: ME.username,
        text: "Yes — finishing the escrow paperwork now, will join in five.",
      },
    },
    {
      id: `${id}_5`,
      senderId: "me",
      senderUsername: ME.username,
      text: "\ud83d\udcb2 Sent 12.50 USDC",
      timestamp: new Date(Date.now() - 3200_000).toISOString(),
      seen: true,
      payment: {
        amount: 12.5,
        asset: "USDC",
        network: "Arc",
        recipientUsername: f.username,
        direction: "sent",
        status: "confirmed",
      },
    },
    {
      id: `${id}_6`,
      senderId: "me",
      senderUsername: ME.username,
      text: "\ud83d\udcde Voice note \u00b7 0:42",
      timestamp: new Date(Date.now() - 3100_000).toISOString(),
      seen: true,
      callLog: {
        type: "audio",
        status: "ended",
        durationSecs: 252,
        peerName: f.displayName,
      },
    },
    {
      id: `${id}_7`,
      senderId: f.uid,
      senderUsername: f.username,
      text: "Perfect. Bring the wallet address too so we can settle on-chain right after.",
      timestamp: new Date(Date.now() - 3000_000).toISOString(),
      seen: true,
    },
  ];
  return acc;
}, {} as Record<string, ChatMessage[]>);

const CHAT_SESSIONS: Record<string, ChatSession> = FRIENDS.reduce((acc, f) => {
  const id = chatIdFor(f.uid);
  acc[id] = {
    id,
    participants: ["me", f.uid],
    lastMessage: "Perfect. Bring the wallet address too...",
    lastMessageAt: new Date(Date.now() - 3000_000).toISOString(),
  };
  return acc;
}, {} as Record<string, ChatSession>);

const FRIEND_REQUESTS: FriendRequest[] = [];

type HarnessState = {
  activeChatId: string | null;
  activeChatFriend: UserProfile | null;
  activeChatMessages: ChatMessage[];
  isFriendTyping: boolean;
  friendDelay: number;
};

const params =
  typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
const FRIEND_DELAY = Number(params.get("fd") ?? "0");

let state: HarnessState = {
  activeChatId: null,
  activeChatFriend: null,
  activeChatMessages: [],
  isFriendTyping: false,
  friendDelay: FRIEND_DELAY,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

let resolveTimer: ReturnType<typeof setTimeout> | null = null;

function selectChat(chatId: string | null) {
  if (resolveTimer) {
    clearTimeout(resolveTimer);
    resolveTimer = null;
  }
  if (!chatId) {
    state = { ...state, activeChatId: null, activeChatFriend: null, activeChatMessages: [] };
    emit();
    return;
  }
  // Clear immediately — mirrors the real context clearing the previous peer
  // profile, then resolve the new one after `friendDelay` (Firestore latency).
  state = { ...state, activeChatId: chatId, activeChatFriend: null, activeChatMessages: [] };
  emit();
  const peerId = chatId.split("_").find((id) => id !== "me");
  const friend = FRIENDS.find((f) => f.uid === peerId) || null;
  resolveTimer = setTimeout(() => {
    resolveTimer = null;
    state = {
      ...state,
      activeChatFriend: friend,
      activeChatMessages: MESSAGES[chatId] || [],
    };
    emit();
  }, state.friendDelay);
}

const noopAsync = async () => {};
const noop = () => {};

function useHarnessState(): HarnessState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  );
}

export const useChat = (): any => {
  const s = useHarnessState();
  return {
    currentUser: ME,
    userProfile: ME,
    friends: FRIENDS,
    friendRequests: FRIEND_REQUESTS,
    activeChatId: s.activeChatId,
    activeChatFriend: s.activeChatFriend,
    activeChatMessages: s.activeChatMessages,
    isFriendTyping: s.isFriendTyping,
    appNotifications: [],
    chatSessions: CHAT_SESSIONS,
    circleWallet: null,
    setActiveChatId: selectChat,
    updateProfile: noopAsync,
    searchUsers: async () => [],
    sendFriendRequest: noopAsync,
    acceptFriendRequest: noopAsync,
    declineFriendRequest: noopAsync,
    sendMessage: noopAsync,
    toggleReaction: noopAsync,
    deleteMessage: noopAsync,
    editMessage: noopAsync,
    uploadImage: noopAsync,
    logout: noop,
    completeOnboarding: noopAsync,
    updatePrimaryWallet: noopAsync,
    logPaymentMessage: noopAsync,
    logBdtTransfer: noopAsync,
    dismissNotification: noopAsync,
    setTypingStatus: noopAsync,
    triggerBotResponse: noopAsync,
    unfriendUser: noopAsync,
    setChatMessages: noop,
  };
};

export const ChatProvider = ({ children }: { children: any }) => children;

export const useCall = (): any => ({
  startCall: noop,
  endCall: noop,
  answerCall: noop,
  declineCall: noop,
  isInCall: false,
  currentCall: null,
  callHistory: [],
});

export const CallProvider = ({ children }: { children: any }) => children;

export const useBlock = (): any => ({
  blockedUids: [],
  blockedByUids: [],
  iBlocked: () => false,
  blockedBy: () => false,
  canInteractWith: () => true,
  blockUser: noopAsync,
  unblockUser: noopAsync,
  setBlockedUids: noop,
  setBlockedByUids: noop,
});

export const BlockProvider = ({ children }: { children: any }) => children;

export const useAppCurrency = (): any => ({
  isBdtMode: false,
  currency: "USD",
  setCurrency: noop,
  symbol: "$",
  formatMoney: (n: number) => `$${Number(n).toFixed(2)}`,
});

export const CURRENCY_OPTIONS: any = [{ value: "USD" }, { value: "BDT" }];
export const fmtBdt = (n: number) => `\u09f3${Number(n).toFixed(2)}`;
export const CurrencyProvider = ({ children }: { children: any }) => children;

export const usePrimaryWallet = (): any => ({
  primaryWallet: null,
  privyUserId: null,
  connecting: false,
  connectWallet: noopAsync,
});

export type VerifiedWallet = any;
