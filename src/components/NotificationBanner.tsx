import { useChat } from "../context/ChatContext";
import { motion, AnimatePresence } from "motion/react";
import { MessageSquare, UserPlus, X } from "lucide-react";

export default function NotificationBanner() {
  const { appNotifications, dismissNotification, setActiveChatId } = useChat();

  const handleNotificationClick = (noti: any) => {
    if (noti.type === "message" && noti.chatId) {
      setActiveChatId(noti.chatId);
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
            className="w-full bg-[#0D111D]/95 backdrop-blur-md border border-white/[0.06] rounded-xl p-4 shadow-2xl flex items-start gap-3 pointer-events-auto cursor-pointer group hover:border-blue-400/50 transition-all duration-250 relative overflow-hidden"
            onClick={() => handleNotificationClick(noti)}
          >
            {/* Neon top accent line */}
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[#6C5CE0] via-[#7C3AED] to-[#6C5CE0] opacity-70" />

            {noti.senderAvatar ? (
              <img
                src={noti.senderAvatar}
                alt={noti.senderName}
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full bg-[#0B0F17] border border-white/[0.06] object-cover mt-0.5"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[#0B0F17] border border-white/[0.06] flex items-center justify-center text-[#94A3B8]">
                {noti.type === "message" ? (
                  <MessageSquare className="w-4 h-4 text-[#94A3B8]" />
                ) : (
                  <UserPlus className="w-4 h-4 text-[#94A3B8]" />
                )}
              </div>
            )}

            <div className="flex-1 min-w-0 pr-4">
              <p className="text-xs font-bold text-[#F8FAFC] tracking-tight leading-tight">
                {noti.title}
              </p>
              <p className="text-[11px] text-[#94A3B8] mt-1 truncate">
                {noti.body}
              </p>
              <p className="text-[9px] text-[#6C5CE0] font-mono mt-1">
                {noti.type === "message" ? "Tap to chat" : "Review in friend Requests"}
              </p>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissNotification(noti.id);
              }}
              className="p-1 rounded-md text-[#6C5CE0] hover:text-[#94A3B8] hover:bg-[#161A2B] transition-all cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
