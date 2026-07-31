import { JsonRpcProvider } from "ethers";
import { ARC_NETWORK } from "./arcNetwork";

export type StepLogger = (step: string, detail?: string) => void;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A brand-new Arc RPC provider.
 *
 * Every balance read / receipt wait / transaction lookup MUST create a fresh
 * provider through this helper so a previous (possibly stale, rate-limited, or
 * closed) connection is never reused. Requirement: "Ensure balance refresh does
 * not reuse stale provider instances."
 */
export function getFreshArcProvider(): JsonRpcProvider {
  return new JsonRpcProvider(ARC_NETWORK.rpcUrl, ARC_NETWORK.chainId, {
    staticNetwork: true,
  });
}

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
    // Fresh provider on EVERY poll so we never reuse a stale connection.
    const provider = getFreshArcProvider();
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
