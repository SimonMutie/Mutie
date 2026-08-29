import { useEffect, useState } from "react";
import { api, type AuthUser, type IncidentStats } from "../api";
import IncidentsMap from "./IncidentsMap";
import IncidentSearch from "./IncidentSearch";
import IncidentUpload from "./IncidentUpload";
import IncidentManualEntry from "./IncidentManualEntry";
import IncidentManageTable from "./IncidentManageTable";
import CustomDashboardBuilder from "./CustomDashboardBuilder";
import DashboardEditor from "./DashboardEditor";

type Tab = "search" | "manual" | "dashboard" | "map" | "upload" | "manage";
type DashboardMode = "auto" | "bespoke";

export default function IncidentsDashboard({ user }: { user: AuthUser }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>("auto");
  const [stats, setStats] = useState<IncidentStats | null>(null);
  const [manageRefreshKey, setManageRefreshKey] = useState(0);

  async function loadAll() {
    const statsRes = await api.getIncidentStats();
    setStats(statsRes);
  }

  useEffect(() => {
    loadAll();
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 24px", borderBottom: "1px solid var(--border-soft)" }}>
        <button onClick={() => setTab("dashboard")} style={tabBtnStyle(tab === "dashboard")}>
          Dashboard
        </button>
        <button onClick={() => setTab("map")} style={tabBtnStyle(tab === "map")}>
          Mapping
        </button>

        {stats && <div style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--text-muted)" }}>{stats.total.toLocaleString()} incidents total</div>}
      </div>

      {tab === "search" && <IncidentSearch />}

      {tab === "map" && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <IncidentsMap incidents={[]} isAdmin={user.role === "admin"} onNavigate={setTab} />
        </div>
      )}

      {tab === "manual" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          <IncidentManualEntry
            onSaved={() => {
              loadAll();
              setManageRefreshKey((k) => k + 1);
            }}
          />
        </div>
      )}

      {tab === "manage" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          <IncidentManageTable
            refreshKey={manageRefreshKey}
            onChanged={() => {
              loadAll();
              setManageRefreshKey((k) => k + 1);
            }}
          />
        </div>
      )}

      {tab === "upload" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          <IncidentUpload
            onUploaded={() => {
              loadAll();
              setManageRefreshKey((k) => k + 1);
            }}
          />
        </div>
      )}

      {tab === "dashboard" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", gap: 6, padding: "10px 24px 0" }}>
            <button onClick={() => setDashboardMode("auto")} style={subTabBtnStyle(dashboardMode === "auto")}>
              Auto Dashboard
            </button>
            <button onClick={() => setDashboardMode("bespoke")} style={subTabBtnStyle(dashboardMode === "bespoke")}>
              Create Bespoke
            </button>
          </div>

          {dashboardMode === "bespoke" && <CustomDashboardBuilder />}

          {dashboardMode === "auto" && <DashboardEditor mode={{ kind: "auto" }} />}
        </div>
      )}
    </div>
  );
}

function subTabBtnStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "6px 12px",
    background: active ? "var(--panel)" : "transparent",
    border: `1px solid ${active ? "var(--border)" : "transparent"}`,
    borderBottom: active ? "1px solid var(--panel)" : "1px solid transparent",
    borderRadius: "6px 6px 0 0",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    cursor: "pointer",
    fontWeight: active ? 600 : 400,
    position: "relative",
    top: 1,
  };
}

function tabBtnStyle(active: boolean): React.CSSProperties {
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
