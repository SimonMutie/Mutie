import { useEffect, useRef, useState } from "react";
import type { AuthUser } from "../api";
import Logo from "./Logo";

interface Props {
  connected: boolean;
  user: AuthUser;
  view: "list" | "dashboard" | "admin" | "settings" | "incidents" | "datasets";
  onNavigate: (view: "list" | "admin" | "settings" | "incidents" | "datasets") => void;
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
        </nav>

        <AccountMenu user={user} view={view} onNavigate={onNavigate} onLogout={onLogout} />
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

/** The account name/role block doubles as the dropdown's trigger — clicking
 *  it (rather than a separate caret icon) opens Settings, the client/team
 *  management link (only for whoever actually has that right), and Log
 *  out. Closes on an outside click or Escape, same expected behavior as
 *  any other dropdown menu. */
function AccountMenu({
  user,
  view,
  onNavigate,
  onLogout,
}: {
  user: AuthUser;
  view: "list" | "dashboard" | "admin" | "settings" | "incidents" | "datasets";
  onNavigate: (view: "list" | "admin" | "settings" | "incidents" | "datasets") => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canManageTeam = user.role === "admin" || user.is_client_admin;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function go(target: "admin" | "settings") {
    onNavigate(target);
    setOpen(false);
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: open ? "var(--panel-raised)" : "transparent",
          border: `1px solid ${open ? "var(--border)" : "transparent"}`,
          borderRadius: 8,
          padding: "5px 10px",
          cursor: "pointer",
        }}
      >
        <div style={{ textAlign: "right" }}>
          <div className="eyebrow">{user.role === "admin" ? "ADMIN" : "SIGNED IN"}</div>
          <div className="mono" style={{ fontSize: 13, color: "var(--text-primary)" }}>
            {user.display_name || user.username}
          </div>
        </div>
        <span style={{ color: "var(--text-faint)", fontSize: 10, transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>▼</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 180,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            overflow: "hidden",
            zIndex: 50,
          }}
        >
          {canManageTeam && (
            <button role="menuitem" onClick={() => go("admin")} style={menuItemStyle(view === "admin")}>
              {user.role === "admin" ? "Clients" : "My Team"}
            </button>
          )}
          <button role="menuitem" onClick={() => go("settings")} style={menuItemStyle(view === "settings")}>
            Settings
          </button>
          <div style={{ height: 1, background: "var(--border-soft)" }} />
          <button role="menuitem" onClick={onLogout} style={{ ...menuItemStyle(false), color: "var(--critical)" }}>
            Log out
          </button>
        </div>
      )}
    </div>
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

function menuItemStyle(active: boolean): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    fontSize: 13,
    padding: "9px 14px",
    background: active ? "var(--signal-dim)" : "transparent",
    border: "none",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
  };
}
