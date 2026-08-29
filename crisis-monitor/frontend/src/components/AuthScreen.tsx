import { useState } from "react";
import { api, setToken, type AuthUser } from "../api";
import Logo from "./Logo";

interface Props {
  mode: "bootstrap" | "login";
  onAuthenticated: (user: AuthUser) => void;
}

/** First-run "set up admin account" screen, or the regular login screen — same layout, different copy/submit action. */
export default function AuthScreen({ mode, onAuthenticated }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { token, user } =
        mode === "bootstrap"
          ? await api.bootstrap(username, password, displayName || undefined)
          : await api.login(username, password);
      setToken(token);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="panel"
        style={{ width: 360, padding: "28px 28px 24px", display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={30} />
          <div>
            <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700 }}>
              The <span style={{ color: "var(--signal)" }}>Lens</span>
            </h1>
            <div className="eyebrow" style={{ marginTop: 2, fontSize: 9.5, color: "var(--text-faint)", lineHeight: 1.3 }}>
              Monitor. Investigate. Connect. Analyse. Understand.
            </div>
            <div className="eyebrow" style={{ fontSize: 9.5, color: "var(--text-faint)", opacity: 0.75, lineHeight: 1.3 }}>
              Turning Signals into Insight and Foresight
            </div>
            <div className="eyebrow" style={{ marginTop: 4 }}>
              {mode === "bootstrap" ? "SET UP YOUR ADMIN ACCOUNT" : "SIGN IN"}
            </div>
          </div>
        </div>

        {mode === "bootstrap" && (
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 4px", lineHeight: 1.5 }}>
            No accounts exist yet — this creates the first admin login. You'll use it to create a separate login for
            each client afterward.
          </p>
        )}

        {mode === "bootstrap" && (
          <input
            placeholder="Display name (optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={inputStyle}
          />
        )}
        <input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          style={inputStyle}
        />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "bootstrap" ? "new-password" : "current-password"}
          style={inputStyle}
        />

        {error && <div style={{ color: "var(--critical)", fontSize: 12.5 }}>{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          style={{
            marginTop: 8,
            padding: "10px 14px",
            background: "var(--signal-dim)",
            border: "1px solid var(--signal)",
            color: "var(--text-primary)",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13.5,
          }}
        >
          {submitting ? "Please wait…" : mode === "bootstrap" ? "Create admin account" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--panel-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "9px 10px",
  fontSize: 13,
  fontFamily: "var(--font-body)",
};
