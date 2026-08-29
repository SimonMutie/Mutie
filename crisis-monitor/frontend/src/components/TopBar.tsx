import type { AuthUser } from "../api";
import Logo from "./Logo";

interface Props {
  connected: boolean;
  user: AuthUser;
  view: "list" | "dashboard" | "admin" | "incidents" | "datasets";
  onNavigate: (view: "list" | "admin" | "incidents" | "datasets") => void;
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
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ position: "relative" }}>
          <Logo size={30} />
          <span
            title={connected ? "Live" : "Disconnected"}
            style={{
              position: "absolute",
              bottom: -1,
              right: -1,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: connected ? "var(--signal)" : "var(--text-faint)",
              border: "1.5px solid var(--panel)",
              boxShadow: connected ? "0 0 6px var(--signal)" : "none",
              animation: connected ? "pulse 2s ease-in-out infinite" : "none",
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 0 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 25,
              fontWeight: 700,
              letterSpacing: "0.01em",
              lineHeight: 1.05,
            }}
          >
            Globa<span style={{ color: "var(--signal)" }}>Lens</span>
          </h1>
          <span className="eyebrow" style={{ fontSize: 9.5, lineHeight: 1.2 }}>CRISIS MONITORING</span>
        </div>
        {user.client_logo && (
          <>
            <div style={{ width: 1, height: 26, background: "var(--border-soft)" }} />
            <img src={user.client_logo} alt="" style={{ width: 26, height: 26, objectFit: "contain", borderRadius: 4 }} />
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <nav style={{ display: "flex", gap: 6 }}>
          <button onClick={() => onNavigate("incidents")} style={navBtnStyle(view === "incidents")}>
            Trends & Patterns
          </button>
          <button onClick={() => onNavigate("list")} style={navBtnStyle(view === "list" || view === "dashboard")}>
            Live Monitoring
          </button>
          <button onClick={() => onNavigate("datasets")} style={navBtnStyle(view === "datasets")}>
            Datasets
          </button>
          {(user.role === "admin" || user.is_client_admin) && (
            <button onClick={() => onNavigate("admin")} style={navBtnStyle(view === "admin")}>
              {user.role === "admin" ? "Clients" : "My Team"}
            </button>
          )}
        </nav>

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
