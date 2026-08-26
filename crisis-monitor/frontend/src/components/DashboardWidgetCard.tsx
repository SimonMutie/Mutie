import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList } from "recharts";
import { MapContainer, TileLayer, CircleMarker } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { DashboardWidget, NormalizedDashboardStats, WidgetDataField } from "../api";

const TOOLTIP_STYLE = { background: "var(--panel-raised)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };
const PIE_COLORS = ["#0d9488", "#2f66f0", "#b3690b", "#d1352b", "#7c3aed", "#0891b2", "#65a30d", "#db2777", "#ea580c", "#4d7c0f"];

const FIELD_LABELS: Record<WidgetDataField, string> = {
  total: "Total incidents",
  by_sector: "By sector",
  by_actor: "By actor",
  by_tactic: "By tactic",
  by_province: "By province",
  by_country: "By country",
  time_series: "Over time",
  deaths: "Civilian deaths",
  injuries: "Civilian injuries",
  kidnappings_ngo: "NGO kidnappings",
};

export function fieldLabel(field: WidgetDataField | undefined): string {
  return field ? FIELD_LABELS[field] : "";
}

function seriesFor(stats: NormalizedDashboardStats, field: WidgetDataField | undefined, topN?: number): { value: string; count: number }[] {
  const series = (() => {
    switch (field) {
      case "by_sector":
        return stats.by_sector;
      case "by_actor":
        return stats.by_actor;
      case "by_tactic":
        return stats.by_tactic;
      case "by_province":
        return stats.by_province;
      case "by_country":
        return stats.by_country;
      default:
        return [];
    }
  })();
  return topN && topN > 0 ? series.slice(0, topN) : series;
}

function statValue(stats: NormalizedDashboardStats, field: WidgetDataField | undefined): number {
  switch (field) {
    case "total":
      return stats.total;
    case "deaths":
      return stats.deaths;
    case "injuries":
      return stats.injuries;
    case "kidnappings_ngo":
      return stats.kidnappings_ngo;
    default:
      return 0;
  }
}

interface Props {
  widget: DashboardWidget;
  stats: NormalizedDashboardStats;
  incidents?: { latitude: number; longitude: number; severity?: string | null }[];
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRename?: (title: string) => void;
  onEdit?: () => void;
  /** True while this widget's edit panel is open — used to highlight it so
   *  it's clear which widget the controls below are editing. */
  selected?: boolean;
}

/** Renders one dashboard widget — a stat card, bar/line/pie chart, or a small
 *  incidents map — from the same normalized stats shape whether it's being
 *  edited live in the builder or viewed read-only on a public share link.
 *  Fills 100% of whatever size its container gives it (a react-grid-layout
 *  cell in the editors, a plain CSS grid cell on the public view) rather than
 *  a fixed pixel height, so real drag-resize actually changes the chart size. */
export default function DashboardWidgetCard({ widget, stats, incidents, onRemove, onMoveUp, onMoveDown, onRename, onEdit, selected }: Props) {
  const editable = !!(onRemove || onMoveUp || onMoveDown || onRename || onEdit);
  const color = widget.color || "var(--signal)";
  const series = seriesFor(stats, widget.dataField, widget.topN);

  return (
    <div
      className="panel"
      style={{
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        height: "100%",
        width: "100%",
        boxSizing: "border-box",
        border: selected ? "1.5px solid var(--signal)" : undefined,
        overflow: "hidden",
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          {onRename ? (
            <input
              value={widget.title}
              onChange={(e) => onRename(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ fontSize: 13, fontWeight: 700, border: "none", background: "transparent", color: "var(--text-primary)", flex: 1, minWidth: 0 }}
            />
          ) : (
            <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{widget.title}</div>
          )}
          {editable && (
            <div style={{ display: "flex", gap: 3, flexShrink: 0 }} onMouseDown={(e) => e.stopPropagation()}>
              {onEdit && (
                <button onClick={onEdit} title="Edit widget" style={miniBtnStyle}>
                  ⚙
                </button>
              )}
              {onMoveUp && (
                <button onClick={onMoveUp} title="Move earlier" style={miniBtnStyle}>
                  ↑
                </button>
              )}
              {onMoveDown && (
                <button onClick={onMoveDown} title="Move later" style={miniBtnStyle}>
                  ↓
                </button>
              )}
              {onRemove && (
                <button onClick={onRemove} title="Remove widget" style={{ ...miniBtnStyle, color: "var(--critical)" }}>
                  ×
                </button>
              )}
            </div>
          )}
        </div>
        {widget.label && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{widget.label}</div>}
      </div>

      <div
        style={{ flex: 1, minHeight: 0, cursor: onEdit ? "pointer" : undefined }}
        onClick={onEdit}
        title={onEdit ? "Click to edit this widget" : undefined}
      >
        {widget.type === "stat" && (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 700, color }}>{statValue(stats, widget.dataField).toLocaleString()}</div>
            <div className="eyebrow" style={{ marginTop: 6 }}>{fieldLabel(widget.dataField).toUpperCase()}</div>
          </div>
        )}

        {widget.type === "bar" && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <YAxis type="category" dataKey="value" width={100} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {widget.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
              <Bar dataKey="count" name={fieldLabel(widget.dataField)} fill={color} radius={[0, 3, 3, 0]}>
                {widget.showDataLabels && <LabelList dataKey="count" position="right" style={{ fill: "var(--text-primary)", fontSize: 11 }} />}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {widget.type === "line" && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={widget.dataField === "time_series" ? stats.time_series : series} margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
              <XAxis dataKey={widget.dataField === "time_series" ? "bucket" : "value"} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {widget.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
              <Line type="monotone" dataKey="count" name={fieldLabel(widget.dataField)} stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {widget.type === "pie" && (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={series} dataKey="count" nameKey="value" cx="50%" cy="50%" outerRadius="75%" label={widget.showDataLabels ? { fontSize: 10 } : false}>
                {series.map((_, idx) => (
                  <Cell key={idx} fill={widget.color ? adjustOpacity(widget.color, idx) : PIE_COLORS[idx % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {widget.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
            </PieChart>
          </ResponsiveContainer>
        )}

        {widget.type === "map" && (
          <div style={{ height: "100%", borderRadius: 6, overflow: "hidden" }}>
            <MapContainer center={[1, 20]} zoom={2.2} style={{ width: "100%", height: "100%" }} scrollWheelZoom={false} dragging={editable} zoomControl={false}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
              {(incidents ?? []).slice(0, 3000).map((i, idx) => (
                <CircleMarker
                  key={idx}
                  center={[i.latitude, i.longitude]}
                  radius={2.5}
                  pathOptions={{ color, fillColor: color, fillOpacity: 0.7, weight: 0.5 }}
                />
              ))}
            </MapContainer>
          </div>
        )}
      </div>
    </div>
  );
}

/** For pie slices when a single custom color is chosen: cycles through a few
 *  opacity variants of that one color instead of the default rainbow palette,
 *  so "pick a color theme" looks intentional on a multi-slice pie rather than
 *  just recoloring slice #1. */
function adjustOpacity(hex: string, index: number): string {
  const opacities = [1, 0.75, 0.55, 0.4, 0.28, 0.2];
  const opacity = opacities[index % opacities.length];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

const miniBtnStyle: React.CSSProperties = {
  fontSize: 12,
  width: 20,
  height: 20,
  lineHeight: "18px",
  padding: 0,
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-muted)",
  cursor: "pointer",
};
