import React from "react";

interface EmojiReactionPanelProps {
  /** Emojis to render as circular reaction buttons */
  emojis?: string[];
  /** Called with the emoji the user picked */
  onSelect: (emoji: string) => void;
  /** Currently active/selected emoji (gets the "carved-in" pressed look) */
  activeEmoji?: string | null;
  /**
   * "dark"  -> opaque neumorphic panel (rgba(0,0,0,0.7) + carved-in buttons)
   * "glass" -> lighter reflective frosted-glass panel with a top-edge highlight
   */
  variant?: "dark" | "glass";
  className?: string;
}

const DEFAULT_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/**
 * Dark-mode emoji picker / reaction panel matching the app's neumorphic
 * coral-red theme. Two visual variants:
 *  - "dark":  frosted glass container (rgba(0,0,0,0.7)) + carved-in circular buttons
 *  - "glass": near-transparent reflective glass (rgba(255,255,255,0.03)) with a
 *             bright top-edge highlight and glossy buttons
 *
 * Usage:
 *   <EmojiReactionPanel onSelect={(emoji) => toggleReaction(msg.id, emoji)} />
 *   <EmojiReactionPanel variant="glass" emojis={["🔥","🚀","✨"]} activeEmoji={picked} onSelect={setPicked} />
 */
export default function EmojiReactionPanel({
  emojis = DEFAULT_EMOJIS,
  onSelect,
  activeEmoji = null,
  variant = "dark",
  className = "",
}: EmojiReactionPanelProps) {
  const panelClass = variant === "glass" ? "glass-panel" : "neu-glass-panel";
  const btnClass = variant === "glass" ? "glass-btn w-[34px] h-[34px] rounded-full flex items-center justify-center text-base" : "neu-emoji-btn";

  return (
    <div
      className={`${panelClass} inline-flex items-center gap-1.5 py-2 px-2.5 ${className}`.trim()}
      onClick={(e) => e.stopPropagation()}
    >
      {emojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onSelect(emoji)}
          className={`${btnClass} ${activeEmoji === emoji ? "is-active" : ""}`}
          title={emoji}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
