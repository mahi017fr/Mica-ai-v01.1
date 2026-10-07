// ─────────────────────────────────────────────────────────────────────────────
// MCP connectivity probe — runs exclusively on the MICA backend.
//
// Browser  →  MICA backend  →  (this module)  →  user's MCP server
//
// Implements the MCP "Streamable HTTP" client handshake using the official
// @modelcontextprotocol/sdk:
//   1. transport construction with the caller's auth header
//   2. initialize            (client.connect()
//   3. notifications/initialized + tool listing
//   4. record tool count, server name/version, latency
//
// SECURITY
//   - `secret` is supplied already-decrypted by the caller and is used only to
//     build an outbound header. It is never logged, never persisted, and never
//     returned.
//   - Every error message is passed through `redactSecrets()` first. This is
//     not paranoia: MCP servers frequently echo request headers back inside
//     error bodies and framework error text, so an unredacted string could
//     otherwise smuggle the token into a log line or an API response.
// ─────────────────────────────────────────────────────────────────────────────

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpAuthType } from "./mcpConnectionsService.js";

/** Client identity sent to the MCP server during `initialize`. */
const CLIENT_INFO = { name: "mica-mcp-connections", version: "0.1.1" } as const;

/** Hard ceiling for a full probe. Vercel's default function budget is 10s. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Diagnostics are capped so a hostile server cannot flood the log. */
const MAX_ERROR_CHARS = 240;

export interface McpProbeTarget {
  endpointUrl: string;
  authType: McpAuthType;
  /** Decrypted plaintext secret. Empty string for authType "none". */
  secret: string;
  /** Header name for authType "api_key_header" (e.g. "X-API-Key"). */
  secretHeaderName: string;
}

export interface McpProbeResult {
  status: "connected" | "failed";
  serverName: string | null;
  serverVersion: string | null;
  toolCount: number | null;
  latencyMs: number;
  /** Sanitized, secret-free explanation. Null when the probe succeeded. */
  error: string | null;
  /** Stable machine-readable reason for the UI. Null on success. */
  errorCode: string | null;
}

/**
 * Remove every known secret value from a string, plus any `Bearer <x>` /
 * `api-key`-style credential that slipped through from a server error body.
 * Returns a bounded, single-line string safe to log and to return to a client.
 */
export function redactSecrets(message: string, secrets: Array<string | null | undefined>): string {
  return redactSecretValues(message, secrets, MAX_ERROR_CHARS);
}

/**
 * Same redaction, but WITHOUT the diagnostic length cap. The MCP agent feeds
 * tool payloads through this so the model receives the full tool result; the
 * agent applies its own (much larger) tool-result budget afterwards.
 */
export function redactSecretsUnbounded(message: string, secrets: Array<string | null | undefined>): string {
  return redactSecretValues(message, secrets, null);
}

