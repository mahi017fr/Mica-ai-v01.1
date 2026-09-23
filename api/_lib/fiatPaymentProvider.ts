// Bangladesh fiat payout provider abstraction — server-side only.
//
// A real on/off-ramp is a thin shell over a provider's B2C payout API (money
// out to a recipient's bank/mobile number). Every provider plugged in here
// speaks one contract:
//
//   createPayout()    → ask the provider to move money out to a recipient number
//   getPayoutStatus() → read the authoritative status back from the provider
//   verifyPayout()    → confirm a payout reference with the provider
//   handleWebhook()   → consume a provider callback (idempotent re-confirmation)
//
// SECURITY:
//   - Credentials are read from server-side environment variables ONLY. They
//     never reach the browser and are never logged (only booleans are).
//   - A provider that is not configured NEVER fabricates success: it throws
//     BkashNotConfiguredError and callers surface the "not configured" state.
//
// The BkashPaymentProvider below maps to bKash's documented tokenized/Payment
// APIs. Endpoint paths + payloads must match the merchant's bKash integration
// contract; the defaults can be overridden with environment variables and the
// mapping is intentionally centralized here so the rest of the app never sees
// provider specifics.

export type BdPayoutStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED";

export interface BdPayoutRequest {
  /** Deterministic id (derived from the transfer idempotency key). */
  payoutRequestId: string;
  /** Recipient mobile number — always the canonical +8801XXXXXXXXX form. */
  recipientMobile: string;
  /** Amount in BDT, canonical decimal string (≤2 decimals). */
  amountDecimal: string;
  /** Human-readable payment reference/label shown to the recipient. */
  reference: string;
  recipientName?: string;
  remark?: string;
}

export interface BdPayoutResult {
  providerTransactionId: string;
  status: BdPayoutStatus;
  /** Raw provider state string (never trusted for success on its own). */
  rawStatus?: string;
}

export interface FiatPaymentProvider {
  readonly name: string;
  isConfigured(): boolean;
  createPayout(req: BdPayoutRequest): Promise<BdPayoutResult>;
  getPayoutStatus(providerTransactionId: string): Promise<BdPayoutStatus>;
  verifyPayout(providerTransactionId: string): Promise<boolean>;
  handleWebhook(payload: unknown, rawBody: string): Promise<BdPayoutStatus | null>;
}

/** Thrown when a provider's credentials are absent — callers must surface the
 * "not configured" state and never manufacture a success. */
export class BkashNotConfiguredError extends Error {
  readonly code = "BKASH_NOT_CONFIGURED";
  constructor() {
    super("bKash payments are not configured yet.");
    this.name = "BkashNotConfiguredError";
  }
}

interface BkashEnv {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
  tokenPath: string;
  payoutPath: string;
  statusPath: string;
}

function readBkashEnv(): BkashEnv {
  return {
    baseUrl: (process.env.BKASH_BASE_URL ?? "").replace(/\/+$/, ""),
    appKey: process.env.BKASH_APP_KEY ?? "",
    appSecret: process.env.BKASH_APP_SECRET ?? "",
    username: process.env.BKASH_USERNAME ?? "",
    password: process.env.BKASH_PASSWORD ?? "",
    tokenPath: process.env.BKASH_TOKEN_PATH ?? "/tokenized/checkout/initiate",
    payoutPath: process.env.BKASH_PAYOUT_PATH ?? "/bdt/executePayment",
    statusPath: process.env.BKASH_STATUS_PATH ?? "/bdt/checkPayment",
  };
}

function logDiag(entry: Record<string, unknown>) {
  console.log("[BKASH_DIAG]", JSON.stringify(entry));
}

/** Single shared provider instance per warm server process. */
let _bkashProvider: BkashPaymentProvider | null = null;

export function getBkashProvider(): FiatPaymentProvider {
  if (!_bkashProvider) _bkashProvider = new BkashPaymentProvider();
  return _bkashProvider;
}

export class BkashPaymentProvider implements FiatPaymentProvider {
  readonly name = "bKash";

  isConfigured(): boolean {
    const env = readBkashEnv();
    return Boolean(
      env.baseUrl && env.appKey && env.appSecret && env.username && env.password
    );
  }

  private assertConfigured(): BkashEnv {
    if (!this.isConfigured()) {
      logDiag({ step: "bkash_not_configured" });
      throw new BkashNotConfiguredError();
    }
    return readBkashEnv();
  }

