// ─────────────────────────────────────────────────────────────────────────────
// MCP Connections — server-side service layer.
//
// Owns every read/write of the `mcp_connections` Firestore collection. The
// browser NEVER touches this collection: firestore.rules denies all direct
// client access, and all reads/writes flow through the authenticated API below.
//
//   Browser ──Bearer FirebaseIDToken──> /api/mcp/* ──> mcpConnectionsService ──> Firestore
//                                                                       └──> probeMcpConnection ──> user's MCP server
//
// SECURITY INVARIANTS
//   1. Ownership is derived from the verified Firebase uid only. A caller can
//      never read or mutate another user's connections by guessing an id.
//   2. `secretCiphertext` is written encrypted (AES-256-GCM, AAD-bound to the
//      connection id) and is never present in any response, log, or error.
//   3. Responses are built by an explicit whitelist serializer, so adding a new
//      stored field can never accidentally leak it.
//   4. Plaintext secrets are decrypted only inside the test flow, immediately
//      before the outbound request, and never persisted.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import {
  verifyFirebaseToken,
  firestoreGet,
  firestoreSet,
  firestoreList,
  firestoreDelete,
} from "./circleWalletService.js";
import {
  encryptSecret,
  decryptSecret,
  isSecretCryptoConfigured,
  SecretCryptoError,
} from "./secretCrypto.js";
import { probeMcpConnection, redactSecrets } from "./mcpProbe.js";
import type { McpProbeTarget } from "./mcpProbe.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MCP_COLLECTION = "mcp_connections";

export const MCP_AUTH_TYPES = ["none", "bearer", "api_key_header"] as const;
export type McpAuthType = (typeof MCP_AUTH_TYPES)[number];

export const MCP_STATUSES = ["untested", "connected", "failed"] as const;
export type McpConnectionStatus = (typeof MCP_STATUSES)[number];

const MAX_NAME_CHARS = 64;
const MAX_URL_CHARS = 2048;
const MAX_SECRET_CHARS = 8192;
const MAX_HEADER_NAME_CHARS = 64;
const MAX_CONNECTIONS_PER_USER = 50;

/**
 * True when running as a deployed serverless function. In this mode plain HTTP
 * and every non-public address are refused outright.
 */
function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** An error whose `message` is always safe to return to the client. */
export class McpError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ---------------------------------------------------------------------------
// Auth helper — mirrors the pattern used by every other MICA service.
// ---------------------------------------------------------------------------

/**
 * Verify the caller's Firebase ID token and return their uid.
 * Throws `McpError` (401) for a missing / invalid / expired token.
 */
async function authenticate(authHeader: string | undefined | null): Promise<string> {
  const raw = typeof authHeader === "string" ? authHeader : "";
  const idToken = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  if (!idToken) {
    throw new McpError("UNAUTHORIZED", "Missing Firebase ID token in Authorization header.", 401);
  }
  try {
    const { uid } = await verifyFirebaseToken(idToken);
    if (!uid) throw new Error("no uid");
    return uid;
  } catch {
    throw new McpError("UNAUTHORIZED", "Invalid or expired Firebase ID token.", 401);
  }
}

// ---------------------------------------------------------------------------
// SSRF guards
// ---------------------------------------------------------------------------

/** IPv4 ranges that must never be reachable from a user-supplied MCP URL. */
function isBlockedIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;

  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8   "this network"
  if (a === 10) return true; // 10.0.0.0/8  private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** IPv6 loopback, unspecified, unique-local, link-local and v4-mapped forms. */
function isBlockedIpv6(host: string): boolean {
  const value = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (!value.includes(":")) return false;

  if (value === "::1" || value === "::") return true;
  // fc00::/7 unique-local, fe80::/10 link-local.
  const head = value.split(":")[0];
  if (/^fe[89ab][0-9a-f]?$/.test(head) && head.length === 4) return true;
  const firstByte = parseInt(head.padStart(4, "0").slice(0, 2), 16);
  if (Number.isNaN(firstByte)) return true;
  if ((firstByte & 0xfe) === 0xfc) return true;

  // v4-mapped (::ffff:1.2.3.4) and NAT64 (64:ff9b::/96) embed an IPv4 address.
  const embedded = value.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (embedded) {
    if (isIP(embedded[0]) === 4) return isBlockedIpv4(embedded[0]);
  }
  if (value.startsWith("64:ff9b:")) return true;
  return false;
}

