import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import IntroOverlay from "./components/IntroOverlay";
import ErrorBoundary from "./components/ErrorBoundary";
import "./theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary
      fallback={(error, retry) => (
        <div style={{ height: "100vh", display: "grid", placeItems: "center", color: "#e8e6e0", font: "14px system-ui, sans-serif", padding: 24, textAlign: "center" }}>
          <div style={{ maxWidth: 560 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Something went wrong loading The Lens</div>
            <pre style={{ opacity: 0.75, whiteSpace: "pre-wrap", textAlign: "left", marginBottom: 14 }}>{error.message}</pre>
            <button onClick={retry} style={{ padding: "8px 18px", cursor: "pointer", marginRight: 8 }}>Try again</button>
            <button onClick={() => location.reload()} style={{ padding: "8px 18px", cursor: "pointer" }}>Reload</button>
          </div>
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
    {/* The opening sequence, over the app while it loads. See IntroOverlay.tsx. */}
    <IntroOverlay />
  </React.StrictMode>
);
