import React, { createContext, useContext } from "react";
import { useDealGuide, DealGuideApi } from "./useDealGuide";

export interface DealGuideProviderProps {
  roomId: string | null;
  currentUid?: string;
  buyerUid?: string | null;
  sellerUid?: string | null;
  buyerWallet?: string;
  sellerWallet?: string;
  buyerName?: string;
  sellerName?: string;
  children: React.ReactNode;
}

const DealGuideContext = createContext<DealGuideApi | null>(null);

export function DealGuideProvider(props: DealGuideProviderProps) {
  const { roomId, currentUid, buyerUid, sellerUid, buyerWallet, sellerWallet, buyerName, sellerName, children } = props;
  const api = useDealGuide({
    roomId,
    currentUid,
    buyerUid,
    sellerUid,
    buyerWallet,
    sellerWallet,
    buyerName,
    sellerName,
  });
  return <DealGuideContext.Provider value={api}>{children}</DealGuideContext.Provider>;
}

export function useDealGuideContext(): DealGuideApi {
  const ctx = useContext(DealGuideContext);
  if (!ctx) {
    throw new Error("useDealGuideContext must be used within a DealGuideProvider");
  }
  return ctx;
}
