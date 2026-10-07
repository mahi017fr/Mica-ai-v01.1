// ─────────────────────────────────────────────────────────────────────────────
// MCP Agent — minimal MCP-enabled chat execution for the MICA AI Chat.
//
//   Browser ──Bearer FirebaseIDToken──> POST /api/mcp/agent/chat
//        └──> mcpAgent ──> Groq (tool-calling loop) ──> user's MCP server
//                 └──> final reply + tool activity (never a secret)
//
// v1 scope: load ONE of the caller's own MCP connections, list its tools,
// expose them to the Groq model as OpenAI-style function tools, and run the
// request/tool-result loop until the model answers. No autonomy, no racing.
//
// SECURITY INVARIANTS
//   1. The browser never receives an MCP token, an MCP Authorization header,
//      `secretCiphertext`, or raw tool credentials — only `reply`, `activity`
//      and whitelist connection metadata.
//   2. The outbound URL always comes from the caller's own Firestore document,
//      re-validated by the shared SSRF guard. The LLM can never supply a URL.
//   3. Only tools returned by `tools/list` on that connection are executable;
//      an unknown tool name is rejected before any network call.
//   4. Error text that could echo a server response is passed through
//      `redactSecrets()` with the decrypted secret before logging or return.
//   5. Client messages are reduced to `{role: user|assistant, content}` — a
//      client cannot inject `system` or `tool` turns into the loop.
// ─────────────────────────────────────────────────────────────────────────────

import { McpError, prepareMcpAgentConnection } from "./mcpConnectionsService.js";
import { openMcpSession, redactSecrets, redactSecretsUnbounded, type McpSession } from "./mcpProbe.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Agent model candidates, preferred first. The agent keeps its OWN list: this
 * feature must not replace the model used by the existing `/api/bot/chat`
 * proxy. Candidates are tried in order only when Groq reports
 * `model_not_found`, so the same code works on keys that still have the legacy
 * model and keys that do not. Every candidate supports native tool calling.
 */
const AGENT_MODELS = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"] as const;

const MAX_TOOL_ROUNDS = 6;
const MAX_TOOL_CALLS = 10;
const LLM_TIMEOUT_MS = 45_000;
/**
 * A long tool chain grows the request until the provider's per-minute token
 * budget rejects it (HTTP 429). Each retry waits out the advertised window and
 * resends the SAME payload; only the total attempts are bounded.
 */
const LLM_RATE_LIMIT_RETRIES = 3;
const LLM_RATE_LIMIT_DEFAULT_WAIT_MS = 3_000;
const LLM_RATE_LIMIT_MAX_WAIT_MS = 10_000;
const MCP_LIST_TIMEOUT_MS = 15_000;
const MCP_CALL_TIMEOUT_MS = 25_000;
/**
 * `initialize` bound. Without it the handshake has no deadline at all, so an
 * unresponsive MCP server holds a serverless invocation open until the
 * platform kills it (the failure then arrives as an opaque 504 from the
 * provider instead of a JSON error from this route). 15s is the same ceiling
 * the connection probe already allows for a full handshake + tools/list.
 */
const MCP_CONNECT_TIMEOUT_MS = 15_000;

const MAX_HISTORY_MESSAGES = 40;
const MAX_CONTENT_CHARS = 8_000;
const MAX_SYSTEM_CHARS = 6_000;
const MAX_TOOL_RESULT_CHARS = 6_000;
const MAX_ACTIVITY_LINES = 24;
const MAX_ACTIVITY_CHARS = 160;
const MAX_TOOL_DESCRIPTORS = 40;

const DEFAULT_SYSTEM =
  "You are Mica, the in-app AI assistant for MICA. Be warm, sharp, and genuinely helpful. " +
  "Keep replies concise and easy to read, and reply in the language the user writes in.";

