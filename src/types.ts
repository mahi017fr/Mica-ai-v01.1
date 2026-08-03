export type UserStatus = "online" | "offline";

export type AuthProvider = "google" | "email" | "wallet";

export type WalletStatus = "active" | "revoked" | "pending";

export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  status: UserStatus;
  lastActive: Date | string;
  createdAt: Date | string;
  // Primary wallet — ALWAYS derived from Privy's verified user object, never from manual input.
  walletAddress?: string;
  walletProvider?: string;
  walletLinkedAt?: string;
  walletVerified?: boolean;
  walletStatus?: WalletStatus;
  authProvider?: AuthProvider;
  privyUserId?: string;
  // Available Arc USDC balance (Circle USDC). Server/Arc managed — never
  // client-writable; read-only for the payment UI.
  usdcBalance?: number;
  pushToken?: string;
  onboardingCompleted?: boolean;
  bio?: string;
  moodEmoji?: string;
  githubUrl?: string;
  twitterUrl?: string;
  dndMode?: boolean;
}

export interface FriendRequest {
  id: string; // senderId_receiverId
  senderId: string;
  senderUsername: string;
  receiverId: string;
  receiverUsername: string;
  status: "pending" | "accepted" | "declined";
  timestamp: any; // Firestore Timestamp
}

export interface ChatSession {
  id: string; // uid1_uid2 alphabetically
  participants: string[];
  lastMessage?: string;
  lastMessageAt?: any; // Firestore Timestamp
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderUsername: string;
  text: string;
  imageUrl?: string;
  audioUrl?: string;
  isSticker?: boolean;
  seen?: boolean;
  timestamp: any; // Firestore Timestamp
  edited?: boolean;
  editedAt?: any; // Firestore Timestamp
  reactions?: Record<string, string[]>; // emoji -> array of userIds
  isSystem?: boolean; // system-generated message (e.g. payments) — rendered as a pill, not a bubble
  payment?: {
    amount: number;
    asset: string;
    network: string;
    recipientUsername: string;
    direction: "sent" | "received";
    status: string;
    transactionHash?: string;
  };
  replyTo?: {
    id: string;
    senderUsername: string;
    text: string;
  };
  callLog?: {
    type: "audio" | "video";
    status: "ended" | "missed" | "declined" | "busy" | "cancelled" | "failed" | string;
    durationSecs: number;
    peerName: string;
  };
}

export interface BlockRecord {
  id: string; // blockerUid_blockedUid (canonical, deterministic for rules)
  blockerUid: string;
  blockedUid: string;
  blockedAt: any; // Firestore Timestamp
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: "message" | "friend_request" | "system" | "deal_room_invite";
  timestamp: Date;
  senderName?: string;
  senderAvatar?: string;
  chatId?: string;
  dealRoomId?: string;
}

export interface DealRoomDoc {
  id: string;
  title: string;
  createdBy: string;
  createdAt: any;
  expiresAt: any;
  status: "active" | "expired" | "read_only";
  participants: string[];
  invitees: string[];
  dealSummary?: string;
  selectedRoles?: Record<string, "buyer" | "seller">;
}

export interface DealRoomMessage {
  id: string;
  senderId: string;
  senderUsername: string;
  text: string;
  imageUrl?: string;
  timestamp: any;
  isSystem?: boolean;
  /** Interactive Mica system-card type rendered with inline actions. */
  prompt?: string;
}

export interface DealRoomInvitation {
  id: string;
  dealRoomId: string;
  dealRoomTitle: string;
  invitedUserId: string;
  invitedByUsername: string;
  invitedBy: string;
  status: "pending" | "accepted" | "declined";
  createdAt: any;
}
