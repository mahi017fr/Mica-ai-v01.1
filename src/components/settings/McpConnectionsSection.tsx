import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Plug,
  Plus,
  Loader2,
  Pencil,
  Trash2,
  Zap,
  Lock,
  AlertTriangle,
  MoreHorizontal,
} from "lucide-react";
import {
  McpApiError,
  listMcpConnections,
  deleteMcpConnection,
  testMcpConnection,
  type McpAuthType,
  type McpConnection,
} from "../../api/mcp";
import McpConnectionModal from "./McpConnectionModal";

interface McpConnectionsSectionProps {
  /** Reuses the Settings page toast so feedback looks identical to the rest of MICA. */
  onNotify: (message: string, kind?: "success" | "error" | "info") => void;
  /**
   * "settings" (default) — the card rendered inside the global Settings page.
   * "panel"             — the body of the Chat Dashboard "MCP Connections" popup.
   * Both render the same rows, so behaviour can never drift apart.
   */
  variant?: "settings" | "panel";
  /**
   * Lets the popup's header `[+ Connect MCP]` action open this section's
   * add/edit modal without lifting any state.
   */
  actionRef?: React.MutableRefObject<(() => void) | null>;
}

type ConfirmState = { id: string; name: string } | null;

const STATUS_META = {
  connected: { label: "Connected", dot: "bg-emerald-400", text: "text-emerald-400" },
  failed: { label: "Connection Failed", dot: "bg-red-500", text: "text-red-400" },
  untested: { label: "Untested", dot: "bg-amber-400", text: "text-amber-400" },
} as const;

