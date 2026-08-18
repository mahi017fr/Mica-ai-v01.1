#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Circle Developer-Controlled Wallet — One-time setup script
//
// This script performs:
//   1. Generate a new Entity Secret (32 random bytes → hex)
//   2. Register the Entity Secret with Circle
//   3. Save the recovery file to a secure location outside the repo
//   4. Create a Wallet Set named "MICA Developer Wallets"
//   5. Update .env with CIRCLE_ENTITY_SECRET and CIRCLE_WALLET_SET_ID
//
// SECURITY:
//   - The entity secret is NEVER printed to the console.
//   - The recovery file is saved to a path you specify (default: ~/.circle/recovery/).
//   - .env is updated in-place — no secrets are exposed.
//
// Usage:
//   node scripts/circle-setup.mjs                     # uses defaults
//   RECOVERY_DIR=/secure/path node scripts/circle-setup.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

// Load .env file into process.env (dotenv is a project dependency)
import { config } from "dotenv";
config({ path: join(process.cwd(), ".env") });

// ── Helpers ────────────────────────────────────────────────────────────────

function die(msg) {
  console.error(`[circle-setup] FATAL: ${msg}`);
  process.exit(1);
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) die(`.env not found at ${envPath}`);
  return readFileSync(envPath, "utf-8");
}

function upsertEnvVar(envContent, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(envContent)) {
    return envContent.replace(re, `${key}="${value}"`);
  }
  return envContent.trimEnd() + `\n${key}="${value}"\n`;
}

// ── 0. Validate environment ────────────────────────────────────────────────

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
if (!CIRCLE_API_KEY) {
  die("CIRCLE_API_KEY is not set. Add it to .env first.");
}

const ROOT = process.cwd();
const ENV_PATH = join(ROOT, ".env");
const recoveryDir = process.env.RECOVERY_DIR || join(homedir(), ".circle", "recovery");

// ── 1. Generate Entity Secret ──────────────────────────────────────────────

console.log("[circle-setup] Generating Entity Secret (32 random bytes)...");
const entitySecret = randomBytes(32).toString("hex");
// NEVER log entitySecret

// ── 2. Register Entity Secret with Circle ──────────────────────────────────

console.log("[circle-setup] Registering Entity Secret with Circle API...");

// Ensure recovery directory exists
mkdirSync(recoveryDir, { recursive: true });

// We use the SDK's registerEntitySecretCiphertext directly
let registerEntitySecretCiphertext;
try {
  const sdk = await import("@circle-fin/developer-controlled-wallets");
  registerEntitySecretCiphertext = sdk.registerEntitySecretCiphertext;
  if (!registerEntitySecretCiphertext) {
    die("Could not find registerEntitySecretCiphertext export in SDK.");
  }
} catch (err) {
  die(`Failed to import SDK: ${err.message}`);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

try {
  const response = await registerEntitySecretCiphertext({
    apiKey: CIRCLE_API_KEY,
    entitySecret: entitySecret,
    recoveryFileDownloadPath: recoveryDir,
  });

  // The SDK downloads the recovery file to the directory.
  // Also save the recovery file content from the response as a backup.
  const recoveryContent = response.data?.recoveryFile;
  const recoveryFilePath = join(recoveryDir, `recovery_backup_${timestamp}.dat`);
  if (recoveryContent) {
    writeFileSync(recoveryFilePath, recoveryContent, "utf-8");
    console.log(`[circle-setup] Recovery backup saved to: ${recoveryFilePath}`);
  }
  console.log(`[circle-setup] Recovery file directory: ${recoveryDir}`);

  console.log("[circle-setup] Entity Secret registered successfully.");
} catch (err) {
  const msg = err?.response?.data?.errorMessage || err?.message || String(err);
  die(`Entity Secret registration failed: ${msg}`);
}

// ── 3. Create Wallet Set ───────────────────────────────────────────────────

console.log('[circle-setup] Creating Wallet Set "MICA Developer Wallets"...');

let initiateDeveloperControlledWalletsClient;
try {
  const sdk = await import("@circle-fin/developer-controlled-wallets");
  initiateDeveloperControlledWalletsClient = sdk.initiateDeveloperControlledWalletsClient;
} catch (err) {
  die(`Failed to import SDK: ${err.message}`);
}

const client = initiateDeveloperControlledWalletsClient({
  apiKey: CIRCLE_API_KEY,
  entitySecret: entitySecret,
});

let walletSetId;
try {
  const wsResponse = await client.createWalletSet({
    name: "MICA Developer Wallets",
  });
  walletSetId = wsResponse.data?.walletSet?.id;
  if (!walletSetId) {
    die("createWalletSet succeeded but returned no walletSet.id");
  }
  console.log(`[circle-setup] Wallet Set created. ID: ${walletSetId}`);
} catch (err) {
  const msg = err?.response?.data?.errorMessage || err?.message || String(err);
  die(`Wallet Set creation failed: ${msg}`);
}

// ── 4. Update .env ─────────────────────────────────────────────────────────

console.log("[circle-setup] Updating .env ...");

let envContent = loadEnvFile(ENV_PATH);
envContent = upsertEnvVar(envContent, "CIRCLE_ENTITY_SECRET", entitySecret);
envContent = upsertEnvVar(envContent, "CIRCLE_WALLET_SET_ID", walletSetId);
writeFileSync(ENV_PATH, envContent, "utf-8");

console.log("[circle-setup] .env updated with CIRCLE_ENTITY_SECRET and CIRCLE_WALLET_SET_ID.");

// ── 5. Final Report ───────────────────────────────────────────────────────

console.log("\n========== SETUP COMPLETE ==========");
console.log(`CIRCLE_API_KEY configured:        true`);
console.log(`CIRCLE_ENTITY_SECRET configured:  true`);
console.log(`CIRCLE_WALLET_SET_ID configured:  true`);
console.log(`Entity Secret registered:         true`);
console.log(`Wallet Set created:               true`);
console.log(`Recovery directory:               ${recoveryDir}`);
console.log("");
console.log("SECURITY REMINDERS:");
console.log("  - NEVER print the entity secret or recovery file contents.");
console.log("  - Store the recovery file in a secure, offline location.");
console.log("  - The .env file is already in .gitignore (.env*).");
console.log("  - Do NOT expose CIRCLE_* variables to VITE_* prefixed vars.");
console.log("====================================\n");
