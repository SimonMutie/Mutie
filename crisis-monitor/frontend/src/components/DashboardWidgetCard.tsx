import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip, useMap } from "react-leaflet";
import { HeatmapLayer } from "./IncidentsMap";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { geoCentroid } from "d3-geo";
import worldTopology from "world-atlas/countries-110m.json?url";

// Dynamically imported, not statically — this is the whole point: Three.js
// and react-globe.gl are heavy, and every dashboard that never uses a globe
// widget should never pay for that weight in its initial page load.
const GlobeWidget = lazy(() => import("./GlobeWidget"));
const RouteDrawingGlobe = lazy(() => import("./RouteDrawingGlobe"));
import "leaflet/dist/leaflet.css";
import type { CrosstabRow, Dataset, DatasetSummary, DashboardWidget, NormalizedDashboardStats, PivotableField, WidgetDataField, WidgetType } from "../api";

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

export const CATEGORY_FIELDS: WidgetDataField[] = [
  "by_sector",
  "by_actor",
  "by_tactic",
  "by_province",
  "by_country",
  "by_severity",
  "by_county",
  "by_district",
  "by_city",
  "by_suburb",
  "by_operation",
  "by_target",
  "by_interest_group",
  "by_actual_main_victim",
  "by_intended_primary_target",
];
export const FIELDS_FOR_TYPE: Record<WidgetType, WidgetDataField[]> = {
  stat: ["total", "deaths", "injuries", "kidnappings_ngo"],
  bar: CATEGORY_FIELDS,
  pie: CATEGORY_FIELDS,
  line: ["time_series", ...CATEGORY_FIELDS],
  map: [],
  radar: CATEGORY_FIELDS,
  funnel: CATEGORY_FIELDS,
  // Choropleth needs a category whose values are real place names it can
  // shade on a map — only country/province have matching boundary data;
  // county/district/etc. would need even more granular geometry this app
  // doesn't have.
  choropleth: ["by_country", "by_province"],
  // Calendar heatmap always uses stats.daily directly, like map does with
  // its incident list — no user-selectable breakdown field applies.
  calendar: [],
  // Primary field only — the secondary ("break down by") field is what makes
  // these genuinely two-variable, handled the same way as bar/line's own
  // optional second variable, just required here instead of optional (a
  // one-variable flow/network diagram isn't meaningful).
  sankey: CATEGORY_FIELDS,
  network: CATEGORY_FIELDS,
  bubble: CATEGORY_FIELDS,
  globe: ["by_country"],
};
export const WIDGET_TYPES: { value: WidgetType; label: string }[] = [
  { value: "stat", label: "Stat card" },
  { value: "bar", label: "Bar chart" },
  { value: "line", label: "Line chart" },
  { value: "pie", label: "Pie chart" },
  { value: "radar", label: "Radar chart" },
  { value: "funnel", label: "Funnel chart" },
  { value: "choropleth", label: "Choropleth map" },
  { value: "globe", label: "3D globe" },
  { value: "calendar", label: "Calendar heatmap" },
  { value: "sankey", label: "Sankey (flow between 2 fields)" },
  { value: "network", label: "Network (links between 2 fields)" },
  { value: "bubble", label: "Packed-circle bubbles" },
  { value: "map", label: "Incident map" },
];

/** Only these types' rendering actually reads from a dataset when
 *  widget.datasetId is set — choropleth/globe assume real country names,
 *  calendar assumes daily incident buckets, and map assumes lat/lng, none of
 *  which a generic spreadsheet can be assumed to have. Offering those against
 *  an uploaded dataset would silently show nothing (or incidents data)
 *  regardless of which dataset was picked, so they're left off the list here
 *  rather than offered and quietly wrong. Sankey/network read from the same
 *  generic two-field crosstab bar/line already use, so they work for either
 *  source just fine. */
export const DATASET_COMPATIBLE_TYPES: WidgetType[] = ["stat", "bar", "line", "pie", "radar", "funnel", "bubble", "sankey", "network", "calendar"];

/** Web-safe system fonts only — no webfont loading, so every option here is
 *  guaranteed to actually render as chosen rather than silently falling back
 *  on whatever device someone's viewing the dashboard on. */
const LABEL_FONT_OPTIONS = ["Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New", "Verdana", "Trebuchet MS", "Impact"];

export const PIVOTABLE_FIELD_OPTIONS: PivotableField[] = [
  "sector",
  "actor",
  "tactic",
  "province",
  "country",
  "severity",
  "county",
  "district",
  "city",
  "suburb",
  "operation",
  "target",
  "interest_group",
  "actual_main_victim",
  "intended_primary_target",
];
export const PIVOT_FIELD_LABELS: Record<PivotableField, string> = {
  sector: "Sector",
  actor: "Actor",
  tactic: "Tactic",
  province: "Province",
  country: "Country",
  severity: "Severity",
  county: "County",
  district: "District",
  city: "City",
  suburb: "Suburb",
  operation: "Operation",
  target: "Target",
  interest_group: "Interest group",
  actual_main_victim: "Actual main victim",
  intended_primary_target: "Intended primary target",
};

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
  by_severity: "By severity",
  time_series: "Over time",
  deaths: "Civilian deaths",
  injuries: "Civilian injuries",
  kidnappings_ngo: "NGO kidnappings",
  by_county: "By county",
  by_district: "By district",
  by_city: "By city",
  by_suburb: "By suburb",
  by_operation: "By operation",
  by_target: "By target",
  by_interest_group: "By interest group",
  by_actual_main_victim: "By actual main victim",
  by_intended_primary_target: "By intended primary target",
};

export function fieldLabel(field: WidgetDataField | string | undefined): string {
  if (!field) return "";
  return (FIELD_LABELS as Record<string, string>)[field] ?? field;
}

/** Sankey/network widgets originally always showed actor × tactic with no
 *  way to change it. A widget saved from that era has no dataField/
 *  secondaryField at all, so it still falls back to that same default here —
 *  existing dashboards don't change appearance. Once a widget has been
 *  customized (or created fresh, which fills in real fields immediately),
 *  this reads from the same generic crosstab mechanism bar/line already use. */
function relationshipData(widget: DashboardWidget, stats: NormalizedDashboardStats, crosstabs?: Record<string, CrosstabRow[]>): CrosstabRow[] {
  if (!widget.dataField) {
    return stats.actor_tactic.map((d) => ({ primary_value: d.actor, secondary_value: d.tactic, count: d.count }));
  }
  const key = crosstabKeyFor(widget);
  return (key && crosstabs?.[key]) || [];
}

function seriesFor(
  widget: DashboardWidget,
  stats: NormalizedDashboardStats,
  breakdowns?: Record<string, { value: string; count: number }[]>
): { value: string; count: number }[] {
  const series = (() => {
    if (widget.datasetId) {
      // Reuses the exact same key format breakdownKeyFor builds for
      // fetching, so lookup and fetch can never drift apart.
      const key = breakdownKeyFor(widget);
      return (key && breakdowns?.[key]) || [];
    }
    switch (widget.dataField) {
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
      case "by_severity":
        return stats.by_severity;
      default: {
        // Every other by_X field is fetched on demand rather than
        // precomputed — see breakdownKeyFor / DATA_FIELD_TO_COLUMN.
        const column = widget.dataField ? DATA_FIELD_TO_COLUMN[widget.dataField as WidgetDataField] : undefined;
        return (column && breakdowns?.[column]) || [];
      }
    }
  })();
  return widget.topN && widget.topN > 0 ? series.slice(0, widget.topN) : series;
}

/** Mirrors the backend's DATA_FIELD_TO_COLUMN exactly — widgets store their
 *  primary field as "by_province" etc., crosstabs are keyed by the bare
 *  column name to match the /crosstab endpoint's allowlist. */
export const DATA_FIELD_TO_COLUMN: Partial<Record<WidgetDataField, PivotableField>> = {
  by_sector: "sector",
  by_actor: "actor",
  by_tactic: "tactic",
  by_province: "province",
  by_country: "country",
  by_severity: "severity",
  by_county: "county",
  by_district: "district",
  by_city: "city",
  by_suburb: "suburb",
  by_operation: "operation",
  by_target: "target",
  by_interest_group: "interest_group",
  by_actual_main_victim: "actual_main_victim",
  by_intended_primary_target: "intended_primary_target",
};

/** The five originally-classic fields (plus severity) live precomputed on
 *  `stats`; everything else needs an on-demand /breakdown fetch, same
 *  mechanism as crosstabKeyFor but for a single dimension instead of two. */
const PRECOMPUTED_FIELDS: string[] = ["by_sector", "by_actor", "by_tactic", "by_province", "by_country", "by_severity"];

/** Key to look up this widget's single-field breakdown, or null if it
 *  doesn't need one (a precomputed incidents field, or no primary field at
 *  all). Dataset-sourced widgets get a namespaced "ds:<id>:<column>" key so
 *  they can never collide with an incidents column of the same name. */
export function breakdownKeyFor(widget: DashboardWidget): string | null {
  if (!widget.dataField) return null;
  if (widget.datasetId) return `ds:${widget.datasetId}:${widget.dataField}`;
  if (PRECOMPUTED_FIELDS.includes(widget.dataField)) return null;
  return DATA_FIELD_TO_COLUMN[widget.dataField as WidgetDataField] ?? null;
}

/** Only calendar widgets sourced from a dataset need this — incidents' own
 *  calendar always reads stats.daily directly, same as before. */
export function dailyKeyFor(widget: DashboardWidget): string | null {
  if (widget.type !== "calendar" || !widget.datasetId || !widget.dataField) return null;
  return `ds:${widget.datasetId}:${widget.dataField}`;
}

export function crosstabKeyFor(widget: DashboardWidget): string | null {
  if (!widget.dataField || !widget.secondaryField) return null;
  if (widget.datasetId) return `ds:${widget.datasetId}:${widget.dataField}|${widget.secondaryField}`;
  const primary = DATA_FIELD_TO_COLUMN[widget.dataField as WidgetDataField];
  if (!primary) return null;
  return `${primary}|${widget.secondaryField}`;
}

/** Reshapes flat (primary, secondary, count) crosstab rows into the
 *  wide/pivoted format recharts needs for stacked bars or multi-series
 *  lines: one row per primary category, one column per secondary category.
 *  Caps the number of secondary series (not the primary categories — topN
 *  already handles that) since a stacked chart with dozens of tiny slices
 *  per bar stops being readable well before dozens of bars would. */
