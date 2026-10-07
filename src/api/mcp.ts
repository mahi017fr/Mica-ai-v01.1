import { auth } from "../firebase";

/**
 * MCP Connections — typed client for the MICA backend.
 *
 * Follows the same authenticated fetch pattern as `src/api/wallet.ts`:
 * the only credential sent from the browser is the Firebase ID token.
 *
 * SECURITY
 *   - The browser NEVER receives an MCP token. The API returns only the boolean
 *     `hasSecret`, so there is no value here that could be leaked or cached.
 *   - Tokens are write-only: they travel in a request body once, are encrypted
 *     server-side before Firestore, and are never echoed back. On edit, an empty
 *     `secret` means "keep the existing secret".
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpAuthType = "none" | "bearer" | "api_key_header";

export type McpConnectionStatus = "untested" | "connected" | "failed";

/**
 * The exact projection the server is willing to return. This is an allowlist on
 * the client too — `secretCiphertext` has no representation here at all.
 */
export interface McpConnection {
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

export interface McpConnectionInput {
  name: string;
  endpointUrl: string;
  authType: McpAuthType;
  /**
   * Bearer token or API key. Omit / pass "" on update to keep the stored
   * secret. Ignored entirely when `authType` is "none".
   */
  secret?: string;
  /** Required when `authType` is "api_key_header", e.g. "X-API-Key". */
  secretHeaderName?: string;
}

/** An error whose message is always safe to render in the UI. */
export class McpApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "UNKNOWN", status = 500) {
    super(message);
    this.name = "McpApiError";
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Temporary production tracing. Every line is safe to print: paths, methods,
 * HTTP status and error codes only — NEVER the Firebase ID token or any
 * credential. Filter the browser console on `[mica/api]` to follow a request
 * from the component down to fetch().
 */
function trace(entry: Record<string, unknown>): void {
  try {
    console.log("[mica/api]", JSON.stringify(entry));
  } catch {
    // Tracing must never break the request itself.
  }
}

async function authorizedFetch(
  path: string,
  init: { method: string; body?: unknown }
): Promise<Record<string, unknown>> {
  const user = auth.currentUser;
  if (!user) {
    // No request leaves the browser when this fires — which is exactly why it
    // has to be visible: it looks identical to "the endpoint was never called".
    trace({ step: "auth_missing", method: init.method, path });
    throw new McpApiError("You must be signed in to manage MCP connections.", "UNAUTHORIZED", 401);
  }

  // Token retrieval happens BEFORE fetch(): if it fails or hangs, Vercel never
  // sees a request, so both outcomes are logged here.
  let idToken: string;
  try {
    idToken = await user.getIdToken();
    trace({ step: "token_ready", method: init.method, path, hasToken: Boolean(idToken) });
  } catch (err) {
    trace({
      step: "token_failed",
      method: init.method,
      path,
      error: err instanceof Error ? err.name : typeof err,
      message: (err instanceof Error ? err.message : String(err)).slice(0, 160),
    });
    throw err;
  }

  trace({ step: "fetch_start", method: init.method, path, url: path });

  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (err) {
    trace({
      step: "fetch_failed",
      method: init.method,
      path,
      error: err instanceof Error ? err.name : typeof err,
      message: (err instanceof Error ? err.message : String(err)).slice(0, 160),
    });
    throw new McpApiError("Could not reach the MICA server.", "NETWORK_ERROR", 0);
  }

  trace({ step: "fetch_done", method: init.method, path, status: res.status, ok: res.ok });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok || body?.ok !== true) {
    // Two envelopes reach this point:
    //   1. this API's own { ok: false, error, code }
    //   2. the platform's error shape, e.g. a serverless function timeout
    //      returns { error: { code: "FUNCTION_INVOCATION_TIMEOUT", ... } }
    // Without reading (2), every deployment-level failure collapses into a
    // bare "Server returned 504" and the real production cause is invisible.
    const rawError = body?.error;
    const platformError =
      rawError && typeof rawError === "object" ? (rawError as Record<string, unknown>) : null;
    const message =
      typeof rawError === "string" && rawError
        ? rawError
        : typeof platformError?.message === "string" && platformError.message
          ? platformError.message
          : `Server returned ${res.status}`;
    const code =
      typeof body?.code === "string" && body.code
        ? body.code
        : typeof platformError?.code === "string" && platformError.code
          ? platformError.code
          : "SERVER_ERROR";
    trace({ step: "response_error", method: init.method, path, status: res.status, code });
    throw new McpApiError(message, code, res.status);
  }

