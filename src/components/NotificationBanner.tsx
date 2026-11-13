import { useChat } from "../context/ChatContext";
import { motion, AnimatePresence } from "motion/react";
import { MessageSquare, UserPlus, Handshake, X } from "lucide-react";

export default function NotificationBanner() {
  const { appNotifications, dismissNotification, setActiveChatId } = useChat();

  const handleNotificationClick = (noti: any) => {
    if (noti.type === "message" && noti.chatId) {
      setActiveChatId(noti.chatId);
    } else if (noti.type === "deal_room_invite") {
      window.dispatchEvent(new CustomEvent("navigate-dealroom"));
    }
    dismissNotification(noti.id);
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-full select-none pointer-events-none pt-[env(safe-area-inset-top,0px)]">
      <AnimatePresence>
        {appNotifications.map((noti) => (
          <motion.div
            key={noti.id}
            initial={{ opacity: 0, scale: 0.9, y: -20, x: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: -10, transition: { duration: 0.15 } }}
            className="w-full bg-[#050505]/95 backdrop-blur-md border border-white/[0.06] rounded-xl p-4 shadow-2xl flex items-start gap-3 pointer-events-auto cursor-pointer group hover:border-white/20  transition-all duration-250 relative overflow-hidden"
            onClick={() => handleNotificationClick(noti)}
          >
            {/* Neon top accent line */}
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-white/20 via-white/15 to-white/15 opacity-70" />

            {noti.senderAvatar ? (
              <img
                src={noti.senderAvatar}
                alt={noti.senderName}
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full bg-[#000000] border border-white/[0.06] object-cover mt-0.5"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[#000000] border border-white/[0.06] flex items-center justify-center text-[#A3A3A3]">
                {noti.type === "message" ? (
                  <MessageSquare className="w-4 h-4 text-[#A3A3A3]" />
                ) : noti.type === "deal_room_invite" ? (
                  <Handshake className="w-4 h-4 text-[#D4D4D4]" />
                ) : (
                  <UserPlus className="w-4 h-4 text-[#A3A3A3]" />
                )}
              </div>
            )}

            <div className="flex-1 min-w-0 pr-4">
              <p className="text-xs font-bold text-[#FFFFFF] tracking-tight leading-tight">
                {noti.title}
              </p>
              <p className="text-[11px] text-[#A3A3A3] mt-1 truncate">
                {noti.body}
              </p>
              <p className="text-[9px] text-white font-mono mt-1">
                {noti.type === "message" ? "Tap to chat" : noti.type === "deal_room_invite" ? "Tap to view invitation" : "Review in friend Requests"}
              </p>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissNotification(noti.id);
              }}
              className="p-1 rounded-md text-white hover:text-[#A3A3A3] hover:bg-[#111111] transition-all cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