const VALID_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------
// Diagnostics
//
// Every line is structured and secret-free. Allowed payload: booleans,
// numbers, route/step labels, model names, connection IDs, and error
// name/message/stack AFTER `redactSecrets()` (which is fed the decrypted MCP
// secret as a redaction input). Never an API key, a token, or a credential.
// ---------------------------------------------------------------------------

function logDiag(entry: Record<string, unknown>): void {
  try {
    console.log("[mcp/agent]", JSON.stringify(entry));
  } catch {
    // Logging must never break the chat turn.
  }
}

/** Exact error name/message/stack for the log, redacted and bounded. */
function describeError(
  err: unknown,
  redactionInputs: Array<string | null | undefined> = []
): { name: string; message: string; stack: string } {
  const name = err instanceof Error ? err.name : typeof err;
  const rawMessage = err instanceof Error ? err.message : String(err ?? "unknown error");
  const rawStack = err instanceof Error && err.stack ? err.stack : "";
  return {
    name,
    message: redactSecrets(rawMessage, redactionInputs),
    stack: redactSecretsUnbounded(rawStack, redactionInputs).slice(0, 600),
  };
}

// ---------------------------------------------------------------------------
// Input sanitization
// ---------------------------------------------------------------------------

type SafeMessage = { role: "user" | "assistant"; content: string };

/**
 * Reduce arbitrary client input to the two roles the loop will honour.
 * `system` and `tool` turns from the client are dropped so nobody can forge a
 * tool result or override the agent's instructions.
 */
function sanitizeMessages(input: unknown): SafeMessage[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new McpError("INVALID_MESSAGES", "Missing or invalid messages array.", 400);
  }

  const safe: SafeMessage[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const { role, content } = raw as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || !content.trim()) continue;
    safe.push({ role, content: content.trim().slice(0, MAX_CONTENT_CHARS) });
  }

  if (!safe.some((m) => m.role === "user")) {
    throw new McpError("INVALID_MESSAGES", "Messages must contain at least one user message.", 400);
  }

  return safe.slice(-MAX_HISTORY_MESSAGES);
}

function readSystemInstruction(input: unknown): string {
  return typeof input === "string" ? input.trim().slice(0, MAX_SYSTEM_CHARS) : "";
}

function readConnectionId(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  return value ? value : undefined;
}

// ---------------------------------------------------------------------------
// MCP tool -> Groq function conversion
// ---------------------------------------------------------------------------

interface GroqTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ToolCatalog {
  tools: GroqTool[];
  /** Groq function name -> original MCP tool name. */
  mcpNameOf: Map<string, string>;
  /** `name — description` lines for the system prompt. */
  inventory: string[];
}

function toParametersSchema(input: unknown): Record<string, unknown> {
  const schema: Record<string, unknown> =
    input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : {};
  if (schema.type !== "object") schema.type = "object";
  if (!schema.properties || typeof schema.properties !== "object") schema.properties = {};
  return schema;
}

/** Build Groq function tools, renaming anything the provider would reject. */
function buildToolCatalog(rawTools: unknown[]): ToolCatalog {
  const tools: GroqTool[] = [];
  const mcpNameOf = new Map<string, string>();
  const inventory: string[] = [];
  const usedNames = new Set<string>();
  let anonymous = 0;

  for (const raw of rawTools.slice(0, MAX_TOOL_DESCRIPTORS)) {
    if (!raw || typeof raw !== "object") continue;
    const rawName = (raw as { name?: unknown }).name;
    const mcpName = typeof rawName === "string" ? rawName.trim() : "";
    if (!mcpName) continue;

    const rawDescription = (raw as { description?: unknown }).description;
    const description =
      typeof rawDescription === "string" ? rawDescription.trim().slice(0, 600) : "";

    let functionName = mcpName.length <= 64 && VALID_TOOL_NAME.test(mcpName) ? mcpName : "";
    if (!functionName || usedNames.has(functionName)) {
      do {
        anonymous += 1;
        functionName = `mcp_tool_${anonymous}`;
      } while (usedNames.has(functionName));
    }
    usedNames.add(functionName);
    mcpNameOf.set(functionName, mcpName);

    tools.push({
      type: "function",
      function: {
        name: functionName,
        description: description || `Tool "${mcpName}" from the connected MCP server.`,
        parameters: toParametersSchema((raw as { inputSchema?: unknown }).inputSchema),
      },
    });

    inventory.push(`- ${mcpName}${description ? ` — ${description}` : ""}`);
  }

  return { tools, mcpNameOf, inventory };
}

