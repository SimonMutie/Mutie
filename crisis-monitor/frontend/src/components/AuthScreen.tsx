import { useState } from "react";
import { api, setToken, type AuthUser } from "../api";
import Logo from "./Logo";

interface Props {
  mode: "bootstrap" | "login";
  onAuthenticated: (user: AuthUser) => void;
}

type AuthTab = "signin" | "change-password" | "request-access";

/** First-run "set up admin account" screen, or the regular login screen —
 *  same layout, different copy/submit action. The three-tab (Sign
 *  In / Change Password / Request Access) treatment only applies to the
 *  regular login screen: bootstrap mode is a one-time setup flow with no
 *  existing account to change the password of, and no admin yet to request
 *  access from. */
export default function AuthScreen({ mode, onAuthenticated }: Props) {
  const [tab, setTab] = useState<AuthTab>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Separate state for the other two tabs — kept apart from the sign-in
  // fields above so switching tabs doesn't leak a half-typed password into
  // the wrong form, and so a success message on one tab doesn't need to
  // guess which fields to clear.
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [changeSuccess, setChangeSuccess] = useState(false);

  const [requestName, setRequestName] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [requestOrg, setRequestOrg] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [requestSuccess, setRequestSuccess] = useState(false);

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

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("New passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.changePasswordPublic(username, password, newPassword);
      setChangeSuccess(true);
      setPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestAccess(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.requestAccess({ name: requestName, email: requestEmail, organization: requestOrg || undefined, reason: requestReason || undefined });
      setRequestSuccess(true);
      setRequestName("");
      setRequestEmail("");
      setRequestOrg("");
      setRequestReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function switchTab(next: AuthTab) {
    setTab(next);
    setError(null);
    setChangeSuccess(false);
    setRequestSuccess(false);
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
      <div className="panel" style={{ width: 380, padding: "28px 28px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ marginBottom: mode === "login" ? 4 : 8, display: "flex", alignItems: "center", gap: 10 }}>
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
            {mode === "bootstrap" && <div className="eyebrow" style={{ marginTop: 4 }}>SET UP YOUR ADMIN ACCOUNT</div>}
          </div>
        </div>

        {mode === "login" && (
          <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border-soft)", marginBottom: 4 }}>
            {(
              [
                { value: "signin", label: "Sign In" },
                { value: "change-password", label: "Change Password" },
                { value: "request-access", label: "Request Access" },
              ] as { value: AuthTab; label: string }[]
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => switchTab(t.value)}
                style={{
                  padding: "6px 8px",
                  fontSize: 11.5,
                  fontWeight: tab === t.value ? 600 : 400,
                  background: "transparent",
                  border: "none",
                  borderBottom: tab === t.value ? "2px solid var(--signal)" : "2px solid transparent",
                  color: tab === t.value ? "var(--text-primary)" : "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {mode === "bootstrap" && (
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 4px", lineHeight: 1.5 }}>
            No accounts exist yet — this creates the first admin login. You'll use it to create a separate login for
            each client afterward.
          </p>
        )}

        {(mode === "bootstrap" || tab === "signin") && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

            <button type="submit" disabled={submitting} style={primaryBtnStyle}>
              {submitting ? "Please wait…" : mode === "bootstrap" ? "Create admin account" : "Sign in"}
            </button>
          </form>
        )}

        {mode === "login" && tab === "change-password" && (
          <>
            {changeSuccess ? (
              <div style={{ fontSize: 13, color: "var(--signal)", padding: "8px 0" }}>
                Password changed. You can sign in with your new password now.
              </div>
            ) : (
              <form onSubmit={handleChangePassword} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  Confirms it's really you by checking your current password — not a "forgot password" reset, since
                  there's no email on file to send one to.
                </p>
                <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" style={inputStyle} />
                <input
                  placeholder="Current password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  style={inputStyle}
                />
                <input
                  placeholder="New password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  style={inputStyle}
                />
                <input
                  placeholder="Confirm new password"
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  autoComplete="new-password"
                  style={inputStyle}
                />
                {error && <div style={{ color: "var(--critical)", fontSize: 12.5 }}>{error}</div>}
                <button type="submit" disabled={submitting} style={primaryBtnStyle}>
                  {submitting ? "Please wait…" : "Change password"}
                </button>
              </form>
            )}
          </>
        )}

        {mode === "login" && tab === "request-access" && (
          <>
            {requestSuccess ? (
              <div style={{ fontSize: 13, color: "var(--signal)", padding: "8px 0" }}>
                Request submitted. An admin will review it and reach out with login details if approved.
              </div>
            ) : (
              <form onSubmit={handleRequestAccess} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  Doesn't create an account — an admin reviews this and follows up directly.
                </p>
                <input placeholder="Full name" value={requestName} onChange={(e) => setRequestName(e.target.value)} style={inputStyle} required />
                <input
                  placeholder="Email"
                  type="email"
                  value={requestEmail}
                  onChange={(e) => setRequestEmail(e.target.value)}
                  style={inputStyle}
                  required
                />
                <input
                  placeholder="Organization (optional)"
                  value={requestOrg}
                  onChange={(e) => setRequestOrg(e.target.value)}
                  style={inputStyle}
                />
                <textarea
                  placeholder="Why do you need access? (optional)"
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-body)" }}
                />
                {error && <div style={{ color: "var(--critical)", fontSize: 12.5 }}>{error}</div>}
                <button type="submit" disabled={submitting} style={primaryBtnStyle}>
                  {submitting ? "Please wait…" : "Submit request"}
                </button>
              </form>
            )}
          </>
        )}
      </div>
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

const primaryBtnStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "10px 14px",
  background: "var(--signal-dim)",
  border: "1px solid var(--signal)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13.5,
};

