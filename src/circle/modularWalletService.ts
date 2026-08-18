// Circle Modular Wallet service — creates (Register) or restores (Login) the
// passkey-backed modular smart account for the signed-in user and returns the
// standard EIP-1193 provider + verified `from` address that the rest of MICA
// consumes through the existing `{ provider, from }` signing seam.
//
// Lifecycle:
//   no stored credential id -> WebAuthn Register (create the wallet)
//   stored credential id    -> WebAuthn Login (restore the SAME passkey)
//
// SECURITY: Private keys, seed phrases, passkeys, keyshares, and recovery
// secrets are NEVER represented here and NEVER persisted to Firestore. The
// WebAuthn passkey stays in the browser authenticator and restores the wallet
// on every login. The ONLY data written to Firestore is the metadata block
// defined in `./types` (address, credential id, status, linkedAt).

import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
} from "@circle-fin/modular-wallets-core";
import { createClient, createPublicClient, http, type Transport } from "viem";
import {
  createBundlerClient,
  toWebAuthnAccount,
  type SmartAccount,
} from "viem/account-abstraction";
import { ARC_NETWORK } from "../payments/arcNetwork";
import { CIRCLE_ARC_TESTNET_CHAIN } from "./arcViemChain";
import { createCircleEip1193Provider } from "./circleProvider";
import type { CircleWalletResult } from "./types";

// The SDK bundles its OWN nested copy of viem; its public types (`Client`,
// `SmartAccount`, transports) are deep-incompatible with the project's root
// viem even though the runtime objects are structurally identical. The casts
// below are the ONLY place that mismatch needs to be bridged (same pattern as
// `circleProvider.ts`).
type SdkClient = Parameters<typeof toCircleSmartAccount>[0]["client"];
type SdkOwner = Parameters<typeof toCircleSmartAccount>[0]["owner"];

const WALLET_NAME = "MICA Wallet";
const DEFAULT_REGISTRATION_USERNAME = "MICA User";

function debug(...args: unknown[]): void {
  if ((import.meta as any).env?.DEV) {
    console.info(`[CircleWallet] [${new Date().toISOString()}]`, ...args);
  }
}

export interface CircleClientConfig {
  /** true when VITE_CLIENT_URL and VITE_CLIENT_KEY are both present. */
  configured: boolean;
  clientUrl: string;
  clientKey: string;
}

export function getCircleClientConfig(): CircleClientConfig {
  const clientUrl = ((import.meta.env.VITE_CLIENT_URL as string | undefined) ?? "").trim();
  const clientKey = ((import.meta.env.VITE_CLIENT_KEY as string | undefined) ?? "").trim();
  return {
    configured: Boolean(clientUrl && clientKey),
    clientUrl,
    clientKey,
  };
}

/**
 * Ensure the user has a Circle Modular Wallet.
 *
 * * No stored credential id -> Register: prompts the browser to create a
 *   passkey and creates the modular smart account.
 * * Stored credential id -> Login: prompts for the SAME passkey and restores
 *   the existing modular smart account.
 *
 * On success returns the modular wallet address, the passkey credential id,
 * the EIP-1193 provider, and the verified `from` address — the ONLY caller of
 * this function (`useCircleWalletSession`) persists just the metadata block.
 */
export async function ensureCircleWallet(
  existingCredentialId: string | null,
  username?: string
): Promise<CircleWalletResult> {
  const { configured, clientUrl, clientKey } = getCircleClientConfig();
  if (!configured) {
    throw new Error(
      "Circle Modular Wallet is not configured. Set VITE_CLIENT_URL and VITE_CLIENT_KEY."
    );
  }

  const mode = existingCredentialId ? WebAuthnMode.Login : WebAuthnMode.Register;
  const isRegister = mode === WebAuthnMode.Register;

  debug(`ensure start: ${isRegister ? "register" : "login"}`, {
    hasClientKey: Boolean(clientKey),
    hasClientUrl: Boolean(clientUrl),
    hasStoredCredential: Boolean(existingCredentialId),
  });

  // Passkey transport drives the WebAuthn prompt: Register on first login,
  // Login (scoped to the stored credential) on every subsequent login.
  const passkeyTransport = toPasskeyTransport(clientUrl, clientKey);

  debug(isRegister ? "WebAuthn registration starting" : "WebAuthn login starting");

  const credential = await toWebAuthnCredential({
    transport: passkeyTransport,
    mode,
    username: isRegister ? username || DEFAULT_REGISTRATION_USERNAME : undefined,
    credentialId: existingCredentialId ?? undefined,
  });

  debug("WebAuthn credential obtained", { credentialIdLength: credential.id.length });

  // Modular transport talks to Circle's Modular Wallet RPC for this chain.
  // The chain path is appended HERE; VITE_CLIENT_URL never includes it.
  const modularTransport = toModularTransport(
    `${clientUrl}/arcTestnet`,
    clientKey
  );

  // Public client reads chain data (balances, receipts) from the Arc RPC.
  const publicClient = createPublicClient({
    chain: CIRCLE_ARC_TESTNET_CHAIN,
    transport: http(ARC_NETWORK.rpcUrl),
  });

  // Client over the modular transport: the transport key tells the smart
  // account to resolve its address against Circle's Modular Wallet API.
  const modularClient = createClient({
    chain: CIRCLE_ARC_TESTNET_CHAIN,
    transport: modularTransport as unknown as Transport,
  });

  // The passkey owner the smart account is created/restored from.
  const owner = toWebAuthnAccount({
    credential: { id: credential.id, publicKey: credential.publicKey },
  }) as unknown as SdkOwner;

  debug("creating/resolving Circle smart account");

  const smartAccount = await toCircleSmartAccount({
    client: modularClient as unknown as SdkClient,
    owner,
    name: WALLET_NAME,
  });

  if (!smartAccount.address) {
    throw new Error(
      "Circle smart account resolved without an address. The Modular Wallet RPC did not return a wallet address."
    );
  }

  debug(`Circle wallet address resolved: ${smartAccount.address}`);

  // Bundler client submits user operations through Circle's bundler RPC.
  const bundlerClient = createBundlerClient({
    account: smartAccount as unknown as SmartAccount,
    chain: CIRCLE_ARC_TESTNET_CHAIN,
    transport: modularTransport as unknown as Transport,
  });

  const provider = createCircleEip1193Provider(bundlerClient, publicClient);

  return {
    address: smartAccount.address,
    credentialId: credential.id,
    linkedAt: new Date().toISOString(),
    provider,
    from: smartAccount.address,
    rpId: credential.rpId,
    restored: Boolean(existingCredentialId),
  };
}
