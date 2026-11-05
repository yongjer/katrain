import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as store from "./state/store";
import { App } from "./ui/App";
import "./ui/styles.css";

// Development hook for scripted UI tests (scripts/ui-smoke.mjs).
if (import.meta.env.DEV) (window as unknown as { __katrain: typeof store }).__katrain = store;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