/** Hostnames that resolve to loopback, a LAN, or a cloud metadata service. */
function isBlockedHostname(rawHost: string): boolean {
  const host = rawHost.replace(/^\[/, "").replace(/\]$/, "").toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost") return true;
  if (host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true;
  if (host.endsWith(".internal")) return true;
  if (host.endsWith(".home.arpa")) return true;
  if (host === "metadata" || host === "metadata.google.internal") return true;
  if (host === "instance-data") return true;
  // A bare label with no dot can only be an intranet short name.
  if (!host.includes(".")) return true;
  return false;
}

/**
 * Validate a user-supplied MCP endpoint.
 *
 * Production: `https:` only, and never an internal/loopback address.
 * Development: `https:` anywhere public; `http:` permitted only for loopback so
 * a locally-running MCP server can be exercised during development.
 */
export function validateEndpointUrl(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new McpError("INVALID_URL", "MCP endpoint URL is required.");
  }
  const raw = input.trim();
  if (raw.length > MAX_URL_CHARS) {
    throw new McpError("INVALID_URL", `MCP endpoint URL must be at most ${MAX_URL_CHARS} characters.`);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpError("INVALID_URL", "MCP endpoint URL is not a valid URL.");
  }

  const protocol = url.protocol.toLowerCase();
  const host = url.hostname;
  const hostLower = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  if (protocol !== "https:" && protocol !== "http:") {
    throw new McpError("INVALID_URL", "MCP endpoint URL must use http:// or https://.");
  }

  const isLoopbackHost =
    host === "127.0.0.1" || hostLower === "::1" || hostLower === "localhost";

  let allowLoopbackInsecure = false;

  if (protocol === "http:") {
    if (isProductionRuntime()) {
      throw new McpError("INSECURE_URL", "MCP endpoint URL must use https:// in production.");
    }
    // Development-only escape hatch so a locally-running MCP server can be
    // exercised. Deliberately narrow: loopback only, and never in production.
    if (!isLoopbackHost) {
      throw new McpError(
        "INSECURE_URL",
        "Plain http:// is only allowed for localhost during development.",
      );
    }
    allowLoopbackInsecure = true;
  }

  const hostIsLiteralIp = isIP(host) !== 0;
  const blockedAddress = hostIsLiteralIp
    ? isIP(host) === 4
      ? isBlockedIpv4(host)
      : isBlockedIpv6(host)
    : isBlockedHostname(host);

  // An https:// URL is always subject to the address blocklist. A dev loopback
  // http:// URL is the single intentional exception.
  if (blockedAddress && !allowLoopbackInsecure) {
    throw new McpError(
      "BLOCKED_HOST",
      "MCP endpoint URL points to a private, loopback, or metadata address, which is not allowed.",
    );
  }

  if (url.username || url.password) {
    throw new McpError(
      "INVALID_URL",
      "MCP endpoint URL must not embed credentials. Use the Authentication fields instead.",
    );
  }

  // Normalize: drop the fragment (meaningless for HTTP), keep the rest intact.
  url.hash = "";
  return url.toString();
}

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

function normalizeName(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new McpError("INVALID_NAME", "Connection name is required.");
  }
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length > MAX_NAME_CHARS) {
    throw new McpError("INVALID_NAME", `Connection name must be at most ${MAX_NAME_CHARS} characters.`);
  }
  return value;
}

function normalizeAuthType(input: unknown): McpAuthType {
  if (typeof input !== "string" || !input.trim()) return "none";
  const value = input.trim().toLowerCase();
  if (!MCP_AUTH_TYPES.includes(value as McpAuthType)) {
    throw new McpError(
      "INVALID_AUTH_TYPE",
      `Authentication type must be one of: ${MCP_AUTH_TYPES.join(", ")}.`,
    );
  }
  return value as McpAuthType;
}

function normalizeHeaderName(input: unknown): string {
  if (input === undefined || input === null || input === "") return "";
  if (typeof input !== "string") {
    throw new McpError("INVALID_HEADER_NAME", "Header name must be a string.");
  }
  const value = input.trim();
  if (!value) return "";
  // RFC 7230 token characters.
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(value) || value.length > MAX_HEADER_NAME_CHARS) {
    throw new McpError(
      "INVALID_HEADER_NAME",
      "Header name must be a valid HTTP header token (letters, digits and - _ . only).",
    );
  }
  return value;
}

