import { useEffect, useState } from "react";
import { api, type CustomDashboard } from "../api";
import DashboardEditor from "./DashboardEditor";

type View = "list" | { editingId: string | null }; // null id = new, unsaved dashboard

export default function CustomDashboardBuilder() {
  const [view, setView] = useState<View>("list");
  const [dashboards, setDashboards] = useState<CustomDashboard[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadList() {
    setLoading(true);
    const rows = await api.getCustomDashboards();
    setDashboards(rows.filter((d) => !d.is_auto));
    setLoading(false);
  }

  useEffect(() => {
    if (view === "list") loadList();
  }, [view]);

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    await api.deleteCustomDashboard(id);
    setDashboards((prev) => prev.filter((d) => d.id !== id));
  }

  if (view === "list") {
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div className="eyebrow">YOUR BESPOKE DASHBOARDS ({dashboards.length})</div>
          <button onClick={() => setView({ editingId: null })} style={primaryBtnStyle}>
            + New dashboard
          </button>
        </div>

        {loading ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
        ) : dashboards.length === 0 ? (
          <div className="panel" style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13.5 }}>
            No bespoke dashboards yet — design one from stat cards, charts, and maps built from your incident data.
            <br />
            <button onClick={() => setView({ editingId: null })} style={{ ...primaryBtnStyle, marginTop: 12 }}>
              + New dashboard
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dashboards.map((d) => (
              <div
                key={d.id}
                onClick={() => setView({ editingId: d.id })}
                className="panel"
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{d.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {d.widgets.length} widget{d.widgets.length === 1 ? "" : "s"} · updated {new Date(d.updated_at).toLocaleDateString()}
                  </div>
                </div>
                {d.is_public && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "3px 9px",
                      borderRadius: 999,
                      color: "var(--signal)",
                      background: "color-mix(in srgb, var(--signal) 14%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--signal) 40%, transparent)",
                    }}
                  >
                    Live shared
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(d.id, d.name);
                  }}
                  title="Delete this dashboard"
                  style={{
                    fontSize: 12,
                    padding: "4px 8px",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    color: "var(--critical)",
                    cursor: "pointer",
                  }}
                >
                  Delete
                </button>
                <span style={{ color: "var(--text-faint)", fontSize: 16 }}>→</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return <DashboardEditor mode={{ kind: "bespoke", id: view.editingId }} onBack={() => setView("list")} onSavedNew={(id) => setView({ editingId: id })} />;
}

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--signal-dim)",
  border: "1px solid var(--signal)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

