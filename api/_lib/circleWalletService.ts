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

// IMPORTANT (Vercel runtime fix — direct, statically-traceable CJS require):
//
// The @circle-fin/developer-controlled-wallets package ships TWO builds:
//   - dist/developer-controlled-wallets.es.js  (ESM, `import` condition)
//   - dist/developer-controlled-wallets.cjs.js (CommonJS, `require` condition)
// Its package.json has NO "type":"module".
//
// TWO failure modes we must avoid on Vercel's Node 20/22 runtime:
//
//   (1) A top-level ESM `import * as CircleSdk` resolves the package's
//       `import` condition to the raw `.es.js` (a file with `import`/`export`
//       but no `type:module`). When Vercel bundles the SDK into the deployed
//       function, esbuild webpack-transpiles the SDK AND its axios dependency
//       tree (axios -> form-data -> combined-stream) into ESM. Those CJS
//       modules call `require("util")` at module scope, which becomes a
//       dynamic `require()` shim that Node 20/22's ESM loader rejects with
//       "Dynamic require of 'util' is not supported" / ERR_REQUIRE_ESM — a
//       module-initialization crash that happens before the handler/WALLET_DIAG.
//
//   (2) Loading the SDK through an opaque helper (e.g. a `cjsRequire(id)`
//       wrapper) hides the literal package name from Vercel's file-tracing
//       bundler, so the package is NOT included in the deploy and the function
//       fails at runtime with "Cannot find module '@circle-fin/...'".
//
// FIX: use a DIRECT, statically analyzable CommonJS `require` with the literal
// package string, created via `createRequire(import.meta.url)`. This:
//   - makes the package id traceable (a literal string at the call site), so
//     Vercel includes it in the deploy, AND
//   - forces Node's `require` condition, loading the guaranteed-CommonJS
//     `.cjs.js` build, so axios/combined-stream/form-data stay native CJS and
//     are never ESM-transpiled — no dynamic-require crash on Node 20/22.
//
// firebase-admin is deliberately left as a dynamic import() with a literal
// string id: its root export is CommonJS (lib/index.js), which loads
// correctly on every Node version, and Vercel statically traces it as well.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve a stable base path that works in BOTH ESM output (Vercel bundles
// these api/*.ts functions as ESM; `import.meta.url` is present) and
// CommonJS output (the local `esbuild server.ts --format=cjs` build where
// `import.meta` is empty and `__filename` is provided by the CJS wrapper).
const _baseUrl =
  typeof import.meta !== "undefined" && typeof import.meta.url === "string"
    ? (import.meta.url as string)
    : pathToFileURL(__filename).href;

// Direct literal require — statically traceable by Vercel's bundler.
const requireCwd = createRequire(_baseUrl);
const CircleSdk = requireCwd(
  "@circle-fin/developer-controlled-wallets"
) as Record<string, unknown>;

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