/**
 * Read the incoming secret. Returns "" when the field is absent or blank,
 * which every caller interprets as "keep the existing secret" on update.
 * The value is NEVER logged or echoed, only length-checked here.
 */
function normalizeSecretInput(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input !== "string") {
    throw new McpError("INVALID_SECRET", "Secret must be a string.");
  }
  if (!input.trim()) return "";
  if (input.length > MAX_SECRET_CHARS) {
    throw new McpError("INVALID_SECRET", "Secret is too long.");
  }
  return input;
}

function requireEncryptionConfigured(): void {
  if (!isSecretCryptoConfigured()) {
    throw new McpError(
      "ENCRYPTION_NOT_CONFIGURED",
      "Server secret storage is not configured. Set MICA_SECRET_ENCRYPTION_KEY on the backend.",
      500,
    );
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function newConnectionId(): string {
  // 24 hex chars — Firestore-safe, and not guessable.
  return randomBytes(12).toString("hex");
}

// ---------------------------------------------------------------------------
// Safe serializer — the ONLY way connection data leaves the server.
// `secretCiphertext` has no entry here, by construction.
// ---------------------------------------------------------------------------

export interface SafeMcpConnection {
  id: string;
  name: string;
  endpointUrl: string;
  authType: McpAuthType;
  hasSecret: boolean;
  status: McpConnectionStatus;
  lastTestedAt: string | null;
  lastError: string | null;
  serverName: string | null;
  serverVersion: string | null;
  toolCount: number | null;
  latencyMs: number | null;
  createdAt: string;
  updatedAt: string;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function statusOf(value: unknown): McpConnectionStatus {
  return MCP_STATUSES.includes(value as McpConnectionStatus)
    ? (value as McpConnectionStatus)
    : "untested";
}

export function toSafeMcpConnection(
  id: string,
  doc: Record<string, unknown>
): SafeMcpConnection {
  return {
    id,
    name: str(doc.name) ?? "Unnamed connection",
    endpointUrl: str(doc.endpointUrl) ?? "",
    authType: normalizeAuthType(doc.authType),
    hasSecret: typeof doc.secretCiphertext === "string" && doc.secretCiphertext.length > 0,
    status: statusOf(doc.status),
    lastTestedAt: str(doc.lastTestedAt),
    lastError: str(doc.lastError),
    serverName: str(doc.serverName),
    serverVersion: str(doc.serverVersion),
    toolCount: num(doc.toolCount),
    latencyMs: num(doc.latencyMs),
    createdAt: str(doc.createdAt) ?? nowIso(),
    updatedAt: str(doc.updatedAt) ?? str(doc.createdAt) ?? nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Load a connection and assert it belongs to `uid`. Throws 404 otherwise. */
async function loadOwnedConnection(uid: string, id: string): Promise<{
  id: string;
  doc: Record<string, unknown>;
}> {
  if (!/^[a-f0-9]{24}$/.test(String(id ?? ""))) {
    throw new McpError("NOT_FOUND", "MCP connection not found.", 404);
  }
  const doc = await firestoreGet(`${MCP_COLLECTION}/${id}`);
  // A missing doc and someone else's doc are indistinguishable on purpose.
  if (!doc || doc.uid !== uid) {
    throw new McpError("NOT_FOUND", "MCP connection not found.", 404);
  }
  return { id, doc };
}

/**
 * Resolve the plaintext secret for an outbound probe.
 * Only ever called inside the test flow; the result is never stored or logged.
 */
function decryptForProbe(id: string, doc: Record<string, unknown>): string {
  const ciphertext = typeof doc.secretCiphertext === "string" ? doc.secretCiphertext : "";
  if (!ciphertext) return "";
  try {
    // AAD must match the value used at encrypt time.
    return decryptSecret(ciphertext, id);
  } catch (err: unknown) {
    if (err instanceof SecretCryptoError) {
      throw new McpError("SECRET_DECRYPT_FAILED", err.message, 500);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Agent support — resolve the connection the MCP agent is allowed to use.
// ---------------------------------------------------------------------------

/** Everything the agent needs to reach one of the caller's own connections. */
export interface McpAgentConnection {
  uid: string;
  /** Whitelist-serialized connection — the only shape ever sent to a client. */
  connection: SafeMcpConnection;
  /**
   * Decrypted outbound target. Stays on the server: handed straight to the MCP
   * client for one session, never serialized, never logged.
   */
  target: McpProbeTarget;
}

/**
 * Authenticate the caller and resolve the MCP connection their agent may use.
 *
 * Selection rules when no explicit id is supplied:
 *   1. connections whose last probe succeeded, most recently tested first;
 *   2. otherwise the most recently created connection;
 *   3. no connections at all -> `NO_MCP_CONNECTION` (404).
 *
 * The endpoint is re-validated with the same SSRF guard used on save, and the
 * secret is decrypted only after ownership is proven.
 */
export async function prepareMcpAgentConnection(
  authHeader: string | undefined,
  connectionId?: string
): Promise<McpAgentConnection> {
  const uid = await authenticate(authHeader);

  let id: string;
  let doc: Record<string, unknown>;

  if (connectionId) {
    ({ id, doc } = await loadOwnedConnection(uid, connectionId));
  } else {
    const owned = await firestoreList(MCP_COLLECTION, { field: "uid", equals: uid });
    const candidates = owned
      .map((entry) => ({ id: str(entry.id), doc: entry }))
      .filter((entry): entry is { id: string; doc: Record<string, unknown> } => !!entry.id);

    if (candidates.length === 0) {
      throw new McpError(
        "NO_MCP_CONNECTION",
        "No MCP connection is configured for this account. Connect a server in Settings → MCP Connections first.",
        404,
      );
    }

    const recency = (a: { doc: Record<string, unknown> }, b: { doc: Record<string, unknown> }) =>
      String(b.doc.lastTestedAt ?? b.doc.createdAt ?? "").localeCompare(
        String(a.doc.lastTestedAt ?? a.doc.createdAt ?? "")
      );

    const connected = candidates
      .filter((entry) => statusOf(entry.doc.status) === "connected")
      .sort(recency);
    const newest = [...candidates].sort((a, b) =>
      String(b.doc.createdAt ?? "").localeCompare(String(a.doc.createdAt ?? ""))
    );

    const chosen = connected[0] ?? newest[0];
    id = chosen.id;
    doc = chosen.doc;
  }

  const authType = normalizeAuthType(doc.authType);
  // Re-validated on every agent run: a host that became internal since save
  // must never be dialled.
  const endpointUrl = validateEndpointUrl(str(doc.endpointUrl) ?? "");

  if (authType !== "none") {
    requireEncryptionConfigured();
  }
  const secret = decryptForProbe(id, doc);

  return {
    uid,
    connection: toSafeMcpConnection(id, doc),
    target: {
      endpointUrl,
      authType,
      secret,
      secretHeaderName: str(doc.secretHeaderName) ?? "",
    },
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleMcpListConnections(
  authHeader: string | undefined
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const uid = await authenticate(authHeader);
  const docs = await firestoreList(MCP_COLLECTION, { field: "uid", equals: uid });

  const connections = docs
    .map((doc) => {
      const id = str(doc.id);
      return id ? toSafeMcpConnection(id, doc) : null;
    })
    .filter((c): c is SafeMcpConnection => c !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return { httpStatus: 200, body: { ok: true, connections } };
}

export async function handleMcpCreateConnection(
  authHeader: string | undefined,
  body: Record<string, unknown>
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const uid = await authenticate(authHeader);

  const existing = await firestoreList(MCP_COLLECTION, { field: "uid", equals: uid });
  if (existing.length >= MAX_CONNECTIONS_PER_USER) {
    throw new McpError(
      "LIMIT_REACHED",
      `You can store at most ${MAX_CONNECTIONS_PER_USER} MCP connections.`,
      409,
    );
  }

  const name = normalizeName(body?.name);
  const endpointUrl = validateEndpointUrl(body?.endpointUrl);
  const authType = normalizeAuthType(body?.authType);
  const secretInput = normalizeSecretInput(body?.secret);
  const headerName = normalizeHeaderName(body?.secretHeaderName);

  if (authType === "none" && secretInput) {
    throw new McpError(
      "INVALID_AUTH_TYPE",
      "Authentication is set to None, so no token should be supplied.",
    );
  }
  if (authType === "bearer" && !secretInput) {
    throw new McpError("SECRET_REQUIRED", "A bearer token is required for Bearer authentication.");
  }
  if (authType === "api_key_header") {
    if (!headerName) {
      throw new McpError("HEADER_NAME_REQUIRED", "A header name is required for API Key authentication.");
    }
    if (!secretInput) {
      throw new McpError("SECRET_REQUIRED", "An API key is required for API Key authentication.");
    }
  }

  requireEncryptionConfigured();

  const id = newConnectionId();
  const timestamp = nowIso();

  const record: Record<string, unknown> = {
    uid,
    id,
    name,
    endpointUrl,
    authType,
    secretHeaderName: authType === "api_key_header" ? headerName : "",
    // Encrypt only when there is something to protect.
    secretCiphertext: secretInput ? encryptSecret(secretInput, id) : "",
    status: "untested",
    lastTestedAt: null,
    lastError: null,
    serverName: null,
    serverVersion: null,
    toolCount: null,
    latencyMs: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await firestoreSet(`${MCP_COLLECTION}/${id}`, record);

  return { httpStatus: 201, body: { ok: true, connection: toSafeMcpConnection(id, record) } };
}

export async function handleMcpUpdateConnection(
  authHeader: string | undefined,
  id: string | undefined,
  body: Record<string, unknown>
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const uid = await authenticate(authHeader);
  const { id: connectionId, doc } = await loadOwnedConnection(uid, id ?? "");

  const patch: Record<string, unknown> = { updatedAt: nowIso() };

  if (body?.name !== undefined) patch.name = normalizeName(body.name);
  if (body?.endpointUrl !== undefined) patch.endpointUrl = validateEndpointUrl(body.endpointUrl);

  const previousAuthType = normalizeAuthType(doc.authType);
  const nextAuthType =
    body?.authType !== undefined ? normalizeAuthType(body.authType) : previousAuthType;

  if (body?.authType !== undefined) patch.authType = nextAuthType;
  if (body?.secretHeaderName !== undefined) {
    patch.secretHeaderName = normalizeHeaderName(body.secretHeaderName);
  }

  // Blank secret = "keep the stored one". This is what lets the UI show a
  // masked placeholder and still save unrelated edits.
  const secretInput = normalizeSecretInput(body?.secret);
  const hasStoredSecret = typeof doc.secretCiphertext === "string" && doc.secretCiphertext.length > 0;

  if (secretInput) {
    requireEncryptionConfigured();
    patch.secretCiphertext = encryptSecret(secretInput, connectionId);
  } else if (!hasStoredSecret) {
    patch.secretCiphertext = "";
  }

  const effectiveHeaderName =
    typeof patch.secretHeaderName === "string"
      ? (patch.secretHeaderName as string)
      : typeof doc.secretHeaderName === "string"
        ? (doc.secretHeaderName as string)
        : "";

  const effectiveHasSecret =
    typeof patch.secretCiphertext === "string"
      ? (patch.secretCiphertext as string).length > 0
      : hasStoredSecret;

  // Validate the resulting combination, not just each field in isolation.
  if (nextAuthType === "bearer" && !effectiveHasSecret) {
    throw new McpError("SECRET_REQUIRED", "A bearer token is required for Bearer authentication.");
  }
  if (nextAuthType === "api_key_header") {
    if (!effectiveHeaderName) {
      throw new McpError("HEADER_NAME_REQUIRED", "A header name is required for API Key authentication.");
    }
    if (!effectiveHasSecret) {
      throw new McpError("SECRET_REQUIRED", "An API key is required for API Key authentication.");
    }
  }

  if (nextAuthType === "none") {
    patch.secretCiphertext = "";
    patch.secretHeaderName = "";
  } else if (nextAuthType !== "api_key_header") {
    patch.secretHeaderName = "";
  }

  // Any change to the transport details invalidates the previous verdict.
  const transportChanged =
    patch.endpointUrl !== undefined ||
    nextAuthType !== previousAuthType ||
    secretInput !== "" ||
    (patch.secretHeaderName !== undefined && patch.secretHeaderName !== doc.secretHeaderName);

  if (transportChanged) {
    patch.status = "untested";
    patch.lastError = null;
    patch.serverName = null;
    patch.serverVersion = null;
    patch.toolCount = null;
    patch.latencyMs = null;
  }

  await firestoreSet(`${MCP_COLLECTION}/${connectionId}`, patch);

  const merged = { ...doc, ...patch };
  return {
    httpStatus: 200,
    body: { ok: true, connection: toSafeMcpConnection(connectionId, merged) },
  };
}

export async function handleMcpDeleteConnection(
  authHeader: string | undefined,
  id: string | undefined
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const uid = await authenticate(authHeader);
  const { id: connectionId } = await loadOwnedConnection(uid, id ?? "");
  await firestoreDelete(`${MCP_COLLECTION}/${connectionId}`);
  return { httpStatus: 200, body: { ok: true, deletedId: connectionId } };
}

/**
 * Probe a stored connection and persist the outcome.
 *
 * This is the ONLY place a plaintext secret is materialized. It is handed
 * straight to `probeMcpConnection`, used to build one outbound header, and then
 * becomes garbage. It is never written back to Firestore.
 */
export async function handleMcpTestConnection(
  authHeader: string | undefined,
  id: string | undefined
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const uid = await authenticate(authHeader);
  const { id: connectionId, doc } = await loadOwnedConnection(uid, id ?? "");

  const authType = normalizeAuthType(doc.authType);
  const endpointUrl = str(doc.endpointUrl) ?? "";

  // Re-validate on every probe, not just on save, so a host that becomes
  // internal (DNS change) cannot be dialled later.
  let safeEndpoint = endpointUrl;
  try {
    safeEndpoint = validateEndpointUrl(endpointUrl);
  } catch (err: unknown) {
    if (err instanceof McpError) {
      await firestoreSet(`${MCP_COLLECTION}/${connectionId}`, {
        status: "failed",
        lastTestedAt: nowIso(),
        lastError: err.message,
        updatedAt: nowIso(),
      });
      return {
        httpStatus: 200,
        body: {
          ok: true,
          connection: toSafeMcpConnection(connectionId, {
            ...doc,
            status: "failed",
            lastError: err.message,
          }),
        },
      };
    }
    throw err;
  }

  if (authType !== "none") {
    requireEncryptionConfigured();
  }

  let secret = "";
  try {
    secret = decryptForProbe(connectionId, doc);
  } catch (err: unknown) {
    if (err instanceof McpError) {
      await firestoreSet(`${MCP_COLLECTION}/${connectionId}`, {
        status: "failed",
        lastTestedAt: nowIso(),
        lastError: err.message,
        updatedAt: nowIso(),
      });
      return {
        httpStatus: 200,
        body: {
          ok: true,
          connection: toSafeMcpConnection(connectionId, {
            ...doc,
            status: "failed",
            lastError: err.message,
          }),
        },
      };
    }
    throw err;
  }

  const result = await probeMcpConnection({
    endpointUrl: safeEndpoint,
    authType,
    secret,
    secretHeaderName: str(doc.secretHeaderName) ?? "",
  });

  // Final safety net: even a locally-built string is scrubbed before storage,
  // because `lastError` is read back and displayed in the browser.
  const safeError = result.error ? redactSecrets(result.error, [secret]) : null;
  const safeServerName = result.serverName ? redactSecrets(result.serverName, [secret]) : null;

  const patch: Record<string, unknown> = {
    status: result.status,
    lastTestedAt: nowIso(),
    lastError: safeError,
    serverName: safeServerName,
    serverVersion: result.serverVersion,
    toolCount: result.toolCount,
    latencyMs: result.latencyMs,
    updatedAt: nowIso(),
  };

  await firestoreSet(`${MCP_COLLECTION}/${connectionId}`, patch);

  return {
    httpStatus: 200,
    body: {
      ok: true,
      connection: toSafeMcpConnection(connectionId, { ...doc, ...patch }),
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch — shared by api/mcp/[...path].ts, server.ts and vite.config.ts so all
// three runtimes execute byte-identical logic.
// ---------------------------------------------------------------------------

export type McpRouteKey =
  | "connections:list"
  | "connections:create"
  | "connections:update"
  | "connections:delete"
  | "connections:test"
  | "agent:chat";

export const MCP_ROUTE_METHODS: Record<McpRouteKey, string[]> = {
  "connections:list": ["GET"],
  "connections:create": ["POST"],
  "connections:update": ["PATCH"],
  "connections:delete": ["DELETE"],
  "connections:test": ["POST"],
  "agent:chat": ["POST"],
};

/** Recognised URL shapes, independent of HTTP verb. */
type McpPathShape = "collection" | "item" | "item-test" | "agent-chat";

function matchMcpPathShape(segments: string[]): McpPathShape | null {
  if (segments.length === 1 && segments[0] === "connections") return "collection";
  if (segments.length === 2 && segments[0] === "connections") return "item";
  if (segments.length === 3 && segments[0] === "connections" && segments[2] === "test") {
    return "item-test";
  }
  if (segments.length === 2 && segments[0] === "agent" && segments[1] === "chat") {
    return "agent-chat";
  }
  return null;
}

const SHAPE_VERBS: Record<McpPathShape, Record<string, McpRouteKey>> = {
  collection: { GET: "connections:list", POST: "connections:create" },
  item: { PATCH: "connections:update", DELETE: "connections:delete" },
  "item-test": { POST: "connections:test" },
  "agent-chat": { POST: "agent:chat" },
};

/**
 * Resolve `/api/mcp/<segments>` to a route. Returns null when either the path
 * shape or the verb is unrecognised — use `mcpRouteNotFound` to tell those two
 * cases apart.
 */
export function resolveMcpRoute(
  method: string | undefined,
  segments: string[]
): { key: McpRouteKey; id: string | undefined } | null {
  const shape = matchMcpPathShape(segments);
  if (!shape) return null;

  const key = SHAPE_VERBS[shape][(method ?? "").toUpperCase()];
  if (!key) return null;

  return { key, id: shape === "collection" ? undefined : segments[1] };
}

/**
 * 405 when the path exists but the verb does not, 404 when the path itself is
 * unknown. Shared so api/, server.ts and vite.config.ts agree exactly.
 */
export function mcpRouteNotFound(
  method: string | undefined,
  segments: string[]
): { httpStatus: number; body: Record<string, unknown> } {
  if (matchMcpPathShape(segments)) {
    return {
      httpStatus: 405,
      body: { ok: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" },
    };
  }
  return { httpStatus: 404, body: { ok: false, error: "Not found", code: "NOT_FOUND" } };
}

/**
 * Execute a resolved MCP route. Returns `{ httpStatus, body }` for every
 * outcome, including errors — callers never need a try/catch of their own for
 * expected failures.
 */
export async function dispatchMcpRoute(
  key: McpRouteKey,
  authHeader: string | undefined,
  id: string | undefined,
  body: Record<string, unknown>
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  try {
    switch (key) {
      case "connections:list":
        return await handleMcpListConnections(authHeader);
      case "connections:create":
        return await handleMcpCreateConnection(authHeader, body);
      case "connections:update":
        return await handleMcpUpdateConnection(authHeader, id, body);
      case "connections:delete":
        return await handleMcpDeleteConnection(authHeader, id);
      case "connections:test":
        return await handleMcpTestConnection(authHeader, id);
      case "agent:chat": {
        // Dynamic import keeps the module graph acyclic: mcpAgent imports the
        // connection loader from this file. All three runtimes (api/,
        // server.ts, vite.config.ts) execute this same branch.
        const { handleMcpAgentChat } = await import("./mcpAgent.js");
        return await handleMcpAgentChat(authHeader, body);
      }
      default:
        return {
          httpStatus: 404,
          body: { ok: false, error: "Not found", code: "NOT_FOUND" },
        };
    }
  } catch (err: unknown) {
    if (err instanceof McpError) {
      return { httpStatus: err.httpStatus, body: { ok: false, error: err.message, code: err.code } };
    }
    // Unknown failure. Log the type only — a raw message could contain a value
    // echoed back from the MCP server.
    console.error(
      "[api/mcp] unexpected error:",
      err instanceof Error ? err.name : typeof err,
    );
    return {
      httpStatus: 500,
      body: { ok: false, error: "Internal MCP service error.", code: "SERVER_ERROR" },
    };
  }
}