  return body;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** GET /api/mcp/connections */
export async function listMcpConnections(): Promise<McpConnection[]> {
  const body = await authorizedFetch("/api/mcp/connections", { method: "GET" });
  return Array.isArray(body.connections) ? (body.connections as McpConnection[]) : [];
}

/** POST /api/mcp/connections */
export async function createMcpConnection(input: McpConnectionInput): Promise<McpConnection> {
  const body = await authorizedFetch("/api/mcp/connections", {
    method: "POST",
    body: {
      name: input.name,
      endpointUrl: input.endpointUrl,
      authType: input.authType,
      secret: input.secret ?? "",
      secretHeaderName: input.secretHeaderName ?? "",
    },
  });
  return body.connection as McpConnection;
}

/**
 * PATCH /api/mcp/connections/:id
 * Omit `secret` (or pass "") to keep the stored secret unchanged.
 */
export async function updateMcpConnection(
  id: string,
  input: Partial<McpConnectionInput>
): Promise<McpConnection> {
  const body = await authorizedFetch(`/api/mcp/connections/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.endpointUrl !== undefined ? { endpointUrl: input.endpointUrl } : {}),
      ...(input.authType !== undefined ? { authType: input.authType } : {}),
      ...(input.secret !== undefined ? { secret: input.secret } : {}),
      ...(input.secretHeaderName !== undefined ? { secretHeaderName: input.secretHeaderName } : {}),
    },
  });
  return body.connection as McpConnection;
}

/** DELETE /api/mcp/connections/:id */
export async function deleteMcpConnection(id: string): Promise<void> {
  await authorizedFetch(`/api/mcp/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * POST /api/mcp/connections/:id/test
 * The backend performs the MCP handshake and stores the resulting status; the
 * returned connection already carries the fresh verdict.
 */
export async function testMcpConnection(id: string): Promise<McpConnection> {
  const body = await authorizedFetch(
    `/api/mcp/connections/${encodeURIComponent(id)}/test`,
    { method: "POST" }
  );
  return body.connection as McpConnection;
}

// ---------------------------------------------------------------------------
// MCP agent — one MCP-enabled chat turn
// ---------------------------------------------------------------------------

export interface McpAgentChatInput {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** The chat's existing persona prompt. Passed through, never mutated. */
  systemInstruction?: string;
  /** Optional explicit connection id. Omitted -> the backend picks one. */
  connectionId?: string;
}

/**
 * The only shape the agent is allowed to return. Deliberately free of tokens,
 * Authorization headers and `secretCiphertext` — activity lines are plain
 * labels such as `Using AGP → tools/list` and `Calling: get_balance`.
 */
export interface McpAgentChatResult {
  reply: string;
  activity: string[];
  connection: { id: string; name: string; serverName: string | null; toolCount: number } | null;
  toolCalls: number;
}

/**
 * Send a chat turn through the MCP agent.
 * Throws `McpApiError` — callers typically fall back to the plain chat proxy
 * when the code is `NO_MCP_CONNECTION`, `UNAUTHORIZED`, or any server error.
 */
export async function mcpAgentChat(input: McpAgentChatInput): Promise<McpAgentChatResult> {
  trace({
    step: "agent_request_start",
    method: "POST",
    path: "/api/mcp/agent/chat",
    messageCount: input.messages.length,
    hasConnectionId: Boolean(input.connectionId),
  });

  const body = await authorizedFetch("/api/mcp/agent/chat", {
    method: "POST",
    body: {
      messages: input.messages,
      ...(input.systemInstruction ? { systemInstruction: input.systemInstruction } : {}),
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    },
  });

  const connection = (body.connection ?? null) as McpAgentChatResult["connection"];
  const result: McpAgentChatResult = {
    reply: typeof body.reply === "string" ? body.reply : "",
    activity: Array.isArray(body.activity) ? body.activity.map((line) => String(line)) : [],
    connection,
    toolCalls: typeof body.toolCalls === "number" ? body.toolCalls : 0,
  };
  trace({
    step: "agent_response_ok",
    path: "/api/mcp/agent/chat",
    replyChars: result.reply.length,
    toolCalls: result.toolCalls,
  });
  return result;
}
