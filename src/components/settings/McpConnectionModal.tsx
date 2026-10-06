import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Loader2,
  AlertTriangle,
  KeyRound,
  Eye,
  EyeOff,
  ChevronDown,
} from "lucide-react";
import {
  McpApiError,
  createMcpConnection,
  updateMcpConnection,
  type McpAuthType,
  type McpConnection,
} from "../../api/mcp";

interface McpConnectionModalProps {
  open: boolean;
  /** The connection being edited, or null to create a new one. */
  connection: McpConnection | null;
  onClose: () => void;
  onSaved: (connection: McpConnection) => void;
  onNotify: (message: string, kind?: "success" | "error" | "info") => void;
}

const MASK_PLACEHOLDER = "••••••••";

const AUTH_OPTIONS: Array<{ value: McpAuthType; label: string; hint: string }> = [
  { value: "none", label: "None", hint: "No credentials are sent to the server." },
  { value: "bearer", label: "Bearer Token", hint: "Sent as an Authorization: Bearer header." },
  {
    value: "api_key_header",
    label: "API Key",
    hint: "Sent in a custom header, e.g. X-API-Key.",
  },
];

/**
 * Add / Edit a single MCP connection.
 *
 * FORM CONSTRAINT — this modal is rendered from inside the Settings page,
 * which is itself one large `<form onSubmit={handleSaveProfile}>`. Two
 * safeguards keep the two concerns apart:
 *   1. The modal is portalled to `document.body`, so it is not a DOM descendant
 *      of that form at all.
 *   2. There is deliberately no `<form>` element here, and every button carries
 *      an explicit `type="button"`.
 * Enter is additionally swallowed on the inputs so it can never submit the
 * profile form underneath.
 */
