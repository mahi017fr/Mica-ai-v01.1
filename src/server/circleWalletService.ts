// Circle Developer-Controlled Wallet service — server-side only.
//
// Creates and resolves one Circle wallet per Firebase uid using the
// @circle-fin/developer-controlled-wallets SDK. All signing happens via
// Circle's MPC infrastructure — no private keys ever leave Circle's servers.
//
// SECURITY:
//   - CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must NEVER reach the browser.
//   - This file is only imported by server-side code (server.ts, api/ handlers).
//   - The entity secret is auto-encrypted per request by the SDK.

// IMPORTANT: All heavy SDK imports are dynamic (lazy) so that a module-loading
// failure in any dependency never crashes the serverless function at init time.
// This ensures the handler can ALWAYS return a JSON error instead of a Vercel
// HTML error page.

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY ?? "";
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET ?? "";
const CIRCLE_WALLET_SET_ID = process.env.CIRCLE_WALLET_SET_ID ?? "";

const ARC_TESTNET = "ARC-TESTNET" as const;

// Singleton client — created lazily on first use.
let _client: any = null;

function logDiag(entry: Record<string, unknown>) {
  console.log("[WALLET_DIAG]", JSON.stringify(entry));
}

async function getClient(): Promise<any> {
  if (_client) return _client;
  const hasKey = Boolean(CIRCLE_API_KEY);
  const hasSecret = Boolean(CIRCLE_ENTITY_SECRET);
  const hasWalletSet = Boolean(CIRCLE_WALLET_SET_ID);
  logDiag({ step: "getClient", hasApiKey: hasKey, hasEntitySecret: hasSecret, hasWalletSetId: hasWalletSet });
  if (!hasKey || !hasSecret) {
    throw new Error(
      "Circle Developer-Controlled Wallet is not configured. " +
        "Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET server-side environment variables."
    );
  }
  if (!hasWalletSet) {
    throw new Error(
      "Circle wallet set is not configured. " +
        "Set CIRCLE_WALLET_SET_ID server-side environment variable."
    );
  }
  try {
    const sdk = await import("@circle-fin/developer-controlled-wallets");
    logDiag({ step: "getClient_sdk_imported" });
    const sdkExports: any = (sdk as any).default ?? sdk;
    const initFn = sdkExports.initiateDeveloperControlledWalletsClient
      ?? sdk.initiateDeveloperControlledWalletsClient;
    if (!initFn) {
      throw new Error(
        "Circle SDK loaded but initiateDeveloperControlledWalletsClient export not found. " +
        "Available exports: " + Object.keys(sdkExports).slice(0, 10).join(", ")
      );
    }
    _client = initFn({
      apiKey: CIRCLE_API_KEY,
      entitySecret: CIRCLE_ENTITY_SECRET,
    });
    logDiag({ step: "getClient_sdk_initialized" });
  } catch (err: any) {
    logDiag({ step: "getClient_sdk_init_failed", message: err?.message ? String(err.message).slice(0, 200) : null });
    throw err;
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnsuredWallet {
  /** Circle wallet UUID. */
  walletId: string;
  /** On-chain address (0x...). */
  address: string;
  /** Blockchain code used. */
  blockchain: string;
  /** "LIVE" when the wallet is active. */
  state: string;
  /** ISO timestamp of when the wallet was created or found. */
  ensuredAt: string;
}

// ---------------------------------------------------------------------------
// Ensure wallet — idempotent, one wallet per uid.
// ---------------------------------------------------------------------------

/**
 * Ensure exactly one Circle Developer-Controlled Wallet exists for the given
 * Firebase uid. The lookup is idempotent:
 *
 *   1. Check Firestore for circleWalletId.
 *   2. If missing, query Circle for refId = uid.
 *   3. Only create if both are empty.
 *
 * Returns the wallet address and metadata. Never returns secrets.
 */
export async function ensureCircleDevWallet(
  uid: string,
  firestoreGet: (path: string) => Promise<Record<string, unknown> | null>,
  firestoreSet: (path: string, data: Record<string, unknown>) => Promise<void>
): Promise<EnsuredWallet> {
  logDiag({ step: "ensureCircleDevWallet_start", uidLen: uid.length });
  const client = await getClient();
  const now = () => new Date().toISOString();
  const userPath = `users/${uid}`;

  // --- Step 1: Check Firestore for existing wallet mapping ---
  const profile = await firestoreGet(userPath);
  const existingWalletId = (profile?.circleWalletId as string) ?? null;
  const existingAddress = (profile?.circleWalletAddress as string) ?? null;

  logDiag({ step: "firestore_lookup", hasExistingWalletId: Boolean(existingWalletId), hasExistingAddress: Boolean(existingAddress) });

  if (existingWalletId && existingAddress) {
    logDiag({ step: "returning_existing_wallet", address: existingAddress });
    return {
      walletId: existingWalletId,
      address: existingAddress,
      blockchain: "ARC-TESTNET",
      state: "LIVE",
      ensuredAt: now(),
    };
  }

  // --- Step 2: Query Circle by refId (= Firebase uid) ---
  let listWalletsFailed = false;
  try {
    logDiag({ step: "listWallets_attempt", refId: uid.slice(0, 8) + "..." });
    const circleResponse = await client.listWallets({
      refId: uid,
      blockchain: ARC_TESTNET,
      walletSetId: CIRCLE_WALLET_SET_ID,
    });

    const wallets = circleResponse.data?.wallets;
    logDiag({ step: "listWallets_response", walletCount: wallets?.length ?? 0, httpStatus: (circleResponse as any)?.statusCode ?? "unknown" });

    if (wallets && wallets.length > 0) {
      const wallet = wallets[0];
      const walletId = wallet.id;
      const address = wallet.address;

      // Synchronize back to Firestore.
      await firestoreSet(userPath, {
        circleWalletId: walletId,
        circleWalletAddress: address,
        circleWalletStatus: "linked",
        circleWalletLinkedAt: now(),
      });

      logDiag({ step: "restored_wallet_from_circle", walletId, address });
      return {
        walletId,
        address,
        blockchain: wallet.blockchain ?? "ARC-TESTNET",
        state: wallet.state ?? "LIVE",
        ensuredAt: now(),
      };
    }
  } catch (err: any) {
    // If Circle API fails (e.g. network), we still try to create.
    // But if the wallet was already created, we don't want duplicates.
    listWalletsFailed = true;
    const msg = err?.message ? String(err.message).slice(0, 300) : String(err).slice(0, 300);
    const statusCode = err?.statusCode ?? err?.response?.status ?? null;
    const errorCode = err?.code ?? null;
    logDiag({ step: "listWallets_failed", message: msg, statusCode, errorCode });
    console.error("[CircleDevWallet] listWallets failed:", err);
  }

  // --- Step 3: Create exactly one wallet ---
  try {
    logDiag({ step: "createWallets_attempt", blockchain: ARC_TESTNET, walletSetId: CIRCLE_WALLET_SET_ID.slice(0, 8) + "..." });
    const createResponse = await client.createWallets({
      blockchains: [ARC_TESTNET],
      count: 1,
      walletSetId: CIRCLE_WALLET_SET_ID,
      metadata: [{ refId: uid, name: `MICA-${uid.slice(0, 8)}` }],
      accountType: "EOA",
    });

    const createdWallets = createResponse.data?.wallets;
    logDiag({ step: "createWallets_response", createdCount: createdWallets?.length ?? 0, httpStatus: (createResponse as any)?.statusCode ?? "unknown" });

    if (!createdWallets || createdWallets.length === 0) {
      logDiag({ step: "createWallets_empty", listWalletsFailed });
      throw new Error("Circle createWallets returned no wallets.");
    }

    const wallet = createdWallets[0];
    const walletId = wallet.id;
    const address = wallet.address;

    // Persist to Firestore.
    await firestoreSet(userPath, {
      circleWalletId: walletId,
      circleWalletAddress: address,
      circleWalletStatus: "linked",
      circleWalletLinkedAt: now(),
    });

    logDiag({ step: "wallet_created_successfully", walletId, address });
    return {
      walletId,
      address,
      blockchain: wallet.blockchain ?? "ARC-TESTNET",
      state: wallet.state ?? "LIVE",
      ensuredAt: now(),
    };
  } catch (err: any) {
    const msg = err?.message ? String(err.message).slice(0, 300) : String(err).slice(0, 300);
    const statusCode = err?.statusCode ?? err?.response?.status ?? null;
    const errorCode = err?.code ?? null;
    logDiag({ step: "createWallets_failed", message: msg, statusCode, errorCode, listWalletsFailed });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Firebase Admin initialization (lazy, server-side only).
//
// Supports two credential strategies (checked in order):
//   1. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
//      (env vars; "\n" in PRIVATE_KEY is converted to real newlines)
//   2. GOOGLE_APPLICATION_CREDENTIALS / applicationDefault()
// ---------------------------------------------------------------------------

let _adminInitialized = false;
let _adminApp: unknown = null;

let _diagEmitted = false;

async function getAdminApp(): Promise<unknown> {
  if (_adminInitialized) return _adminApp;
  _adminInitialized = true;

  // ── Safe diagnostics (no secrets printed) ──────────────────────────
  const hasProjectId = Boolean(process.env.FIREBASE_PROJECT_ID);
  const hasClientEmail = Boolean(process.env.FIREBASE_CLIENT_EMAIL);
  const rawKey = process.env.FIREBASE_PRIVATE_KEY ?? "";
  const hasPrivateKey = Boolean(rawKey);
  const pkHasBegin = hasPrivateKey && rawKey.includes("BEGIN PRIVATE KEY");
  const pkHasEnd = hasPrivateKey && rawKey.includes("END PRIVATE KEY");
  const pkHasEscapedNl = hasPrivateKey && rawKey.includes("\\n");
  const pkHasRealNl = hasPrivateKey && rawKey.includes("\n");

  const diag: Record<string, unknown> = {
    step: "FirebaseAdmin",
    PROJECT_ID_CONFIGURED: hasProjectId,
    CLIENT_EMAIL_CONFIGURED: hasClientEmail,
    PRIVATE_KEY_CONFIGURED: hasPrivateKey,
    PRIVATE_KEY_FORMAT_VALID: pkHasBegin && pkHasEnd,
    PRIVATE_KEY_HAS_ESCAPED_NL: pkHasEscapedNl,
    PRIVATE_KEY_HAS_REAL_NL: pkHasRealNl,
    NODE_VERSION: process.version,
    CWD: process.cwd(),
    GOOGLE_APPLICATION_CREDENTIALS_SET: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
  };

  if (!_diagEmitted) {
    _diagEmitted = true;
    logDiag(diag);
    console.log("[FirebaseAdmin]", JSON.stringify(diag));
  }

  try {
    const adminModule = await import("firebase-admin");
    const admin = (adminModule as any).default ?? adminModule;

    if (admin.apps.length === 0) {
      const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? "";
      const privateKey = process.env.FIREBASE_PRIVATE_KEY ?? "";

      if (projectId && clientEmail && privateKey) {
        const parsedKey = privateKey.replace(/\\n/g, "\n");
        logDiag({ step: "firebase_admin_init", method: "service_account_env" });
        admin.initializeApp({
          credential: admin.credential.cert({ projectId, clientEmail, privateKey: parsedKey }),
        });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        logDiag({ step: "firebase_admin_init", method: "application_default" });
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      } else {
        logDiag({ step: "firebase_admin_init", method: "application_default_fallback" });
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      }
    } else {
      logDiag({ step: "firebase_admin_init", method: "already_initialized" });
    }

    _adminApp = admin;
    console.log("[FirebaseAdmin] ADMIN_INITIALIZED=true");
    logDiag({ step: "firebase_admin_ready", ADMIN_INITIALIZED: true });
  } catch (err: any) {
    const msg = err?.message ? String(err.message).slice(0, 200) : String(err).slice(0, 200);
    console.error("[FirebaseAdmin] ADMIN_INITIALIZED=false");
    console.error("[FirebaseAdmin] INIT_ERROR=" + msg);
    logDiag({ step: "firebase_admin_init_failed", ADMIN_INITIALIZED: false, INIT_ERROR: msg });
    // Reset so next call can retry
    _adminInitialized = false;
  }
  return _adminApp;
}

/**
 * Verify a Firebase ID token and return the uid.
 * Server-side only — never called from browser code.
 */
export async function verifyFirebaseToken(
  idToken: string
): Promise<{ uid: string; email?: string }> {
  const admin = await getAdminApp() as any;
  if (!admin) {
    throw new Error("Firebase Admin SDK is not initialized.");
  }
  const decoded = await admin.auth().verifyIdToken(idToken);
  return { uid: decoded.uid, email: decoded.email };
}

// ---------------------------------------------------------------------------
// Firestore helpers via firebase-admin.
// ---------------------------------------------------------------------------

async function getFirestore(): Promise<any> {
  const admin = await getAdminApp() as any;
  if (!admin) {
    throw new Error("Firebase Admin SDK is not initialized.");
  }
  return admin.firestore();
}

/**
 * Read a Firestore document. Returns null if it doesn't exist.
 */
export async function firestoreGet(
  collectionPath: string
): Promise<Record<string, unknown> | null> {
  const db = await getFirestore();
  const doc = await db.doc(collectionPath).get();
  return doc.exists ? doc.data() : null;
}

/**
 * Set (merge) a Firestore document. Creates if it doesn't exist.
 */
export async function firestoreSet(
  collectionPath: string,
  data: Record<string, unknown>
): Promise<void> {
  const db = await getFirestore();
  await db.doc(collectionPath).set(data, { merge: true });
}

/**
 * High-level ensure: verify token → resolve/create wallet → return safe data.
 */
export async function handleEnsureWallet(
  idToken: string
): Promise<EnsuredWallet> {
  try {
    logDiag({ step: "verifyFirebaseToken_attempt", idTokenLen: idToken.length });
    const { uid, email } = await verifyFirebaseToken(idToken);
    logDiag({ step: "verifyFirebaseToken_ok", uidLen: uid.length, hasEmail: Boolean(email) });
    const result = await ensureCircleDevWallet(uid, firestoreGet, firestoreSet);
    logDiag({ step: "handleEnsureWallet_complete", address: result.address, walletId: result.walletId });
    return result;
  } catch (err: any) {
    const msg = err?.message ? String(err.message).slice(0, 300) : String(err).slice(0, 300);
    logDiag({ step: "handleEnsureWallet_error", message: msg, name: err?.name });
    throw err;
  }
}
