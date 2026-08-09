import type { AuthUser } from "../api";

interface Props {
  connected: boolean;
  user: AuthUser;
  view: "list" | "dashboard" | "admin";
  onNavigate: (view: "list" | "admin") => void;
  onLogout: () => void;
}

export default function TopBar({ connected, user, view, onNavigate, onLogout }: Props) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 24px",
        borderBottom: "1px solid var(--border-soft)",
        background: "var(--panel)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: connected ? "var(--signal)" : "var(--text-faint)",
            boxShadow: connected ? "0 0 10px var(--signal)" : "none",
            animation: connected ? "pulse 2s ease-in-out infinite" : "none",
          }}
        />
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "0.02em",
          }}
        >
          SENTINEL
        </h1>
        <span className="eyebrow">CRISIS MONITORING</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {user.role === "admin" && (
          <nav style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onNavigate("list")} style={navBtnStyle(view !== "admin")}>
              Queries
            </button>
            <button onClick={() => onNavigate("admin")} style={navBtnStyle(view === "admin")}>
              Clients
            </button>
          </nav>
        )}

        <div style={{ textAlign: "right" }}>
          <div className="eyebrow">{user.role === "admin" ? "ADMIN" : "SIGNED IN"}</div>
          <div className="mono" style={{ fontSize: 13, color: "var(--text-primary)" }}>
            {user.display_name || user.username}
          </div>
        </div>

        <button onClick={onLogout} style={logoutBtnStyle}>
          Log out
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </header>
  );
}

function navBtnStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 12.5,
    padding: "6px 12px",
    background: active ? "var(--signal-dim)" : "transparent",
    border: `1px solid ${active ? "var(--signal)" : "var(--border)"}`,
    borderRadius: 6,
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    cursor: "pointer",
    fontWeight: active ? 600 : 400,
  };
}

const logoutBtnStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 12px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-muted)",
  cursor: "pointer",
};