// ---------------------------------------------------------------------------
// Tool output / activity helpers
// ---------------------------------------------------------------------------

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Serialize an MCP tool result into a bounded, secret-free string for the LLM. */
function serializeToolResult(result: unknown, secret: string): string {
  const record = (result ?? {}) as Record<string, unknown>;
  const content = Array.isArray(record.content) ? (record.content as unknown[]) : [];
  const parts: string[] = [];

  for (const item of content) {
    const entry = (item ?? {}) as Record<string, unknown>;
    if (entry.type === "text" && typeof entry.text === "string") {
      parts.push(entry.text);
    } else {
      try {
        parts.push(JSON.stringify(item));
      } catch {
        parts.push(String(item));
      }
    }
  }

  if (parts.length === 0 && record.structuredContent !== undefined) {
    try {
      parts.push(JSON.stringify(record.structuredContent));
    } catch {
      parts.push(String(record.structuredContent));
    }
  }

  let out = parts.join("\n").trim() || "(the tool returned no content)";
  if (record.isError === true) out = `TOOL ERROR:\n${out}`;
  // Redaction must not be the truncation step: the shared `redactSecrets()`
  // is capped for log/error use, while tool payloads keep their full text up
  // to the agent's own (much larger) tool-result budget.
  return truncate(redactSecretsUnbounded(out, [secret]), MAX_TOOL_RESULT_CHARS);
}

function pushActivity(activity: string[], line: string): void {
  if (activity.length >= MAX_ACTIVITY_LINES) return;
  activity.push(truncate(line.replace(/\s+/g, " ").trim(), MAX_ACTIVITY_CHARS));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How long to wait before retrying an HTTP 429: the `retry-after` header
 * first, then the "Please try again in N.Ns" phrasing providers put in the
 * error body, otherwise a short default. Always clamped to a sane window.
 */
function rateLimitDelayMs(retryAfterHeader: string | null, errText: string): number {
  const header = Number(retryAfterHeader);
  if (Number.isFinite(header) && header >= 0) {
    return Math.min(Math.max(header * 1000, 250), LLM_RATE_LIMIT_MAX_WAIT_MS);
  }
  const match = /try again in ([0-9]+(?:\.[0-9]+)?) ?s/i.exec(errText);
  if (match) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.max(seconds * 1000, 250), LLM_RATE_LIMIT_MAX_WAIT_MS);
    }
  }
  return LLM_RATE_LIMIT_DEFAULT_WAIT_MS;
}

// ---------------------------------------------------------------------------
// Groq
// ---------------------------------------------------------------------------

