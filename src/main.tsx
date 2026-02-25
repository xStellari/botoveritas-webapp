import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Kiosk UX: disable pinch-zoom (Edge/Chromium maps pinch to Ctrl + wheel)
// This does NOT affect normal touch scrolling (pan).
window.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false }
);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
