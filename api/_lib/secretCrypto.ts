// ─────────────────────────────────────────────────────────────────────────────
// MICA secret-at-rest encryption.
//
// AES-256-GCM authenticated encryption for per-user credentials (MCP tokens and
// API keys). Secrets are encrypted on the server BEFORE they reach Firestore and
// are only ever decrypted inside the server process, immediately before an
// outbound request to the user's own MCP server.
//
// SECURITY INVARIANTS
//   1. The plaintext secret never touches a log line, an error message, or an
//      HTTP response body.
//   2. The master key lives ONLY in `MICA_SECRET_ENCRYPTION_KEY` (server env).
//      It is never prefixed with `VITE_`, so Vite can never inline it into the
//      browser bundle.
//   3. Every ciphertext is bound to a context string via GCM's Additional
//      Authenticated Data (AAD). Copying a ciphertext from one document into
//      another therefore fails authentication instead of silently decrypting.
//
// PAYLOAD FORMAT (single string, safe for a Firestore string field)
//   v1.<iv base64url>.<authTag base64url>.<ciphertext base64url>
//
// Node builtin only — `node:crypto`. No new dependency.
// ─────────────────────────────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM-recommended size.
const KEY_BYTES = 32; // AES-256.
const PAYLOAD_VERSION = "v1";
const MASK_PLACEHOLDER = "••••••••";

/**
 * Raised for every failure in this module. The message is always safe to show:
 * it never contains key material or plaintext.
 */
export class SecretCryptoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SecretCryptoError";
    this.code = code;
  }
}

/**
 * Parse a 32-byte key supplied as hex (64 chars) or base64/base64url.
 * Throws `SecretCryptoError` with an actionable message on any malformed input.
 */
function parseKeyMaterial(raw: string): Buffer {
  const value = raw.trim();
  if (!value) {
    throw new SecretCryptoError(
      "ENCRYPTION_KEY_MISSING",
      "MICA_SECRET_ENCRYPTION_KEY is not set on the server.",
    );
  }

  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, "hex");
  } else {
    // Tolerate base64 / base64url. Validate the decoded length before use so a
    // truncated copy-paste fails loudly instead of producing a weak key.
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length > 0) key = decoded;
  }

  if (!key || key.length !== KEY_BYTES) {
    throw new SecretCryptoError(
      "ENCRYPTION_KEY_INVALID",
      `MICA_SECRET_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (64 hex chars or 44 base64 chars).`,
    );
  }
  return key;
}

let cachedRaw: string | null = null;
let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  const raw = process.env.MICA_SECRET_ENCRYPTION_KEY ?? "";
  if (cachedKey && cachedRaw === raw) return cachedKey;
  const key = parseKeyMaterial(raw);
  cachedRaw = raw;
  cachedKey = key;
  return key;
}

/**
 * True when a usable master key is present. Used by the API to return an
 * actionable 500 instead of failing mid-write.
 */
export function isSecretCryptoConfigured(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt a plaintext secret.
 *
 * @param plaintext  The secret as typed by the user. Never logged or returned.
 * @param aad        Context bound into the auth tag (e.g. the connection id).
 *                   Use the SAME value at decrypt time or the payload will fail
 *                   to authenticate.
 */
export function encryptSecret(plaintext: string, aad = ""): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new SecretCryptoError("SECRET_EMPTY", "Cannot encrypt an empty secret.");
  }
  if (plaintext.length > 8192) {
    // Generous ceiling that still prevents an accidental huge payload write.
    throw new SecretCryptoError("SECRET_TOO_LONG", "Secret exceeds the maximum supported length.");
  }

  const key = masterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    PAYLOAD_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt a payload produced by `encryptSecret`.
 *
 * A wrong key, a tampered ciphertext, or a mismatched `aad` all surface as
 * `SecretCryptoError` — GCM authentication is what rejects them.
 */
export function decryptSecret(payload: string, aad = ""): string {
  if (typeof payload !== "string" || payload.length === 0) {
    throw new SecretCryptoError("SECRET_PAYLOAD_MISSING", "No stored secret for this connection.");
  }

  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== PAYLOAD_VERSION) {
    throw new SecretCryptoError("SECRET_PAYLOAD_MALFORMED", "Stored secret is malformed.");
  }

  const [, ivRaw, tagRaw, dataRaw] = parts;
  let iv: Buffer;
  let authTag: Buffer;
  let ciphertext: Buffer;
  try {
    iv = Buffer.from(ivRaw, "base64url");
    authTag = Buffer.from(tagRaw, "base64url");
    ciphertext = Buffer.from(dataRaw, "base64url");
  } catch {
    throw new SecretCryptoError("SECRET_PAYLOAD_MALFORMED", "Stored secret is malformed.");
  }

  if (iv.length !== IV_BYTES || authTag.length !== 16 || ciphertext.length === 0) {
    throw new SecretCryptoError("SECRET_PAYLOAD_MALFORMED", "Stored secret is malformed.");
  }

  try {
    const key = masterKey();
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (err: unknown) {
    if (err instanceof SecretCryptoError) throw err;
    // Deliberately does NOT surface the underlying crypto error: keep the
    // message generic so nothing about key state leaks to the client.
    throw new SecretCryptoError(
      "SECRET_DECRYPT_FAILED",
      "Could not decrypt the stored secret. It may have been written with a different MICA_SECRET_ENCRYPTION_KEY.",
    );
  }
}

/**
 * The masked placeholder shown in the UI in place of a stored secret.
 * A constant — it carries no information about the real value.
 */
export function maskSecret(): string {
  return MASK_PLACEHOLDER;
}