function redactSecretValues(
  message: string,
  secrets: Array<string | null | undefined>,
  maxChars: number | null
): string {
  let out = String(message ?? "");

  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length < 4) continue;
    out = out.split(secret).join("[REDACTED]");
    // Also catch URL-encoded / JSON-escaped variants of the same value.
    try {
      const encoded = encodeURIComponent(secret);
      if (encoded !== secret) out = out.split(encoded).join("[REDACTED]");
    } catch {
      /* ignore */
    }
    try {
      const jsonEscaped = JSON.stringify(secret).slice(1, -1);
      if (jsonEscaped !== secret) out = out.split(jsonEscaped).join("[REDACTED]");
    } catch {
      /* ignore */
    }
  }

  // Belt-and-braces: strip anything that still looks like a credential.
  out = out
    .replace(/\b(bearer|basic|token)\s+[A-Za-z0-9._\-+/=]{8,}/gi, "$1 [REDACTED]")
    .replace(/(authorization"?\s*[:=]\s*"?)[^",\s}]{8,}/gi, "$1[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();

  if (maxChars !== null && out.length > maxChars) return `${out.slice(0, maxChars)}…`;
  return out;
}

/**
 * Build the outbound request headers for the configured auth type.
 * Returns an empty object for "none".
 *
 * Shared by the probe and the agent so the credential-to-header mapping exists
 * in exactly one place.
 */
export function buildAuthHeaders(target: McpProbeTarget): Record<string, string> {
  const secret = typeof target.secret === "string" ? target.secret.trim() : "";
  if (target.authType === "none" || !secret) return {};

  if (target.authType === "bearer") {
    return { Authorization: `Bearer ${secret}` };
  }

  if (target.authType === "api_key_header") {
    const headerName = String(target.secretHeaderName || "").trim();
    // Guarded again here because the value may predate the current validator.
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(headerName)) return {};
    return { [headerName]: secret };
  }

  return {};
}

/** Map a thrown value onto a stable code + human-safe message. */
function classifyError(err: unknown, secrets: Array<string | null | undefined>): {
  code: string;
  message: string;
} {
  const name = err instanceof Error ? err.name : "";
  const raw = err instanceof Error ? err.message : String(err ?? "unknown error");

  if (name === "AbortError" || /abort|timed? ?out/i.test(raw)) {
    return { code: "TIMEOUT", message: "Timed out waiting for the MCP server to respond." };
  }
  if (name === "StreamableHTTPError") {
    return { code: "HTTP_ERROR", message: redactSecrets(raw, secrets) || "The MCP server returned an HTTP error." };
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(raw)) {
    return { code: "DNS_FAILED", message: "Could not resolve the MCP endpoint hostname." };
  }
  if (/ECONNREFUSED/i.test(raw)) {
    return { code: "CONNECTION_REFUSED", message: "The MCP server refused the connection." };
  }
  if (/ECONNRESET|socket hang up/i.test(raw)) {
    return { code: "CONNECTION_RESET", message: "The connection to the MCP server was reset." };
  }
  if (/certificate|CERT_|SSL|TLS/i.test(raw)) {
    return { code: "TLS_ERROR", message: "TLS verification failed for the MCP endpoint." };
  }
  if (/fetch failed|network|NetworkError/i.test(raw)) {
    return { code: "NETWORK_ERROR", message: redactSecrets(raw, secrets) || "Network error reaching the MCP server." };
  }
  if (/Unauthorized|401|authentication|invalid.*token|forbidden|403/i.test(raw)) {
    return { code: "UNAUTHORIZED", message: "The MCP server rejected the supplied credentials." };
  }

  return { code: "PROBE_FAILED", message: redactSecrets(raw, secrets) || "The MCP handshake failed." };
}

/** A live MCP session. Call `close()` exactly once when finished — it never throws. */
export interface McpSession {
  client: Client;
  close: () => Promise<void>;
}

/**
 * Open an authenticated MCP session: construct the transport with the caller's
 * auth header, connect (which performs `initialize` + `notifications/initialized`)
 * and return a live client.
 *
 * Shared by `probeMcpConnection` and the MCP agent so there is a single
 * handshake implementation. Throws on any failure — every caller is expected to
 * redact the message with the supplied secret before surfacing it.
 *
 * `timeoutMs: null` disables the session-wide abort timer (the agent instead
 * bounds each individual MCP operation itself).
 *
 * `connectTimeoutMs` bounds ONLY the `initialize` handshake: the connect
 * promise is raced against it, and on expiry the client is closed so the
 * in-flight POST is aborted too. It never fires against a healthy,
 * already-connected session. The agent uses it so an unresponsive MCP server
 * fails fast with a JSON error instead of holding a serverless invocation
 * open until the platform's own deadline.
 */
export async function openMcpSession(
  target: McpProbeTarget,
  options: { timeoutMs?: number | null; connectTimeoutMs?: number | null } = {}
): Promise<McpSession> {
  const timeoutMs = options.timeoutMs ?? null;
  const connectTimeoutMs = options.connectTimeoutMs ?? null;
  const abortController = new AbortController();

  // NOTE: `@modelcontextprotocol/sdk` spreads `requestInit` into its POST
  // requests but then OVERWRITES `signal` with its own internal controller, so
  // our `requestInit.signal` is never consulted. Aborting it therefore cancels
  // nothing. The only way to cancel an in-flight `initialize` / `tools/list`
  // POST is to close the transport, which aborts that internal controller.
  // Both deadlines below are implemented accordingly.
  let sessionClient: Client | null = null;
  const sessionTimer =
    timeoutMs === null
      ? null
      : setTimeout(
          () => void Promise.resolve(sessionClient?.close()).catch(() => undefined),
          Math.max(1, timeoutMs)
        );
  const clearSessionTimer = (): void => {
    if (sessionTimer) clearTimeout(sessionTimer);
  };

  try {
    const url = new URL(target.endpointUrl);
    const headers = buildAuthHeaders(target);

    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers,
        signal: abortController.signal,
        // Do not silently follow redirects: a redirect is a classic way to
        // bounce an SSRF-hardened request at an internal host.
        redirect: "error",
      },
    });

    const client = new Client(CLIENT_INFO, { capabilities: {} });
    sessionClient = client;

    // connect() performs `initialize` and then the `notifications/initialized`
    // handshake, so by the time it resolves the session is usable.
    const connecting = client.connect(transport);

    if (connectTimeoutMs !== null && connectTimeoutMs > 0) {
      let connectTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          connecting,
          new Promise<never>((_resolve, reject) => {
            connectTimer = setTimeout(
              () => reject(new Error(`MCP connect timed out after ${connectTimeoutMs}ms`)),
              Math.max(1, connectTimeoutMs)
            );
          }),
        ]);
      } finally {
        if (connectTimer) clearTimeout(connectTimer);
      }
    } else {
      await connecting;
    }

    const connected = client;
    return {
      client: connected,
      close: async () => {
        clearSessionTimer();
        // Never await a hanging close() — it must not delay the response.
        void Promise.resolve(connected.close()).catch(() => undefined);
      },
    };
  } catch (err: unknown) {
    clearSessionTimer();
    // Abandon any handshake still in flight (this also releases its socket).
    if (sessionClient) void Promise.resolve(sessionClient.close()).catch(() => undefined);
    throw err;
  }
}

