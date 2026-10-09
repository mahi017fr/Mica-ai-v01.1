import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import ChatDashboard from "../components/ChatDashboard";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChatDashboard />
  </StrictMode>
);
