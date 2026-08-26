import { useEffect, useState } from "react";
import {
  api,
  type CustomDashboard,
  type DashboardWidget,
  type IncidentItem,
  type IncidentStats,
  type NormalizedDashboardStats,
  type WidgetDataField,
  type WidgetType,
} from "../api";
import DashboardWidgetCard, { fieldLabel } from "./DashboardWidgetCard";

const CATEGORY_FIELDS: WidgetDataField[] = ["by_sector", "by_actor", "by_tactic", "by_province", "by_country"];
const FIELDS_FOR_TYPE: Record<WidgetType, WidgetDataField[]> = {
  stat: ["total", "deaths", "injuries", "kidnappings_ngo"],
  bar: CATEGORY_FIELDS,
  pie: CATEGORY_FIELDS,
  line: ["time_series", ...CATEGORY_FIELDS],
  map: [],
};
const WIDGET_TYPES: { value: WidgetType; label: string }[] = [
  { value: "stat", label: "Stat card" },
  { value: "bar", label: "Bar chart" },
  { value: "line", label: "Line chart" },
  { value: "pie", label: "Pie chart" },
  { value: "map", label: "Map" },
];

/** IncidentStats (the existing authenticated stats endpoint) has casualties
 *  broken into several named fields; widgets want three flat numbers. This
 *  keeps the builder's live preview using the exact same widget-rendering
 *  code as the public share view, which gets an already-normalized shape
 *  from the backend directly. */
function normalizeStats(stats: IncidentStats): NormalizedDashboardStats {
  const deaths = Object.entries(stats.casualties)
    .filter(([k]) => k.startsWith("deaths_"))
    .reduce((sum, [, v]) => sum + (v ?? 0), 0);
  const injuries = Object.entries(stats.casualties)
    .filter(([k]) => k.startsWith("injuries_"))
    .reduce((sum, [, v]) => sum + (v ?? 0), 0);
  return {
    total: stats.total,
    by_sector: stats.by_sector,
    by_actor: stats.by_actor,
    by_tactic: stats.by_tactic,
    by_severity: stats.by_severity,
    by_province: stats.by_province,
    by_country: stats.by_country,
    time_series: stats.time_series,
    deaths,
    injuries,
    kidnappings_ngo: stats.casualties.kidnappings_ngo ?? 0,
  };
}

type View = "list" | { editingId: string | null }; // null id = new, unsaved dashboard

