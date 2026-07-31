/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChatProvider, useChat } from "./context/ChatContext";
import { CallProvider } from "./context/CallContext";
import { BlockProvider } from "./context/BlockContext";
import { PrivyProvider } from "@privy-io/react-auth";
import AuthPage from "./components/AuthPage";
import ChatDashboard from "./components/ChatDashboard";
import NotificationBanner from "./components/NotificationBanner";
import AIBuddy from "./components/AIBuddy";
import CallOverlay from "./components/CallOverlay";
import { Loader2 } from "lucide-react";

function MainAppContent() {
  const { currentUser, isInitialLoading } = useChat();

  if (isInitialLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#0B0F17] text-[#94A3B8]">
        <Loader2 className="w-8 h-8 animate-spin text-[#6C5CE0] mb-2" />
        <p className="text-xs font-mono uppercase tracking-wider">Syncing SendXX Services...</p>
      </div>
    );
  }

  return (
    <>
      {currentUser ? (
        <>
          <ChatDashboard />
          <AIBuddy />
          <CallOverlay />
        </>
      ) : (
        <AuthPage onAuthSuccess={() => {}} />
      )}
      <NotificationBanner />
    </>
  );
}

export default function App() {
  return (
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID || ""}
      config={{
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#6C5CE0",
        },
        embeddedWallets: {
          createOnLogin: "all-users",
        },
      }}
    >
      <ChatProvider>
        <BlockProvider>
          <CallProvider>
            <MainAppContent />
          </CallProvider>
        </BlockProvider>
      </ChatProvider>
    </PrivyProvider>
  );
}
