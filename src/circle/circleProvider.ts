// Thin EIP-1193 adapter around the Circle SDK `EIP1193Provider`.
//
// The SDK's provider is a `web3-types` base provider: its `request()` resolves
// to a JSON-RPC envelope `{ result, jsonrpc, id }`. The rest of MICA (and the
// existing `getSigningContext` pipeline) uses the standard EIP-1193 contract
// where `request()` resolves to the RAW result (e.g. `eth_accounts` -> string[],
// `personal_sign` -> hex string). This adapter bridges that difference so the
// Circle wallet can drop into the same `{ provider, from }` seam.
//
// NOTE on types: the SDK bundles its OWN nested copy of viem (2.45.3). Its
// public types (`Chain`, `Account`, `Transport`, `Client`) are deep-incompatible
// with the project's root viem (2.55.5) even though the runtime objects are
// structurally identical. The casts below are the ONLY place that mismatch
// needs to be bridged — the adapter accepts structurally-compatible clients and
// hands them to the SDK as its own types.

import { EIP1193Provider as CircleSdkProvider } from "@circle-fin/modular-wallets-core";
import type { CircleEip1193Provider } from "./types";

type SdkBundlerClient = ConstructorParameters<typeof CircleSdkProvider>[0];
type SdkPublicClient = ConstructorParameters<typeof CircleSdkProvider>[1];

function unwrap(result: unknown): unknown {
  if (result && typeof result === "object" && "result" in (result as Record<string, unknown>)) {
    return (result as { result: unknown }).result;
  }
  return result;
}

export function createCircleEip1193Provider(
  bundlerClient: unknown,
  publicClient: unknown
): CircleEip1193Provider {
  const inner = new CircleSdkProvider(
    bundlerClient as SdkBundlerClient,
    publicClient as SdkPublicClient
  );

  return {
    async request(request): Promise<unknown> {
      const { method, params = [] } = request;
      const response = await inner.request({ method, params });
      return unwrap(response);
    },
  };
}
