import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  FunnelChart,
  Funnel,
  Sankey,
} from "recharts";
import { hierarchy, pack } from "d3-hierarchy";
import { MapContainer, TileLayer, CircleMarker } from "react-leaflet";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import worldTopology from "world-atlas/countries-110m.json?url";
import "leaflet/dist/leaflet.css";
import type { DashboardWidget, NormalizedDashboardStats, WidgetDataField, WidgetType } from "../api";

const TOOLTIP_STYLE = { background: "var(--panel-raised)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };
const PIE_COLORS = ["#0d9488", "#2f66f0", "#b3690b", "#d1352b", "#7c3aed", "#0891b2", "#65a30d", "#db2777", "#ea580c", "#4d7c0f"];

/** Curated starting points, Tableau/Power-BI-style — each just a normal
 *  palette (array of colors), same shape as a fully custom one. Picking a
 *  preset copies its colors into the widget's own palette, which can then be
 *  edited freely (add/remove/reorder/recolor any entry), so this isn't a
 *  fixed set of themes to choose between — it's a starting point for an
 *  open-ended one. */
export const PRESET_THEMES: { name: string; colors: string[] }[] = [
  { name: "Signal", colors: PIE_COLORS },
  { name: "Ocean", colors: ["#0891b2", "#0d9488", "#2563eb", "#0369a1", "#155e75", "#134e4a"] },
  { name: "Sunset", colors: ["#f97316", "#ea580c", "#dc2626", "#db2777", "#c026d3", "#f59e0b"] },
  { name: "Forest", colors: ["#166534", "#15803d", "#65a30d", "#4d7c0f", "#84cc16", "#0f766e"] },
  { name: "Berry", colors: ["#7c3aed", "#a21caf", "#db2777", "#e11d48", "#9333ea", "#6d28d9"] },
  { name: "Corporate", colors: ["#1e3a5f", "#2f66f0", "#64748b", "#0d9488", "#475569", "#334155"] },
  { name: "Vibrant", colors: ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"] },
  { name: "Earth", colors: ["#78350f", "#92400e", "#b45309", "#a16207", "#854d0e", "#57534e"] },
];

export const COLOR_SWATCHES = ["#0d9488", "#2f66f0", "#b3690b", "#d1352b", "#7c3aed", "#0891b2", "#65a30d", "#db2777"];

export const CATEGORY_FIELDS: WidgetDataField[] = ["by_sector", "by_actor", "by_tactic", "by_province", "by_country"];
export const FIELDS_FOR_TYPE: Record<WidgetType, WidgetDataField[]> = {
  stat: ["total", "deaths", "injuries", "kidnappings_ngo"],
  bar: CATEGORY_FIELDS,
  pie: CATEGORY_FIELDS,
  line: ["time_series", ...CATEGORY_FIELDS],
  map: [],
  radar: CATEGORY_FIELDS,
  funnel: CATEGORY_FIELDS,
  // Choropleth needs a category whose values are real place names it can
  // shade on a world map — only "by_country" qualifies (sector/actor/tactic
  // names aren't places).
  choropleth: ["by_country"],
  // Calendar heatmap always uses stats.daily directly, like map does with
  // its incident list — no user-selectable breakdown field applies.
  calendar: [],
  // These three always use the actor×tactic joint-count data directly — like
  // calendar/map, there's no single "which field" choice that applies.
  sankey: [],
  network: [],
  bubble: CATEGORY_FIELDS,
};
export const WIDGET_TYPES: { value: WidgetType; label: string }[] = [
  { value: "stat", label: "Stat card" },
  { value: "bar", label: "Bar chart" },
  { value: "line", label: "Line chart" },
  { value: "pie", label: "Pie chart" },
  { value: "radar", label: "Radar chart" },
  { value: "funnel", label: "Funnel chart" },
  { value: "choropleth", label: "Choropleth map" },
  { value: "calendar", label: "Calendar heatmap" },
  { value: "sankey", label: "Sankey (actor → tactic)" },
  { value: "network", label: "Network (actor–tactic links)" },
  { value: "bubble", label: "Packed-circle bubbles" },
  { value: "map", label: "Incident map" },
];

/** Resolves a widget's effective per-category color list: an explicit custom
 *  palette wins; otherwise fall back to opacity variants of a single chosen
 *  color; otherwise the default preset. Cycles if there are more categories
 *  than colors, however many either has — no artificial cap either way. */
function paletteFor(widget: DashboardWidget, count: number): string[] {
  if (widget.palette && widget.palette.length > 0) {
    return Array.from({ length: count }, (_, i) => widget.palette![i % widget.palette!.length]);
  }
  if (widget.color) {
    return Array.from({ length: count }, (_, i) => adjustOpacity(widget.color!, i));
  }
  return Array.from({ length: count }, (_, i) => PIE_COLORS[i % PIE_COLORS.length]);
}

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
  onRename?: (title: string) => void;
  /** Applies a partial patch to just this widget — editing lives entirely
   *  inside this card's own popover, independent of every other widget and
   *  of any shared panel elsewhere on the page. */
  onUpdate?: (patch: Partial<DashboardWidget>) => void;
}

/** Renders one dashboard widget — a stat card, bar/line/pie chart, or a small
 *  incidents map — from the same normalized stats shape whether it's being
 *  edited live in an editor or viewed read-only on a public share link.
 *  Fills 100% of whatever size its container gives it (a react-grid-layout
 *  cell in the editors, a plain CSS grid cell on the public view) rather than
 *  a fixed pixel height, so real drag-resize actually changes the chart size. */
export default function DashboardWidgetCard({ widget, stats, incidents, onRemove, onRename, onUpdate }: Props) {
  // "Dashboard editable" = the editor gave us handlers at all (it withholds
  // them entirely when the whole dashboard is locked). "Widget locked" is a
  // second, per-widget flag that can be toggled independently — locking one
  // chart doesn't touch any other, and the dashboard-level lock always wins.
  const dashboardEditable = !!(onRemove || onRename || onUpdate);
  const widgetLocked = !!widget.locked;
  const showFullControls = dashboardEditable && !widgetLocked;
  const color = widget.color || "var(--signal)";
  const series = seriesFor(stats, widget.dataField, widget.topN);
  const [showEditor, setShowEditor] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Positioned via a portal to document.body (fixed coordinates) rather than
  // as a normal absolutely-positioned child, because this card's own
  // `overflow: hidden` (needed to keep charts contained) would otherwise
  // silently clip the popover the moment it tried to extend past the card's
  // edge — invisible, not just cosmetically off.
  useLayoutEffect(() => {
    if (!showEditor || !gearRef.current) return;
    const rect = gearRef.current.getBoundingClientRect();
    const width = 320;
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    setPopoverPos({ top: rect.bottom + 6, left: Math.max(8, left) });
  }, [showEditor]);

  useEffect(() => {
    if (!showEditor) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (cardRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setShowEditor(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEditor]);

  return (
    <div
      ref={cardRef}
      className="panel"
      style={{
        position: "relative",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        height: "100%",
        width: "100%",
        boxSizing: "border-box",
        border: showEditor ? "1.5px solid var(--signal)" : undefined,
        overflow: "hidden",
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          {showFullControls && onRename ? (
            <input
              value={widget.title}
              onChange={(e) => onRename(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ fontSize: 13, fontWeight: 700, border: "none", background: "transparent", color: "var(--text-primary)", flex: 1, minWidth: 0 }}
            />
          ) : (
            <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
              {widgetLocked && <span title="This widget is locked">🔒</span>}
              {widget.title}
            </div>
          )}
          {dashboardEditable && (
            <div style={{ display: "flex", gap: 3, flexShrink: 0 }} onMouseDown={(e) => e.stopPropagation()}>
              {onUpdate && (
                <button
                  onClick={() => onUpdate({ locked: !widgetLocked })}
                  title={widgetLocked ? "Unlock this widget" : "Lock this widget"}
                  style={widgetLocked ? { ...miniBtnStyle, background: "var(--signal-dim)", borderColor: "var(--signal)", color: "var(--signal)" } : miniBtnStyle}
                >
                  {widgetLocked ? "🔒" : "🔓"}
                </button>
              )}
              {showFullControls && onUpdate && (
                <button
                  ref={gearRef}
                  onClick={() => setShowEditor((v) => !v)}
                  title="Edit this widget"
                  style={{ ...miniBtnStyle, ...(showEditor ? { background: "var(--signal-dim)", borderColor: "var(--signal)", color: "var(--signal)" } : {}) }}
                >
                  ⚙
                </button>
              )}
              {showFullControls && onRemove && (
                <button onClick={onRemove} title="Remove widget" style={{ ...miniBtnStyle, color: "var(--critical)" }}>
                  ×
                </button>
              )}
            </div>
          )}
        </div>
        {widget.label && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{widget.label}</div>}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {widget.type === "stat" && (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 700, color }}>{statValue(stats, widget.dataField).toLocaleString()}</div>
            <div className="eyebrow" style={{ marginTop: 6 }}>{fieldLabel(widget.dataField).toUpperCase()}</div>
            {widget.showSparkline && stats.time_series.length > 1 && (
              <div style={{ width: "80%", height: 32, marginTop: 8 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.time_series}>
                    <Line type="monotone" dataKey="count" stroke={color} strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
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
                {widget.palette && widget.palette.length > 0 && paletteFor(widget, series.length).map((c, idx) => <Cell key={idx} fill={c} />)}
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
                {paletteFor(widget, series.length).map((c, idx) => (
                  <Cell key={idx} fill={c} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {widget.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
            </PieChart>
          </ResponsiveContainer>
        )}

        {widget.type === "radar" && (
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={series} outerRadius="75%">
              <PolarGrid stroke="var(--border-soft)" />
              <PolarAngleAxis dataKey="value" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
              <PolarRadiusAxis tick={{ fontSize: 9, fill: "var(--text-faint)" }} allowDecimals={false} />
              <Radar name={fieldLabel(widget.dataField)} dataKey="count" stroke={color} fill={color} fillOpacity={0.35} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {widget.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
            </RadarChart>
          </ResponsiveContainer>
        )}

        {widget.type === "funnel" && (
          <ResponsiveContainer width="100%" height="100%">
            <FunnelChart>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Funnel dataKey="count" data={series} nameKey="value" isAnimationActive={false}>
                {paletteFor(widget, series.length).map((c, idx) => (
                  <Cell key={idx} fill={c} />
                ))}
                {widget.showDataLabels && <LabelList dataKey="value" position="right" fill="var(--text-primary)" stroke="none" fontSize={11} />}
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        )}

        {widget.type === "choropleth" && <ChoroplethMap series={series} baseColor={widget.color || "#0d9488"} />}

        {widget.type === "calendar" && <CalendarHeatmap daily={stats.daily} baseColor={widget.color || "#0d9488"} />}

        {widget.type === "sankey" && <ActorTacticSankey data={stats.actor_tactic} baseColor={widget.color || "#0d9488"} />}

        {widget.type === "network" && <ActorTacticNetwork data={stats.actor_tactic} baseColor={widget.color || "#0d9488"} />}

        {widget.type === "bubble" && <BubbleChart series={series} colors={paletteFor(widget, series.length)} />}

        {widget.type === "map" && (
          <div style={{ height: "100%", borderRadius: 6, overflow: "hidden" }}>
            <MapContainer center={[1, 20]} zoom={2.2} style={{ width: "100%", height: "100%" }} scrollWheelZoom={false} dragging={showFullControls} zoomControl={false}>
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

      {showEditor && onUpdate && popoverPos && createPortal(
        <WidgetEditPopover
          popoverRef={popoverRef}
          position={popoverPos}
          widget={widget}
          onSave={(patch) => {
            onUpdate(patch);
            setShowEditor(false);
          }}
          onClose={() => setShowEditor(false)}
        />,
        document.body
      )}
    </div>
  );
}

/** Fully self-contained per-widget edit form — its own draft state, its own
 *  open/close lifecycle. Opening one widget's editor has no effect on any
 *  other widget; several could be open across the dashboard at once. */
function WidgetEditPopover({
  widget,
  onSave,
  onClose,
  popoverRef,
  position,
}: {
  widget: DashboardWidget;
  onSave: (patch: Partial<DashboardWidget>) => void;
  onClose: () => void;
  popoverRef: React.RefObject<HTMLDivElement>;
  position: { top: number; left: number };
}) {
  const [type, setType] = useState<WidgetType>(widget.type);
  const [field, setField] = useState<WidgetDataField>(widget.dataField ?? (FIELDS_FOR_TYPE[widget.type][0] ?? "by_sector"));
  const [label, setLabel] = useState(widget.label ?? "");
  const [showDataLabels, setShowDataLabels] = useState(!!widget.showDataLabels);
  const [color, setColor] = useState<string | undefined>(widget.color);
  const [palette, setPalette] = useState<string[]>(widget.palette ?? []);
  const [showLegend, setShowLegend] = useState(!!widget.showLegend);
  const [topN, setTopN] = useState<number | undefined>(widget.topN);
  const [showSparkline, setShowSparkline] = useState(!!widget.showSparkline);

  function handleTypeChange(newType: WidgetType) {
    setType(newType);
    if (FIELDS_FOR_TYPE[newType].length > 0 && !FIELDS_FOR_TYPE[newType].includes(field)) {
      setField(FIELDS_FOR_TYPE[newType][0]);
    }
  }

  function handleSave() {
    onSave({
      type,
      dataField: type === "map" ? undefined : field,
      label: label || undefined,
      showDataLabels,
      color,
      palette: palette.length > 0 ? palette : undefined,
      showLegend,
      topN,
      showSparkline,
    });
  }

  return (
    <div
      ref={popoverRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 1000,
        width: 320,
        maxHeight: 420,
        overflowY: "auto",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(19,23,34,0.18)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div className="eyebrow">EDIT THIS WIDGET</div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>TYPE</div>
        <select value={type} onChange={(e) => handleTypeChange(e.target.value as WidgetType)} style={selectStyle}>
          {WIDGET_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {type !== "map" && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>DATA</div>
          <select value={field} onChange={(e) => setField(e.target.value as WidgetDataField)} style={selectStyle}>
            {FIELDS_FOR_TYPE[type].map((f) => (
              <option key={f} value={f}>
                {fieldLabel(f)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>{type === "bar" || type === "pie" ? "FALLBACK COLOR" : "COLOR"}</div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title={c}
              style={{
                width: 20,
                height: 20,
                borderRadius: 5,
                background: c,
                border: color === c ? "2px solid var(--text-primary)" : "1px solid var(--border)",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
          <input
            type="color"
            value={color ?? "#0d9488"}
            onChange={(e) => setColor(e.target.value)}
            title="Custom color"
            style={{ width: 22, height: 22, padding: 0, border: "none", background: "none", cursor: "pointer" }}
          />
          {color && (
            <button onClick={() => setColor(undefined)} title="Reset to default" style={miniBtnStyle}>
              ×
            </button>
          )}
        </div>
      </div>

      {(type === "bar" || type === "pie" || type === "funnel") && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>THEME — PALETTE (OVERRIDES FALLBACK COLOR)</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
            {PRESET_THEMES.map((theme) => (
              <button
                key={theme.name}
                onClick={() => setPalette(theme.colors)}
                title={theme.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "3px 6px",
                  borderRadius: 6,
                  border: `1px solid ${JSON.stringify(palette) === JSON.stringify(theme.colors) ? "var(--signal)" : "var(--border)"}`,
                  background: "var(--panel-raised)",
                  cursor: "pointer",
                }}
              >
                <span style={{ display: "flex" }}>
                  {theme.colors.slice(0, 4).map((c, i) => (
                    <span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: c, marginLeft: i > 0 ? -2 : 0, border: "1px solid var(--panel)" }} />
                  ))}
                </span>
                <span style={{ fontSize: 10.5 }}>{theme.name}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            {palette.map((c, idx) => (
              <span key={idx} style={{ position: "relative", display: "inline-flex" }}>
                <input
                  type="color"
                  value={c}
                  onChange={(e) => setPalette((p) => p.map((x, i) => (i === idx ? e.target.value : x)))}
                  title={`Color ${idx + 1}`}
                  style={{ width: 20, height: 20, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
                />
                <button
                  onClick={() => setPalette((p) => p.filter((_, i) => i !== idx))}
                  title="Remove"
                  style={{
                    position: "absolute",
                    top: -5,
                    right: -5,
                    width: 13,
                    height: 13,
                    lineHeight: "11px",
                    fontSize: 9,
                    padding: 0,
                    borderRadius: "50%",
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--critical)",
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              onClick={() => setPalette((p) => [...p, PRESET_THEMES[0].colors[p.length % PRESET_THEMES[0].colors.length]])}
              title="Add a color — no limit"
              style={{ ...miniBtnStyle, color: "var(--signal)" }}
            >
              +
            </button>
            {palette.length > 0 && (
              <button onClick={() => setPalette([])} style={{ fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {(type === "bar" || type === "pie" || type === "radar" || type === "funnel") && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>TOP N (SCALE)</div>
          <input
            type="number"
            min={1}
            max={20}
            value={topN ?? ""}
            onChange={(e) => setTopN(e.target.value ? Number(e.target.value) : undefined)}
            placeholder="All"
            style={{ ...selectStyle, width: 70 }}
          />
        </div>
      )}

      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>LABEL / CAPTION</div>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. source, note, date range…" style={{ ...selectStyle, width: "100%" }} />
      </div>

      {(type === "bar" || type === "line" || type === "pie" || type === "radar") && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} />
          Show legend
        </label>
      )}
      {(type === "bar" || type === "pie" || type === "funnel") && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={showDataLabels} onChange={(e) => setShowDataLabels(e.target.checked)} />
          Show values on chart
        </label>
      )}
      {type === "stat" && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={showSparkline} onChange={(e) => setShowSparkline(e.target.checked)} />
          Show trend line (overall incident volume by month)
        </label>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button onClick={handleSave} style={primaryBtnStyle}>
          Save changes
        </button>
        <button onClick={onClose} style={secondaryBtnStyle}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** For pie slices when a single custom color is chosen: cycles through a few
 *  opacity variants of that one color instead of the default rainbow palette,
 *  so "pick a color theme" looks intentional on a multi-slice pie rather than
 *  just recoloring slice #1. */
/** Shades each country by its share of the max value in the series — reuses
 *  the exact same world topology and map library already proven working in
 *  WorldMap.tsx, just driven by dashboard stats instead of live events.
 *  Country-name matching is case/whitespace-insensitive but otherwise exact;
 *  a country in the data that doesn't match the topology's naming just stays
 *  unshaded rather than guessing, since a wrong match would misrepresent
 *  where incidents actually happened. */
function ChoroplethMap({ series, baseColor }: { series: { value: string; count: number }[]; baseColor: string }) {
  const maxCount = Math.max(1, ...series.map((s) => s.count));
  const countByCountry = new Map<string, number>();
  for (const s of series) countByCountry.set(s.value.trim().toLowerCase(), s.count);

  return (
    <div style={{ height: "100%", borderRadius: 6, overflow: "hidden", background: "var(--panel-raised)" }}>
      <ComposableMap projectionConfig={{ scale: 148 }} style={{ width: "100%", height: "100%" }}>
        <Geographies geography={worldTopology}>
          {({ geographies }: { geographies: { rsmKey: string; properties?: { name?: string } }[] }) =>
            geographies.map((geo) => {
              const name = geo.properties?.name;
              const count = name ? countByCountry.get(name.trim().toLowerCase()) : undefined;
              const intensity = count ? Math.max(0.18, count / maxCount) : 0;
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={count ? hexToRgba(baseColor, intensity) : "var(--panel)"}
                  stroke="var(--border)"
                  strokeWidth={0.4}
                  style={{ default: { outline: "none" }, hover: { outline: "none", opacity: 0.8 }, pressed: { outline: "none" } }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** GitHub-contributions-style grid — a year of days as columns of weeks, rows
 *  of weekdays, shaded by count. Horizontally scrollable rather than squeezed
 *  to fit, since 52 columns compressed into a narrow widget just becomes
 *  illegible; native SVG <title> elements give per-day tooltips with no extra
 *  dependency. */
function CalendarHeatmap({ daily, baseColor }: { daily: { date: string; count: number }[]; baseColor: string }) {
  const countByDate = new Map(daily.map((d) => [d.date, d.count]));
  const maxCount = Math.max(1, ...daily.map((d) => d.count));

  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay()); // align to the preceding Sunday

  const cells: { date: string; count: number; col: number; row: number }[] = [];
  let col = 0;
  const cursor = new Date(start);
  while (cursor <= today) {
    const dow = cursor.getDay();
    const iso = cursor.toISOString().slice(0, 10);
    cells.push({ date: iso, count: countByDate.get(iso) ?? 0, col, row: dow });
    if (dow === 6) col++;
    cursor.setDate(cursor.getDate() + 1);
  }
  const totalCols = col + 1;
  const cell = 11;
  const gap = 2;
  const width = totalCols * (cell + gap);
  const height = 7 * (cell + gap);

  return (
    <div style={{ height: "100%", overflowX: "auto", overflowY: "hidden", display: "flex", alignItems: "center" }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ flexShrink: 0 }}>
        {cells.map((d) => {
          const intensity = d.count > 0 ? Math.max(0.15, d.count / maxCount) : 0;
          return (
            <rect
              key={d.date}
              x={d.col * (cell + gap)}
              y={d.row * (cell + gap)}
              width={cell}
              height={cell}
              rx={2}
              fill={d.count > 0 ? hexToRgba(baseColor, intensity) : "var(--border-soft)"}
            >
              <title>{`${d.date}: ${d.count} incident${d.count === 1 ? "" : "s"}`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

/** Builds recharts' required {nodes, links} shape from flat (actor, tactic,
 *  count) rows — actors and tactics each become their own node, so the same
 *  name never collides even if an actor and tactic happened to share a label. */
function sankeyDataFrom(rows: { actor: string; tactic: string; count: number }[]) {
  const actors = Array.from(new Set(rows.map((d) => d.actor)));
  const tactics = Array.from(new Set(rows.map((d) => d.tactic)));
  const nodes = [...actors.map((a) => ({ name: a })), ...tactics.map((t) => ({ name: t }))];
  const links = rows.map((d) => ({
    source: actors.indexOf(d.actor),
    target: actors.length + tactics.indexOf(d.tactic),
    value: d.count,
  }));
  return { nodes, links };
}

function ActorTacticSankey({ data, baseColor }: { data: { actor: string; tactic: string; count: number }[]; baseColor: string }) {
  if (data.length === 0) {
    return <EmptyState message="No actor/tactic data to show a flow for yet." />;
  }
  const sankeyData = sankeyDataFrom(data);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <Sankey
        data={sankeyData}
        nodePadding={20}
        node={{ fill: baseColor, fillOpacity: 0.85 } as never}
        link={{ stroke: baseColor, strokeOpacity: 0.25 } as never}
      >
        <Tooltip contentStyle={TOOLTIP_STYLE} />
      </Sankey>
    </ResponsiveContainer>
  );
}

/** Hand-rolled bipartite relationship diagram — actors on the left, tactics on
 *  the right, a curved link between them whenever they genuinely co-occurred
 *  in the same incident, thickness scaled to how often. No graph/network
 *  library needed for this simplified two-column layout, which keeps this
 *  widget from adding any new dependency at all. */
function ActorTacticNetwork({ data, baseColor }: { data: { actor: string; tactic: string; count: number }[]; baseColor: string }) {
  if (data.length === 0) {
    return <EmptyState message="No actor/tactic data to show relationships for yet." />;
  }
  const actors = Array.from(new Set(data.map((d) => d.actor)));
  const tactics = Array.from(new Set(data.map((d) => d.tactic)));
  const maxCount = Math.max(1, ...data.map((d) => d.count));

  const width = 480;
  const height = Math.max(160, Math.max(actors.length, tactics.length) * 26);
  const leftX = 90;
  const rightX = width - 90;
  const actorY = new Map(actors.map((a, i) => [a, ((i + 1) * height) / (actors.length + 1)]));
  const tacticY = new Map(tactics.map((t, i) => [t, ((i + 1) * height) / (tactics.length + 1)]));

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {data.map((d, i) => {
          const y1 = actorY.get(d.actor)!;
          const y2 = tacticY.get(d.tactic)!;
          const strokeWidth = 1 + (d.count / maxCount) * 5;
          return (
            <path
              key={i}
              d={`M ${leftX} ${y1} C ${width / 2} ${y1}, ${width / 2} ${y2}, ${rightX} ${y2}`}
              stroke={baseColor}
              strokeWidth={strokeWidth}
              fill="none"
              opacity={0.35}
            >
              <title>{`${d.actor} × ${d.tactic}: ${d.count}`}</title>
            </path>
          );
        })}
        {actors.map((a) => (
          <g key={`a-${a}`}>
            <circle cx={leftX} cy={actorY.get(a)} r={4} fill={baseColor} />
            <text x={leftX - 8} y={actorY.get(a)} fontSize={10} textAnchor="end" dominantBaseline="middle" fill="var(--text-primary)">
              {a}
            </text>
          </g>
        ))}
        {tactics.map((t) => (
          <g key={`t-${t}`}>
            <circle cx={rightX} cy={tacticY.get(t)} r={4} fill={baseColor} />
            <text x={rightX + 8} y={tacticY.get(t)} fontSize={10} textAnchor="start" dominantBaseline="middle" fill="var(--text-primary)">
              {t}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Circle-packing layout via d3-hierarchy — each category becomes a circle
 *  sized by its count, packed together with no wasted space. */
function BubbleChart({ series, colors }: { series: { value: string; count: number }[]; colors: string[] }) {
  if (series.length === 0) {
    return <EmptyState message="No data for this breakdown yet." />;
  }
  const width = 320;
  const height = 240;
  const root = hierarchy<{ children: { value: string; count: number }[] }>({ children: series })
    .sum((d) => ("count" in d ? (d as unknown as { count: number }).count : 0));
  const packed = pack<{ children: { value: string; count: number }[] }>().size([width, height]).padding(3)(root);
  const leaves = packed.leaves();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {leaves.map((leaf, i) => {
          const datum = leaf.data as unknown as { value: string; count: number };
          return (
            <g key={i} transform={`translate(${leaf.x},${leaf.y})`}>
              <circle r={leaf.r} fill={colors[i % colors.length]} fillOpacity={0.85}>
                <title>{`${datum.value}: ${datum.count}`}</title>
              </circle>
              {leaf.r > 18 && (
                <text textAnchor="middle" dy="0.35em" fontSize={Math.min(11, leaf.r / 3)} fill="#fff" pointerEvents="none">
                  {datum.count}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </ResponsiveContainer>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-faint)", textAlign: "center", padding: 12 }}>
      {message}
    </div>
  );
}

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

const selectStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 8px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text-primary)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "7px 12px",
  background: "var(--signal-dim)",
  border: "1px solid var(--signal)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 12.5,
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "7px 12px",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12.5,
};