  /** bKash tokenized initiation: exchanges app credentials for a session token. */
  private async getAccessToken(env: BkashEnv): Promise<string> {
    const res = await fetch(`${env.baseUrl}${env.tokenPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        app_key: env.appKey,
        app_secret: env.appSecret,
        username: env.username,
        password: env.password,
      }),
    });
    const text = await res.text().catch(() => "");
    let data: Record<string, unknown> | null = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    const token =
      (data?.["access_token"] as string | undefined) ??
      (data?.["token"] as string | undefined) ??
      (data?.["id_token"] as string | undefined);
    if (!res.ok || !token) {
      logDiag({
        step: "bkash_token_failed",
        httpStatus: res.status,
        hasAppKey: Boolean(env.appKey),
      });
      throw new Error(`bKash token request failed (HTTP ${res.status}).`);
    }
    return token;
  }

  /** Ask bKash to move BDT out to the recipient's number. Never faked. */
  async createPayout(req: BdPayoutRequest): Promise<BdPayoutResult> {
    const env = this.assertConfigured();
    const token = await this.getAccessToken(env);
    const res = await fetch(`${env.baseUrl}${env.payoutPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        payoutRequestId: req.payoutRequestId,
        recipientMobile: req.recipientMobile,
        amount: req.amountDecimal,
        currency: "BDT",
        reference: req.reference,
        ...(req.recipientName ? { recipientName: req.recipientName } : {}),
        ...(req.remark ? { remark: req.remark } : {}),
      }),
    });
    const text = await res.text().catch(() => "");
    let data: Record<string, unknown> | null = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    const transactionId =
      (data?.["transaction_id"] as string | undefined) ??
      (data?.["payoutReference"] as string | undefined) ??
      (data?.["reference"] as string | undefined) ??
      `${req.payoutRequestId}`;
    const rawStatus = String(data?.["status"] ?? "PENDING");
    logDiag({
      step: "bkash_createPayout",
      httpStatus: res.status,
      status: rawStatus,
      hasTransactionId: Boolean(data?.["transaction_id"] as string | undefined),
    });
    if (!res.ok) {
      const message = data?.["error"] ? String(data["error"]).slice(0, 200) : `bKash payout failed (HTTP ${res.status}).`;
      throw new Error(message);
    }
    return {
      providerTransactionId: transactionId,
      status: mapBkashStatus(rawStatus),
      rawStatus,
    };
  }

  /** Read the authoritative payout status from bKash. */
  async getPayoutStatus(providerTransactionId: string): Promise<BdPayoutStatus> {
    const env = this.assertConfigured();
    const token = await this.getAccessToken(env);
    const res = await fetch(`${env.baseUrl}${env.statusPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({ transactionId: providerTransactionId }),
    });
    let data: Record<string, unknown> | null = null;
    const text = await res.text().catch(() => "");
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok || !data) {
      logDiag({ step: "bkash_status_failed", httpStatus: res.status });
      throw new Error(`bKash status check failed (HTTP ${res.status}).`);
    }
    return mapBkashStatus(String(data["status"] ?? data["transactionStatus"] ?? "PENDING"));
  }

  /** Confirm a referenced payout is real. Used to guard refund/idempotent paths. */
  async verifyPayout(providerTransactionId: string): Promise<boolean> {
    const status = await this.getPayoutStatus(providerTransactionId);
    return status === "SUCCESS";
  }

  /** Consume a bKash webhook callback. Returns the mapped status on recognisable
   * payloads, null for unrelated callbacks. Payloads must never be trusted to
   * carry secrets or the full payout — status is re-read from the provider. */
  async handleWebhook(payload: unknown, _rawBody: string): Promise<BdPayoutStatus | null> {
    const p = (payload ?? {}) as Record<string, unknown>;
    const txId =
      (p["transaction_id"] as string | undefined) ??
      (p["payoutReference"] as string | undefined);
    if (!txId) return null;
    // Re-read authoritative status rather than trusting the callback data.
    return this.getPayoutStatus(txId).catch(() => null);
  }
}

function mapBkashStatus(raw: string): BdPayoutStatus {
  const s = String(raw ?? "").toUpperCase();
  if (/SUCCESS|COMPLETE|COMPLETED|SETTLED/.test(s)) return "SUCCESS";
  if (/FAIL|DECLINED|DENIED|CANCELLED|ERROR|EXPIRED/.test(s)) return "FAILED";
  if (/PROCESSING|INITIATED/.test(s)) return "PROCESSING";
  return "PENDING";
}