interface GroqToolCall {
  id?: unknown;
  type?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

interface GroqTurn {
  message: {
    content?: unknown;
    tool_calls?: GroqToolCall[];
  };
  finish_reason?: unknown;
}

/**
 * One Groq chat completion with the agent's tool definitions.
 * Falls through the candidate models only when Groq reports the model missing.
 */
async function callGroq(
  apiKey: string,
  messages: Array<Record<string, unknown>>,
  tools: GroqTool[]
): Promise<{ turn: GroqTurn; model: string }> {
  let modelIndex = 0;
  let rateLimitRetries = 0;

  while (modelIndex < AGENT_MODELS.length) {
    const model = AGENT_MODELS[modelIndex];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    const startedAt = Date.now();
    logDiag({
      step: "groq_request_started",
      model,
      messageCount: messages.length,
      toolCount: tools.length,
      timeoutMs: LLM_TIMEOUT_MS,
    });
    try {
      const res = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 1024,
          tool_choice: "auto",
          tools,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = truncate(await res.text().catch(() => ""), 400);
        // Server-side only: keeps the real provider status/reason visible in
        // logs (sanitized) while clients receive a safe, generic message.
        const safeLog = redactSecrets(errText, [apiKey]);
        logDiag({
          step: "groq_request_failed",
          model,
          httpStatus: res.status,
          durationMs: Date.now() - startedAt,
          providerText: safeLog.slice(0, 300),
        });
        // Only an unavailable model advances to the next candidate.
        if ((res.status === 400 || res.status === 404) && /model_not_found|does not exist|not access/i.test(errText)) {
          modelIndex += 1;
          rateLimitRetries = 0;
          continue;
        }
        // 429 = the token budget is temporarily exhausted (typical after a
        // multi-step tool chain). Wait out the window and resend the SAME
        // request a bounded number of times before giving up.
        if (res.status === 429 && rateLimitRetries < LLM_RATE_LIMIT_RETRIES) {
          rateLimitRetries += 1;
          const waitMs = rateLimitDelayMs(res.headers.get("retry-after"), errText);
          clearTimeout(timer);
          await sleep(waitMs);
          continue;
        }
        if (res.status === 429) {
          // Raw provider text is never forwarded — a safe, specific message is.
          throw new McpError(
            "LLM_RATE_LIMITED",
            "The AI model is rate-limited right now. Please try again in a few seconds.",
            502
          );
        }
        // Raw provider text is never forwarded — a safe, generic message is.
        throw new McpError("LLM_ERROR", "The AI model could not be reached.", 502);
      }

      const data = (await res.json()) as { choices?: GroqTurn[] };
      const turn = data?.choices?.[0];
      if (!turn) throw new McpError("LLM_ERROR", "The AI model returned an empty response.", 502);
      logDiag({
        step: "groq_request_succeeded",
        model,
        durationMs: Date.now() - startedAt,
        finishReason: typeof turn.finish_reason === "string" ? turn.finish_reason : null,
        requestedToolCalls: Array.isArray(turn.message?.tool_calls)
          ? turn.message.tool_calls.length
          : 0,
      });
      return { turn, model };
    } catch (err: unknown) {
      if (err instanceof McpError) throw err;
      const message = err instanceof Error ? err.message : String(err ?? "unknown error");
      if (/abort|timed ?out/i.test(message)) {
        logDiag({
          step: "groq_request_failed",
          model,
          durationMs: Date.now() - startedAt,
          error: describeError(err, [apiKey]),
          reason: "timeout",
        });
        throw new McpError("LLM_TIMEOUT", "The AI model timed out. Please try again.", 504);
      }
      logDiag({
        step: "groq_request_failed",
        model,
        durationMs: Date.now() - startedAt,
        error: describeError(err, [apiKey]),
      });
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new McpError("LLM_ERROR", "The AI model could not be reached.", 502);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Run one MCP-enabled chat turn. Returns `{httpStatus, body}` for every
 * outcome; expected failures arrive as a safe `{ok:false, error, code}` payload.
 */
export async function handleMcpAgentChat(
  authHeader: string | undefined,
  body: Record<string, unknown>
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  try {
    const messages = sanitizeMessages(body?.messages);
    const systemInstruction = readSystemInstruction(body?.systemInstruction);
    const connectionId = readConnectionId(body?.connectionId);

    const apiKey = process.env.GROQ_API_KEY;
    logDiag({
      step: "agent_start",
      hasGroqApiKey: Boolean(apiKey),
      hasEncryptionKey: Boolean(process.env.MICA_SECRET_ENCRYPTION_KEY),
      hasFirebaseProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
      hasFirebaseClientEmail: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
      hasFirebasePrivateKey: Boolean(process.env.FIREBASE_PRIVATE_KEY),
      hasApplicationDefaultCredentials: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      requestedConnectionId: connectionId ?? null,
      userMessageCount: messages.length,
    });
    if (!apiKey) {
      throw new McpError("LLM_NOT_CONFIGURED", "The AI model is not configured on the server.", 500);
    }

    // 1–2. Authenticate, load the caller's OWN connection, decrypt server-side.
    const { connection, target } = await prepareMcpAgentConnection(authHeader, connectionId);
    const redactionInputs = [target.secret];
    const activity: string[] = [];
    // Connection id ONLY — never the endpoint URL, header name or secret.
    const connectionIdSafe = connection.id;

    // 3–4. Open the MCP session (initialize + notifications/initialized).
    logDiag({ step: "mcp_connect_started", connectionId: connectionIdSafe });
    let session: McpSession;
    const connectedAt = Date.now();
    try {
      session = await openMcpSession(target, {
        timeoutMs: null,
        connectTimeoutMs: MCP_CONNECT_TIMEOUT_MS,
      });
      logDiag({
        step: "mcp_connect_succeeded",
        connectionId: connectionIdSafe,
        durationMs: Date.now() - connectedAt,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err ?? "connection failed");
      logDiag({
        step: "mcp_connect_failed",
        connectionId: connectionIdSafe,
        durationMs: Date.now() - connectedAt,
        error: describeError(err, redactionInputs),
      });
      const isTimeout = err instanceof Error && /abort|timed ?out/i.test(err.message);
      throw new McpError(
        "MCP_CONNECT_FAILED",
        isTimeout
          ? `The MCP server did not respond within ${MCP_CONNECT_TIMEOUT_MS / 1000} seconds.`
          : redactSecrets(message, redactionInputs) || "Could not connect to the MCP server.",
        502
      );
    }

    try {
      // 5. Enumerate the tool list of THIS connection only.
      let rawTools: unknown[] = [];
      try {
        const listed = (await withTimeout(
          session.client.listTools(),
          MCP_LIST_TIMEOUT_MS,
          "MCP tools/list"
        )) as { tools?: unknown };
        rawTools = Array.isArray(listed?.tools) ? listed.tools : [];
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err ?? "tools/list failed");
        logDiag({
          step: "mcp_tools_list_failed",
          connectionId: connectionIdSafe,
          error: describeError(err, redactionInputs),
        });
        throw new McpError(
          "MCP_LIST_TOOLS_FAILED",
          redactSecrets(message, redactionInputs) || "Could not list tools on the MCP server.",
          502
        );
      }

      // 6. Convert MCP tools into the provider's function-tool format.
      const { tools, mcpNameOf, inventory } = buildToolCatalog(rawTools);
      logDiag({
        step: "mcp_tools_listed",
        connectionId: connectionIdSafe,
        toolCount: rawTools.length,
        exposedToModel: tools.length,
      });
      pushActivity(
        activity,
        `Using ${connection.name} → tools/list${rawTools.length ? ` (${rawTools.length} tools)` : ""}`
      );

      const toolSection = inventory.length
        ? `\n\nConnected MCP server "${connection.name}" exposes these tools:\n${inventory.join("\n")}`
        : `\n\nThe connected MCP server "${connection.name}" currently exposes no tools.`;

      const systemContent =
        (systemInstruction || DEFAULT_SYSTEM) +
        toolSection +
        "\n\nTool rules: call a tool only when it helps answer the user; never invent " +
        "URLs, tokens, or credentials; if a tool fails, say so briefly and move on.";

      const convo: Array<Record<string, unknown>> = [
        { role: "system", content: systemContent },
        ...messages,
      ];

      // 7–9. Tool-call loop until the model produces a final answer.
      let reply = "";
      let rounds = 0;
      let toolCalls = 0;

      while (rounds < MAX_TOOL_ROUNDS) {
        const { turn } = await callGroq(apiKey, convo, tools);
        const message = turn.message ?? {};
        const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

        if (rawCalls.length === 0) {
          reply = typeof message.content === "string" ? message.content.trim() : "";
          if (!reply && rounds === 0) {
            reply = "I couldn't put that together just now — mind trying again?";
          }
          break;
        }

        convo.push({
          role: "assistant",
          content: typeof message.content === "string" ? message.content : "",
          tool_calls: rawCalls,
        });

        for (const call of rawCalls) {
          const functionName =
            call?.function && typeof call.function.name === "string" ? call.function.name : "";
          const callId = typeof call.id === "string" && call.id ? call.id : `call_${toolCalls + 1}`;
          const mcpName = functionName ? mcpNameOf.get(functionName) : undefined;

          let resultText = "";

          if (!mcpName) {
            // 3. Unknown tool — rejected before any network call.
            resultText = `Error: unknown tool "${functionName}". Only tools listed by this connection can be called.`;
            pushActivity(activity, `Rejected unknown tool: ${functionName || "(unnamed)"}`);
          } else if (toolCalls >= MAX_TOOL_CALLS) {
            resultText = "Error: tool call budget for this message is exhausted.";
            pushActivity(activity, "Tool call limit reached");
          } else {
            let args: Record<string, unknown> = {};
            let argsOk = true;
            try {
              const parsed = call?.function?.arguments ? JSON.parse(String(call.function.arguments)) : {};
              if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
              args = parsed as Record<string, unknown>;
            } catch {
              argsOk = false;
              resultText = 'Error: tool arguments were not a valid JSON object.';
            }

            if (argsOk) {
              toolCalls += 1;
              pushActivity(activity, `Calling: ${mcpName}`);
              try {
                const result = await withTimeout(
                  session.client.callTool({ name: mcpName, arguments: args }),
                  MCP_CALL_TIMEOUT_MS,
                  `MCP tool "${mcpName}"`
                );
                resultText = serializeToolResult(result, target.secret);
                pushActivity(activity, "Completed");
              } catch (err: unknown) {
                const message2 = err instanceof Error ? err.message : String(err ?? "tool failed");
                resultText = `Tool failed: ${redactSecrets(message2, redactionInputs) || "unknown error"}`;
                pushActivity(activity, "Failed");
              }
            }
          }

          convo.push({ role: "tool", tool_call_id: callId, name: functionName, content: resultText });
        }

        rounds += 1;
      }

      if (!reply) {
        reply =
          "I ran out of steps while using your MCP tools — please rephrase or try a shorter request.";
      }

      // 10. Only safe, whitelist fields ever leave the server.
      logDiag({
        step: "agent_completed",
        connectionId: connectionIdSafe,
        toolCount: rawTools.length,
        toolCalls,
        rounds,
        replyChars: reply.length,
      });
      return {
        httpStatus: 200,
        body: {
          ok: true,
          reply,
          activity,
          connection: {
            id: connection.id,
            name: connection.name,
            serverName: connection.serverName,
            toolCount: rawTools.length,
          },
          toolCalls,
        },
      };
    } finally {
      void session.close();
    }
  } catch (err: unknown) {
    if (err instanceof McpError) {
      // `McpError` messages are either authored here or already redacted at
      // the throw site, so name/code/message are all safe for the log.
      logDiag({
        step: "agent_error",
        code: err.code,
        status: err.httpStatus,
        error: describeError(err),
      });
      return { httpStatus: err.httpStatus, body: { ok: false, error: err.message, code: err.code } };
    }
    // Unexpected failure: full (redacted) name/message/stack belongs in the
    // server log so a production-only bug is visible; the client still gets a
    // safe, generic message.
    logDiag({ step: "agent_unexpected_error", error: describeError(err) });
    return {
      httpStatus: 500,
      body: { ok: false, error: "Internal MCP agent error.", code: "SERVER_ERROR" },
    };
  }
}
