import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
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

function seriesFor(stats: NormalizedDashboardStats, field: WidgetDataField | undefined): { value: string; count: number }[] {
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

const SIZE_HEIGHT: Record<DashboardWidget["size"], number> = { small: 160, medium: 240, large: 340 };

interface Props {
  widget: DashboardWidget;
  stats: NormalizedDashboardStats;
  incidents?: { latitude: number; longitude: number; severity?: string | null }[];
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRename?: (title: string) => void;
}

/** Renders one dashboard widget — a stat card, bar/line/pie chart, or a small
 *  incidents map — from the same normalized stats shape whether it's being
 *  edited live in the builder or viewed read-only on a public share link. */
export default function DashboardWidgetCard({ widget, stats, incidents, onRemove, onMoveUp, onMoveDown, onRename }: Props) {
  const editable = !!(onRemove || onMoveUp || onMoveDown || onRename);
  const height = SIZE_HEIGHT[widget.size];

  return (
    <div
      className="panel"
      style={{
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        gridColumn: widget.size === "large" ? "span 3" : widget.size === "medium" ? "span 2" : "span 1",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        {onRename ? (
          <input
            value={widget.title}
            onChange={(e) => onRename(e.target.value)}
            style={{ fontSize: 13, fontWeight: 700, border: "none", background: "transparent", color: "var(--text-primary)", flex: 1, minWidth: 0 }}
          />
        ) : (
          <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{widget.title}</div>
        )}
        {editable && (
          <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
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

      <div style={{ height }}>
        {widget.type === "stat" && (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: widget.size === "large" ? 48 : widget.size === "medium" ? 36 : 28, fontWeight: 700, color: "var(--signal)" }}>
              {statValue(stats, widget.dataField).toLocaleString()}
            </div>
            <div className="eyebrow" style={{ marginTop: 6 }}>{fieldLabel(widget.dataField).toUpperCase()}</div>
          </div>
        )}

        {widget.type === "bar" && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={seriesFor(stats, widget.dataField)} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <YAxis type="category" dataKey="value" width={100} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" fill="var(--signal)" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}

        {widget.type === "line" && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={widget.dataField === "time_series" ? stats.time_series : seriesFor(stats, widget.dataField)} margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
              <XAxis dataKey={widget.dataField === "time_series" ? "bucket" : "value"} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="count" stroke="var(--signal)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {widget.type === "pie" && (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={seriesFor(stats, widget.dataField)} dataKey="count" nameKey="value" cx="50%" cy="50%" outerRadius="80%" label={{ fontSize: 10 }}>
                {seriesFor(stats, widget.dataField).map((_, idx) => (
                  <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        )}

        {widget.type === "map" && (
          <div style={{ height: "100%", borderRadius: 6, overflow: "hidden" }}>
            <MapContainer center={[1, 20]} zoom={2.2} style={{ width: "100%", height: "100%" }} scrollWheelZoom={false} dragging={editable} zoomControl={false}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
              {(incidents ?? []).slice(0, 3000).map((i, idx) => (
                <CircleMarker key={idx} center={[i.latitude, i.longitude]} radius={2.5} pathOptions={{ color: "var(--signal)", fillColor: "var(--signal)", fillOpacity: 0.7, weight: 0.5 }} />
              ))}
            </MapContainer>
          </div>
        )}
      </div>
    </div>
  );
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
