import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Global currency/payment-environment mode.
 *
 * BDT → native (Bangladeshi Taka) payment environment: crypto wallet, Arc/Circle
 * UI, and on-chain payment terms are hidden and replaced with BDT equivalents.
 * USDC | USDT | ETH | SOL → existing Web3 payment environment.
 *
 * The selection is persisted using the app's standard localStorage preference
 * pattern and restored on refresh / re-login.
 */

export type AppCurrency = "BDT" | "USDC" | "USDT" | "ETH" | "SOL";

export const CURRENCY_OPTIONS: { value: AppCurrency; label: string; hint: string }[] = [
  { value: "BDT", label: "BDT", hint: "Bangladeshi Taka" },
  { value: "USDC", label: "USDC", hint: "Circle USD" },
  { value: "USDT", label: "USDT", hint: "Tether USD" },
  { value: "ETH", label: "ETH", hint: "Ether" },
  { value: "SOL", label: "SOL", hint: "Solana" },
];

const STORAGE_KEY = "mica_app_currency";

// BDT is the default payment environment for new users / no saved preference
// (Bangladesh). Returning users restore the preference they saved in
// localStorage — an explicit choice is never overwritten.
const DEFAULT_CURRENCY: AppCurrency = "BDT";

function readInitialCurrency(): AppCurrency {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && CURRENCY_OPTIONS.some((o) => o.value === stored)) {
      return stored as AppCurrency;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_CURRENCY;
}

/** Matches the existing fmtUsdc number style (en-US, 2–6 decimals). */
export function fmtUsdcLike(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

export function fmtBdt(n: number): string {
  return "৳" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

interface CurrencyContextValue {
  currency: AppCurrency;
  setCurrency: (c: AppCurrency) => void;
  isBdtMode: boolean;
  isCryptoMode: boolean;
  /** "৳" for BDT, otherwise the token code (USDC/USDT/ETH/SOL). */
  symbol: string;
  /** BDT → "৳10,000"; crypto → "10,000" (same style as fmtUsdc). */
  formatNumber: (n: number) => string;
  /** BDT → "৳10,000"; crypto → "10,000 USDC" (mode-aware full money label). */
  formatMoney: (n: number) => string;
  currencyLabel: string;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<AppCurrency>(() => readInitialCurrency());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, currency);
    } catch {
      /* ignore */
    }
  }, [currency]);

  const setCurrency = useCallback((c: AppCurrency) => {
    setCurrencyState(c);
  }, []);

  const value = useMemo<CurrencyContextValue>(() => {
    const isBdtMode = currency === "BDT";
    const isCryptoMode = !isBdtMode;
    const formatNumber = (n: number) => (isBdtMode ? fmtBdt(n) : fmtUsdcLike(n));
    const formatMoney = (n: number) => (isBdtMode ? fmtBdt(n) : `${fmtUsdcLike(n)} ${currency}`);
    const label = CURRENCY_OPTIONS.find((o) => o.value === currency)?.hint || currency;
    return {
      currency,
      setCurrency,
      isBdtMode,
      isCryptoMode,
      symbol: isBdtMode ? "৳" : currency,
      formatNumber,
      formatMoney,
      currencyLabel: label,
    };
  }, [currency, setCurrency]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useAppCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useAppCurrency must be used within a CurrencyProvider");
  return ctx;
}