import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useMotionValue } from "motion/react";
import { X, Send, Loader2, Minus } from "lucide-react";
import { Live2DCharacter, MicaFaceSnapshot, type MicaEmotionTrigger } from "./Live2DCharacter";
import { LLM_EMOTION_KEYS } from "../config/micaReactions";

interface BuddyMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// Fixed footprint of the floating AI button. A plain number (not measured off the
// DOM) keeps the drag bounds perfectly predictable — no jitter from re-measuring.
const BUTTON_WIDTH = 210;
const BUTTON_HEIGHT = 380;
const WIDGET_MARGIN = 16;

/** Whether Mica is shown at all (Settings page "Mica Character" toggle). Turning
 *  this off hides the floating AI button entirely. */
function readMicaWidgetEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem("mica_widget_enabled") !== "false";
}

const AIBuddy: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isGreeting, setIsGreeting] = useState(false);
  const [isConfused, setIsConfused] = useState(false);
  const [isGoodbye, setIsGoodbye] = useState(false);
  // Whatever emotion the AI itself picked for its last reply (see api/bot/chat.ts's JSON
  // contract) — drives Live2DCharacter's generic `emotion` prop: motion, voice line, and
  // speech bubble text all come from this single key via micaReactions.ts. `nonce` makes
  // sure the same emotion firing twice in a row still re-triggers the reaction.
  const [emotionTrigger, setEmotionTrigger] = useState<MicaEmotionTrigger | null>(null);
  const [messages, setMessages] = useState<BuddyMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [widgetEnabled, setWidgetEnabled] = useState(readMicaWidgetEnabled);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  // Tracks where/when a press started, so pointer-up can tell a genuine tap
  // apart from a drag (see the tap-detection comment further below).
  const pointerDownPos = useRef<{ x: number; y: number; time: number } | null>(null);

  // Drag state for the floating button. dragX/dragY are absolute left/top pixel
  // coordinates (not an offset from a CSS anchor) — this and the numeric dragBounds
  // below (rather than a ref measured via getBoundingClientRect) are what make the
  // dragging itself smooth and never "stick" partway across the screen. Living at
  // component scope (not inside the conditionally-rendered JSX) means wherever the
  // user drags it to stays put across opening/closing the chat panel — restoring
  // it brings it back smoothly at exactly that spot instead of snapping to a corner.
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const hasPlacedRef = useRef(false);
  const [dragBounds, setDragBounds] = useState(() => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1024;
    const h = typeof window !== "undefined" ? window.innerHeight : 768;
    return {
      left: WIDGET_MARGIN,
      top: WIDGET_MARGIN,
      right: Math.max(WIDGET_MARGIN, w - BUTTON_WIDTH - WIDGET_MARGIN),
      bottom: Math.max(WIDGET_MARGIN, h - BUTTON_HEIGHT - WIDGET_MARGIN),
    };
  });

  // Places it in the bottom-right corner on first mount, and re-clamps its position
  // whenever the window is resized/rotated so it's never dragged off-screen or left
  // covering important UI.
  useEffect(() => {
    const place = () => {
      const bounds = {
        left: WIDGET_MARGIN,
        top: WIDGET_MARGIN,
        right: Math.max(WIDGET_MARGIN, window.innerWidth - BUTTON_WIDTH - WIDGET_MARGIN),
        bottom: Math.max(WIDGET_MARGIN, window.innerHeight - BUTTON_HEIGHT - WIDGET_MARGIN),
      };
      setDragBounds(bounds);
      if (!hasPlacedRef.current) {
        dragX.set(bounds.right);
        dragY.set(bounds.bottom);
        hasPlacedRef.current = true;
      } else {
        dragX.set(Math.min(Math.max(dragX.get(), bounds.left), bounds.right));
        dragY.set(Math.min(Math.max(dragY.get(), bounds.top), bounds.bottom));
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick up live changes made on the Settings page (same tab via our custom event,
  // other tabs via the native "storage" event) without needing a page reload.
  useEffect(() => {
    const refreshWidget = () => setWidgetEnabled(readMicaWidgetEnabled());
    window.addEventListener("mica-widget-settings-changed", refreshWidget);
    window.addEventListener("storage", refreshWidget);
    return () => {
      window.removeEventListener("mica-widget-settings-changed", refreshWidget);
      window.removeEventListener("storage", refreshWidget);
    };
  }, []);

  useEffect(() => {
    if (!widgetEnabled) {
      setIsOpen(false);
    }
  }, [widgetEnabled]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking, isOpen]);

  // Restores the panel: called both by tapping the floating button and by the
  // external toggle event below.
  const handleOpen = () => {
    setIsOpen(true);
    // Little greeting wave the moment the chat opens
    setIsGreeting(true);
    setTimeout(() => setIsGreeting(false), 1000);
    if (messages.length === 0) {
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          content: "Hey! I'm Mica 🙂 Talk to me about anything, in any language you like.",
        },
      ]);
    }
  };

  // Minimizes/closes the panel with a goodbye wave first. The floating button remounts
  // right as the panel starts its exit slide, so the pulse below reaches it in time to
  // play as she reappears.
  const handleClose = () => {
    setIsGoodbye(true);
    setIsOpen(false);
    setTimeout(() => setIsGoodbye(false), 5000);
  };

  // Lets other parts of the app (e.g. the sidebar "AI" quick-action button) open
  // or close this same panel without needing shared state/context — a plain
  // window event, same convention as the widget settings sync above.
  useEffect(() => {
    const handleExternalToggle = () => {
      if (isOpenRef.current) {
        handleClose();
      } else {
        handleOpen();
      }
    };
    window.addEventListener("mica-ai-toggle-panel", handleExternalToggle);
    return () => window.removeEventListener("mica-ai-toggle-panel", handleExternalToggle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Broadcasts this panel's open/closed state so other UI can mirror it (e.g. to
  // decide whether the sidebar AI icon should show its idle glow).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("mica-ai-panel-state", { detail: { isOpen } }));
  }, [isOpen]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isThinking) return;

    const userMsg: BuddyMessage = { id: `u_${Date.now()}`, role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setIsThinking(true);

    try {
      const apiMessages = nextMessages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/bot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          systemInstruction:
            "You are Mica, a cheerful, slightly playful AI companion who lives as a small animated character inside a chat app. " +
            "Be warm, friendly, and genuinely helpful with whatever the user brings up — questions, problems, venting, random chat, anything. " +
            "Keep replies concise and natural. Default to English. If the user writes to you in another language (Bengali, Banglish, or " +
            "anything else), you're free to reply in that language too, but English is your baseline voice — never Japanese.",
        }),
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const data = await res.json();
      const rawContent: string = data.choices?.[0]?.message?.content?.trim() || "";

      // The backend asks the model for a strict {"reply": "...", "emotion": "..."} JSON
      // object (see api/bot/chat.ts). Parse that out; if the model ever deviates from the
      // contract (or JSON mode isn't available), fall back to treating the raw text as the
      // reply itself with a neutral emotion, so a parsing hiccup never breaks the chat.
      let replyText = rawContent || "Sorry, I didn't quite catch that — can you say it again?";
      let emotionKey = "neutral";
      try {
        const parsed = JSON.parse(rawContent);
        if (parsed && typeof parsed.reply === "string" && parsed.reply.trim()) {
          replyText = parsed.reply.trim();
        }
        if (typeof parsed?.emotion === "string" && (LLM_EMOTION_KEYS as readonly string[]).includes(parsed.emotion)) {
          emotionKey = parsed.emotion;
        }
      } catch {
        // Not JSON — just use the raw text as-is with the neutral emotion set above.
      }

      setMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: "assistant", content: replyText }]);

      // Reply just landed — play whichever emotion the AI itself chose (motion + voice +
      // speech bubble all come from this one key, see src/config/micaReactions.ts).
      setEmotionTrigger({ key: emotionKey, nonce: Date.now() });
    } catch (err) {
      console.error("Mica chat failed:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: "assistant",
          content: "Hmm, I couldn't respond just now. Mind trying again in a moment?",
        },
      ]);
      setIsConfused(true);
      setTimeout(() => setIsConfused(false), 50);
    } finally {
      setIsThinking(false);
    }
  };

  if (!widgetEnabled) return null;

  return (
    <>
      {/* Floating AI launcher — just Mica herself, no frame/circle around her — only
          mounted while the panel is minimized (state B). We track pointer-down
          position/time ourselves and only call handleOpen() on pointer-up if the
          pointer barely moved and released quickly — i.e. a genuine tap, not a drag. */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            key="mica-ai-floating-button"
            role="button"
            aria-label="Open Mica AI chat"
            drag
            dragMomentum={false}
            dragElastic={0.04}
            dragConstraints={dragBounds}
            onPointerDown={(e) => {
              pointerDownPos.current = { x: e.clientX, y: e.clientY, time: Date.now() };
            }}
            onPointerUp={(e) => {
              const start = pointerDownPos.current;
              pointerDownPos.current = null;
              if (!start) return;
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              const elapsed = Date.now() - start.time;
              // Only a near-stationary, quick press counts as a tap.
              if (distance < 6 && elapsed < 500) {
                handleOpen();
              }
            }}
            style={{ x: dragX, y: dragY, width: BUTTON_WIDTH, height: BUTTON_HEIGHT, touchAction: "none" }}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            transition={{
              opacity: { type: "spring", stiffness: 340, damping: 30, mass: 0.6 },
              scale: { type: "spring", stiffness: 340, damping: 30, mass: 0.6 },
            }}
            title="Chat with Mica AI"
            className="fixed left-0 top-0 z-[70] select-none cursor-grab active:cursor-grabbing"
          >
            <Live2DCharacter
              width={BUTTON_WIDTH}
              height={BUTTON_HEIGHT}
              focus="full"
              goodbye={isGoodbye}
              lively={!isGoodbye}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat panel — slides vertically. Restore (open): slide up from the bottom.
          Minimize (close): slide back down. Both 350ms, easeInOut. */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1, transition: { type: "tween", duration: 0.35, ease: "easeInOut" } }}
            exit={{ y: "100%", opacity: 0, transition: { type: "tween", duration: 0.35, ease: "easeInOut" } }}
            className="fixed top-0 right-0 h-full w-full sm:w-[380px] bg-[#0B0F17] border-l border-white/[0.06] z-[80] flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="border border-[#7C3AED]/40 rounded-full shrink-0 overflow-hidden w-9 h-9">
                  <MicaFaceSnapshot size={36} />
                </div>
                <div>
                  <p className="text-xs font-bold text-white">Mica</p>
                  <p className="text-[10px] text-[#6C5CE0] font-mono uppercase tracking-wider">
                    {isThinking ? "Typing..." : "Speaks any language"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {/* Minimize — slides the panel down, leaving only the floating button (with its glow) visible */}
                <button
                  type="button"
                  onClick={handleClose}
                  title="Minimize"
                  className="p-1.5 rounded-lg hover:bg-[#0D111D] text-[#6C5CE0] hover:text-white transition-colors cursor-pointer"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  title="Close"
                  className="p-1.5 rounded-lg hover:bg-[#0D111D] text-[#6C5CE0] hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Mica stands inside the panel header area too, waving hello on open */}
            <div className="flex justify-center pt-4 pb-2 shrink-0 border-b border-white/[0.06] bg-gradient-to-b from-[#0D111D]/60 to-transparent">
              <Live2DCharacter
                width={170}
                height={280}
                focus="full"
                greet={isGreeting}
                thinking={isThinking}
                confused={isConfused}
                emotion={emotionTrigger}
                lively={!isGreeting && !isThinking && !isConfused}
              />
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-[#0B0F17]">
              {messages.map((m) => (
                <div key={m.id} className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" && (
                    <div className="shrink-0 border border-[#7C3AED]/20 rounded-full overflow-hidden w-6 h-6">
                      <MicaFaceSnapshot size={24} />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] px-3 py-2 rounded-2xl text-xs leading-relaxed break-words whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-gradient-to-tr from-[#7C3AED] to-[#6C5CE0] text-white rounded-br-none"
                        : "bg-[#0D111D]/90 border border-white/5 text-[#F8FAFC] rounded-bl-none"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {isThinking && (
                <div className="flex items-end gap-2 justify-start">
                  <div className="shrink-0 border border-[#7C3AED]/20 rounded-full overflow-hidden w-6 h-6">
                    <MicaFaceSnapshot size={24} />
                  </div>
                  <div className="bg-[#0D111D]/90 border border-white/5 text-[#7C3AED] rounded-2xl rounded-bl-none px-3 py-2 flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="text-[10px] font-mono uppercase tracking-wider">Thinking</span>
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={handleSend} className="p-3 border-t border-white/[0.06] flex items-center gap-2 shrink-0">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Say anything, in any language..."
                className="flex-1 bg-[#0D111D]/80 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-[#F8FAFC] placeholder-sky-300/20 focus:outline-none focus:border-[#7C3AED]/50 focus:ring-1 focus:ring-[#7C3AED]/30 transition-all font-sans"
              />
              <button
                type="submit"
                disabled={!input.trim() || isThinking}
                className="p-2.5 rounded-xl bg-gradient-to-tr from-[#7C3AED] to-[#6C5CE0] text-white hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default AIBuddy;
