import { JsonRpcProvider } from "ethers";
import { ARC_NETWORK } from "./arcNetwork";

export type StepLogger = (step: string, detail?: string) => void;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getFreshArcProvider(): JsonRpcProvider {
  return new JsonRpcProvider(ARC_NETWORK.rpcUrl, ARC_NETWORK.chainId, {
    staticNetwork: true,
  });
}

let sharedArcReadProvider: JsonRpcProvider | null = null;

/** Shared provider for ordinary read-only calls such as ERC-20 balanceOf. */
export function getSharedArcReadProvider(): JsonRpcProvider {
  if (!sharedArcReadProvider) sharedArcReadProvider = getFreshArcProvider();
  return sharedArcReadProvider;
}

const readInflight = new Map<string, Promise<unknown>>();
const readCache = new Map<string, { value: unknown; expires: number }>();
const isRateLimited = (err: any) => /rate.?limit|429|too many requests|eth_gasPrice/i.test(String(err?.message || err));

export async function withArcReadCache<T>(key: string, read: () => Promise<T>, ttlMs = 1500): Promise<T> {
  const cached = readCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  const pending = readInflight.get(key);
  if (pending) return pending as Promise<T>;
  const request = (async () => {
    let last: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const value = await read();
        readCache.set(key, { value, expires: Date.now() + ttlMs });
        return value;
      } catch (err) {
        last = err;
        if (!isRateLimited(err) || attempt === 4) throw err;
        await sleep(Math.min(8000, 400 * 2 ** attempt));
      }
    }
    throw last;
  })();
  readInflight.set(key, request);
  try { return await request; } finally { if (readInflight.get(key) === request) readInflight.delete(key); }
}

export { isRateLimited };

export interface ArcReceiptStatus {
  confirmed: boolean;
  status: number | null;
  transactionHash: string;
}

/**
 * Wait for an Arc transaction receipt using a FRESH provider that polls until
 * the transaction is mined (Arc has deterministic finality — a mined receipt is
 * final). Transient RPC errors during polling do NOT abort the wait.
 *
 * @param hash      Transaction hash returned by the wallet.
 * @param timeoutMs Max time to wait before giving up.
 * @returns confirmed=true with status 1 on success, status 0 on-chain revert,
 *          or confirmed=false if the timeout elapsed before a receipt appeared.
 */
export async function waitForArcTransaction(
  hash: string,
  timeoutMs = 45_000,
  log?: StepLogger
): Promise<ArcReceiptStatus> {
  const start = Date.now();
  let lastError: unknown = null;

  while (Date.now() - start < timeoutMs) {
    const provider = getSharedArcReadProvider();
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      if (receipt) {
        const status = Number(receipt.status);
        return { confirmed: true, status, transactionHash: hash };
      }
      lastError = null;
    } catch (err: any) {
      lastError = err;
      log?.(
        `Waiting Confirmation — RPC error on poll ${Math.round((Date.now() - start) / 1000)}s (retrying):`,
        err?.message || String(err)
      );
    }
    await sleep(2000);
  }

  if (lastError) {
    console.warn(
      `[Arc] Last RPC error while waiting for receipt ${hash} before timeout:`,
      lastError
    );
  }
  log?.(
    `Waiting Confirmation — timed out after ${Math.round(timeoutMs / 1000)}s (transaction was submitted; receipt not yet seen)`,
    hash
  );
  return { confirmed: false, status: null, transactionHash: hash };
}