/**
 * Connect to an MCP endpoint, complete the handshake, and enumerate its tools.
 *
 * Never throws: every failure mode is reported through `status: "failed"` with
 * a redacted `error` string. Always closes the transport.
 */
export async function probeMcpConnection(
  target: McpProbeTarget,
  options: { timeoutMs?: number | null } = {}
): Promise<McpProbeResult> {
  const timeoutMs = Math.max(2_000, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
  const startedAt = Date.now();

  // Only non-empty plaintexts are redaction inputs.
  const redactionInputs: Array<string | null | undefined> = [target.secret];
  let session: McpSession | null = null;

  try {
    session = await openMcpSession(target, { timeoutMs });

    const serverInfo = session.client.getServerVersion();

    // A server may legitimately expose no tools; treat a tools/list rejection
    // as non-fatal so the connection still reads as Connected.
    let toolCount: number | null = null;
    try {
      const listed = await session.client.listTools();
      toolCount = Array.isArray(listed?.tools) ? listed.tools.length : 0;
    } catch {
      toolCount = null;
    }

    const serverName =
      typeof serverInfo?.name === "string" && serverInfo.name.trim()
        ? redactSecrets(serverInfo.name.trim(), redactionInputs)
        : null;
    const serverVersion =
      typeof serverInfo?.version === "string" && serverInfo.version.trim()
        ? redactSecrets(serverInfo.version.trim(), redactionInputs)
        : null;

    return {
      status: "connected",
      serverName,
      serverVersion,
      toolCount,
      latencyMs: Math.max(0, Date.now() - startedAt),
      error: null,
      errorCode: null,
    };
  } catch (err: unknown) {
    const classified = classifyError(err, redactionInputs);
    return {
      status: "failed",
      serverName: null,
      serverVersion: null,
      toolCount: null,
      latencyMs: Math.max(0, Date.now() - startedAt),
      error: classified.message,
      errorCode: classified.code,
    };
  } finally {
    if (session) void session.close();
  }
}
