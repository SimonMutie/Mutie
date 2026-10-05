import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import IntroOverlay from "./components/IntroOverlay";
import "./theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    {/* The opening sequence, over the app while it loads. See IntroOverlay.tsx. */}
    <IntroOverlay />
  </React.StrictMode>
);
