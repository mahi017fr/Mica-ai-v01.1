import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { UserMinus, X } from "lucide-react";

interface UnfriendConfirmModalProps {
  open: boolean;
  displayName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

const UNFRIEND_MESSAGE =
  "Are you sure you want to remove this person from your friends? Your chat history will remain محفوظ.";

const UnfriendConfirmModal: React.FC<UnfriendConfirmModalProps> = ({ open, displayName, onCancel, onConfirm }) => {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-[#0B0F17]/85 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative z-10 bg-[#0B0F17]/95 border border-red-500/30 rounded-3xl w-full max-w-md p-6 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-start justify-between border-b border-red-500/10 pb-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
                  <UserMinus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black tracking-wide font-sans text-white uppercase">
                    Unfriend
                  </h3>
                  <p className="text-[10px] text-[#94A3B8] mt-0.5 font-mono">
                    {displayName || "this user"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCancel}
                className="p-1.5 rounded-lg border border-white/5 text-[#94A3B8] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#94A3B8] leading-relaxed font-sans">
              Unfriend {displayName || "this user"}?
              <span className="block mt-1.5">{UNFRIEND_MESSAGE}</span>
            </p>

            <div className="flex gap-3 pt-5">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 py-2.5 px-4 rounded-xl bg-[#0D111D] border border-white/[0.06] hover:border-neutral-500 text-[#94A3B8] hover:text-white text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="flex-1 py-2.5 px-4 rounded-xl text-white text-xs font-black font-sans uppercase tracking-wider transition-all cursor-pointer bg-gradient-to-r from-red-600 to-rose-600 hover:brightness-110 shadow-lg shadow-red-600/20"
              >
                Unfriend
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default UnfriendConfirmModal;