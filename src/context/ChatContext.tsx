import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { auth, db, handleFirestoreError, OperationType } from "../firebase";
import {
  onSnapshot,
  doc,
  collection,
  query,
  where,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  addDoc,
  serverTimestamp,
  orderBy,
  deleteDoc,
  limit,
} from "firebase/firestore";
import { UserProfile, FriendRequest, ChatSession, ChatMessage, AppNotification, AuthProvider } from "../types";
import { VerifiedWallet } from "../hooks/usePrimaryWallet";
import { isUserBlocked, getBlockMessage } from "../utils/blocking";
import { usePrivy } from "@privy-io/react-auth";
import {
  useCircleWalletSession,
  type CircleWalletSession,
  type CircleEip1193Provider,
} from "../circle";
import { ensureServerWallet } from "../api/wallet";

interface ChatContextType {
  currentUser: any;
  userProfile: UserProfile | null;
  friends: UserProfile[];
  friendRequests: FriendRequest[];
  activeChatId: string | null;
  activeChatFriend: UserProfile | null;
  activeChatMessages: ChatMessage[];
  appNotifications: AppNotification[];
  chatSessions: Record<string, ChatSession>;
  setActiveChatId: (chatId: string | null) => void;
  updateProfile: (updates: {
    displayName: string;
    avatarUrl: string;
    bio?: string;
    moodEmoji?: string;
    githubUrl?: string;
    twitterUrl?: string;
    dndMode?: boolean;
  }) => Promise<void>;
  completeOnboarding: (
    username: string,
    displayName: string,
    avatarUrl: string,
    wallet?: VerifiedWallet | null,
    privyUserId?: string
  ) => Promise<void>;
  updatePrimaryWallet: (wallet: VerifiedWallet, privyUserId?: string) => Promise<void>;
  searchUsers: (searchQuery: string) => Promise<UserProfile[]>;
  sendFriendRequest: (receiverId: string) => Promise<void>;
  acceptFriendRequest: (requestId: string) => Promise<void>;
  declineFriendRequest: (requestId: string) => Promise<void>;
  sendMessage: (text: string, imageUrl?: string, replyTo?: { id: string; senderUsername: string; text: string }, audioUrl?: string, isSticker?: boolean) => Promise<void>;
  logPaymentMessage: (info: {
    chatId: string;
    amount: number;
    recipientUsername: string;
    transactionHash: string;
  }) => Promise<void>;
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, newText: string) => Promise<void>;
  uploadImage: (file: File) => Promise<string>;
  logout: () => Promise<void>;
  dismissNotification: (id: string) => void;
  isInitialLoading: boolean;
  isFriendTyping: boolean;
  setTypingStatus: (isTyping: boolean) => Promise<void>;
  triggerBotResponse: (chatId: string, userText: string, replyToMessage?: any) => Promise<void>;
  triggerNotification: (noti: AppNotification) => void;
  // Circle Developer-Controlled Wallet (server-side MPC) — created/restored
  // automatically for the authenticated uid via POST /api/wallet/ensure.
  // `getCircleSigningContext` returns the EIP-1193 provider seam used by the
  // transaction pipeline.
  circleWallet: CircleWalletSession;
  ensureCircleWallet: () => Promise<any>;
  getCircleSigningContext: () => Promise<{ provider: CircleEip1193Provider; from: string }>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used within a ChatProvider");
  return context;
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChatFriend, setActiveChatFriend] = useState<UserProfile | null>(null);
  const [activeChatMessages, setActiveChatMessages] = useState<ChatMessage[]>([]);
  const [isFriendTyping, setIsFriendTyping] = useState<boolean>(false);
  
  const [appNotifications, setAppNotifications] = useState<AppNotification[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [chatSessions, setChatSessions] = useState<Record<string, ChatSession>>({});
  const processedDndMessageIds = useRef<Set<string>>(new Set());
  const { logout: privyLogout } = usePrivy();

  // Circle Developer-Controlled Wallet (server-side MPC): auto-created for the
  // authenticated Firebase uid via POST /api/wallet/ensure. Writes ONLY the
  // Circle metadata block to Firestore — never secrets.
  const {
    session: circleWallet,
    ensure: ensureCircleWallet,
    getSigningContext: getCircleSigningContext,
  } = useCircleWalletSession({
    uid: currentUser?.uid ?? null,
    profile: userProfile,
    username: userProfile?.username ?? null,
  });

  // 1. Listen to Authentication Changes
  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setCurrentUser(user);
        
        // Start Presence Update
        try {
          await updateDoc(doc(db, "users", user.uid), {
            status: "online",
            lastActive: new Date().toISOString(),
          });
        } catch (e) {
          // If updateDoc fails, maybe doc doesn't exist yet, we let AuthPage handle the creation first
          console.log("Presence check ignored (profile not ready yet)");
        }

        // Phase 1: Ensure a Circle Developer-Controlled Wallet exists for this
        // Firebase uid. Fire-and-forget — wallet creation is server-side MPC and
        // does not block the login flow. The Firestore onSnapshot listener (step
        // 2) will pick up the updated circleWalletAddress automatically.
        ensureServerWallet().catch((err) => {
          console.warn("[ChatContext] ensureServerWallet (background) failed:", err);
        });
      } else {
        // Handle Logout presence clean up prior to state wipe
        if (currentUser) {
          try {
            await updateDoc(doc(db, "users", currentUser.uid), {
              status: "offline",
              lastActive: new Date().toISOString(),
            });
          } catch (e) {
            console.error(e);
          }
        }
        setCurrentUser(null);
        setUserProfile(null);
        setFriends([]);
        setFriendRequests([]);
        setActiveChatId(null);
        setActiveChatFriend(null);
        setActiveChatMessages([]);
        setIsInitialLoading(false);
      }
    });

    // Request desktop notifications permission in new tab environments
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }

    return () => unsubscribeAuth();
  }, []);

  // 2. Fetch User Profile and Listen to Updates
  useEffect(() => {
    if (!currentUser) return;

    const path = `users/${currentUser.uid}`;
    const unsubscribeProfile = onSnapshot(
      doc(db, "users", currentUser.uid),
      async (snapshot) => {
        if (snapshot.exists()) {
          const profile = snapshot.data() as UserProfile;
          setUserProfile(profile);
          setIsInitialLoading(false);
        } else {
          // If the profile document doesn't exist yet, do not lock the screen forever.
          // Set userProfile to null so that the onboarding setup can be rendered.
          setUserProfile(null);
          setIsInitialLoading(false);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      }
    );

    // Keep database session alive with online heartbeat
    const interval = setInterval(async () => {
      try {
        await updateDoc(doc(db, "users", currentUser.uid), {
          lastActive: new Date().toISOString(),
          status: "online",
        });
      } catch (err) {
        console.error("Heartbeat update failed:", err);
      }
    }, 60000); // 1 minute heartbeat

    // Set offline on unload
    const handleUnload = () => {
      navigator.sendBeacon(
        `/api/unload-trigger`, // Optional endpoint, or we just rely on window listeners
      );
      // Synchronously set offline using updateDoc immediately before tab closes
      updateDoc(doc(db, "users", currentUser.uid), {
        status: "offline",
        lastActive: new Date().toISOString(),
      });
    };

    window.addEventListener("beforeunload", handleUnload);

    return () => {
      unsubscribeProfile();
      clearInterval(interval);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [currentUser]);

  // 3. Listen to Friend Requests (Inbox and Outbox)
  useEffect(() => {
    if (!currentUser) return;

    const reqPath = "friend_requests";
    const q = query(
      collection(db, reqPath),
      where("senderId", "==", currentUser.uid)
    );
    const q2 = query(
      collection(db, reqPath),
      where("receiverId", "==", currentUser.uid)
    );

    // Collect both sent & received requests
    const unsubscribeRequestsSelfIn = onSnapshot(q2, (snapshot) => {
      const received = snapshot.docs
        .map(d => ({ ...d.data(), id: d.id }) as FriendRequest)
        // Never surface friend requests from users the current user has blocked.
        .filter((req) => !isUserBlocked(req.senderId));
      
      // Look for new incoming requests and trigger dynamic local notifications
      received.forEach((req) => {
        if (req.status === "pending") {
          // Check if notification already shown
          const alreadyNotified = appNotifications.some(n => n.id === req.id);
          if (!alreadyNotified) {
            triggerNotification({
              id: req.id,
              title: "Friend Request",
              body: `${req.senderUsername} sent you a friend request.`,
              type: "friend_request",
              timestamp: new Date(),
              senderName: req.senderUsername,
              senderAvatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${req.senderId}`,
            });
          }
        }
      });

      setFriendRequests(prev => {
        const outbox = prev.filter(r => r.senderId === currentUser.uid);
        return [...outbox, ...received];
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, reqPath);
    });

    const unsubscribeRequestsSelfOut = onSnapshot(q, (snapshot) => {
      const sent = snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as FriendRequest);
      setFriendRequests(prev => {
        const inbox = prev.filter(r => r.receiverId === currentUser.uid);
        return [...sent, ...inbox];
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, reqPath);
    });

    return () => {
      unsubscribeRequestsSelfIn();
      unsubscribeRequestsSelfOut();
    };
  }, [currentUser]);

  // 4. Track Friends based on Accepted Friend Requests
  useEffect(() => {
    if (!currentUser || friendRequests.length === 0) {
      setFriends([]);
      return;
    }

    // Filter accepted requests where current user is participant
    const acceptedRequests = friendRequests.filter(r => r.status === "accepted");
    const friendIds = acceptedRequests.map(r => 
      r.senderId === currentUser.uid ? r.receiverId : r.senderId
    );

    if (friendIds.length === 0) {
      setFriends([]);
      return;
    }

    // Listen to friends profiles updates to see if they transition online/offline
    const path = "users";
    const q = query(collection(db, path), where("uid", "in", friendIds));
    const unsubscribeFriends = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => d.data() as UserProfile);
      setFriends(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribeFriends();
  }, [currentUser, friendRequests]);

  // 4b. Track every chat session's last-message metadata, so conversation lists
  // can be ordered by whoever messaged most recently instead of a fixed order.
  useEffect(() => {
    if (!currentUser) {
      setChatSessions({});
      return;
    }

    const path = "chats";
    const q = query(collection(db, path), where("participants", "array-contains", currentUser.uid));
    const unsubscribeChatSessions = onSnapshot(q, (snapshot) => {
      const map: Record<string, ChatSession> = {};
      snapshot.docs.forEach((d) => {
        map[d.id] = { ...(d.data() as ChatSession), id: d.id };
      });
      setChatSessions(map);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribeChatSessions();
  }, [currentUser]);

  // 5. Track Active Friend info from Selected Chat
  useEffect(() => {
    if (!activeChatId || !currentUser) {
      setActiveChatFriend(null);
      return;
    }

    // Chat ID format: "uid1_uid2"
    const ids = activeChatId.split("_");
    const friendId = ids.find(id => id !== currentUser.uid);

    if (!friendId) return;

    const path = `users/${friendId}`;
    const unsubscribeFriendInfo = onSnapshot(doc(db, "users", friendId), (snapshot) => {
      if (snapshot.exists()) {
        setActiveChatFriend(snapshot.data() as UserProfile);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribeFriendInfo();
  }, [activeChatId, currentUser]);

  // 6. Listen to Messages in Active Chat with automatic Chat Session self-healing
  useEffect(() => {
    if (!activeChatId || !currentUser) {
      setActiveChatMessages([]);
      return;
    }

    // Self-healing: Ensure parent chat document exists in Firestore
    const chatDocRef = doc(db, "chats", activeChatId);
    getDoc(chatDocRef).then((snap) => {
      if (!snap.exists()) {
        const ids = activeChatId.split("_");
        // Only trigger creation if the current user is an authorized participant
        if (ids.includes(currentUser.uid)) {
          console.log("Auto-creating missing chat document for ID:", activeChatId);
          setDoc(chatDocRef, {
            id: activeChatId,
            participants: ids.sort(),
            lastMessage: "No messages shared yet",
            lastMessageAt: new Date().toISOString()
          }, { merge: true }).catch(err => {
            console.error("Auto-creating chat document failed:", err);
          });
        }
      }
    }).catch(err => {
      console.error("Checking chat document existence failed:", err);
    });

    const path = `chats/${activeChatId}/messages`;
    const q = query(collection(db, path), orderBy("timestamp", "asc"));
    
    const unsubscribeMessages = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as ChatMessage);
      setActiveChatMessages(list);

      // Mark the friend's messages as "seen" now that we're actively viewing this chat
      const unseenFromFriend = snapshot.docs.filter(d => {
        const data = d.data() as ChatMessage;
        return data.senderId !== currentUser.uid && data.seen !== true;
      });
      unseenFromFriend.forEach(d => {
        updateDoc(doc(db, path, d.id), { seen: true }).catch(err => {
          console.warn("Failed to mark message as seen:", d.id, err);
        });
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribeMessages();
  }, [activeChatId, currentUser]);

  // 6.5. Real-time Listening to Chat Document Typing Status
  useEffect(() => {
    if (!activeChatId || !currentUser) {
      setIsFriendTyping(false);
      return;
    }

    const ids = activeChatId.split("_");
    const friendId = ids.find(id => id !== currentUser.uid);
    if (!friendId) return;

    const chatDocRef = doc(db, "chats", activeChatId);
    const unsubscribeChatDoc = onSnapshot(chatDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const typing = data?.typing || {};
        setIsFriendTyping(!!typing[friendId]);
      } else {
        setIsFriendTyping(false);
      }
    }, (error) => {
      console.warn("Typing listener warning ignored for chat:", activeChatId, error);
    });

    return () => {
      unsubscribeChatDoc();
    };
  }, [activeChatId, currentUser]);

  // 7. Subscribe to all Messages in real-time across ALL friends to trigger Push Notifications
  useEffect(() => {
    if (!currentUser || friends.length === 0) return;

    const unsubscribes: (() => void)[] = [];

    friends.forEach((friend) => {
      // Chat ID is alphabetical uid1_uid2
      const chatId = [currentUser.uid, friend.uid].sort().join("_");
      const path = `chats/${chatId}/messages`;
      
      // Query last message from each chat
      const q = query(
        collection(db, path),
        orderBy("timestamp", "desc"),
        limit(1)
      );

      const unsub = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) return;
        const msg = { ...snapshot.docs[0].data(), id: snapshot.docs[0].id } as ChatMessage;

        // Trigger notification only if:
        // - Message is not sent by current user
        // - Chat is NOT currently the open/active chat
        // - Message timestamp is very recent (less than 10 seconds old, to avoid history trigger)
        const isSelf = msg.senderId === currentUser.uid;
        const isActive = activeChatId === chatId;
        
        let isRecent = false;
        if (msg.timestamp) {
          const msgTime = msg.timestamp.toMillis ? msg.timestamp.toMillis() : new Date(msg.timestamp).getTime();
          isRecent = (Date.now() - msgTime) < 8000;
        }

        // Trigger automatic DND response if DND is active and a recent message is received from a friend
        if (!isSelf && msg.senderUsername !== "mahi_bot" && isRecent && userProfile?.dndMode) {
          if (!processedDndMessageIds.current.has(msg.id)) {
            processedDndMessageIds.current.add(msg.id);
            triggerDndAutoReply(chatId, msg);
          }
        }

        if (!isSelf && !isActive && isRecent) {
          // Determine correct preview text based on the actual message type
          let notifBody = msg.text;
          if (!notifBody) {
            if (msg.isSticker) {
              notifBody = "🎨 Sent a sticker";
            } else if (msg.audioUrl) {
              notifBody = "🎵 Sent a voice message";
            } else if (msg.imageUrl) {
              notifBody = "📷 Shared an image";
            } else {
              notifBody = "Sent a message";
            }
          }

          triggerNotification({
            id: msg.id,
            title: `New Message from ${msg.senderUsername}`,
            body: notifBody,
            type: "message",
            timestamp: new Date(),
            senderName: msg.senderUsername,
            senderAvatar: friend.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${msg.senderId}`,
            chatId: chatId,
          });
        }
      }, (error) => {
        console.warn("Silent notification listener permission skipped for chat:", chatId, error);
      });
      unsubscribes.push(unsub);
    });

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [currentUser, friends, activeChatId, userProfile]);

  // Deal Room invitation listener — triggers inbox notifications for new invitations
  useEffect(() => {
    if (!currentUser) return;

    const invQuery = query(
      collection(db, "deal_room_invitations"),
      where("invitedUserId", "==", currentUser.uid),
      where("status", "==", "pending")
    );

    const seenInvites = new Set<string>();
    const unsub = onSnapshot(invQuery, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added") {
          const invId = change.doc.id;
          if (seenInvites.has(invId)) return;
          seenInvites.add(invId);

          const inv = change.doc.data() as any;
          triggerNotification({
            id: `dr_invite_${invId}`,
            title: `Deal Room Invitation`,
            body: `You've been invited to "${inv.dealRoomTitle}" by @${inv.invitedByUsername}. Tap to accept or decline.`,
            type: "deal_room_invite" as any,
            timestamp: new Date(),
            senderName: inv.invitedByUsername,
            senderAvatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${inv.invitedBy}`,
            dealRoomId: inv.dealRoomId,
          });
        }
      });
    }, (error) => {
      console.warn("Deal room invitation listener skipped:", error);
    });

    return () => unsub();
  }, [currentUser?.uid]);

  // Push notification helper (In-App Slide Banners & Native Notification API)
  const triggerNotification = (noti: AppNotification) => {
    if (userProfile?.dndMode) {
      console.log("Notification silenced because DND is active");
      return;
    }
    // 1. Update in-app state with automatic banner slide-down UI
    setAppNotifications(prev => [noti, ...prev]);

    // 2. Play subtle notification vibration or standard audio alert
    try {
      if (typeof window !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(100);
      }
    } catch (e) {}

    // 3. Fallback to System Native Desktop Notifications
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification("SendXX", {
          body: noti.body,
          icon: noti.senderAvatar || "/favicon.ico",
        });
      }
    }

    // Auto dismiss in-app slide banner after 5.5 seconds
    setTimeout(() => {
      dismissNotification(noti.id);
    }, 5500);
  };

  const dismissNotification = (id: string) => {
    setAppNotifications(prev => prev.filter(n => n.id !== id));
  };

  // --- API / Database Custom Operations ---

  // Update Profile details (walletAddress is NOT editable here — the primary
  // wallet can only be changed through `updatePrimaryWallet`, which only
  // accepts Privy-verified wallet data).
  const updateProfile = async (updates: {
    displayName: string;
    avatarUrl: string;
    bio?: string;
    moodEmoji?: string;
    githubUrl?: string;
    twitterUrl?: string;
    dndMode?: boolean;
  }) => {
    if (!currentUser) return;
    const path = `users/${currentUser.uid}`;
    try {
      const updateData: any = {
        displayName: updates.displayName.trim(),
        avatarUrl: updates.avatarUrl.trim(),
        lastActive: new Date().toISOString(),
      };

      updateData.bio = updates.bio ? updates.bio.trim() : "";
      updateData.moodEmoji = updates.moodEmoji ? updates.moodEmoji.trim() : "";
      updateData.githubUrl = updates.githubUrl ? updates.githubUrl.trim() : "";
      updateData.twitterUrl = updates.twitterUrl ? updates.twitterUrl.trim() : "";
      if (updates.dndMode !== undefined) {
        updateData.dndMode = updates.dndMode;
      }

      await updateDoc(doc(db, "users", currentUser.uid), updateData);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  // Determine which sign-in method the Firebase user used.
  const detectAuthProvider = (fbUser: any): AuthProvider => {
    const email = fbUser?.email || "";
    if (email.endsWith("@privy.auth")) return "wallet";
    const providerId = fbUser?.providerData?.[0]?.providerId;
    if (providerId === "google.com") return "google";
    return "email";
  };

  // Complete first-time user profile setup config.
  // An external (Privy) wallet is OPTIONAL. Google-only users enter MICA with
  // their internal Circle wallet; the dashboard no longer requires a verified
  // external wallet. When a Privy wallet IS linked, its verified metadata is
  // persisted (still used by Send USDC).
  const completeOnboarding = async (username: string, displayName: string, avatarUrl: string, wallet?: VerifiedWallet | null, privyUserId?: string) => {
    if (!currentUser) return;
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!cleanUsername) throw new Error("Username must contain alphanumeric characters or underscores");
    if (cleanUsername.length < 3 || cleanUsername.length > 32) {
      throw new Error("Username must be between 3 and 32 characters");
    }

    // Check if username is taken by another user
    const usersSnap = await getDocs(collection(db, "users"));
    let taken = false;
    usersSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.username && data.uid !== currentUser.uid && data.username.toLowerCase() === cleanUsername) {
        taken = true;
      }
    });

    if (taken) {
      throw new Error("This username is already taken. Please try another one.");
    }

    const path = `users/${currentUser.uid}`;
    try {
      const updateData: any = {
        username: cleanUsername,
        displayName: displayName.trim(),
        avatarUrl: avatarUrl.trim(),
        onboardingCompleted: true,
        authProvider: detectAuthProvider(currentUser),
        lastActive: new Date().toISOString(),
      };
      if (wallet && wallet.address) {
        updateData.walletAddress = wallet.address.toLowerCase();
        updateData.walletProvider = wallet.provider;
        updateData.walletLinkedAt = wallet.linkedAt || new Date().toISOString();
        updateData.walletVerified = true;
        updateData.walletStatus = "active";
      }
      if (privyUserId) {
        updateData.privyUserId = privyUserId;
      }
      await setDoc(doc(db, "users", currentUser.uid), updateData, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  // Replace the primary wallet. Only Privy-verified wallet data is accepted —
  // the address always originates from `linkWallet()`/Privy's user object.
  const updatePrimaryWallet = async (wallet: VerifiedWallet, privyUserId?: string) => {
    if (!currentUser) return;
    if (!wallet || !wallet.address) return;
    const path = `users/${currentUser.uid}`;
    try {
      const updateData: any = {
        walletAddress: wallet.address.toLowerCase(),
        walletProvider: wallet.provider,
        walletLinkedAt: wallet.linkedAt || new Date().toISOString(),
        walletVerified: true,
        walletStatus: "active",
        lastActive: new Date().toISOString(),
      };
      if (privyUserId) {
        updateData.privyUserId = privyUserId;
      }
      await updateDoc(doc(db, "users", currentUser.uid), updateData);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  // Find User by substring matching of Username, Display Name, or Wallet Address
  const searchUsers = async (searchQuery: string): Promise<UserProfile[]> => {
    if (!currentUser || !searchQuery) return [];
    const queryTerm = searchQuery.trim().toLowerCase();
    
    const path = "users";
    try {
      // Get all users (sandbox limits multi-column index matches so we query the lookup directly)
      const results: UserProfile[] = [];
      const querySnapshot = await getDocs(collection(db, "users"));
      
      querySnapshot.forEach((docSnap) => {
        const u = docSnap.data() as UserProfile;
        if (u.uid !== currentUser.uid) {
          const uNameMatch = u.username.toLowerCase().includes(queryTerm) || 
                             u.displayName.toLowerCase().includes(queryTerm);
          const walletMatch = u.walletAddress && u.walletAddress.toLowerCase().includes(queryTerm);
          
          if (uNameMatch || walletMatch) {
            results.push(u);
          }
        }
      });
      return results;
    } catch (error) {
      return handleFirestoreError(error, OperationType.LIST, path);
    }
  };

  // Send a Friend Request
  const sendFriendRequest = async (receiverId: string) => {
    if (!currentUser || !userProfile) return;
    // Defensive gate: never send a friend request to a blocked user (either direction).
    if (isUserBlocked(receiverId)) {
      throw new Error(getBlockMessage(receiverId) || "Friend requests are disabled for this user.");
    }
    const id = `${currentUser.uid}_${receiverId}`;
    const path = `friend_requests/${id}`;
    
    try {
      // Look up target receiver to get their username
      const targetSnap = await getDoc(doc(db, "users", receiverId));
      if (!targetSnap.exists()) throw new Error("Friend target profile doesn't exist");
      const targetProfile = targetSnap.data() as UserProfile;

      const newRequest: FriendRequest = {
        id,
        senderId: currentUser.uid,
        senderUsername: userProfile.username,
        receiverId,
        receiverUsername: targetProfile.username,
        status: "pending",
        timestamp: new Date().toISOString()
      };

      await setDoc(doc(db, "friend_requests", id), newRequest);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  // Accept a Friend Request (Creates Mutual Chats entry)
  const acceptFriendRequest = async (requestId: string) => {
    if (!currentUser) return;
    const path = `friend_requests/${requestId}`;
    
    try {
      const reqRef = doc(db, "friend_requests", requestId);
      const reqSnap = await getDoc(reqRef);
      
      if (!reqSnap.exists()) throw new Error("Friend request expired");

      // Update request status
      await updateDoc(reqRef, { status: "accepted" });

      // Create Mutual Chat Session record
      const reqData = reqSnap.data() as FriendRequest;
      const participants = [reqData.senderId, reqData.receiverId].sort();
      const chatId = participants.join("_");

      const chatRef = doc(db, "chats", chatId);
      const chatSnap = await getDoc(chatRef);

      if (!chatSnap.exists()) {
        await setDoc(chatRef, {
          id: chatId,
          participants,
          lastMessage: "No messages shared yet",
          lastMessageAt: new Date().toISOString()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  // Decline or Cancel Friend Request
  const declineFriendRequest = async (requestId: string) => {
    if (!currentUser) return;
    const path = `friend_requests/${requestId}`;
    try {
      // For clean security rule operations, we can either hard delete request, or update to 'declined'
      await deleteDoc(doc(db, "friend_requests", requestId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  // Send Chat Message plus images & audio voice notes
  const sendMessage = async (
    text: string,
    imageUrl?: string,
    replyTo?: { id: string; senderUsername: string; text: string },
    audioUrl?: string,
    isSticker?: boolean
  ) => {
    if (!currentUser || !activeChatId || !userProfile) return;

    // Defensive gate at the DB boundary: never write into a chat whose peer is
    // blocked in EITHER direction. Server rules enforce this too.
    const peerId = activeChatId.split("_").find((id) => id !== currentUser.uid);
    if (peerId && isUserBlocked(peerId)) {
      throw new Error(getBlockMessage(peerId) || "Messages are disabled for this conversation.");
    }
    
    const messagesCollection = `chats/${activeChatId}/messages`;
    const chatDoc = `chats/${activeChatId}`;

    try {
      // 1. Ensure parent chat document exists in Firestore first
      const chatDocRef = doc(db, "chats", activeChatId);
      const chatDocSnap = await getDoc(chatDocRef);
      if (!chatDocSnap.exists()) {
        const ids = activeChatId.split("_");
        if (ids.includes(currentUser.uid)) {
          console.log("Auto-creating missing chat document inside sendMessage:", activeChatId);
          await setDoc(chatDocRef, {
            id: activeChatId,
            participants: ids.sort(),
            lastMessage: "No messages shared yet",
            lastMessageAt: new Date().toISOString()
          }, { merge: true });
        }
      }

      // 2. Create Message payload
      const payload: any = {
        senderId: currentUser.uid,
        senderUsername: userProfile.username,
        text,
        imageUrl: imageUrl || "",
        audioUrl: audioUrl || "",
        isSticker: !!isSticker,
        seen: false,
        timestamp: new Date().toISOString()
      };

      if (replyTo) {
        payload.replyTo = replyTo;
      }

      // 3. Write Message Subcollection
      const docRef = await addDoc(collection(db, messagesCollection), payload);

      // 4. Update parent chat preview indices
      let lastMsgText = text;
      if (isSticker) {
        lastMsgText = "🎨 Sent a sticker";
      } else if (imageUrl) {
        lastMsgText = "📷 Shared a media asset";
      } else if (audioUrl) {
        lastMsgText = "🎵 Shared a voice note";
      }

      await updateDoc(doc(db, chatDoc), {
        lastMessage: lastMsgText,
        lastMessageAt: new Date().toISOString()
      });

      // Check if bot should respond: contains "/bot" or replies to "sovereign_bot" or "mahi_bot"
      const triggerBot = text.toLowerCase().includes("/bot") || (replyTo && (replyTo.senderUsername === "sovereign_bot" || replyTo.senderUsername === "mahi_bot"));
      if (triggerBot) {
        triggerBotResponse(activeChatId, text, {
          id: docRef.id,
          senderUsername: userProfile.username,
          text
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, messagesCollection);
    }
  };

  // Insert a payment system message after a successful Arc USDC transfer.
  // Rendered as a system pill (isSystem + payment payload), not a chat bubble.
  const logPaymentMessage = async (info: {
    chatId: string;
    amount: number;
    recipientUsername: string;
    transactionHash: string;
  }) => {
    if (!currentUser || !userProfile) return;
    const { chatId, amount, recipientUsername, transactionHash } = info;
    const messagesCollection = `chats/${chatId}/messages`;
    const text = `You sent ${amount} USDC to @${recipientUsername}.`;

    try {
      // Ensure the parent chat document exists before writing a subcollection.
      const chatDocRef = doc(db, "chats", chatId);
      const chatDocSnap = await getDoc(chatDocRef);
      if (!chatDocSnap.exists()) {
        const ids = chatId.split("_");
        if (ids.includes(currentUser.uid)) {
          await setDoc(chatDocRef, {
            id: chatId,
            participants: ids.sort(),
            lastMessage: text,
            lastMessageAt: new Date().toISOString(),
          }, { merge: true });
        }
      }

      await addDoc(collection(db, messagesCollection), {
        senderId: currentUser.uid,
        senderUsername: userProfile.username,
        text,
        imageUrl: "",
        audioUrl: "",
        isSticker: false,
        isSystem: true,
        seen: false,
        timestamp: new Date().toISOString(),
        payment: {
          amount,
          asset: "circle_usdc",
          network: "arc",
          recipientUsername,
          direction: "sent",
          status: "succeeded",
          transactionHash,
        },
      });

      await updateDoc(doc(db, "chats", chatId), {
        lastMessage: text,
        lastMessageAt: new Date().toISOString(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, messagesCollection);
    }
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!currentUser || !activeChatId) return;
    const messageDocPath = `chats/${activeChatId}/messages/${messageId}`;
    try {
      const msgRef = doc(db, messageDocPath);
      const msgSnap = await getDoc(msgRef);
      if (!msgSnap.exists()) return;

      const msgData = msgSnap.data() as ChatMessage;
      const currentReactions = msgData.reactions || {};
      
      const userList = currentReactions[emoji] || [];
      let updatedList = [...userList];
      
      if (updatedList.includes(currentUser.uid)) {
        updatedList = updatedList.filter(uid => uid !== currentUser.uid);
      } else {
        updatedList.push(currentUser.uid);
      }

      const updatedReactions = { ...currentReactions };
      if (updatedList.length === 0) {
        delete updatedReactions[emoji];
      } else {
        updatedReactions[emoji] = updatedList;
      }

      await updateDoc(msgRef, {
        reactions: updatedReactions
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, messageDocPath);
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!currentUser || !activeChatId) return;
    const messageDocPath = `chats/${activeChatId}/messages/${messageId}`;
    try {
      const msgRef = doc(db, messageDocPath);
      const msgSnap = await getDoc(msgRef);
      if (!msgSnap.exists()) return;

      const msgData = msgSnap.data() as ChatMessage;
      // Only allow the original sender to delete their own message
      if (msgData.senderId !== currentUser.uid) return;

      await deleteDoc(msgRef);

      // If the deleted message was the most recent one, refresh the chat preview
      const q = query(
        collection(db, `chats/${activeChatId}/messages`),
        orderBy("timestamp", "desc"),
        limit(1)
      );
      const latestSnap = await getDocs(q);
      const chatDocRef = doc(db, "chats", activeChatId);
      if (latestSnap.empty) {
        await updateDoc(chatDocRef, {
          lastMessage: "No messages shared yet",
        });
      } else {
        const latest = latestSnap.docs[0].data() as ChatMessage;
        let lastMsgText = latest.text;
        if (latest.isSticker) {
          lastMsgText = "🎨 Sent a sticker";
        } else if (latest.imageUrl) {
          lastMsgText = "📷 Shared a media asset";
        } else if (latest.audioUrl) {
          lastMsgText = "🎵 Shared a voice note";
        }
        await updateDoc(chatDocRef, {
          lastMessage: lastMsgText || "No messages shared yet",
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, messageDocPath);
    }
  };

  const editMessage = async (messageId: string, newText: string) => {
    if (!currentUser || !activeChatId) return;
    const trimmedText = newText.trim();
    if (!trimmedText) return;

    const messageDocPath = `chats/${activeChatId}/messages/${messageId}`;
    try {
      const msgRef = doc(db, messageDocPath);
      const msgSnap = await getDoc(msgRef);
      if (!msgSnap.exists()) return;

      const msgData = msgSnap.data() as ChatMessage;
      // Only allow the original sender to edit their own message
      if (msgData.senderId !== currentUser.uid) return;
      // Only plain text messages can be edited (not stickers/images/audio-only notes)
      if (msgData.isSticker) return;

      await updateDoc(msgRef, {
        text: trimmedText,
        edited: true,
        editedAt: new Date().toISOString()
      });

      // If this was the most recent message, refresh the chat preview text too
      const q = query(
        collection(db, `chats/${activeChatId}/messages`),
        orderBy("timestamp", "desc"),
        limit(1)
      );
      const latestSnap = await getDocs(q);
      if (!latestSnap.empty && latestSnap.docs[0].id === messageId) {
        const chatDocRef = doc(db, "chats", activeChatId);
        await updateDoc(chatDocRef, {
          lastMessage: trimmedText
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, messageDocPath);
    }
  };

  const setTypingStatus = async (isTyping: boolean) => {
    if (!currentUser || !activeChatId) return;
    const chatDocRef = doc(db, "chats", activeChatId);
    try {
      const ids = activeChatId.split("_");
      if (!ids.includes(currentUser.uid)) return;

      await setDoc(chatDocRef, {
        id: activeChatId,
        participants: ids.sort(),
        typing: {
          [currentUser.uid]: isTyping
        }
      }, { merge: true });
    } catch (error) {
      console.warn("Failed to update typing status:", error);
    }
  };

  // Upload file to Cloudinary via our secure serverless endpoint
  const uploadImage = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Upload failed");
    }

    return data.url;
  };

  // Logout session
  const logout = async () => {
    if (currentUser) {
      try {
        await updateDoc(doc(db, "users", currentUser.uid), {
          status: "offline",
          lastActive: new Date().toISOString(),
        });
      } catch (e) {
        console.error(e);
      }
    }
    try {
      await privyLogout();
    } catch (e) {
      console.log("Privy logout skipped (no active Privy session)");
    }
    await auth.signOut();
  };

  const triggerDndAutoReply = async (chatId: string, friendMsg: ChatMessage) => {
    setIsFriendTyping(true);
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      let botText = "";
      const queryText = friendMsg.text.trim().toLowerCase();
      const ownerUsername = userProfile?.username || "unknown";
      const ownerWallet = userProfile?.walletAddress || "Not configured yet";
      const verifiedLink = "https://mahix.com";

      const apiMessages = [
        {
          role: "user",
          content: friendMsg.text
        }
      ];

      const systemInstruction = `You are MAHI, a very friendly and warm AI Assistant developed by and under the MAHIX company.
Your owner, @${ownerUsername}, is currently busy and has turned on "Do Not Disturb" (DND) mode.
You are chatting with their friend/peer (@${friendMsg.senderUsername}) on behalf of @${ownerUsername}.
You MUST say politely that your owner @${ownerUsername} is currently busy, and ask them how you can help.
For example, say: "My owner @${ownerUsername} is currently busy, but I'm here as their AI Assistant. How can I help you? (আমার ওনার @${ownerUsername} এখন ব্যস্ত আছেন, আপনি বলুন আমি আপনাকে কীভাবে সাহায্য করতে পারি?)"
CRITICAL INFO:
- Owner's Wallet Address: "${ownerWallet}"
- Verified Official Link: "${verifiedLink}"
- Current App Link: "${window.location.origin}"

If they ask for the owner's wallet address (or keywords like 'wallet', 'address', 'solana', 'sol', 'deposit', 'send address'), you MUST provide the owner's wallet address: "${ownerWallet}".
If they ask for a verified link or official links (or keywords like 'link', 'verified link', 'website', 'url'), you MUST provide the verified links: "${verifiedLink}" and "${window.location.origin}".
Keep your response warm, concise, and match the language of the incoming message (English or Bengali). Try to use a mix of friendly Bangla and English.`;

      const res = await fetch("/api/bot/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: apiMessages,
          systemInstruction: systemInstruction
        })
      });

      if (res.ok) {
        const responseData = await res.json();
        botText = responseData.choices?.[0]?.message?.content || "";
      }

      if (!botText) {
        if (queryText.includes("wallet") || queryText.includes("address") || queryText.includes("sol")) {
          botText = `Hello! My owner @${ownerUsername} is currently busy. Here is their cryptographic wallet address: ${ownerWallet} 💳. (আমার ওনার @${ownerUsername} এখন ওয়ালেট অ্যাড্রেস হলো: ${ownerWallet})`;
        } else if (queryText.includes("link") || queryText.includes("website") || queryText.includes("verified")) {
          botText = `Hello! My owner @${ownerUsername} is currently busy. Here is the verified official link: ${verifiedLink} 🌐. (আমার ওনার @${ownerUsername} এখন ভেরিফাইড লিংক হলো: ${verifiedLink})`;
        } else {
          botText = `My owner @${ownerUsername} is currently busy. Please tell me, how can I help you on their behalf? 😊 (আমার ওনার @${ownerUsername} এখন ব্যস্ত আছেন, আপনি বলুন আমি আপনাকে কীভাবে সাহায্য করতে পারি?)`;
        }
      }

      const botPayload: any = {
        senderId: "mahi_bot_system",
        senderUsername: "mahi_bot",
        text: botText,
        imageUrl: "",
        audioUrl: "",
        isSticker: false,
        timestamp: new Date().toISOString()
      };

      await addDoc(collection(db, `chats/${chatId}/messages`), botPayload);

      await updateDoc(doc(db, `chats/${chatId}`), {
        lastMessage: botText,
        lastMessageAt: new Date().toISOString()
      });

    } catch (err) {
      console.error("DND auto reply failed:", err);
    } finally {
      setIsFriendTyping(false);
    }
  };

  const triggerBotResponse = async (chatId: string, userText: string, replyToMessage?: any) => {
    // Natural simulated delay without setting typing indicator
    await new Promise(resolve => setTimeout(resolve, 800));

    try {
      let botText = "";
      const trimmedText = userText.trim().toLowerCase();

      const isDndOnCommand = trimmedText.includes("do not disturb mood on") || 
                             trimmedText.includes("do not disturb on") || 
                             trimmedText.includes("dnd on") ||
                             trimmedText.includes("do not disturb mode on") ||
                             trimmedText.includes("disturb mood on");
                             
      const isDndOffCommand = trimmedText.includes("do not disturb mood off") || 
                              trimmedText.includes("do not disturb off") || 
                              trimmedText.includes("dnd off") ||
                              trimmedText.includes("do not disturb mode off") ||
                              trimmedText.includes("disturb mood off");

      if (isDndOnCommand) {
        if (currentUser) {
          await updateDoc(doc(db, "users", currentUser.uid), { dndMode: true });
        }
        botText = "Do Not Disturb (DND) Mode has been turned ON. I will handle incoming messages and notifications for you! 😊 (হ্যাঁ, আপনার Do Not Disturb মুড চালু করা হয়েছে। এখন থেকে আপনার সব মেসেজের উত্তর আমি দেবো এবং কোনো নোটিফিকেশন আসবে না! 😊)";
      } else if (isDndOffCommand) {
        if (currentUser) {
          await updateDoc(doc(db, "users", currentUser.uid), { dndMode: false });
        }
        botText = "Do Not Disturb (DND) Mode is now OFF. You will receive notifications normally. 😊 (হ্যাঁ, আপনার Do Not Disturb মুড বন্ধ করা হয়েছে। এখন থেকে আপনি স্বাভাবিকভাবে নোটিফিকেশন পাবেন। 😊)";
      } else if (trimmedText === "/bot") {
        botText = "Yes, how can I help you? 😊 (হ্যাঁ, আমি কীভাবে আপনাকে সাহায্য করতে পারি? আই এম মাহি, MAHIX-এর একটি অফিশিয়াল এআই অ্যাসিস্ট্যান্ট।)";
      } else {
        // 1. Get recent messages in this chat session for context
        const messagesCol = collection(db, `chats/${chatId}/messages`);
        const q = query(messagesCol, orderBy("timestamp", "desc"), limit(10));
        const snap = await getDocs(q);
        
        const chatHistory: any[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          chatHistory.push(d);
        });
        // Sort messages ascending by time so they are in conversational order
        chatHistory.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        // Map to Groq format
        const apiMessages = chatHistory.map(m => ({
          role: (m.senderUsername === "sovereign_bot" || m.senderUsername === "mahi_bot") ? "assistant" : "user",
          content: m.text || ""
        }));

        // If no messages found, just use the current prompt
        if (apiMessages.length === 0) {
          apiMessages.push({
            role: "user",
            content: userText
          });
        }

        // 2. Fetch bot response from our server proxy
        const res = await fetch("/api/bot/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ messages: apiMessages })
        });

        if (!res.ok) {
          throw new Error(`Proxy error: ${await res.text()}`);
        }

        const responseData = await res.json();
        botText = responseData.choices?.[0]?.message?.content || "Yes, how can I help you? 😊";
      }

      // 3. Write bot message to Firestore
      const botPayload: any = {
        senderId: "mahi_bot_system",
        senderUsername: "mahi_bot",
        text: botText,
        imageUrl: "",
        audioUrl: "",
        isSticker: false,
        timestamp: new Date().toISOString()
      };

      if (replyToMessage) {
        botPayload.replyTo = {
          id: replyToMessage.id,
          senderUsername: replyToMessage.senderUsername,
          text: replyToMessage.text
        };
      }

      await addDoc(collection(db, `chats/${chatId}/messages`), botPayload);

      // 4. Update parent chat preview index
      await updateDoc(doc(db, `chats/${chatId}`), {
        lastMessage: botText,
        lastMessageAt: new Date().toISOString()
      });

    } catch (err) {
      console.error("Failed to trigger bot response:", err);
      // Fallback bot response in Firestore if API fails
      try {
        await addDoc(collection(db, `chats/${chatId}/messages`), {
          senderId: "mahi_bot_system",
          senderUsername: "mahi_bot",
          text: "Yes, how can I help you? 😊 (হ্যাঁ, আমি কীভাবে আপনাকে সাহায্য করতে পারি? আই এম মাহি, MAHIX-এর এআই অ্যাসিস্ট্যান্ট।)",
          imageUrl: "",
          audioUrl: "",
          isSticker: false,
          timestamp: new Date().toISOString()
        });
      } catch (innerErr) {
        console.error(innerErr);
      }
    } finally {
      setIsFriendTyping(false);
    }
  };

  return (
    <ChatContext.Provider
      value={{
        currentUser,
        userProfile,
        friends,
        friendRequests,
        activeChatId,
        activeChatFriend,
        activeChatMessages,
        appNotifications,
        chatSessions,
        setActiveChatId,
        updateProfile,
        completeOnboarding,
        updatePrimaryWallet,
        searchUsers,
        sendFriendRequest,
        acceptFriendRequest,
        declineFriendRequest,
        sendMessage,
        logPaymentMessage,
        editMessage,
        toggleReaction,
        deleteMessage,
        uploadImage,
        logout,
        dismissNotification,
        isInitialLoading,
        isFriendTyping,
        setTypingStatus,
        triggerBotResponse,
        triggerNotification,
        circleWallet,
        ensureCircleWallet,
        getCircleSigningContext,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};
