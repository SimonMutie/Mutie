import { useEffect, useRef, useState } from "react";
import { api, type AuthUser, type IncidentStats } from "../api";
import IncidentsMap from "./IncidentsMap";
import IncidentSearch from "./IncidentSearch";
import IncidentUpload from "./IncidentUpload";
import IncidentManualEntry from "./IncidentManualEntry";
import IncidentManageTable from "./IncidentManageTable";
import CustomDashboardBuilder from "./CustomDashboardBuilder";
import DashboardEditor from "./DashboardEditor";
import MapDefaultsPanel from "./MapDefaultsPanel";

type Tab = "search" | "manual" | "dashboard" | "map" | "upload" | "manage" | "mapdefaults";
type DashboardMode = "auto" | "bespoke";

export default function IncidentsDashboard({ user }: { user: AuthUser }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>("auto");
  const [stats, setStats] = useState<IncidentStats | null>(null);
  const [manageRefreshKey, setManageRefreshKey] = useState(0);
  const [logMenuOpen, setLogMenuOpen] = useState(false);
  const logMenuRef = useRef<HTMLDivElement>(null);

  const LOG_TABS: Tab[] = ["search", "manual", "upload", "manage"];
  const isLogTabActive = LOG_TABS.includes(tab);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (logMenuRef.current && !logMenuRef.current.contains(e.target as Node)) {
        setLogMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
        {user.role === "admin" && (
          <button onClick={() => setTab("mapdefaults")} style={tabBtnStyle(tab === "mapdefaults")} title="What everyone sees by default when they open Mapping">
            Map Defaults
          </button>
        )}

        <div ref={logMenuRef} style={{ position: "relative" }}>
          <button onClick={() => setLogMenuOpen((v) => !v)} style={tabBtnStyle(isLogTabActive)}>
            Incident Log ▾
          </button>
          {logMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                zIndex: 20,
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(19,23,34,0.14)",
                minWidth: 180,
                overflow: "hidden",
              }}
            >
              {(
                [
                  { value: "search", label: "Search Incidents" },
                  { value: "manual", label: "Enter Manually" },
                  { value: "upload", label: "Upload Bulk" },
                  { value: "manage", label: "Manage (Edit/Delete)" },
                ] as { value: Tab; label: string }[]
              ).map((item) => (
                <button
                  key={item.value}
                  onClick={() => {
                    setTab(item.value);
                    setLogMenuOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 14px",
                    fontSize: 12.5,
                    background: tab === item.value ? "var(--signal-dim)" : "transparent",
                    border: "none",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    fontWeight: tab === item.value ? 600 : 400,
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {stats && <div style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--text-muted)" }}>{stats.total.toLocaleString()} incidents total</div>}
      </div>

      {tab === "search" && <IncidentSearch />}

      {tab === "map" && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <IncidentsMap incidents={[]} />
        </div>
      )}

      {tab === "mapdefaults" && user.role === "admin" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          <MapDefaultsPanel />
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