const AUTH_LABEL: Record<McpAuthType, string> = {
  none: "No auth",
  bearer: "Bearer Token",
  api_key_header: "API Key",
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "2 minutes ago" for recent probes, a concrete date once it gets old. */
function formatLastTested(iso: string | null): string {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "unknown";
  const diff = Date.now() - time;
  if (diff < 0) return formatTimestamp(iso);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return formatTimestamp(iso);
}

const separator = <span className="px-1.5 text-white/25">·</span>;

/**
 * MCP Connections — the single source of truth for listing, testing, editing
 * and deleting MCP servers. Presentation only: a developer-console style
 * integration list shared by the Settings page and the Chat Dashboard popup.
 *
 * SECURITY: the browser only ever sees `hasSecret`. No token, ciphertext or
 * Authorization header is ever rendered, logged or stored in state.
 *
 * FORM CONSTRAINT — no `<form>` element here and every button is explicitly
 * `type="button"`; the add/edit modal is portalled to `document.body`, so this
 * section can never submit a parent form.
 */
const McpConnectionsSection: React.FC<McpConnectionsSectionProps> = ({
  onNotify,
  variant = "settings",
  actionRef,
}) => {
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<McpConnection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmState>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await listMcpConnections();
      if (!mountedRef.current) return;
      setConnections(list);
      setLoadError(null);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setConnections([]);
      setLoadError(
        err instanceof McpApiError ? err.message : "Could not load MCP connections."
      );
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleTest = async (connection: McpConnection) => {
    setBusyId(connection.id);
    try {
      const updated = await testMcpConnection(connection.id);
      if (!mountedRef.current) return;
      setConnections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      if (updated.status === "connected") {
        const tools =
          typeof updated.toolCount === "number" ? ` · ${updated.toolCount} tool(s)` : "";
        onNotify(`${updated.name} connected${tools}.`, "success");
      } else {
        onNotify(`${updated.name} failed: ${updated.lastError ?? "unknown error"}`, "error");
      }
    } catch (err: unknown) {
      const message = err instanceof McpApiError ? err.message : "Connection test failed.";
      onNotify(message, "error");
      void refresh();
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  };

  const handleDelete = async (target: ConfirmState) => {
    if (!target) return;
    setBusyId(target.id);
    try {
      await deleteMcpConnection(target.id);
      if (!mountedRef.current) return;
      setConnections((prev) => prev.filter((c) => c.id !== target.id));
      setConfirmDelete(null);
      onNotify(`MCP connection "${target.name}" removed.`, "success");
    } catch (err: unknown) {
      const message = err instanceof McpApiError ? err.message : "Could not delete the connection.";
      onNotify(message, "error");
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (connection: McpConnection) => {
    setEditing(connection);
    setModalOpen(true);
  };

  const handleSaved = (saved: McpConnection) => {
    if (!mountedRef.current) return;
    setConnections((prev) => {
      const exists = prev.some((c) => c.id === saved.id);
      return exists
        ? prev.map((c) => (c.id === saved.id ? saved : c))
        : [...prev, saved];
    });
  };

  // Expose the add action to the popup header without lifting any state.
  useEffect(() => {
    if (!actionRef) return;
    actionRef.current = openCreate;
  });

  const showEmpty = !loading && !loadError && connections.length === 0;
  const showList = !loading && connections.length > 0;

  const loadingBlock = (
    <div className="flex items-center gap-2 py-4 text-[12px] text-[#8B93A7]">
      <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
      Loading connections
    </div>
  );

  const errorBlock = !loadError ? null : (
    <div className="flex items-start gap-2 rounded-xl border border-white/[0.08] bg-[#111722] px-3.5 py-3">
      <AlertTriangle className="w-3.5 h-3.5 text-white shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[12px] text-red-400 leading-relaxed break-words">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
          className="mt-1.5 text-[11px] font-semibold text-white underline underline-offset-2 hover:text-white/70 cursor-pointer"
        >
          Retry
        </button>
      </div>
    </div>
  );

  const listBlock = !showList ? null : (
    <div className="space-y-2">
      {connections.map((connection) => {
        const meta = STATUS_META[connection.status] ?? STATUS_META.untested;
        const busy = busyId === connection.id;
        const lastTested = formatLastTested(connection.lastTestedAt);

        return (
          <motion.div
            key={connection.id}
            layout
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="relative rounded-xl border border-white/[0.08] bg-[#111722] px-3.5 py-3 transition-colors hover:border-white/[0.16]"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                    aria-hidden="true"
                  />
                  <span className="text-[13px] font-semibold text-white truncate">
                    {connection.name}
                  </span>
                </div>

                <p className="mt-1 pl-4 text-[11px] font-mono text-[#8B93A7] break-all">
                  {connection.endpointUrl}
                </p>

                <p className="mt-1 pl-4 flex flex-wrap items-center text-[11px] text-[#8B93A7]">
                  <span>{AUTH_LABEL[connection.authType]}</span>
                  {typeof connection.toolCount === "number" ? (
                    <>
                      {separator}
                      <span>
                        {connection.toolCount} tool{connection.toolCount === 1 ? "" : "s"}
                      </span>
                    </>
                  ) : null}
                  {separator}
                  <span className={meta.text}>{meta.label}</span>
                  {lastTested ? (
                    <>
                      {separator}
                      <span>tested {lastTested}</span>
                    </>
                  ) : null}
                </p>

                {connection.status === "failed" && connection.lastError ? (
                  <p className="mt-1 pl-4 text-[11px] text-red-400 leading-relaxed break-words">
                    {connection.lastError}
                  </p>
                ) : null}
              </div>

              {/* Actions */}
              <div className="flex w-full items-center justify-end gap-1.5 shrink-0 sm:w-auto">
                <button
                  type="button"
                  onClick={() => void handleTest(connection)}
                  disabled={busy}
                  title="Test the MCP connection"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-white/[0.08] hover:border-white/20 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                >
                  {busy ? (
                    <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5 text-white" />
                  )}
                  Test
                </button>

                <button
                  type="button"
                  onClick={() => setMenuId((id) => (id === connection.id ? null : connection.id))}
                  disabled={busy}
                  title="More actions"
                  aria-label="More actions"
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-1.5 text-white transition-colors hover:bg-white/[0.08] hover:border-white/20 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                >
                  <MoreHorizontal className="w-4 h-4 text-white" />
                </button>

                {menuId === connection.id ? (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setMenuId(null)}
                      aria-hidden="true"
                    />
                    <div className="absolute right-0 top-full mt-1.5 z-40 w-40 rounded-xl border border-white/[0.08] bg-[#111722] p-1 shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuId(null);
                          openEdit(connection);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-white transition-colors hover:bg-white/[0.06] cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5 text-white" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuId(null);
                          setConfirmDelete({ id: connection.id, name: connection.name });
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-white transition-colors hover:bg-red-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-white" />
                        Delete
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  const emptyState = (
    <div className="rounded-xl border border-dashed border-white/[0.1] bg-[#111722] px-4 py-5">
      <p className="text-[13px] font-semibold text-white">No MCP servers connected</p>
      <p className="mt-1 text-[12px] leading-relaxed text-[#8B93A7]">
        {variant === "panel"
          ? "Connect an external MCP server to give MICA access to its tools."
          : "Connect an MCP server to give MICA access to external tools."}
      </p>
      {variant === "panel" ? (
        <button
          type="button"
          onClick={openCreate}
          className="mt-3.5 inline-flex items-center gap-1.5 rounded-[10px] bg-[#6C5CE0] px-3.5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[#7A6BE8] cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-white" />
          Connect MCP
        </button>
      ) : null}
    </div>
  );

  const securityNote = (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <Lock className="w-3.5 h-3.5 text-white shrink-0" />
      <p className="text-[11px] leading-relaxed text-[#8B93A7]">
        Credentials are encrypted and never exposed to the browser.
      </p>
    </div>
  );

  const confirmDeleteBlock = (
    <AnimatePresence>
      {confirmDelete ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[130] flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setConfirmDelete(null)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 w-full max-w-[400px] rounded-2xl border border-white/[0.08] bg-[#111722] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
          >
            <h4 className="text-[13px] font-bold text-white">Delete MCP connection?</h4>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[#8B93A7]">
              "{confirmDelete.name}" and its stored credential will be permanently removed.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-[12px] font-semibold text-[#A7B0C0] transition-colors hover:border-white/20 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(confirmDelete)}
                disabled={busyId === confirmDelete.id}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-red-500/40 bg-red-500/10 px-3.5 py-2 text-[12px] font-semibold text-red-300 transition-colors hover:bg-red-500/20 cursor-pointer disabled:opacity-50"
              >
                {busyId === confirmDelete.id ? (
                  <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5 text-white" />
                )}
                Delete
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  const connectionModal = (
    <McpConnectionModal
      open={modalOpen}
      connection={editing}
      onClose={() => setModalOpen(false)}
      onSaved={handleSaved}
      onNotify={onNotify}
    />
  );

  // -------------------------------------------------------------------------
  // PANEL — body of the Chat Dashboard "MCP Connections" popup.
  // -------------------------------------------------------------------------
  if (variant === "panel") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">
            Connections
          </h3>
          {!loading && !loadError && connections.length > 0 ? (
            <span className="text-[11px] font-mono text-white/40">{connections.length}</span>
          ) : null}
        </div>

        {loading ? loadingBlock : null}
        {!loading ? errorBlock : null}
        {showEmpty ? emptyState : null}
        {listBlock}

        {securityNote}

        {confirmDeleteBlock}
        {connectionModal}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // SETTINGS — global Settings page card.
  // -------------------------------------------------------------------------
  return (
    <div className="bg-[#12172A]/60 border border-white/10 p-4.5 sm:p-5 rounded-2xl space-y-3.5">
      {/* Section header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Plug className="w-4 h-4 text-white shrink-0" />
          <div className="min-w-0">
            <h3 className="text-[11px] font-black text-white uppercase tracking-widest font-mono">
              MCP Connections
            </h3>
            <p className="text-[10px] text-[#8B93A7] font-medium">
              External Model Context Protocol servers
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="shrink-0 min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[10px] font-bold font-mono uppercase tracking-wider text-white hover:border-[#6C5CE0]/50 hover:bg-[#6C5CE0]/15 transition-colors duration-150 cursor-pointer"
        >
          <Plus className="w-3 h-3 text-white" />
          Add MCP
        </button>
      </div>

      {securityNote}

      {loading ? loadingBlock : null}
      {!loading ? errorBlock : null}
      {showEmpty ? emptyState : null}
      {listBlock}

      {confirmDeleteBlock}
      {connectionModal}
    </div>
  );
};

export default McpConnectionsSection;