export default function CustomDashboardBuilder() {
  const [view, setView] = useState<View>("list");
  const [dashboards, setDashboards] = useState<CustomDashboard[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadList() {
    setLoading(true);
    const rows = await api.getCustomDashboards();
    setDashboards(rows);
    setLoading(false);
  }

  useEffect(() => {
    if (view === "list") loadList();
  }, [view]);

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
                <span style={{ color: "var(--text-faint)", fontSize: 16 }}>→</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return <DashboardEditor editingId={view.editingId} onBack={() => setView("list")} />;
}

function DashboardEditor({ editingId, onBack }: { editingId: string | null; onBack: () => void }) {
  const [name, setName] = useState("Untitled dashboard");
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [backendId, setBackendId] = useState<string | null>(editingId);
  const [isPublic, setIsPublic] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [stats, setStats] = useState<NormalizedDashboardStats | null>(null);
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [addingWidget, setAddingWidget] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [draftType, setDraftType] = useState<WidgetType>("bar");
  const [draftField, setDraftField] = useState<WidgetDataField>("by_sector");
  const [draftSize, setDraftSize] = useState<DashboardWidget["size"]>("medium");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftDataLabels, setDraftDataLabels] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    api.getIncidentStats().then((s) => setStats(normalizeStats(s)));
    api.getIncidents({ limit: 3000 }).then(setIncidents);
  }, []);

  useEffect(() => {
    if (editingId) {
      api.getCustomDashboard(editingId).then((d) => {
        setName(d.name);
        setWidgets(d.widgets);
        setBackendId(d.id);
        setIsPublic(d.is_public);
        setShareToken(d.share_token);
      });
    }
  }, [editingId]);

  function addWidget() {
    const widget: DashboardWidget = {
      id: crypto.randomUUID(),
      type: draftType,
      title: `${draftType === "stat" ? "" : `${draftType[0].toUpperCase()}${draftType.slice(1)}: `}${fieldLabel(draftField)}`,
      label: draftLabel || undefined,
      dataField: draftField,
      size: draftSize,
      showDataLabels: draftDataLabels,
    };
    setWidgets((w) => [...w, widget]);
    resetDraft();
  }

  function resetDraft() {
    setAddingWidget(false);
    setEditingWidgetId(null);
    setDraftType("bar");
    setDraftField("by_sector");
    setDraftSize("medium");
    setDraftLabel("");
    setDraftDataLabels(false);
  }

  function startEditWidget(widget: DashboardWidget) {
    setAddingWidget(false);
    setEditingWidgetId(widget.id);
    setDraftType(widget.type);
    setDraftField(widget.dataField ?? FIELDS_FOR_TYPE[widget.type][0]);
    setDraftSize(widget.size);
    setDraftLabel(widget.label ?? "");
    setDraftDataLabels(!!widget.showDataLabels);
  }

  function applyEditWidget() {
    if (!editingWidgetId) return;
    setWidgets((ws) =>
      ws.map((w) =>
        w.id === editingWidgetId
          ? { ...w, type: draftType, dataField: draftType === "map" ? undefined : draftField, size: draftSize, label: draftLabel || undefined, showDataLabels: draftDataLabels }
          : w
      )
    );
    resetDraft();
  }

  function removeWidget(id: string) {
    setWidgets((w) => w.filter((x) => x.id !== id));
  }
  function renameWidget(id: string, title: string) {
    setWidgets((w) => w.map((x) => (x.id === id ? { ...x, title } : x)));
  }
  function moveWidget(id: string, dir: -1 | 1) {
    setWidgets((w) => {
      const idx = w.findIndex((x) => x.id === id);
      const swapWith = idx + dir;
      if (idx < 0 || swapWith < 0 || swapWith >= w.length) return w;
      const next = [...w];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      if (backendId) {
        await api.updateCustomDashboard(backendId, { name, widgets });
      } else {
        const created = await api.createCustomDashboard(name, widgets);
        setBackendId(created.id);
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleShare() {
    if (!backendId) {
      await save();
    }
    if (!backendId) return;
    const updated = await api.updateCustomDashboard(backendId, { is_public: !isPublic });
    setIsPublic(updated.is_public);
    setShareToken(updated.share_token);
  }

  function copyShareLink() {
    if (!shareToken) return;
    const url = `${window.location.origin}/shared/${shareToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 24px", borderBottom: "1px solid var(--border-soft)", flexWrap: "wrap" }}>
        <button onClick={onBack} style={secondaryBtnStyle}>
          ← All dashboards
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ fontSize: 15, fontWeight: 700, border: "none", background: "transparent", color: "var(--text-primary)", flex: 1, minWidth: 160 }}
        />
        <button
          onClick={() => {
            resetDraft();
            setAddingWidget(true);
          }}
          style={primaryBtnStyle}
        >
          + Add widget
        </button>
        <button onClick={save} disabled={saving} style={secondaryBtnStyle}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={toggleShare} style={isPublic ? liveBtnStyle : secondaryBtnStyle}>
          {isPublic ? "● Live shared" : "Share for live viewing"}
        </button>
        {isPublic && shareToken && (
          <button onClick={copyShareLink} style={secondaryBtnStyle}>
            {linkCopied ? "Copied!" : "Copy link"}
          </button>
        )}
      </div>

      {(addingWidget || editingWidgetId) && (
        <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border-soft)", display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", background: "var(--panel-raised)" }}>
          <div className="eyebrow" style={{ width: "100%", marginBottom: -4 }}>{editingWidgetId ? "EDIT WIDGET" : "NEW WIDGET"}</div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>TYPE</div>
            <select
              value={draftType}
              onChange={(e) => {
                const newType = e.target.value as WidgetType;
                setDraftType(newType);
                if (FIELDS_FOR_TYPE[newType].length > 0 && !FIELDS_FOR_TYPE[newType].includes(draftField)) {
                  setDraftField(FIELDS_FOR_TYPE[newType][0]);
                }
              }}
              style={selectStyle}
            >
              {WIDGET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {draftType !== "map" && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>DATA</div>
              <select value={draftField} onChange={(e) => setDraftField(e.target.value as WidgetDataField)} style={selectStyle}>
                {FIELDS_FOR_TYPE[draftType].map((f) => (
                  <option key={f} value={f}>
                    {fieldLabel(f)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>SIZE</div>
            <select value={draftSize} onChange={(e) => setDraftSize(e.target.value as DashboardWidget["size"])} style={selectStyle}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>LABEL / CAPTION (OPTIONAL)</div>
            <input
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="e.g. source, note, date range…"
              style={{ ...selectStyle, width: "100%" }}
            />
          </div>
          {(draftType === "bar" || draftType === "pie") && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
              <input type="checkbox" checked={draftDataLabels} onChange={(e) => setDraftDataLabels(e.target.checked)} />
              Show values on chart
            </label>
          )}
          <button onClick={editingWidgetId ? applyEditWidget : addWidget} style={primaryBtnStyle}>
            {editingWidgetId ? "Save changes" : "Add"}
          </button>
          <button onClick={resetDraft} style={secondaryBtnStyle}>
            Cancel
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {widgets.length === 0 ? (
          <div className="panel" style={{ padding: "40px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13.5 }}>
            No widgets yet — click "+ Add widget" to build this dashboard from stat cards, charts, and a map.
          </div>
        ) : stats ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            {widgets.map((w, idx) => (
              <DashboardWidgetCard
                key={w.id}
                widget={w}
                stats={stats}
                incidents={incidents.filter((i) => i.latitude != null && i.longitude != null) as { latitude: number; longitude: number }[]}
                onRemove={() => removeWidget(w.id)}
                onMoveUp={idx > 0 ? () => moveWidget(w.id, -1) : undefined}
                onMoveDown={idx < widgets.length - 1 ? () => moveWidget(w.id, 1) : undefined}
                onRename={(title) => renameWidget(w.id, title)}
                onEdit={() => startEditWidget(w)}
              />
            ))}
          </div>
        ) : (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading data…</div>
        )}
      </div>
    </div>
  );
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

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

const liveBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "color-mix(in srgb, var(--signal) 14%, transparent)",
  border: "1px solid var(--signal)",
  color: "var(--signal)",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

const selectStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 8px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text-primary)",
};
