import { useEffect, useState } from "react";
import { api, type AuthUser } from "../api";

interface Props {
  onBack: () => void;
}

export default function AdminPanel({ onBack }: Props) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadUsers() {
    setUsers(await api.listUsers());
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (username.trim().length < 3 || password.length < 8) {
      setError("Username needs 3+ characters and password needs 8+ characters.");
      return;
    }
    setSubmitting(true);
    try {
      await api.createUser(username.trim(), password, displayName.trim() || undefined, "client");
      setUsername("");
      setPassword("");
      setDisplayName("");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", gap: 24, padding: 24, minHeight: 0 }}>
      <div style={{ flex: "0 0 340px" }}>
        <button onClick={onBack} style={backBtnStyle}>
          ← All queries
        </button>

        <form
          onSubmit={handleSubmit}
          className="panel"
          style={{ marginTop: 16, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            CREATE CLIENT LOGIN
          </div>
          <input
            placeholder="Display name (e.g. Acme Corp)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={inputStyle}
          />
          <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} />
          <input
            placeholder="Password (8+ characters)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
          {error && <div style={{ color: "var(--critical)", fontSize: 12 }}>{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            style={{
              marginTop: 4,
              padding: "8px 14px",
              background: "var(--signal-dim)",
              border: "1px solid var(--signal)",
              color: "var(--text-primary)",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {submitting ? "Creating…" : "Create client"}
          </button>
          <p style={{ fontSize: 11.5, color: "var(--text-faint)", margin: "4px 0 0", lineHeight: 1.5 }}>
            Share this username/password with the client directly — there's no self-serve signup. They'll see only
            the queries they create after logging in.
          </p>
        </form>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          ALL ACCOUNTS ({users.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {users.map((u) => (
            <div
              key={u.id}
              className="panel"
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: u.role === "admin" ? "var(--elevated)" : "var(--signal)",
                  textTransform: "uppercase",
                  flexShrink: 0,
                  width: 46,
                }}
              >
                {u.role}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{u.display_name || u.username}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  {u.username}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--panel-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "var(--font-body)",
};

const backBtnStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 10px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-muted)",
  cursor: "pointer",
};