const McpConnectionModal: React.FC<McpConnectionModalProps> = ({
  open,
  connection,
  onClose,
  onSaved,
  onNotify,
}) => {
  const isEditing = Boolean(connection);

  const [name, setName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [authType, setAuthType] = useState<McpAuthType>("none");
  const [secret, setSecret] = useState("");
  const [secretHeaderName, setSecretHeaderName] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to a clean draft each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setName(connection?.name ?? "");
    setEndpointUrl(connection?.endpointUrl ?? "");
    setAuthType(connection?.authType ?? "none");
    // The stored secret is never fetched — it cannot be, by design. The field
    // starts empty, which the server reads as "keep the existing secret".
    setSecret("");
    // `secretHeaderName` is not part of the API response either, so it starts
    // blank on edit and the server keeps the stored value unless a new one is
    // supplied.
    setSecretHeaderName("");
    setShowSecret(false);
    setSaving(false);
    setError(null);
  }, [open, connection]);

  if (!open) return null;

  const needsSecret = authType !== "none";
  const hasStoredSecret = Boolean(connection?.hasSecret);
  const keepExistingSecret = isEditing && hasStoredSecret && secret.trim().length === 0;
  const activeAuth = AUTH_OPTIONS.find((o) => o.value === authType) ?? AUTH_OPTIONS[0];

  const trimmedUrl = endpointUrl.trim();
  const urlHint = (() => {
    if (!trimmedUrl) return null;
    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol === "http:" && parsed.hostname !== "localhost" && !parsed.hostname.startsWith("127.")) {
        return "Plain http:// is only accepted for localhost during development.";
      }
      return null;
    } catch {
      return "Enter a full URL including the scheme, e.g. https://example.com/mcp";
    }
  })();

  const handleSave = async () => {
    if (saving) return;
    setError(null);

    if (!name.trim()) {
      setError("Connection name is required.");
      return;
    }
    if (!trimmedUrl) {
      setError("Server URL is required.");
      return;
    }
    if (needsSecret && !secret.trim() && !hasStoredSecret) {
      setError(authType === "bearer" ? "An access token is required." : "An API key is required.");
      return;
    }
    if (authType === "api_key_header" && !secretHeaderName.trim() && !connection) {
      setError("A header name is required for API Key authentication.");
      return;
    }

    setSaving(true);
    try {
      if (connection) {
        // Omit `secret` entirely when blank so the stored value is preserved.
        const payload: Parameters<typeof updateMcpConnection>[1] = {
          name: name.trim(),
          endpointUrl: trimmedUrl,
          authType,
        };
        if (secret.trim()) payload.secret = secret;
        if (authType === "api_key_header" && secretHeaderName.trim()) {
          payload.secretHeaderName = secretHeaderName.trim();
        }
        const saved = await updateMcpConnection(connection.id, payload);
        onNotify(`MCP connection "${saved.name}" updated.`, "success");
        onSaved(saved);
      } else {
        const saved = await createMcpConnection({
          name: name.trim(),
          endpointUrl: trimmedUrl,
          authType,
          secret: secret.trim(),
          secretHeaderName: authType === "api_key_header" ? secretHeaderName.trim() : "",
        });
        onNotify(`MCP connection "${saved.name}" added.`, "success");
        onSaved(saved);
      }
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof McpApiError ? err.message : "Could not save the MCP connection.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  /** Never let Enter reach the parent profile form. */
  const blockEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.preventDefault();
  };

  const inputCls =
    "w-full rounded-xl border border-white/[0.08] bg-[#0B0F17] px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 focus:border-[#6C5CE0]/60 focus:outline-none focus:ring-2 focus:ring-[#6C5CE0]/15 transition-colors";
  const labelCls =
    "block mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8B93A7]";

  const modal = (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={saving ? undefined : onClose}
            className="absolute inset-0 bg-black/65"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 w-full max-w-[520px] max-h-[88vh] flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111722] shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
          >
            {/* Header */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.08] px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white">
                  {isEditing ? "Edit MCP Connection" : "Connect MCP"}
                </h3>
                <p className="mt-1 text-[12px] leading-relaxed text-[#8B93A7]">
                  {isEditing
                    ? "Update the endpoint or rotate the stored credential"
                    : "Register an external tool server for your MICA agent"}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                title="Close"
                aria-label="Close"
                className="shrink-0 rounded-[10px] p-1.5 text-white transition-colors hover:bg-white/[0.06] cursor-pointer"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-4 space-y-4">
              <div>
                <label className={labelCls} htmlFor="mcp_field_name">
                  Name
                </label>
                <input
                  id="mcp_field_name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={blockEnter}
                  placeholder="e.g. AGP Race"
                  autoFocus
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor="mcp_field_url">
                  Server URL
                </label>
                <input
                  id="mcp_field_url"
                  type="url"
                  value={endpointUrl}
                  onChange={(e) => setEndpointUrl(e.target.value)}
                  onKeyDown={blockEnter}
                  placeholder="https://example.com/mcp"
                  spellCheck={false}
                  autoComplete="off"
                  className={`${inputCls} font-mono`}
                />
                {urlHint ? (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-400">
                    <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-white" />
                    {urlHint}
                  </p>
                ) : null}
              </div>

              <div>
                <label className={labelCls} htmlFor="mcp_field_auth">
                  Authentication
                </label>
                <div className="relative">
                  <select
                    id="mcp_field_auth"
                    value={authType}
                    onChange={(e) => {
                      setAuthType(e.target.value as McpAuthType);
                      setError(null);
                    }}
                    className={`${inputCls} cursor-pointer appearance-none pr-9`}
                  >
                    {AUTH_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} className="bg-[#0B0F17]">
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white" />
                </div>
                <p className="mt-1.5 text-[11px] text-[#8B93A7]">{activeAuth.hint}</p>
              </div>

              {authType === "api_key_header" ? (
                <div>
                  <label className={labelCls} htmlFor="mcp_field_header">
                    Header Name
                  </label>
                  <input
                    id="mcp_field_header"
                    type="text"
                    value={secretHeaderName}
                    onChange={(e) => setSecretHeaderName(e.target.value)}
                    onKeyDown={blockEnter}
                    placeholder="X-API-Key"
                    spellCheck={false}
                    autoComplete="off"
                    className={`${inputCls} font-mono`}
                  />
                  {!connection ? null : (
                    <p className="mt-1.5 text-[11px] text-[#8B93A7]">
                      Leave blank to keep the header name currently in use.
                    </p>
                  )}
                </div>
              ) : null}

              {needsSecret ? (
                <div>
                  <label className={labelCls} htmlFor="mcp_field_secret">
                    {authType === "bearer" ? "Access Token" : "API Key"}
                  </label>
                  <div className="relative">
                    <input
                      id="mcp_field_secret"
                      type={showSecret ? "text" : "password"}
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      onKeyDown={blockEnter}
                      placeholder={hasStoredSecret ? MASK_PLACEHOLDER : ""}
                      spellCheck={false}
                      autoComplete="off"
                      className={`${inputCls} pr-10 font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      title={showSecret ? "Hide value" : "Show value"}
                      aria-label={showSecret ? "Hide value" : "Show value"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-white transition-colors hover:bg-white/[0.06] cursor-pointer"
                    >
                      {showSecret ? (
                        <EyeOff className="h-3.5 w-3.5 text-white" />
                      ) : (
                        <Eye className="h-3.5 w-3.5 text-white" />
                      )}
                    </button>
                  </div>
                  {keepExistingSecret ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[#8B93A7]">
                      A credential is already stored. Leave this blank to keep it.
                    </p>
                  ) : (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-[#8B93A7]">
                      <KeyRound className="mt-px h-3 w-3 shrink-0 text-white" />
                      Encrypted on the MICA server before storage. It is never sent back to this
                      browser.
                    </p>
                  )}
                </div>
              ) : null}

              {error ? (
                <p className="flex items-start gap-2 text-[12px] leading-relaxed text-red-400">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-white" />
                  {error}
                </p>
              ) : null}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.08] px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-[12px] font-semibold text-[#A7B0C0] transition-colors hover:border-white/20 hover:text-white cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#6C5CE0] px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[#7A6BE8] cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
                    Saving
                  </>
                ) : isEditing ? (
                  "Save Changes"
                ) : (
                  "Connect MCP"
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  // Portal out of the Settings <form> so the two forms can never interact.
  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
};

export default McpConnectionModal;
