export type UserStatus = "online" | "offline";

export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  status: UserStatus;
  lastActive: Date | string;
  createdAt: Date | string;
  walletAddress?: string;
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