function pivotCrosstab(rows: CrosstabRow[], topNPrimary: number | undefined, maxSeries = 8): { data: Record<string, string | number>[]; seriesKeys: string[] } {
  const secondaryTotals = new Map<string, number>();
  for (const r of rows) secondaryTotals.set(r.secondary_value, (secondaryTotals.get(r.secondary_value) ?? 0) + r.count);
  const seriesKeys = Array.from(secondaryTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSeries)
    .map(([k]) => k);

  const primaryTotals = new Map<string, number>();
  for (const r of rows) primaryTotals.set(r.primary_value, (primaryTotals.get(r.primary_value) ?? 0) + r.count);
  let primaryOrder = Array.from(primaryTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  if (topNPrimary && topNPrimary > 0) primaryOrder = primaryOrder.slice(0, topNPrimary);

  const data = primaryOrder.map((p) => {
    const row: Record<string, string | number> = { value: p };
    for (const s of seriesKeys) row[s] = 0;
    return row;
  });
  const rowByPrimary = new Map(data.map((r) => [r.value as string, r]));
  for (const r of rows) {
    if (!seriesKeys.includes(r.secondary_value)) continue;
    const row = rowByPrimary.get(r.primary_value);
    if (row) row[r.secondary_value] = r.count;
  }
  return { data, seriesKeys };
}

function statValue(widget: DashboardWidget, stats: NormalizedDashboardStats, datasetSummaries?: Record<string, DatasetSummary>): number {
  if (widget.datasetId) {
    const summary = datasetSummaries?.[widget.datasetId];
    if (!summary) return 0;
    // No field picked = row count; a numeric column picked = its sum.
    return widget.dataField ? (summary.sums[widget.dataField] ?? 0) : summary.total;
  }
  switch (widget.dataField) {
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
  incidents?: { latitude: number; longitude: number; severity?: string | null; actor?: string | null; sector?: string | null; tactic?: string | null; occurred_date?: string | null; city?: string | null; province?: string | null }[];
  /** Keyed "primaryColumn|secondaryColumn" — only present for widgets that
   *  actually have a secondaryField set; see crosstabKeyFor(). */
  crosstabs?: Record<string, CrosstabRow[]>;
  /** Keyed by bare column name for incidents fields, or "ds:<id>:<column>"
   *  for dataset-sourced fields — see breakdownKeyFor(). */
  breakdowns?: Record<string, { value: string; count: number }[]>;
  /** Keyed "ds:<id>:<column>" — daily counts for a dataset-sourced calendar
   *  widget's chosen date column; see dailyKeyFor(). Incidents' own calendar
   *  reads stats.daily directly and never needs this. */
  dailyBreakdowns?: Record<string, { date: string; count: number }[]>;
  /** Keyed by dataset id — row count + numeric column sums, for stat cards
   *  sourced from a dataset instead of incidents. */
  datasetSummaries?: Record<string, DatasetSummary>;
  /** The user's uploaded datasets, for the "Data source" selector in the
   *  edit popover — only needed where editing happens, so undefined/empty
   *  on the read-only public view is fine. */
  datasets?: Dataset[];
  /** The dashboard-wide category filter currently in effect (see
   *  DashboardEditor's effectiveFilters) — used to visually highlight a
   *  value as "selected" whether it's pinned via click or just being
   *  hovered right now; both look the same, not to actually filter this
   *  widget's own data (every widget already gets pre-filtered data from
   *  the parent, this is purely about which bar looks active). */
  activeCrossFilters?: Partial<Record<PivotableField, string>>;
  /** Called when the mouse enters/leaves a specific value within this
   *  widget (a bar, a pie slice, a funnel stage) on an Incidents-sourced
   *  widget — sets/clears that as a dashboard-wide filter so every other
   *  widget reacts live while hovering, reverting once the mouse leaves.
   *  Undefined on the read-only public view, where nothing reacts to hover. */
  onCrossFilterHoverStart?: (field: PivotableField, value: string) => void;
  onCrossFilterHoverEnd?: () => void;
  /** Called on click — pins the value persistently (into the dashboard's
   *  saved filters, not the temporary hover overlay above), so it survives
   *  after the mouse moves away. Clicking the same value again unpins it. */
  onCrossFilterClick?: (field: PivotableField, value: string) => void;
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
export default function DashboardWidgetCard({
  widget,
  stats,
  incidents,
  crosstabs,
  breakdowns,
  dailyBreakdowns,
  datasetSummaries,
  datasets,
  activeCrossFilters,
  onCrossFilterHoverStart,
  onCrossFilterHoverEnd,
  onCrossFilterClick,
  onRemove,
  onRename,
  onUpdate,
}: Props) {
  // "Dashboard editable" = the editor gave us handlers at all (it withholds
  // them entirely when the whole dashboard is locked). "Widget locked" is a
  // second, per-widget flag that can be toggled independently — locking one
  // chart doesn't touch any other, and the dashboard-level lock always wins.
  const dashboardEditable = !!(onRemove || onRename || onUpdate);
  const widgetLocked = !!widget.locked;
  const showFullControls = dashboardEditable && !widgetLocked;
  const color = widget.color || "var(--signal)";
  const series = seriesFor(widget, stats, breakdowns);

  // Cross-filtering only makes sense for Incidents-sourced widgets whose
  // primary dimension is one of the real categorical columns — a
  // dataset-sourced widget has no matching field in the dashboard's filters
  // at all, and only bother wiring hover handlers when a parent actually
  // gave us onCrossFilterHoverStart (never on the read-only public view,
  // where nothing should react to hover in the first place).
  const crossFilterField: PivotableField | undefined = !widget.datasetId ? DATA_FIELD_TO_COLUMN[widget.dataField as WidgetDataField] : undefined;
  const handleCrossFilterHover =
    crossFilterField && onCrossFilterHoverStart ? (value: string) => onCrossFilterHoverStart(crossFilterField, value) : undefined;
  // For two-field crosstab widgets (network, sankey) — hovering the
  // secondary side filters by the secondary field instead of the primary
  // one. Only valid for Incidents-sourced widgets whose secondaryField is
  // genuinely one of the real categorical columns, not a dataset's own
  // column name (PivotableField | string covers both).
  const secondaryCrossFilterField: PivotableField | undefined =
    !widget.datasetId && widget.secondaryField && (PIVOTABLE_FIELD_OPTIONS as string[]).includes(widget.secondaryField)
      ? (widget.secondaryField as PivotableField)
      : undefined;
  const handleSecondaryCrossFilterHover =
    secondaryCrossFilterField && onCrossFilterHoverStart ? (value: string) => onCrossFilterHoverStart(secondaryCrossFilterField, value) : undefined;
  const handleCrossFilterClick = crossFilterField && onCrossFilterClick ? (value: string) => onCrossFilterClick(crossFilterField, value) : undefined;
  const handleSecondaryCrossFilterClick =
    secondaryCrossFilterField && onCrossFilterClick ? (value: string) => onCrossFilterClick(secondaryCrossFilterField, value) : undefined;

  // A pivoted, two-variable breakdown only kicks in when the widget actually
  // has a secondaryField set and the matching crosstab data has arrived —
  // otherwise every bar/line chart renders exactly as it always has.
  const crosstabKey = crosstabKeyFor(widget);
  const crosstabRows = crosstabKey ? crosstabs?.[crosstabKey] : undefined;
  const pivoted = crosstabRows ? pivotCrosstab(crosstabRows, widget.topN) : null;

  const [showEditor, setShowEditor] = useState(false);
  // Recharts has a confirmed, currently-unresolved bug where its internal
  // hover/tooltip tracking can get stuck highlighting the last-hovered bar
  // or slice even after the mouse has genuinely left the chart — see
  // https://github.com/recharts/recharts/issues/4466 and #6946. Recharts
  // doesn't expose a public way to reset that internal state directly, but
  // forcing a remount does: incrementing this key on mouseleave (a plain
  // DOM event, handled reliably by React — unlike recharts' own SVG-based
  // mouse tracking, which is where the actual bug lives) tears down and
  // rebuilds the chart with fresh internal state. This only fires once the
  // mouse has already left, so the brief remount isn't visually noticeable —
  // nothing on screen is changing at that moment.
  const [chartResetKey, setChartResetKey] = useState(0);
  // Tracks whether the mouse is currently over this specific widget's chart
  // area — set via the same wrapping div's mouseenter/mouseleave used below.
  // Needed to fix a real conflict between two things that otherwise fight
  // each other: hovering a bar here updates activeCrossFilters, which gets
  // passed back down to this exact widget too — and without this guard, the
  // reset-on-filter-change effect below would see that as "data changed,
  // remount to be safe" and tear down the very DOM element the mouse is
  // sitting on mid-hover. Once that element is destroyed and recreated, the
  // browser never fires a fresh mouseenter on the replacement (it only
  // fires when the cursor actually moves into something, not when a new
  // element appears under an already-stationary cursor), so hover tracking
  // would silently die right as the interaction was working.
  const isMouseOverRef = useRef(false);
  // A second trigger for the same remount, beyond onMouseLeave below: when
  // cross-filtering (clicking a bar) changes what's selected, every other
  // widget's underlying data changes and re-renders — including, possibly,
  // whichever chart the mouse happens to still be hovering at that exact
  // moment. No mouseleave event fires in that case (the mouse never
  // actually left), so the fix below alone wouldn't catch it; this covers
  // that gap by also resetting whenever the selection itself changes — but
  // never for the widget currently under the mouse itself (see isMouseOverRef
  // above), since that widget's own dimming already updates correctly via
  // a normal prop-driven re-render, and remounting it would only break the
  // hover interaction that just caused the change in the first place.
  useEffect(() => {
    if (isMouseOverRef.current) return;
    setChartResetKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(activeCrossFilters)]);
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
          {dashboardEditable && !widgetLocked && (
            <span
              className="widget-drag-handle"
              title="Drag from here to reposition this widget"
              style={{ cursor: "grab", color: "var(--text-faint)", fontSize: 13, flexShrink: 0, lineHeight: 1, padding: "0 2px" }}
            >
              ⣿
            </span>
          )}
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

      <div
        // Stable (never changes) for globe/map — neither is a recharts
        // component, so neither has the stuck-tooltip bug this remount
        // mechanism exists to work around, and neither participates in
        // cross-filtering, so there's no reason for either to ever react to
        // activeCrossFilters changing. Force-remounting the globe
        // specifically is real risk for no benefit: it means tearing down
        // and rebuilding an entire Three.js/WebGL scene every time any
        // *other* widget on the same dashboard is hovered or clicked for
        // cross-filtering, which is exactly the kind of repeated
        // teardown/rebuild cycle that can crash a WebGL context.
        key={widget.type === "globe" || widget.type === "map" ? "stable" : chartResetKey}
        onMouseEnter={() => {
          isMouseOverRef.current = true;
        }}
        onMouseLeave={() => {
          isMouseOverRef.current = false;
          setChartResetKey((k) => k + 1);
        }}
        style={{ flex: 1, minHeight: 0 }}
      >
        {widget.type === "stat" && (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 700, color }}>{statValue(widget, stats, datasetSummaries).toLocaleString()}</div>
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

        {widget.type === "bar" && pivoted && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pivoted.data} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <YAxis type="category" dataKey="value" width={100} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {widget.showLegend !== false && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {pivoted.seriesKeys.map((key, idx) => (
                <Bar key={key} dataKey={key} stackId="pivot" fill={paletteFor(widget, pivoted.seriesKeys.length)[idx]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}

        {widget.type === "bar" && !pivoted && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <YAxis type="category" dataKey="value" width={100} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {widget.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
              <Bar
                dataKey="count"
                name={fieldLabel(widget.dataField)}
                fill={color}
                radius={[0, 3, 3, 0]}
                onMouseEnter={
                  handleCrossFilterHover
                    ? (data: { value: string; payload: { value: string } }) => handleCrossFilterHover(data.payload.value)
                    : undefined
                }
                onMouseLeave={onCrossFilterHoverEnd}
                onClick={
                  handleCrossFilterClick
                    ? (data: { value: string; payload: { value: string } }) => handleCrossFilterClick(data.payload.value)
                    : undefined
                }
                cursor={handleCrossFilterClick ? "pointer" : undefined}
              >
                {(widget.palette && widget.palette.length > 0) || crossFilterField
                  ? series.map((s, idx) => (
                      <Cell
                        key={idx}
                        fill={widget.palette && widget.palette.length > 0 ? paletteFor(widget, series.length)[idx] : color}
                        fillOpacity={crossFilterField && activeCrossFilters?.[crossFilterField] && activeCrossFilters[crossFilterField] !== s.value ? 0.3 : 1}
                      />
                    ))
                  : null}
                {widget.showDataLabels && (
                  <LabelList
                    dataKey="count"
                    position="right"
                    style={{ fill: "var(--text-primary)", fontSize: widget.labelFontSize ?? 11, fontFamily: widget.labelFontFamily }}
                  />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {widget.type === "line" && pivoted && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pivoted.data} margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
              <XAxis dataKey="value" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {widget.showLegend !== false && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {pivoted.seriesKeys.map((key, idx) => (
                <Line key={key} type="monotone" dataKey={key} stroke={paletteFor(widget, pivoted.seriesKeys.length)[idx]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}

        {widget.type === "line" && !pivoted && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={widget.dataField === "time_series" ? stats.time_series : series} margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
              <XAxis dataKey={widget.dataField === "time_series" ? "bucket" : "value"} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {widget.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
              <Line
                type="monotone"
                dataKey="count"
                name={fieldLabel(widget.dataField)}
                stroke={color}
                strokeWidth={2}
                dot={
                  handleCrossFilterHover
                    ? (dotProps: { cx: number; cy: number; payload: { value: string } }) => {
                        const isSelected = activeCrossFilters?.[crossFilterField!] === dotProps.payload.value;
                        const isFiltered = activeCrossFilters?.[crossFilterField!] !== undefined;
                        return (
                          <circle
                            key={dotProps.payload.value}
                            cx={dotProps.cx}
                            cy={dotProps.cy}
                            r={isSelected ? 5 : 3}
                            fill={color}
                            fillOpacity={isFiltered && !isSelected ? 0.35 : 1}
                            stroke={isSelected ? "var(--text-primary)" : "none"}
                            strokeWidth={1.5}
                            onMouseEnter={() => handleCrossFilterHover(dotProps.payload.value)}
                            onMouseLeave={onCrossFilterHoverEnd}
                            onClick={handleCrossFilterClick ? () => handleCrossFilterClick(dotProps.payload.value) : undefined}
                            cursor={handleCrossFilterClick ? "pointer" : undefined}
                          />
                        );
                      }
                    : false
                }
              />
            </LineChart>
          </ResponsiveContainer>
        )}

        {widget.type === "pie" && (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={series}
                dataKey="count"
                nameKey="value"
                cx="50%"
                cy="50%"
                outerRadius="75%"
                label={widget.showDataLabels ? { fontSize: widget.labelFontSize ?? 10, fontFamily: widget.labelFontFamily } : false}
                onMouseEnter={
                  handleCrossFilterHover
                    ? (data: { value: string; payload: { value: string } }) => handleCrossFilterHover(data.payload.value)
                    : undefined
                }
                onMouseLeave={onCrossFilterHoverEnd}
                onClick={
                  handleCrossFilterClick
                    ? (data: { value: string; payload: { value: string } }) => handleCrossFilterClick(data.payload.value)
                    : undefined
                }
                cursor={handleCrossFilterClick ? "pointer" : undefined}
              >
                {paletteFor(widget, series.length).map((c, idx) => (
                  <Cell
                    key={idx}
                    fill={c}
                    fillOpacity={crossFilterField && activeCrossFilters?.[crossFilterField] && activeCrossFilters[crossFilterField] !== series[idx]?.value ? 0.3 : 1}
                  />
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
              <Radar
                name={fieldLabel(widget.dataField)}
                dataKey="count"
                stroke={color}
                fill={color}
                fillOpacity={0.35}
                dot={(dotProps: { cx: number; cy: number; payload: { value: string } }) => {
                  const isSelected = crossFilterField && activeCrossFilters?.[crossFilterField] === dotProps.payload.value;
                  const isFiltered = crossFilterField && activeCrossFilters?.[crossFilterField] !== undefined;
                  return (
                    <circle
                      key={dotProps.payload.value}
                      cx={dotProps.cx}
                      cy={dotProps.cy}
                      r={isSelected ? 5 : 3.5}
                      fill={color}
                      fillOpacity={isFiltered && !isSelected ? 0.35 : 1}
                      stroke={isSelected ? "var(--text-primary)" : "none"}
                      strokeWidth={1.5}
                      onMouseEnter={handleCrossFilterHover ? () => handleCrossFilterHover(dotProps.payload.value) : undefined}
                      onMouseLeave={onCrossFilterHoverEnd}
                      onClick={handleCrossFilterClick ? () => handleCrossFilterClick(dotProps.payload.value) : undefined}
                      cursor={handleCrossFilterClick ? "pointer" : undefined}
                    />
                  );
                }}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {widget.showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
            </RadarChart>
          </ResponsiveContainer>
        )}

        {widget.type === "funnel" && (
          <ResponsiveContainer width="100%" height="100%">
            <FunnelChart>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Funnel
                dataKey="count"
                data={series}
                nameKey="value"
                isAnimationActive={false}
                onMouseEnter={
                  (handleCrossFilterHover
                    ? (data: { value: string; payload: { value: string } }) => handleCrossFilterHover(data.payload.value)
                    : undefined) as never
                }
                onMouseLeave={onCrossFilterHoverEnd}
                onClick={
                  (handleCrossFilterClick
                    ? (data: { value: string; payload: { value: string } }) => handleCrossFilterClick(data.payload.value)
                    : undefined) as never
                }
                cursor={handleCrossFilterClick ? "pointer" : undefined}
              >
                {paletteFor(widget, series.length).map((c, idx) => (
                  <Cell
                    key={idx}
                    fill={c}
                    fillOpacity={crossFilterField && activeCrossFilters?.[crossFilterField] && activeCrossFilters[crossFilterField] !== series[idx]?.value ? 0.3 : 1}
                  />
                ))}
                {widget.showDataLabels && (
                  <LabelList
                    dataKey="value"
                    position="right"
                    fill="var(--text-primary)"
                    stroke="none"
                    fontSize={widget.labelFontSize ?? 11}
                    fontFamily={widget.labelFontFamily}
                  />
                )}
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        )}

        {widget.type === "choropleth" && (
          <ChoroplethMap
            series={series}
            baseColor={widget.color || "#0d9488"}
            field={widget.dataField === "by_province" ? "by_province" : "by_country"}
            manualData={widget.manualCountryData}
            showLabels={widget.showDataLabels}
            fontFamily={widget.labelFontFamily}
            fontSize={widget.labelFontSize}
            selectedValue={crossFilterField ? activeCrossFilters?.[crossFilterField] : undefined}
            onHoverStart={handleCrossFilterHover}
            onHoverEnd={onCrossFilterHoverEnd}
            onClick={handleCrossFilterClick}
          />
        )}

        {widget.type === "globe" && (
          <Suspense
            fallback={
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-faint)" }}>
                Loading 3D globe…
              </div>
            }
          >
            <GlobeWidget series={series} baseColor={widget.color || "#0d9488"} manualData={widget.manualCountryData} routes={widget.manualRoutes} labels={widget.manualLabels} />
          </Suspense>
        )}

        {widget.type === "calendar" && (
          <CalendarHeatmap
            daily={widget.datasetId ? (dailyBreakdowns?.[dailyKeyFor(widget) ?? ""] ?? []) : stats.daily}
            baseColor={widget.color || "#0d9488"}
          />
        )}

        {widget.type === "sankey" && (
          <RelationshipSankey
            data={relationshipData(widget, stats, crosstabs)}
            baseColor={widget.color || "#0d9488"}
            showLabels={widget.showDataLabels}
            fontFamily={widget.labelFontFamily}
            fontSize={widget.labelFontSize}
            offsets={widget.labelOffsets}
            onCommitOffset={onUpdate ? (key, dx, dy) => onUpdate({ labelOffsets: { ...widget.labelOffsets, [key]: { dx, dy } } }) : undefined}
            selectedPrimary={crossFilterField ? activeCrossFilters?.[crossFilterField] : undefined}
            selectedSecondary={secondaryCrossFilterField ? activeCrossFilters?.[secondaryCrossFilterField] : undefined}
            onHoverStartPrimary={handleCrossFilterHover}
            onHoverStartSecondary={handleSecondaryCrossFilterHover}
            onHoverEnd={onCrossFilterHoverEnd}
            onClickPrimary={handleCrossFilterClick}
            onClickSecondary={handleSecondaryCrossFilterClick}
          />
        )}

        {widget.type === "network" && (
          <RelationshipNetwork
            data={relationshipData(widget, stats, crosstabs)}
            baseColor={widget.color || "#0d9488"}
            showLabels={widget.showDataLabels}
            fontFamily={widget.labelFontFamily}
            fontSize={widget.labelFontSize}
            offsets={widget.labelOffsets}
            onCommitOffset={onUpdate ? (key, dx, dy) => onUpdate({ labelOffsets: { ...widget.labelOffsets, [key]: { dx, dy } } }) : undefined}
            selectedPrimary={crossFilterField ? activeCrossFilters?.[crossFilterField] : undefined}
            selectedSecondary={secondaryCrossFilterField ? activeCrossFilters?.[secondaryCrossFilterField] : undefined}
            onHoverStartPrimary={handleCrossFilterHover}
            onHoverStartSecondary={handleSecondaryCrossFilterHover}
            onHoverEnd={onCrossFilterHoverEnd}
            onClickPrimary={handleCrossFilterClick}
            onClickSecondary={handleSecondaryCrossFilterClick}
          />
        )}

        {widget.type === "bubble" && (
          <BubbleChart
            series={series}
            colors={paletteFor(widget, series.length)}
            showLabels={widget.showDataLabels}
            fontFamily={widget.labelFontFamily}
            fontSize={widget.labelFontSize}
            offsets={widget.labelOffsets}
            onCommitOffset={onUpdate ? (key, dx, dy) => onUpdate({ labelOffsets: { ...widget.labelOffsets, [key]: { dx, dy } } }) : undefined}
            selectedValue={crossFilterField ? activeCrossFilters?.[crossFilterField] : undefined}
            onHoverStart={handleCrossFilterHover}
            onHoverEnd={onCrossFilterHoverEnd}
            onClick={handleCrossFilterClick}
          />
        )}

        {widget.type === "map" && (
          <div style={{ height: "100%", borderRadius: 6, overflow: "hidden", position: "relative" }}>
            <MapContainer
              center={widget.mapView ? [widget.mapView.lat, widget.mapView.lng] : [1, 20]}
              zoom={widget.mapView?.zoom ?? 2.2}
              style={{ width: "100%", height: "100%" }}
              scrollWheelZoom={false}
              dragging={showFullControls}
              zoomControl={false}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
              {(widget.mapViewMode ?? "markers") === "heatmap" ? (
                <HeatmapLayer points={(incidents ?? []).slice(0, 5000).map((i) => [i.latitude, i.longitude, 1] as [number, number, number])} />
              ) : (
                (incidents ?? []).slice(0, 3000).map((i, idx) => (
                  <CircleMarker key={idx} center={[i.latitude, i.longitude]} radius={2.5} pathOptions={{ color, fillColor: color, fillOpacity: 0.7, weight: 0.5 }}>
                    <LeafletTooltip direction="top" offset={[0, -2]} opacity={0.95}>
                      <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                        <div style={{ fontWeight: 700 }}>{[i.city, i.province].filter(Boolean).join(", ") || "Unknown location"}</div>
                        {i.actor && <div>Actor: {i.actor}</div>}
                        {i.sector && <div>Sector: {i.sector}</div>}
                        {i.tactic && <div>Tactic: {i.tactic}</div>}
                        {i.severity && <div>Severity: {i.severity}</div>}
                        {i.occurred_date && <div style={{ color: "#888" }}>{i.occurred_date}</div>}
                      </div>
                    </LeafletTooltip>
                  </CircleMarker>
                ))
              )}
              {onUpdate && (
                <>
                  <MapViewLockButton locked={!!widget.mapView} onLock={(view) => onUpdate({ mapView: view })} onUnlock={() => onUpdate({ mapView: undefined })} />
                  <MapModeToggle mode={widget.mapViewMode ?? "markers"} onChange={(mode) => onUpdate({ mapViewMode: mode })} />
                </>
              )}
            </MapContainer>
          </div>
        )}
      </div>

      {showEditor && onUpdate && popoverPos && createPortal(
        <WidgetEditPopover
          popoverRef={popoverRef}
          position={popoverPos}
          widget={widget}
          datasets={datasets}
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
  datasets,
}: {
  widget: DashboardWidget;
  onSave: (patch: Partial<DashboardWidget>) => void;
  onClose: () => void;
  popoverRef: React.RefObject<HTMLDivElement>;
  position: { top: number; left: number };
  datasets?: Dataset[];
}) {
  const [type, setType] = useState<WidgetType>(widget.type);
  const [datasetId, setDatasetId] = useState<string | undefined>(widget.datasetId);
  const [field, setField] = useState<string>(widget.dataField ?? (widget.datasetId ? "" : FIELDS_FOR_TYPE[widget.type][0] ?? "by_sector"));
  const [secondaryField, setSecondaryField] = useState<string | undefined>(widget.secondaryField);
  const [label, setLabel] = useState(widget.label ?? "");
  const [showDataLabels, setShowDataLabels] = useState(!!widget.showDataLabels);
  const [labelFontFamily, setLabelFontFamily] = useState(widget.labelFontFamily ?? "");
  const [labelFontSize, setLabelFontSize] = useState<number | undefined>(widget.labelFontSize);
  const [color, setColor] = useState<string | undefined>(widget.color);
  const [palette, setPalette] = useState<string[]>(widget.palette ?? []);
  const [showLegend, setShowLegend] = useState(!!widget.showLegend);
  const [topN, setTopN] = useState<number | undefined>(widget.topN);
  const [showSparkline, setShowSparkline] = useState(!!widget.showSparkline);
  const [useManualData, setUseManualData] = useState(!!widget.manualCountryData);
  const [manualCountryData, setManualCountryData] = useState<{ country: string; value: number; color?: string }[]>(widget.manualCountryData ?? []);
  const [manualRoutes, setManualRoutes] = useState<
    { waypoints: string[]; label?: string; color?: string; vehicle?: "plane" | "commercial-ship" | "warship" | "drone" | "none"; strokeWidth?: number }[]
  >(widget.manualRoutes ?? []);
  const [manualLabels, setManualLabels] = useState<{ location: string; text: string; color?: string }[]>(widget.manualLabels ?? []);

  const supportsManualData = type === "choropleth" || type === "globe";

  const supportsBreakdown = type === "bar" || type === "line" || type === "sankey" || type === "network";
  const requiresSecondary = type === "sankey" || type === "network";
  const activeDataset = datasetId ? datasets?.find((d) => d.id === datasetId) : undefined;

  /** Sankey/network need two *different* fields to mean anything — unlike
   *  bar/line's optional second variable, picking one of these types with no
   *  secondary field set (or the same field as primary) would render an
   *  empty or nonsensical diagram, so this fills in a sensible different
   *  field automatically rather than leaving the user to notice and pick one. */
  function defaultSecondary(primaryField: string, dataset: Dataset | undefined): string | undefined {
    if (dataset) return dataset.schema.map((c) => c.name).find((c) => c !== primaryField);
    const primaryColumn = DATA_FIELD_TO_COLUMN[primaryField as WidgetDataField];
    return PIVOTABLE_FIELD_OPTIONS.find((f) => f !== primaryColumn);
  }

  /** A sensible starting field for a given (type, source) combination — a
   *  numeric column for stat, a date column for calendar, any column
   *  otherwise for a dataset source; the fixed WidgetDataField list for
   *  Incidents. Used both when first switching to a dataset and when
   *  changing type while a dataset is already active, since a field valid
   *  for the old type (e.g. a number column for "stat") usually isn't valid
   *  for the new one (e.g. calendar needs a date column specifically). */
  function defaultFieldFor(forType: WidgetType, dataset: Dataset | undefined): string {
    if (dataset) {
      if (forType === "stat") return dataset.schema.find((c) => c.type === "number")?.name ?? "";
      if (forType === "calendar") return dataset.schema.find((c) => c.type === "date")?.name ?? "";
      return dataset.schema[0]?.name ?? "";
    }
    return FIELDS_FOR_TYPE[forType][0] ?? "by_sector";
  }

  function handleTypeChange(newType: WidgetType) {
    setType(newType);
    if (datasetId && !DATASET_COMPATIBLE_TYPES.includes(newType)) {
      // This type can't actually read from a dataset (see
      // DATASET_COMPATIBLE_TYPES) — fall back to Incidents rather than offer
      // a combination that would silently show the wrong data.
      setDatasetId(undefined);
      setField(defaultFieldFor(newType, undefined));
    } else if (datasetId) {
      // Still dataset-sourced — the current field might not fit the new
      // type's constraints (a number column doesn't work for calendar, a
      // date column doesn't work for stat's sums), so re-validate it.
      const currentColType = activeDataset?.schema.find((c) => c.name === field)?.type;
      const stillValid = newType === "stat" ? currentColType === "number" : newType === "calendar" ? currentColType === "date" : true;
      if (!stillValid) setField(defaultFieldFor(newType, activeDataset));
    } else if (FIELDS_FOR_TYPE[newType].length > 0 && !(FIELDS_FOR_TYPE[newType] as string[]).includes(field)) {
      setField(FIELDS_FOR_TYPE[newType][0]);
    }
    if (newType === "sankey" || newType === "network") {
      if (!secondaryField || secondaryField === field) setSecondaryField(defaultSecondary(field, activeDataset));
    } else if (newType !== "bar" && newType !== "line") {
      setSecondaryField(undefined);
    }
    if (newType !== "choropleth" && newType !== "globe") setUseManualData(false);
    if (newType !== "globe") setManualRoutes([]);
  }

  function handleDatasetChange(newDatasetId: string | undefined) {
    setDatasetId(newDatasetId);
    const dataset = newDatasetId ? datasets?.find((d) => d.id === newDatasetId) : undefined;
    const effectiveType = newDatasetId && !DATASET_COMPATIBLE_TYPES.includes(type) ? "bar" : type;
    if (effectiveType !== type) setType(effectiveType);
    const newField = defaultFieldFor(effectiveType, dataset);
    setField(newField);
    setSecondaryField(requiresSecondary || effectiveType === "sankey" || effectiveType === "network" ? defaultSecondary(newField, dataset) : undefined);
  }

  function handleSave() {
    const manualActive = supportsManualData && useManualData;
    onSave({
      type,
      datasetId: manualActive ? undefined : datasetId,
      dataField: type === "map" || manualActive ? undefined : field || undefined,
      secondaryField: supportsBreakdown && !manualActive ? secondaryField : undefined,
      label: label || undefined,
      showDataLabels,
      labelFontFamily: labelFontFamily || undefined,
      labelFontSize,
      color,
      palette: palette.length > 0 ? palette : undefined,
      showLegend,
      topN,
      showSparkline,
      manualCountryData: manualActive ? manualCountryData : undefined,
      manualRoutes: type === "globe" && manualRoutes.length > 0 ? manualRoutes : undefined,
      manualLabels: type === "globe" && manualLabels.length > 0 ? manualLabels : undefined,
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

      {supportsManualData && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={useManualData} onChange={(e) => setUseManualData(e.target.checked)} />
          Use manual country data instead of Incidents/a dataset
        </label>
      )}

      {!(supportsManualData && useManualData) && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>DATA SOURCE</div>
          <select value={datasetId ?? ""} onChange={(e) => handleDatasetChange(e.target.value || undefined)} style={selectStyle}>
            <option value="">Incidents (this app's conflict/security data)</option>
            {(datasets ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {datasetId && (datasets ?? []).length === 0 && (
            <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 3 }}>No datasets uploaded yet — see the Datasets tab.</div>
          )}
        </div>
      )}

      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>TYPE</div>
        <select value={type} onChange={(e) => handleTypeChange(e.target.value as WidgetType)} style={selectStyle}>
          {WIDGET_TYPES.filter((t) => !datasetId || DATASET_COMPATIBLE_TYPES.includes(t.value)).map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {supportsManualData && useManualData && (
        <ManualCountryDataEditor rows={manualCountryData} onChange={setManualCountryData} />
      )}

      {type === "globe" && <ManualRoutesEditor routes={manualRoutes} onChange={setManualRoutes} />}

      {type === "globe" && <ManualLabelsEditor labels={manualLabels} onChange={setManualLabels} />}

      {type !== "map" && !(supportsManualData && useManualData) && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>DATA</div>
          <select
            value={field}
            onChange={(e) => {
              const newField = e.target.value;
              setField(newField);
              if (requiresSecondary && secondaryField === newField) setSecondaryField(defaultSecondary(newField, activeDataset));
            }}
            style={selectStyle}
          >
            {activeDataset ? (
              <>
                {type === "stat" && <option value="">Row count</option>}
                {activeDataset.schema
                  .filter((col) => (type === "stat" ? col.type === "number" : type === "calendar" ? col.type === "date" : true))
                  .map((col) => (
                    <option key={col.name} value={col.name}>
                      {col.name}
                    </option>
                  ))}
              </>
            ) : (
              FIELDS_FOR_TYPE[type].map((f) => (
                <option key={f} value={f}>
                  {fieldLabel(f)}
                </option>
              ))
            )}
          </select>
        </div>
      )}

      {supportsBreakdown && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            {requiresSecondary ? "LINKED TO (2ND FIELD)" : "BREAK DOWN BY (OPTIONAL — 2ND VARIABLE)"}
          </div>
          <select
            value={secondaryField ?? ""}
            onChange={(e) => setSecondaryField(e.target.value || undefined)}
            style={selectStyle}
          >
            {!requiresSecondary && <option value="">None — single variable</option>}
            {activeDataset
              ? activeDataset.schema
                  .filter((col) => col.name !== field)
                  .map((col) => (
                    <option key={col.name} value={col.name}>
                      {col.name}
                    </option>
                  ))
              : PIVOTABLE_FIELD_OPTIONS.filter((f) => f !== DATA_FIELD_TO_COLUMN[field as WidgetDataField]).map((f) => (
                  <option key={f} value={f}>
                    {PIVOT_FIELD_LABELS[f]}
                  </option>
                ))}
          </select>
          {secondaryField && (
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 4 }}>
              {type === "bar" && "Stacked bars"}
              {type === "line" && "Multiple lines"}
              {type === "sankey" && "Flow"}
              {type === "network" && "Links"}, one per {activeDataset ? secondaryField : PIVOT_FIELD_LABELS[secondaryField as PivotableField].toLowerCase()}
            </div>
          )}
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
      {(type === "bar" || type === "pie" || type === "funnel" || type === "choropleth" || type === "bubble" || type === "network" || type === "sankey") && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={showDataLabels} onChange={(e) => setShowDataLabels(e.target.checked)} />
          {type === "choropleth"
            ? "Show region name labels on the map"
            : type === "bubble"
              ? "Show category names (not just counts)"
              : type === "network" || type === "sankey"
                ? "Show node names and counts on each link"
                : "Show values on chart"}
        </label>
      )}
      {showDataLabels &&
        (type === "bar" || type === "pie" || type === "funnel" || type === "choropleth" || type === "bubble" || type === "network" || type === "sankey") && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", paddingLeft: 20 }}>
            <select value={labelFontFamily} onChange={(e) => setLabelFontFamily(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
              <option value="">Default font</option>
              {LABEL_FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={6}
              max={32}
              value={labelFontSize ?? ""}
              onChange={(e) => setLabelFontSize(e.target.value ? Number(e.target.value) : undefined)}
              placeholder="Size"
              title="Font size — leave blank for the default"
              style={{ ...selectStyle, width: 56 }}
            />
          </div>
        )}
      {(type === "bubble" || type === "network" || type === "sankey") && showDataLabels && (
        <div style={{ fontSize: 10, color: "var(--text-faint)", paddingLeft: 20 }}>Drag any label directly on the chart to reposition it.</div>
      )}
      {type === "stat" && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={showSparkline} onChange={(e) => setShowSparkline(e.target.checked)} />
          Show trend line (overall incident volume by month)
        </label>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button onClick={handleSave} style={primaryBtnStyle}>
          Apply
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
// Global province/state (admin-1) boundaries, simplified from Natural Earth's
// ~4,600-region worldwide dataset (44MB raw) down to ~1.6MB — same idea as
// the country-level topology below, just one administrative level deeper.
// Served as a static asset (not bundled into JS) so it only downloads when a
// province-level choropleth is actually on screen.
const PROVINCE_TOPOLOGY_URL = "/geo/admin1-provinces.json";

/** Shades either whole countries or their individual provinces/states,
 *  depending on which breakdown field the widget is showing — reuses the
 *  exact same world topology and map library already proven working in
 *  WorldMap.tsx, just driven by dashboard stats instead of live events.
 *  Name matching is case/whitespace-insensitive but otherwise exact; a place
 *  in the data that doesn't match the topology's naming just stays unshaded
 *  rather than guessing, since a wrong match would misrepresent where
 *  incidents actually happened. Known limitation: province names are matched
 *  globally, not scoped to a country, so a name that happens to repeat across
 *  countries (uncommon, but real) could match the wrong one. */
function ChoroplethMap({
  series,
  baseColor,
  field,
  manualData,
  showLabels,
  fontFamily,
  fontSize,
  selectedValue,
  onHoverStart,
  onHoverEnd,
  onClick,
}: {
  series: { value: string; count: number }[];
  baseColor: string;
  field: "by_country" | "by_province";
  manualData?: { country: string; value: number; color?: string }[];
  showLabels?: boolean;
  fontFamily?: string;
  fontSize?: number;
  selectedValue?: string;
  onHoverStart?: (value: string) => void;
  onHoverEnd?: () => void;
  onClick?: (value: string) => void;
}) {
  const usingManualData = !!manualData;
  const countByName = new Map<string, number>();
  const colorByName = new Map<string, string>();
  // What to actually send as the filter value when a region is clicked —
  // the backend matches category filters case-sensitively (unlike the
  // client's own country-restriction check, which is deliberately
  // case-insensitive), so this needs to be the value exactly as it's
  // stored in the incidents data, not the map topology's own casing for
  // the same place name, which can easily differ.
  const originalCaseByName = new Map<string, string>();
  if (usingManualData) {
    for (const d of manualData!) {
      countByName.set(d.country.trim().toLowerCase(), d.value);
      if (d.color) colorByName.set(d.country.trim().toLowerCase(), d.color);
    }
  } else {
    for (const s of series) {
      const key = s.value.trim().toLowerCase();
      countByName.set(key, s.count);
      originalCaseByName.set(key, s.value);
    }
  }
  const maxCount = Math.max(1, ...Array.from(countByName.values()));
  const topologyUrl = field === "by_province" ? PROVINCE_TOPOLOGY_URL : worldTopology;

  return (
    <div style={{ height: "100%", borderRadius: 6, overflow: "hidden", background: "var(--panel-raised)" }}>
      <ComposableMap projectionConfig={{ scale: 148 }} style={{ width: "100%", height: "100%" }}>
        <Geographies geography={topologyUrl}>
          {({ geographies }: { geographies: { rsmKey: string; properties?: { name?: string } }[] }) => (
            <>
              {geographies.map((geo) => {
                const name = geo.properties?.name;
                const key = name?.trim().toLowerCase();
                const count = key ? countByName.get(key) : undefined;
                const explicitColor = key ? colorByName.get(key) : undefined;
                const intensity = count ? Math.max(0.18, count / maxCount) : 0;
                const originalCaseValue = key ? originalCaseByName.get(key) : undefined;
                const isSelected = selectedValue !== undefined && key === selectedValue.trim().toLowerCase();
                const isDimmed = selectedValue !== undefined && !isSelected;
                const isHoverable = !usingManualData && originalCaseValue && onHoverStart;
                const isClickable = !usingManualData && originalCaseValue && onClick;
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={explicitColor ?? (count ? hexToRgba(baseColor, intensity) : "var(--panel)")}
                    fillOpacity={isDimmed ? 0.3 : 1}
                    stroke={isSelected ? "var(--text-primary)" : "var(--border)"}
                    strokeWidth={isSelected ? 1.2 : field === "by_province" ? 0.2 : 0.4}
                    onMouseEnter={isHoverable ? () => onHoverStart(originalCaseValue) : undefined}
                    onMouseLeave={onHoverEnd}
                    onClick={isClickable ? () => onClick(originalCaseValue) : undefined}
                    style={{
                      default: { outline: "none", cursor: isHoverable || isClickable ? "pointer" : undefined },
                      hover: { outline: "none", opacity: 0.8, cursor: isHoverable || isClickable ? "pointer" : undefined },
                      pressed: { outline: "none" },
                    }}
                  />
                );
              })}
              {showLabels &&
                geographies.map((geo) => {
                  const name = geo.properties?.name;
                  const key = name?.trim().toLowerCase();
                  const count = key ? countByName.get(key) : undefined;
                  if (!name || !count) return null; // only label regions with actual data, to avoid cluttering every country name on the map
                  const centroid = geoCentroid(geo as unknown as Parameters<typeof geoCentroid>[0]);
                  if (!Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) return null;
                  return (
                    <Marker key={`label-${geo.rsmKey}`} coordinates={centroid}>
                      <text
                        textAnchor="middle"
                        style={{ fontSize: fontSize ?? (field === "by_province" ? 5 : 7), fontFamily, fill: "var(--text-primary)", pointerEvents: "none" }}
                      >
                        {name}
                      </text>
                    </Marker>
                  );
                })}
            </>
          )}
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

/** Builds recharts' required {nodes, links} shape from flat crosstab rows —
 *  each distinct primary/secondary value becomes its own node, so the same
 *  label never collides even if a primary and secondary value happen to
 *  share text (e.g. a "Region" and a "Category" both having a "North"). */
function sankeyDataFrom(rows: CrosstabRow[]) {
  const primaries = Array.from(new Set(rows.map((d) => d.primary_value)));
  const secondaries = Array.from(new Set(rows.map((d) => d.secondary_value)));
  const nodes = [...primaries.map((a) => ({ name: a })), ...secondaries.map((t) => ({ name: t }))];
  const links = rows.map((d) => ({
    source: primaries.indexOf(d.primary_value),
    target: primaries.length + secondaries.indexOf(d.secondary_value),
    value: d.count,
  }));
  return { nodes, links };
}

function RelationshipSankey({
  data,
  baseColor,
  showLabels,
  fontFamily,
  fontSize,
  offsets,
  onCommitOffset,
  selectedPrimary,
  selectedSecondary,
  onHoverStartPrimary,
  onHoverStartSecondary,
  onHoverEnd,
  onClickPrimary,
  onClickSecondary,
}: {
  data: CrosstabRow[];
  baseColor: string;
  showLabels?: boolean;
  fontFamily?: string;
  fontSize?: number;
  offsets?: Record<string, { dx: number; dy: number }>;
  onCommitOffset?: (key: string, dx: number, dy: number) => void;
  selectedPrimary?: string;
  selectedSecondary?: string;
  onHoverStartPrimary?: (value: string) => void;
  onHoverStartSecondary?: (value: string) => void;
  onHoverEnd?: () => void;
  onClickPrimary?: (value: string) => void;
  onClickSecondary?: (value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Sankey's own layout is recharts' internal computation, not something
  // this file controls — unlike the hand-rolled bubble/network SVGs, there's
  // no viewBox set here at all (recharts re-renders at exact pixel
  // dimensions on resize instead), which DraggableLabel's scale-factor
  // logic accounts for directly. What custom node/link render functions
  // *do* give access to is each node/link's actual computed position, which
  // is enough to inject a draggable label at the right spot without needing
  // to reimplement the Sankey layout algorithm by hand.
  useEffect(() => {
    const svg = containerRef.current?.querySelector("svg");
    if (svg) svgRef.current = svg as unknown as SVGSVGElement;
  }, [data]);

  if (data.length === 0) {
    return <EmptyState message="No data for this pair of fields yet." />;
  }
  const sankeyData = sankeyDataFrom(data);
  const nodeFontSize = fontSize ?? 11;
  const primariesSet = new Set(data.map((d) => d.primary_value));

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={sankeyData}
          nodePadding={20}
          node={(nodeProps: { x: number; y: number; width: number; height: number; payload: { name: string } }) => {
            const isPrimary = primariesSet.has(nodeProps.payload.name);
            const selected = isPrimary ? selectedPrimary : selectedSecondary;
            const isDimmed = selected !== undefined && selected !== nodeProps.payload.name;
            const handleHover = isPrimary ? onHoverStartPrimary : onHoverStartSecondary;
            const handleClick = isPrimary ? onClickPrimary : onClickSecondary;
            return (
              <g>
                <rect
                  x={nodeProps.x}
                  y={nodeProps.y}
                  width={nodeProps.width}
                  height={nodeProps.height}
                  fill={baseColor}
                  fillOpacity={isDimmed ? 0.25 : 0.85}
                  stroke={selected === nodeProps.payload.name ? "var(--text-primary)" : "none"}
                  strokeWidth={1.5}
                  onMouseEnter={handleHover ? () => handleHover(nodeProps.payload.name) : undefined}
                  onMouseLeave={onHoverEnd}
                  onClick={handleClick ? () => handleClick(nodeProps.payload.name) : undefined}
                  cursor={handleHover || handleClick ? "pointer" : undefined}
                />
                {showLabels && (
                  <DraggableLabel
                    x={nodeProps.x + nodeProps.width / 2}
                    y={nodeProps.y - 6}
                    text={nodeProps.payload.name}
                    fontSize={nodeFontSize}
                    fontFamily={fontFamily}
                    fill="var(--text-primary)"
                    textAnchor="middle"
                    offsetKey={`node:${nodeProps.payload.name}`}
                    offsets={offsets}
                    onCommitOffset={onCommitOffset}
                    svgRef={svgRef}
                  />
                )}
              </g>
            );
          }}
          link={(linkProps: {
            sourceX: number;
            sourceY: number;
            targetX: number;
            targetY: number;
            sourceControlX: number;
            targetControlX: number;
            linkWidth: number;
            payload: { source: number; target: number; value: number };
          }) => {
            const midX = (linkProps.sourceX + linkProps.targetX) / 2;
            const midY = (linkProps.sourceY + linkProps.targetY) / 2;
            const sourceName = sankeyData.nodes[linkProps.payload.source]?.name;
            const targetName = sankeyData.nodes[linkProps.payload.target]?.name;
            const isDimmed = (selectedPrimary && sourceName !== selectedPrimary) || (selectedSecondary && targetName !== selectedSecondary);
            return (
              <g>
                <path
                  d={`M${linkProps.sourceX},${linkProps.sourceY} C${linkProps.sourceControlX},${linkProps.sourceY} ${linkProps.targetControlX},${linkProps.targetY} ${linkProps.targetX},${linkProps.targetY}`}
                  fill="none"
                  stroke={baseColor}
                  strokeOpacity={isDimmed ? 0.06 : 0.25}
                  strokeWidth={linkProps.linkWidth}
                />
                {showLabels && (
                  <DraggableLabel
                    x={midX}
                    y={midY}
                    text={linkProps.payload.value}
                    fontSize={Math.max(8, nodeFontSize - 1)}
                    fontFamily={fontFamily}
                    fill="var(--text-muted)"
                    textAnchor="middle"
                    offsetKey={`link:${linkProps.payload.source}-${linkProps.payload.target}`}
                    offsets={offsets}
                    onCommitOffset={onCommitOffset}
                    svgRef={svgRef}
                  />
                )}
              </g>
            );
          }}
        >
          <Tooltip contentStyle={TOOLTIP_STYLE} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}

/** Hand-rolled bipartite relationship diagram — primary values on the left,
 *  secondary values on the right, a curved link between them whenever they
 *  genuinely co-occurred, thickness scaled to how often. No graph/network
 *  library needed for this simplified two-column layout, which keeps this
 *  widget from adding any new dependency at all. */
function RelationshipNetwork({
  data,
  baseColor,
  showLabels,
  fontFamily,
  fontSize,
  offsets,
  onCommitOffset,
  selectedPrimary,
  selectedSecondary,
  onHoverStartPrimary,
  onHoverStartSecondary,
  onHoverEnd,
  onClickPrimary,
  onClickSecondary,
}: {
  data: CrosstabRow[];
  baseColor: string;
  showLabels?: boolean;
  fontFamily?: string;
  fontSize?: number;
  offsets?: Record<string, { dx: number; dy: number }>;
  onCommitOffset?: (key: string, dx: number, dy: number) => void;
  selectedPrimary?: string;
  selectedSecondary?: string;
  onHoverStartPrimary?: (value: string) => void;
  onHoverStartSecondary?: (value: string) => void;
  onHoverEnd?: () => void;
  onClickPrimary?: (value: string) => void;
  onClickSecondary?: (value: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  if (data.length === 0) {
    return <EmptyState message="No data for this pair of fields yet." />;
  }
  const primaries = Array.from(new Set(data.map((d) => d.primary_value)));
  const secondaries = Array.from(new Set(data.map((d) => d.secondary_value)));
  const maxCount = Math.max(1, ...data.map((d) => d.count));
  const nodeFontSize = fontSize ?? 10;

  const width = 480;
  const height = Math.max(160, Math.max(primaries.length, secondaries.length) * 26);
  const leftX = 90;
  const rightX = width - 90;
  const leftY = new Map(primaries.map((a, i) => [a, ((i + 1) * height) / (primaries.length + 1)]));
  const rightY = new Map(secondaries.map((t, i) => [t, ((i + 1) * height) / (secondaries.length + 1)]));

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <svg ref={svgRef} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {data.map((d, i) => {
          const y1 = leftY.get(d.primary_value)!;
          const y2 = rightY.get(d.secondary_value)!;
          const strokeWidth = 1 + (d.count / maxCount) * 5;
          const midX = width / 2;
          const midY = (y1 + y2) / 2;
          const linkKey = `${d.primary_value}→${d.secondary_value}`;
          const isDimmed = (selectedPrimary && d.primary_value !== selectedPrimary) || (selectedSecondary && d.secondary_value !== selectedSecondary);
          return (
            <g key={i}>
              <path
                d={`M ${leftX} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${rightX} ${y2}`}
                stroke={baseColor}
                strokeWidth={strokeWidth}
                fill="none"
                opacity={isDimmed ? 0.08 : 0.35}
              >
                <title>{`${d.primary_value} × ${d.secondary_value}: ${d.count}`}</title>
              </path>
              {showLabels && (
                <DraggableLabel
                  x={midX}
                  y={midY}
                  text={d.count}
                  fontSize={nodeFontSize - 1}
                  fontFamily={fontFamily}
                  fill="var(--text-muted)"
                  textAnchor="middle"
                  offsetKey={linkKey}
                  offsets={offsets}
                  onCommitOffset={onCommitOffset}
                  svgRef={svgRef}
                />
              )}
            </g>
          );
        })}
        {primaries.map((a) => (
          <g key={`a-${a}`}>
            <circle
              cx={leftX}
              cy={leftY.get(a)}
              r={selectedPrimary === a ? 6 : 4}
              fill={baseColor}
              fillOpacity={selectedPrimary && selectedPrimary !== a ? 0.3 : 1}
              stroke={selectedPrimary === a ? "var(--text-primary)" : "none"}
              strokeWidth={1.5}
              onMouseEnter={onHoverStartPrimary ? () => onHoverStartPrimary(a) : undefined}
              onMouseLeave={onHoverEnd}
              onClick={onClickPrimary ? () => onClickPrimary(a) : undefined}
              cursor={onHoverStartPrimary || onClickPrimary ? "pointer" : undefined}
            />
            <DraggableLabel
              x={leftX - 8}
              y={leftY.get(a)!}
              text={a}
              fontSize={nodeFontSize}
              fontFamily={fontFamily}
              fill="var(--text-primary)"
              textAnchor="end"
              dominantBaseline="middle"
              offsetKey={`node:${a}`}
              offsets={offsets}
              onCommitOffset={onCommitOffset}
              svgRef={svgRef}
            />
          </g>
        ))}
        {secondaries.map((t) => (
          <g key={`t-${t}`}>
            <circle
              cx={rightX}
              cy={rightY.get(t)}
              r={selectedSecondary === t ? 6 : 4}
              fill={baseColor}
              fillOpacity={selectedSecondary && selectedSecondary !== t ? 0.3 : 1}
              stroke={selectedSecondary === t ? "var(--text-primary)" : "none"}
              strokeWidth={1.5}
              onMouseEnter={onHoverStartSecondary ? () => onHoverStartSecondary(t) : undefined}
              onMouseLeave={onHoverEnd}
              onClick={onClickSecondary ? () => onClickSecondary(t) : undefined}
              cursor={onHoverStartSecondary || onClickSecondary ? "pointer" : undefined}
            />
            <DraggableLabel
              x={rightX + 8}
              y={rightY.get(t)!}
              text={t}
              fontSize={nodeFontSize}
              fontFamily={fontFamily}
              fill="var(--text-primary)"
              textAnchor="start"
              dominantBaseline="middle"
              offsetKey={`node:${t}`}
              offsets={offsets}
              onCommitOffset={onCommitOffset}
              svgRef={svgRef}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Circle-packing layout via d3-hierarchy — each category becomes a circle
 *  sized by its count, packed together with no wasted space. */
function BubbleChart({
  series,
  colors,
  showLabels,
  fontFamily,
  fontSize,
  offsets,
  onCommitOffset,
  selectedValue,
  onHoverStart,
  onHoverEnd,
  onClick,
}: {
  series: { value: string; count: number }[];
  colors: string[];
  showLabels?: boolean;
  fontFamily?: string;
  fontSize?: number;
  offsets?: Record<string, { dx: number; dy: number }>;
  onCommitOffset?: (key: string, dx: number, dy: number) => void;
  selectedValue?: string;
  onHoverStart?: (value: string) => void;
  onHoverEnd?: () => void;
  onClick?: (value: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
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
      <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {leaves.map((leaf, i) => {
          const datum = leaf.data as unknown as { value: string; count: number };
          const baseFontSize = fontSize ?? Math.min(11, leaf.r / 3);
          const isSelected = selectedValue === datum.value;
          const isFiltered = selectedValue !== undefined;
          return (
            <g key={i}>
              <circle
                cx={leaf.x}
                cy={leaf.y}
                r={leaf.r}
                fill={colors[i % colors.length]}
                fillOpacity={isFiltered && !isSelected ? 0.35 : 0.85}
                stroke={isSelected ? "var(--text-primary)" : "none"}
                strokeWidth={2}
                onMouseEnter={onHoverStart ? () => onHoverStart(datum.value) : undefined}
                onMouseLeave={onHoverEnd}
                onClick={onClick ? () => onClick(datum.value) : undefined}
                cursor={onHoverStart || onClick ? "pointer" : undefined}
              >
                <title>{`${datum.value}: ${datum.count}`}</title>
              </circle>
              {leaf.r > 18 && !showLabels && (
                <text x={leaf.x} y={leaf.y} textAnchor="middle" dy="0.35em" fontSize={baseFontSize} fontFamily={fontFamily} fill="#fff" pointerEvents="none">
                  {datum.count}
                </text>
              )}
              {leaf.r > 18 && showLabels && (
                <>
                  <DraggableLabel
                    x={leaf.x}
                    y={leaf.y - baseFontSize * 0.6}
                    text={datum.value}
                    fontSize={baseFontSize}
                    fontFamily={fontFamily}
                    fill="#fff"
                    textAnchor="middle"
                    offsetKey={`${datum.value}:name`}
                    offsets={offsets}
                    onCommitOffset={onCommitOffset}
                    svgRef={svgRef}
                  />
                  <DraggableLabel
                    x={leaf.x}
                    y={leaf.y + baseFontSize * 0.9}
                    text={datum.count}
                    fontSize={baseFontSize}
                    fontFamily={fontFamily}
                    fill="#fff"
                    textAnchor="middle"
                    offsetKey={`${datum.value}:count`}
                    offsets={offsets}
                    onCommitOffset={onCommitOffset}
                    svgRef={svgRef}
                  />
                </>
              )}
            </g>
          );
        })}
      </svg>
    </ResponsiveContainer>
  );
}

/** Repeatable-row form for typing in per-country values directly — the
 *  "delink from the database, fill in what I want" path. Free-text country
 *  names (matched case-insensitively against the world map at render time,
 *  same tolerance as everywhere else country names get matched), a numeric
 *  value driving shading intensity, and an optional specific color that
 *  overrides intensity-based shading for that one country. */
function ManualCountryDataEditor({
  rows,
  onChange,
}: {
  rows: { country: string; value: number; color?: string }[];
  onChange: (rows: { country: string; value: number; color?: string }[]) => void;
}) {
  function update(idx: number, patch: Partial<{ country: string; value: number; color?: string }>) {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function remove(idx: number) {
    onChange(rows.filter((_, i) => i !== idx));
  }
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>COUNTRIES</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((row, idx) => (
          <div key={idx} style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              value={row.country}
              onChange={(e) => update(idx, { country: e.target.value })}
              placeholder="Country name"
              list="known-country-names"
              style={{ ...selectStyle, flex: 1.4, minWidth: 0 }}
            />
            <input
              type="number"
              value={Number.isFinite(row.value) ? row.value : ""}
              onChange={(e) => update(idx, { value: e.target.value ? Number(e.target.value) : 0 })}
              placeholder="Value"
              style={{ ...selectStyle, width: 64 }}
            />
            <input
              type="color"
              value={row.color ?? "#0d9488"}
              onChange={(e) => update(idx, { color: e.target.value })}
              title="Specific color for this country (optional — overrides intensity shading)"
              style={{ width: 22, height: 22, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", flexShrink: 0 }}
            />
            <button onClick={() => remove(idx)} title="Remove" style={miniBtnStyle}>
              ×
            </button>
          </div>
        ))}
        <datalist id="known-country-names">
          {KNOWN_COUNTRY_NAMES.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button
          onClick={() => onChange([...rows, { country: "", value: 1 }])}
          style={{ ...miniBtnStyle, width: "auto", padding: "3px 8px", color: "var(--signal)" }}
        >
          + Add country
        </button>
      </div>
    </div>
  );
}

/** Repeatable-row form for free-standing text labels — checkpoints, ports,
 *  chokepoints, anything worth naming directly on the map, independent of
 *  country shading and routes. */
function ManualLabelsEditor({
  labels,
  onChange,
}: {
  labels: { location: string; text: string; color?: string }[];
  onChange: (labels: { location: string; text: string; color?: string }[]) => void;
}) {
  function update(idx: number, patch: Partial<{ location: string; text: string; color?: string }>) {
    onChange(labels.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function remove(idx: number) {
    onChange(labels.filter((_, i) => i !== idx));
  }
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>LABELS (CHECKPOINTS, PORTS, ETC.)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {labels.map((label, idx) => (
          <div key={idx} style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              value={label.location}
              onChange={(e) => update(idx, { location: e.target.value })}
              placeholder="Country or lat,lng"
              list="known-country-names"
              style={{ ...selectStyle, flex: 1, minWidth: 0 }}
            />
            <input
              value={label.text}
              onChange={(e) => update(idx, { text: e.target.value })}
              placeholder="Label text, e.g. Port of Mombasa"
              style={{ ...selectStyle, flex: 1.4, minWidth: 0 }}
            />
            <input
              type="color"
              value={label.color ?? "#0d9488"}
              onChange={(e) => update(idx, { color: e.target.value })}
              title="Label color"
              style={{ width: 22, height: 22, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", flexShrink: 0 }}
            />
            <button onClick={() => remove(idx)} title="Remove" style={miniBtnStyle}>
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => onChange([...labels, { location: "", text: "" }])}
          style={{ ...miniBtnStyle, width: "auto", padding: "3px 8px", color: "var(--signal)" }}
        >
          + Add label
        </button>
      </div>
    </div>
  );
}

/** Repeatable-row form for arcs between two named locations — a country name
 *  (matched the same way as country shading) or a precise "lat,lng" for a
 *  spot no country polygon covers, like open water on a shipping route.
 *  Globe-only: a flat choropleth has no arc rendering. */
type ManualRoute = { waypoints: string[]; label?: string; color?: string; vehicle?: "plane" | "commercial-ship" | "warship" | "drone" | "none"; strokeWidth?: number };

const VEHICLE_OPTIONS: { value: NonNullable<ManualRoute["vehicle"]>; label: string }[] = [
  { value: "none", label: "None — line only" },
  { value: "plane", label: "✈ Plane" },
  { value: "commercial-ship", label: "🚢 Commercial ship" },
  { value: "warship", label: "⚓ Warship" },
  { value: "drone", label: "🛸 Drone" },
];

function ManualRoutesEditor({ routes, onChange }: { routes: ManualRoute[]; onChange: (routes: ManualRoute[]) => void }) {
  const [drawingRouteIdx, setDrawingRouteIdx] = useState<number | null>(null);

  function updateRoute(idx: number, patch: Partial<ManualRoute>) {
    onChange(routes.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function removeRoute(idx: number) {
    onChange(routes.filter((_, i) => i !== idx));
    if (drawingRouteIdx === idx) setDrawingRouteIdx(null);
  }
  function updateWaypoint(routeIdx: number, wpIdx: number, value: string) {
    const route = routes[routeIdx];
    const waypoints = route.waypoints.map((w, i) => (i === wpIdx ? value : w));
    updateRoute(routeIdx, { waypoints });
  }
  function addWaypoint(routeIdx: number) {
    updateRoute(routeIdx, { waypoints: [...routes[routeIdx].waypoints, ""] });
  }
  function removeWaypoint(routeIdx: number, wpIdx: number) {
    const route = routes[routeIdx];
    if (route.waypoints.length <= 2) return; // a path needs at least 2 points
    updateRoute(routeIdx, { waypoints: route.waypoints.filter((_, i) => i !== wpIdx) });
  }

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>ROUTES (BENDABLE PATHS)</div>
      <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 6 }}>
        Country name or a precise "lat,lng" (e.g. for open water) per waypoint — add more waypoints to bend a route through the sea rather than a straight line between two countries.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {routes.map((route, routeIdx) => (
          <div key={routeIdx} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 5 }}>
            {route.waypoints.map((wp, wpIdx) => (
              <div key={wpIdx} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: 9.5, color: "var(--text-faint)", width: 14, flexShrink: 0 }}>{wpIdx + 1}</span>
                <input
                  value={wp}
                  onChange={(e) => updateWaypoint(routeIdx, wpIdx, e.target.value)}
                  placeholder={wpIdx === 0 ? "Start" : wpIdx === route.waypoints.length - 1 ? "End" : "Bend through…"}
                  list="known-country-names"
                  style={{ ...selectStyle, flex: 1, minWidth: 0 }}
                />
                {route.waypoints.length > 2 && (
                  <button onClick={() => removeWaypoint(routeIdx, wpIdx)} title="Remove this waypoint" style={miniBtnStyle}>
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => addWaypoint(routeIdx)}
              style={{ ...miniBtnStyle, width: "auto", padding: "2px 7px", fontSize: 10, color: "var(--signal)", alignSelf: "flex-start" }}
            >
              + Bend through another point
            </button>
            <button
              onClick={() => setDrawingRouteIdx((cur) => (cur === routeIdx ? null : routeIdx))}
              style={{
                ...miniBtnStyle,
                width: "auto",
                padding: "2px 7px",
                fontSize: 10,
                alignSelf: "flex-start",
                ...(drawingRouteIdx === routeIdx ? { background: "var(--signal-dim)", borderColor: "var(--signal)", color: "var(--signal)" } : {}),
              }}
            >
              🌐 {drawingRouteIdx === routeIdx ? "Close globe editor" : "Draw / adjust on globe"}
            </button>
            {drawingRouteIdx === routeIdx && (
              <Suspense fallback={<div style={{ fontSize: 11, color: "var(--text-faint)", padding: 8 }}>Loading globe…</div>}>
                <RouteDrawingGlobe waypoints={route.waypoints} color={route.color ?? "#0d9488"} onChange={(waypoints) => updateRoute(routeIdx, { waypoints })} />
              </Suspense>
            )}

            <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 2, flexWrap: "wrap" }}>
              <select value={route.vehicle ?? "none"} onChange={(e) => updateRoute(routeIdx, { vehicle: e.target.value as ManualRoute["vehicle"] })} style={{ ...selectStyle, flex: 1, minWidth: 110 }}>
                {VEHICLE_OPTIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
              <input
                value={route.label ?? ""}
                onChange={(e) => updateRoute(routeIdx, { label: e.target.value || undefined })}
                placeholder="Label (optional)"
                style={{ ...selectStyle, flex: 1, minWidth: 80 }}
              />
              <input
                type="number"
                min={0.5}
                max={10}
                step={0.5}
                value={route.strokeWidth ?? 2.2}
                onChange={(e) => updateRoute(routeIdx, { strokeWidth: e.target.value ? Number(e.target.value) : undefined })}
                title="Line thickness"
                style={{ ...selectStyle, width: 48 }}
              />
              <input
                type="color"
                value={route.color ?? "#0d9488"}
                onChange={(e) => updateRoute(routeIdx, { color: e.target.value })}
                title="Line and icon color"
                style={{ width: 22, height: 22, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", flexShrink: 0 }}
              />
              <button onClick={() => removeRoute(routeIdx)} title="Remove this route" style={{ ...miniBtnStyle, color: "var(--critical)" }}>
                × Route
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={() => onChange([...routes, { waypoints: ["", ""], vehicle: "none" }])}
          style={{ ...miniBtnStyle, width: "auto", padding: "3px 8px", color: "var(--signal)" }}
        >
          + Add route
        </button>
      </div>
    </div>
  );
}

/** The exact country names this app's world topology (world-atlas
 *  countries-110m) actually uses — extracted directly from that file, not
 *  hand-typed, since Natural Earth's naming has real quirks ("Côte
 *  d'Ivoire" not "Ivory Coast", "S. Sudan" not "South Sudan", "Macedonia"
 *  not "North Macedonia") that a guessed list would silently get wrong,
 *  defeating the point of an autocomplete meant to guarantee a match. */
const KNOWN_COUNTRY_NAMES = [
  "Afghanistan", "Albania", "Algeria", "Angola", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan",
  "Bahamas", "Bangladesh", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herz.",
  "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Canada",
  "Central African Rep.", "Chad", "Chile", "China", "Colombia", "Congo", "Costa Rica", "Croatia", "Cuba",
  "Cyprus", "Czechia", "Côte d'Ivoire", "Dem. Rep. Congo", "Denmark", "Djibouti", "Dominican Rep.", "Ecuador",
  "Egypt", "El Salvador", "Eq. Guinea", "Eritrea", "Estonia", "Ethiopia", "Fiji", "Finland", "France", "Gabon",
  "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti",
  "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
  "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia",
  "Lebanon", "Lesotho", "Liberia", "Libya", "Lithuania", "Luxembourg", "Macedonia", "Madagascar", "Malawi",
  "Malaysia", "Mali", "Mauritania", "Mexico", "Moldova", "Mongolia", "Montenegro", "Morocco", "Mozambique",
  "Myanmar", "Namibia", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea",
  "Norway", "Oman", "Pakistan", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines",
  "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "S. Sudan", "Saudi Arabia", "Senegal", "Serbia",
  "Sierra Leone", "Slovakia", "Slovenia", "Solomon Is.", "Somalia", "Somaliland", "South Africa", "South Korea",
  "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan",
  "Tanzania", "Thailand", "Timor-Leste", "Togo", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States of America", "Uruguay",
  "Uzbekistan", "Vanuatu", "Venezuela", "Vietnam", "W. Sahara", "Yemen", "Zambia", "Zimbabwe", "eSwatini",
];

/** Reads the map's live center/zoom directly from Leaflet (via useMap,
 *  which only works as a descendant of MapContainer) and persists it onto
 *  the widget — so the next person to load this dashboard, or view it on a
 *  public share link, sees the same framing instead of the default world
 *  view they'd have to zoom in from manually. */
function MapViewLockButton({
  locked,
  onLock,
  onUnlock,
}: {
  locked: boolean;
  onLock: (view: { lat: number; lng: number; zoom: number }) => void;
  onUnlock: () => void;
}) {
  const map = useMap();
  return (
    <button
      onClick={() => {
        if (locked) {
          onUnlock();
        } else {
          const center = map.getCenter();
          onLock({ lat: center.lat, lng: center.lng, zoom: map.getZoom() });
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title={locked ? "Unlock — allow the view to reset to default" : "Lock the current pan/zoom position for everyone who opens this"}
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        zIndex: 1000,
        width: 24,
        height: 24,
        lineHeight: "22px",
        padding: 0,
        fontSize: 12,
        borderRadius: 4,
        border: "1px solid rgba(255,255,255,0.3)",
        background: locked ? "rgba(13,148,136,0.85)" : "rgba(0,0,0,0.45)",
        color: "#fff",
        cursor: "pointer",
      }}
    >
      {locked ? "🔒" : "🔓"}
    </button>
  );
}

/** Markers vs. heatmap density — the same choice already available on the
 *  standalone incidents map, now available per dashboard widget too. */
function MapModeToggle({ mode, onChange }: { mode: "markers" | "heatmap"; onChange: (mode: "markers" | "heatmap") => void }) {
  return (
    <button
      onClick={() => onChange(mode === "markers" ? "heatmap" : "markers")}
      onMouseDown={(e) => e.stopPropagation()}
      title={mode === "markers" ? "Switch to heatmap density view" : "Switch to individual incident markers"}
      style={{
        position: "absolute",
        top: 34,
        right: 6,
        zIndex: 1000,
        padding: "3px 7px",
        fontSize: 10.5,
        borderRadius: 4,
        border: "1px solid rgba(255,255,255,0.3)",
        background: "rgba(0,0,0,0.45)",
        color: "#fff",
        cursor: "pointer",
      }}
    >
      {mode === "markers" ? "🔥 Heatmap" : "📍 Markers"}
    </button>
  );
}

/** A text label that can be dragged to a custom offset when onCommitOffset
 *  is provided (i.e. the dashboard is editable — never on the read-only
 *  public view). Tracks the drag with plain window mouse listeners rather
 *  than a drag library, since this only needs to work within one SVG's own
 *  coordinate space, not general-purpose drag-and-drop.
 *
 *  The coordinate conversion matters here: these SVGs scale responsively
 *  (viewBox + percentage width/height), so a mouse movement measured in
 *  screen pixels isn't the same distance in the SVG's own coordinate units
 *  unless the chart happens to be rendered at exactly 1:1 — the ratio
 *  between the SVG's actual rendered size (getBoundingClientRect) and its
 *  viewBox size gives the right scale factor.
 *
 *  Only commits the final position on mouseup, not on every mousemove — a
 *  live local offset drives the visual feedback during the drag itself,
 *  so dragging doesn't trigger a save-worthy state update dozens of times
 *  per second. */
function DraggableLabel({
  x,
  y,
  text,
  fontSize,
  fontFamily,
  fill,
  textAnchor,
  dominantBaseline,
  offsetKey,
  offsets,
  onCommitOffset,
  svgRef,
}: {
  x: number;
  y: number;
  text: string | number;
  fontSize: number;
  fontFamily?: string;
  fill: string;
  textAnchor: "start" | "middle" | "end";
  dominantBaseline?: "middle" | "auto" | "hanging";
  offsetKey: string;
  offsets?: Record<string, { dx: number; dy: number }>;
  onCommitOffset?: (key: string, dx: number, dy: number) => void;
  svgRef: React.RefObject<SVGSVGElement>;
}) {
  const savedOffset = offsets?.[offsetKey] ?? { dx: 0, dy: 0 };
  const [liveOffset, setLiveOffset] = useState<{ dx: number; dy: number } | null>(null);
  const displayOffset = liveOffset ?? savedOffset;

  function handleMouseDown(e: React.MouseEvent) {
    if (!onCommitOffset) return;
    const commitOffset = onCommitOffset;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startDx = savedOffset.dx;
    const startDy = savedOffset.dy;

    function scaleFactors(): { scaleX: number; scaleY: number } | null {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      if (rect.width === 0 || rect.height === 0) return null;
      // Some SVGs (this file's own hand-rolled ones) use a fixed viewBox
      // stretched via CSS to fill their container responsively, where the
      // ratio between viewBox size and actual rendered size is exactly the
      // scale factor needed. Others (recharts' own Sankey, notably) render
      // with no viewBox at all and instead re-render at exact pixel
      // dimensions whenever their container resizes — direct 1:1 pixel
      // coordinates, no CSS scaling layer to account for. Detecting which
      // case this is by checking whether a viewBox was actually set, rather
      // than assuming one convention everywhere, is what makes this one
      // component correctly support both instead of silently computing a
      // zero scale factor (and therefore a label that visually never moves)
      // in whichever case wasn't originally anticipated.
      const hasViewBox = viewBox.width > 0 && viewBox.height > 0;
      return {
        scaleX: hasViewBox ? viewBox.width / rect.width : 1,
        scaleY: hasViewBox ? viewBox.height / rect.height : 1,
      };
    }

    function handleMove(ev: MouseEvent) {
      const scale = scaleFactors();
      if (!scale) return;
      setLiveOffset({
        dx: startDx + (ev.clientX - startX) * scale.scaleX,
        dy: startDy + (ev.clientY - startY) * scale.scaleY,
      });
    }
    function handleUp(ev: MouseEvent) {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      const scale = scaleFactors();
      setLiveOffset(null);
      if (!scale) return;
      commitOffset(offsetKey, startDx + (ev.clientX - startX) * scale.scaleX, startDy + (ev.clientY - startY) * scale.scaleY);
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  return (
    <text
      x={x + displayOffset.dx}
      y={y + displayOffset.dy}
      textAnchor={textAnchor}
      dominantBaseline={dominantBaseline}
      fontSize={fontSize}
      fontFamily={fontFamily}
      fill={fill}
      onMouseDown={handleMouseDown}
      style={{ cursor: onCommitOffset ? "grab" : undefined, userSelect: "none" }}
    >
      {text}
    </text>
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
