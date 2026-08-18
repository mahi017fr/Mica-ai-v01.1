// Circle Modular Wallet — shared types.
//
// SECURITY: These types are metadata only. Private keys, seed phrases,
// passkeys, keyshares, and recovery secrets are NEVER represented here and
// NEVER persisted to Firestore. The WebAuthn passkey stays in the browser and
// restores the wallet on every login.

// The ONLY Circle fields written to `users/{uid}` in Firestore.
export interface CircleWalletMetadata {
  circleWalletAddress: string | null;
  circleWalletCredentialId: string | null;
  circleWalletStatus: CircleWalletStatus;
  circleWalletLinkedAt: string | null;
}

export type CircleWalletStatus =
  | "unconfigured" // VITE_CLIENT_KEY is missing — nothing can run
  | "not_created" // no Circle wallet for this user yet
  | "linking" // passkey registration / login in progress
  | "linked" // passkey + modular smart account active for this user
  | "error"; // last attempt failed

export const EMPTY_CIRCLE_WALLET_METADATA: CircleWalletMetadata = {
  circleWalletAddress: null,
  circleWalletCredentialId: null,
  circleWalletStatus: "not_created",
  circleWalletLinkedAt: null,
};

// Standard EIP-1193 provider interface used by the existing MICA signing
// pipeline (`getSigningContext` returns `{ provider, from }`).
export interface CircleEip1193Request {
  method: string;
  params?: unknown[];
}

export interface CircleEip1193Provider {
  request(request: CircleEip1193Request): Promise<unknown>;
}

// Result of creating or restoring a Circle Modular Wallet for a MICA user.
export interface CircleWalletResult {
  address: string;
  credentialId: string;
  linkedAt: string;
  provider: CircleEip1193Provider;
  from: string;
  rpId?: string | undefined;
  /** true when an existing passkey credential restored the same wallet. */
  restored: boolean;
}

export type CircleWalletSession =
  | { status: "checking" }
  | { status: "unconfigured" }
  | { status: "idle"; uid: string; metadata: CircleWalletMetadata }
  | {
      status: "linking";
      uid: string;
      metadata: CircleWalletMetadata;
    }
  | {
      status: "linked";
      uid: string;
      metadata: CircleWalletMetadata;
      address: string;
      credentialId: string;
      from: string;
      provider: CircleEip1193Provider;
    }
  | {
      status: "error";
      uid: string | null;
      metadata: CircleWalletMetadata;
      message: string;
    };