// TEMPORARY startup diagnostic — proves the module (and thus the Circle SDK)
// loaded successfully during function initialization. Never logs secret values.
try {
  const sdkInitFn =
    (CircleSdk as Record<string, unknown>).initiateDeveloperControlledWalletsClient;
  logDiag({
    step: "circleWalletService_module_loaded",
    sdk_export_found: typeof sdkInitFn === "function",
    has_circle_api_key: Boolean(process.env.CIRCLE_API_KEY),
    has_circle_entity_secret: Boolean(process.env.CIRCLE_ENTITY_SECRET),
    has_circle_wallet_set_id: Boolean(process.env.CIRCLE_WALLET_SET_ID),
  });
} catch (err: any) {
  logDiag({
    step: "circleWalletService_module_loaded",
    sdk_export_found: false,
    error: err?.message ? String(err.message).slice(0, 200) : "unknown",
  });
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
    // Directly required CJS build (see header). `initiateDeveloperControlledWalletsClient`
    // is a top-level export on the .cjs.js build (no `default` wrapper), but the
    // `default ?? sdk` fallback keeps this correct for either layout.
    const sdk = CircleSdk;
    logDiag({ step: "getClient_sdk_imported", method: "direct_require" });
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

let _adminApp: unknown = null;
let _adminInitPromise: Promise<unknown> | null = null;

let _diagEmitted = false;

/**
 * Initialize the Firebase Admin SDK exactly once (planet-safe singleton).
 *
 * - Reads FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY.
 * - Escaped "\\n" sequences in the private key are converted to real newlines
 *   (Vercel stores the PEM with literal backslash-n when pasted).
 * - Falls back to GOOGLE_APPLICATION_CREDENTIALS / applicationDefault() only
 *   when that env var is explicitly set.
 * - Throws a clear, actionable error when no credentials are configured —
 *   never an opaque "not initialized" state.
 *
 * Server-side only. NEVER expose credentials to the browser.
 */
async function initFirebaseAdmin(): Promise<unknown> {
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

  const adminModule = await import("firebase-admin");
  const admin = (adminModule as any).default ?? adminModule;

  // Adapter guard for the installed firebase-admin version (13.x CJS export).
  if (!admin || typeof admin.initializeApp !== "function" || !admin.apps) {
    throw new Error(
      "firebase-admin loaded but the expected exports are missing. " +
        "Available exports: " + Object.keys(adminModule ?? {}).slice(0, 10).join(", ")
    );
  }

  // Already initialized (by us or another module) — reuse the singleton app.
  if ((admin.apps as unknown[]).length > 0) {
    logDiag({ step: "firebase_admin_init", method: "already_initialized" });
    console.log("[FirebaseAdmin] ADMIN_INITIALIZED=true");
    return admin;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? "";
  const privateKey = process.env.FIREBASE_PRIVATE_KEY ?? "";

  if (projectId && clientEmail && privateKey) {
    // Vercel may inject the PEM with escaped "\\n"; convert to real newlines.
    const parsedKey = privateKey.replace(/\\n/g, "\n").trim();
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
    throw new Error(
      "Firebase Admin SDK is not configured: missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, " +
        "or FIREBASE_PRIVATE_KEY. Set them server-side (or GOOGLE_APPLICATION_CREDENTIALS)."
    );
  }

  console.log("[FirebaseAdmin] ADMIN_INITIALIZED=true");
  logDiag({ step: "firebase_admin_ready", ADMIN_INITIALIZED: true });
  return admin;
}

/**
 * Get the Firebase Admin app, initializing it once and deduplicating
 * concurrent initialization (single-flight promise).
 */
async function getAdminApp(): Promise<unknown> {
  if (_adminApp) return _adminApp;
  if (!_adminInitPromise) {
    const pending = initFirebaseAdmin()
      .then((adminApp) => {
        _adminApp = adminApp;
        return adminApp;
      })
      .catch((err: any) => {
        const msg = err?.message ? String(err.message).slice(0, 300) : String(err).slice(0, 300);
        console.error("[FirebaseAdmin] ADMIN_INITIALIZED=false");
        console.error("[FirebaseAdmin] INIT_ERROR=" + msg);
        logDiag({ step: "firebase_admin_init_failed", ADMIN_INITIALIZED: false, INIT_ERROR: msg });
        _adminInitPromise = null; // allow a later retry on the next invocation
        throw err;
      });
    _adminInitPromise = pending;
  }
  return _adminInitPromise;
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
    throw new Error(
      "Firebase Admin SDK is not initialized: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, " +
        "and FIREBASE_PRIVATE_KEY server-side environment variables."
    );
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
    throw new Error(
      "Firebase Admin SDK is not initialized: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, " +
        "and FIREBASE_PRIVATE_KEY server-side environment variables."
    );
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

// ---------------------------------------------------------------------------
// USDC send support — Developer-Controlled Wallet transfers (server-side only).
//
// The source wallet is ALWAYS a server-resolved Circle wallet id; signing is
// performed by Circle's MPC infrastructure. No passkey / WebAuthn / Privy /
// browser signature is ever involved in this path.
// ---------------------------------------------------------------------------

/** Resolved Circle wallet for a MICA user (metadata only). */
export interface ResolvedCircleWallet {
  walletId: string;
  address: string;
  blockchain: string;
  status: string;
}

/**
 * Centralized wallet resolver — the SINGLE source of truth for every
 * wallet-related server operation.
 *
 * Resolution order:
 *   1. Firestore users/{uid} — if circleWalletId + circleWalletAddress exist, use them.
 *   2. Circle API listWallets({ refId: uid }) — if found, repair Firestore and return.
 *   3. Create a new Circle wallet — persist to Firestore and return.
 *
 * Returns { walletId, walletAddress, blockchain, status }.
 * Never returns null — always creates if nothing exists.
 */
export async function resolveUserCircleWallet(uid: string): Promise<ResolvedCircleWallet> {
  logDiag({ step: "resolveUserCircleWallet_start", uidLen: uid.length });
  const client = await getClient();
  const now = () => new Date().toISOString();
  const userPath = `users/${uid}`;

  // --- Step 1: Check Firestore for existing wallet mapping ---
  const profile = await firestoreGet(userPath);
  const existingWalletId = (profile?.circleWalletId as string) ?? null;
  const existingAddress = (profile?.circleWalletAddress as string) ?? null;

  if (existingWalletId && existingAddress) {
    logDiag({ step: "resolve_from_firestore", walletId: existingWalletId, address: existingAddress });
    return {
      walletId: existingWalletId,
      address: existingAddress,
      blockchain: "ARC-TESTNET",
      status: (profile?.circleWalletStatus as string) ?? "linked",
    };
  }

  // --- Step 2: Firestore mapping incomplete — try Circle by refId ---
  try {
    logDiag({ step: "resolve_listWallets_attempt", refId: uid.slice(0, 8) + "..." });
    const circleResponse = await client.listWallets({
      refId: uid,
      blockchain: ARC_TESTNET,
      walletSetId: CIRCLE_WALLET_SET_ID,
    });

    const wallets = circleResponse.data?.wallets;
    logDiag({ step: "resolve_listWallets_response", walletCount: wallets?.length ?? 0 });

    if (wallets && wallets.length > 0) {
      // Deterministic selection: if multiple wallets exist, pick the first
      // (sorted by creation time from Circle) and log the duplicate situation.
      if (wallets.length > 1) {
        logDiag({
          step: "resolve_duplicate_wallets_detected",
          uidLen: uid.length,
          count: wallets.length,
          message: "Multiple Circle wallets found for same refId. Using deterministic selection.",
        });
        console.warn(
          `[WalletResolver] WARNING: ${wallets.length} Circle wallets found for refId=${uid.slice(0, 8)}... ` +
          `Using the first wallet deterministically. Duplicate wallets were NOT created by this code path.`
        );
      }

      const wallet = wallets[0];

      // Repair Firestore mapping.
      await firestoreSet(userPath, {
        circleWalletId: wallet.id,
        circleWalletAddress: wallet.address,
        circleWalletStatus: "linked",
        circleWalletLinkedAt: now(),
      });

      logDiag({ step: "resolve_repaired_from_circle", walletId: wallet.id, address: wallet.address });
      return {
        walletId: wallet.id,
        address: wallet.address,
        blockchain: wallet.blockchain ?? "ARC-TESTNET",
        status: wallet.state ?? "linked",
      };
    }
  } catch (err: any) {
    const msg = err?.message ? String(err.message).slice(0, 300) : String(err).slice(0, 300);
    logDiag({ step: "resolve_listWallets_failed", message: msg });
    console.error("[WalletResolver] listWallets failed:", err);
  }

  // --- Step 3: No wallet exists anywhere — create one ---
  try {
    logDiag({ step: "resolve_createWallets_attempt" });
    const createResponse = await client.createWallets({
      blockchains: [ARC_TESTNET],
      count: 1,
      walletSetId: CIRCLE_WALLET_SET_ID,
      metadata: [{ refId: uid, name: `MICA-${uid.slice(0, 8)}` }],
      accountType: "EOA",
    });

    const createdWallets = createResponse.data?.wallets;
    if (!createdWallets || createdWallets.length === 0) {
      throw new Error("Circle createWallets returned no wallets.");
    }

    const wallet = createdWallets[0];

    await firestoreSet(userPath, {
      circleWalletId: wallet.id,
      circleWalletAddress: wallet.address,
      circleWalletStatus: "linked",
      circleWalletLinkedAt: now(),
    });

    logDiag({ step: "resolve_wallet_created", walletId: wallet.id, address: wallet.address });
    return {
      walletId: wallet.id,
      address: wallet.address,
      blockchain: wallet.blockchain ?? "ARC-TESTNET",
      status: wallet.state ?? "linked",
    };
  } catch (err: any) {
    const msg = err?.message ? String(err.message).slice(0, 300) : String(err).slice(0, 300);
    logDiag({ step: "resolve_createWallets_failed", message: msg });
    throw err;
  }
}

/**
 * Resolve a user's existing Circle wallet from Firestore with repair.
 * If Firestore is missing the mapping but Circle has the wallet via refId,
 * repairs the mapping automatically.
 * Returns null ONLY when no wallet exists anywhere (Firestore + Circle).
 */
export async function resolveCircleWallet(uid: string): Promise<ResolvedCircleWallet | null> {
  const profile = await firestoreGet(`users/${uid}`);
  const walletId = typeof profile?.circleWalletId === "string" ? profile.circleWalletId : null;
  const address = typeof profile?.circleWalletAddress === "string" ? profile.circleWalletAddress : null;

  if (walletId && address) {
    return {
      walletId,
      address,
      blockchain: "ARC-TESTNET",
      status: (profile?.circleWalletStatus as string) ?? "linked",
    };
  }

  // Firestore mapping incomplete — try Circle API as repair fallback.
  try {
    const client = await getClient();
    const circleResponse = await client.listWallets({
      refId: uid,
      blockchain: ARC_TESTNET,
      walletSetId: CIRCLE_WALLET_SET_ID,
    });
    const wallets = circleResponse.data?.wallets;
    if (wallets && wallets.length > 0) {
      const wallet = wallets[0];
      const now = () => new Date().toISOString();
      await firestoreSet(`users/${uid}`, {
        circleWalletId: wallet.id,
        circleWalletAddress: wallet.address,
        circleWalletStatus: "linked",
        circleWalletLinkedAt: now(),
      });
      logDiag({ step: "resolveCircleWallet_repaired", walletId: wallet.id, address: wallet.address });
      return {
        walletId: wallet.id,
        address: wallet.address,
        blockchain: wallet.blockchain ?? "ARC-TESTNET",
        status: wallet.state ?? "linked",
      };
    }
  } catch (err: any) {
    logDiag({ step: "resolveCircleWallet_repair_failed", message: err?.message?.slice(0, 200) });
  }

  return null;
}

/**
 * Resolve only the on-chain address (used for recipients).
 * Includes Firestore repair: if mapping is missing, queries Circle by refId.
 */
export async function resolveCircleWalletAddress(uid: string): Promise<string | null> {
  const profile = await firestoreGet(`users/${uid}`);
  const address =
    typeof profile?.circleWalletAddress === "string" && profile.circleWalletAddress.startsWith("0x")
      ? profile.circleWalletAddress
      : null;
  if (address) return address;

  // Firestore mapping incomplete — try Circle API as repair fallback.
  try {
    const client = await getClient();
    const circleResponse = await client.listWallets({
      refId: uid,
      blockchain: ARC_TESTNET,
      walletSetId: CIRCLE_WALLET_SET_ID,
    });
    const wallets = circleResponse.data?.wallets;
    if (wallets && wallets.length > 0) {
      const wallet = wallets[0];
      const now = () => new Date().toISOString();
      await firestoreSet(`users/${uid}`, {
        circleWalletId: wallet.id,
        circleWalletAddress: wallet.address,
        circleWalletStatus: "linked",
        circleWalletLinkedAt: now(),
      });
      logDiag({ step: "resolveCircleWalletAddress_repaired", address: wallet.address });
      return wallet.address;
    }
  } catch (err: any) {
    logDiag({ step: "resolveCircleWalletAddress_repair_failed", message: err?.message?.slice(0, 200) });
  }

  return null;
}

/** Terminal Circle transaction states that mean the write will not proceed. */
const FAILED_STATES = new Set(["FAILED", "DENIED", "CANCELLED"]);
/** Terminal states meaning the transaction is final on-chain. */
const SUCCESS_STATES = new Set(["COMPLETE"]);

export function isTerminalCircleState(state: string): boolean {
  return state === "COMPLETE" || state === "CONFIRMED" || FAILED_STATES.has(state) || state === "STUCK";
}
export function isFailedCircleState(state: string): boolean {
  return FAILED_STATES.has(state);
}

/**
 * Create a token transfer through Circle's Developer-Controlled Wallets SDK.
 *
 * - `idempotencyKey` MUST be stable per logical send: Circle treats repeated
 *   calls with the same key as THE SAME request and returns the original
 *   transaction instead of creating a second blockchain write.
 * - `amountDecimal` is a human decimal string (e.g. "10" / "0.5") at ≤6 dp.
 * - `tokenAddress` is the ERC-20 USDC contract; empty string would mean native.
 * Returns the Circle transaction id + initial state. NEVER fabricates results.
 */
export async function createCircleUsdcTransfer(params: {
  sourceWalletId: string;
  destinationAddress: string;
  amountDecimal: string;
  tokenAddress: string;
  blockchain?: string;
  idempotencyKey: string;
}): Promise<{ transactionId: string; state: string }> {
  const client = await getClient();
  const response = await client.createTransaction({
    walletId: params.sourceWalletId,
    destinationAddress: params.destinationAddress,
    amount: [params.amountDecimal],
    tokenAddress: params.tokenAddress,
    blockchain: params.blockchain ?? ARC_TESTNET,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    idempotencyKey: params.idempotencyKey,
  });
  const tx = response?.data;
  if (!tx?.id) {
    throw new Error("Circle createTransaction returned no transaction id.");
  }
  return { transactionId: String(tx.id), state: String(tx.state ?? "INITIATED") };
}

/**
 * Execute an arbitrary smart-contract interaction through Circle's
 * Developer-Controlled Wallets SDK (server-side MPC signing).
 *
 * This is the primitive used by the Deal escrow migration: the signing wallet
 * is the ACTING user's Circle wallet (resolved from uid on the server — never
 * a browser signer). `callData` is the raw ABI-encoded function calldata
 * (`0x...`, even-length hex), which Circle submits to `contractAddress`.
 *
 * - `idempotencyKey` MUST be stable per logical blockchain write: Circle treats
 *   repeated calls with the same key as THE SAME request.
 * - `blockchain` defaults to ARC-TESTNET.
 * Returns the Circle transaction id + initial state. NEVER fabricates results.
 */
export async function createCircleContractExecution(params: {
  sourceWalletId: string;
  contractAddress: string;
  callData: string;
  blockchain?: string;
  idempotencyKey: string;
}): Promise<{ transactionId: string; state: string }> {
  const client = await getClient();
  const response = await client.createContractExecutionTransaction({
    walletId: params.sourceWalletId,
    contractAddress: params.contractAddress,
    callData: params.callData,
    blockchain: params.blockchain ?? ARC_TESTNET,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    idempotencyKey: params.idempotencyKey,
  });
  const tx = response?.data;
  if (!tx?.id) {
    throw new Error("Circle createContractExecutionTransaction returned no transaction id.");
  }
  return { transactionId: String(tx.id), state: String(tx.state ?? "INITIATED") };
}

/**
 * Fetch the current state of a Circle transaction. Returns null when Circle
 * does not know the id (never guessed).
 */
export async function getCircleTransaction(
  transactionId: string
): Promise<{ state: string; txHash: string | null } | null> {
  const client = await getClient();
  const response = await client.getTransaction({ id: transactionId });
  const tx = response?.data?.transaction;
  if (!tx) return null;
  return {
    state: String(tx.state ?? "UNKNOWN"),
    txHash: typeof tx.txHash === "string" ? tx.txHash : null,
  };
}

/**
 * Create a Firestore document at `collectionPath/id`. Fails (returns false)
 * when a document already exists there — used for race-free idempotency keys.
 */
export async function firestoreCreate(
  collectionPath: string,
  id: string,
  data: Record<string, unknown>
): Promise<boolean> {
  const db = await getFirestore();
  try {
    await db.collection(collectionPath).doc(id).create(data);
    return true;
  } catch (err: any) {
    if (String(err?.code ?? "").includes("already-exists") || /already exists/i.test(String(err?.message))) {
      return false;
    }
    throw err;
  }
}

/**
 * Run an atomic Firestore transaction. `fn` receives the raw Firestore
 * transaction object plus the Firestore instance (server-side only).
 */
export async function firestoreRunTransaction(
  fn: (tx: any, db: any) => Promise<void>
): Promise<void> {
  const db = await getFirestore();
  await db.runTransaction(async (tx: any) => fn(tx, db));
}
