import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { Plus, X } from "lucide-react";
import McpConnectionsSection from "./McpConnectionsSection";

interface McpConnectionsPopupProps {
  open: boolean;
  onClose: () => void;
  /** The Chat Dashboard toast — same feedback style as the rest of MICA. */
  onNotify: (message: string, kind?: "success" | "error" | "info") => void;
}

/**
 * Chat Dashboard → Settings → **MCP Connections** popup.
 *
 * Opens over the dashboard (it never navigates away), is dismissible with the
 * X, a backdrop click or Escape, locks background scroll while open, and is
 * portalled to `document.body` so no ancestor `overflow`/`z-index` can clip it.
 *
 * It reuses the exact same `McpConnectionsSection` + `McpConnectionModal` +
 * `src/api/mcp.ts` stack as the global Settings page — no second MCP backend,
 * no duplicated encryption, no secrets in the browser.
 *
 * Z-INDEX: the popup sits at z-[95] — above the dashboard chrome, below the
 * toast (z-[100]) and below the nested add/edit modal (z-[120]) and delete
 * confirm (z-[130]) it opens.
 */
const McpConnectionsPopup: React.FC<McpConnectionsPopupProps> = ({
  open,
  onClose,
  onNotify,
}) => {
  // The section registers its "add connection" action so the header button
  // can open the same modal without lifting any state.
  const connectActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) connectActionRef.current = null;
  }, [open]);

  // Escape closes the popup.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Prevent background scrolling (and the layout jump from the hidden scrollbar).
  useEffect(() => {
    if (!open) return;
    const { body, documentElement } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbarGap = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbarGap > 0) body.style.paddingRight = `${scrollbarGap}px`;
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [open]);

  const popup = (
    <AnimatePresence>
      {open ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="MCP Connections"
        >
          {/* Backdrop — dark translucent veil + viewport blur. Only this layer
              is blurred: the dashboard stays recognizable behind it while the
              panel above remains sharp and crisp. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/[0.65] backdrop-blur-[14px]"
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 w-full max-w-[660px] max-h-[86vh] sm:max-h-[88vh] flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0B0F17] shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
          >
            {/* Header */}
            <div className="shrink-0 flex items-start justify-between gap-4 border-b border-white/[0.08] px-4 py-3.5 sm:px-5">
              <div className="min-w-0">
                <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white">
                  MCP Connections
                </h2>
                <p className="mt-1 text-[12px] leading-relaxed text-[#8B93A7]">
                  External tools and servers connected to your workspace.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => connectActionRef.current?.()}
                  className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#6C5CE0] px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[#7A6BE8] cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-white" />
                  Connect MCP
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  title="Close"
                  aria-label="Close MCP Connections"
                  className="rounded-[10px] p-2 text-white transition-colors hover:bg-white/[0.06] cursor-pointer"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>

            {/* Scrollable body — same MCP list / test / edit / delete stack */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-4 sm:px-5">
              <McpConnectionsSection
                variant="panel"
                onNotify={onNotify}
                actionRef={connectActionRef}
              />
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );

  if (typeof document === "undefined") return null;
  return createPortal(popup, document.body);
};

export default McpConnectionsPopup;
