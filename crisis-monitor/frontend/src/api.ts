import type { LabelType } from "./components/labelTypes";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000";

const TOKEN_STORAGE_KEY = "sentinel_token";

let authToken: string | null = localStorage.getItem(TOKEN_STORAGE_KEY);

export function setToken(token: string | null) {
  authToken = token;
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getToken(): string | null {
  return authToken;
}

export type UserRole = "admin" | "client";

export interface AuthUser {
  id: string;
  username: string;
  display_name: string | null;
  role: UserRole;
  /** Which client organization this login belongs to — null for the
   *  platform admin and any standalone login not part of a client org. */
  client_id: string | null;
  /** Whether this login can manage its own client's other logins. */
  is_client_admin: boolean;
  /** This login's client organization's logo, if any and if set — a base64
   *  data URL, ready to use directly as an <img src>. */
  client_logo: string | null;
  created_at?: string;
}

export interface MapDefaultSettings {
  /** Whether incident markers/heatmap show at all when Mapping first opens
   *  — the platform-wide default everyone (admin and every client alike)
   *  starts with, admin-configurable. Not a per-user preference. */
  show_incidents_by_default: boolean;
  default_view_mode: "markers" | "heatmap";
  default_basemap: string;
  /** Date range plus any of the 15 categorical fields (sector, country,
   *  etc.), pre-applied when Mapping first opens. Keys match PivotableField
   *  names, plus "from"/"to" for the date range. */
  default_filters: Record<string, string>;
  /** The starting camera position — null means no fixed position is set,
   *  falling back to the map's natural auto-centering on the data instead. */
  map_center_lat: number | null;
  map_center_lng: number | null;
  map_zoom: number | null;
  /** Whether the saved position above is actually the one being applied —
   *  kept separate from the lat/lng/zoom themselves so an admin can capture
   *  a position without immediately forcing it on everyone. */
  position_locked: boolean;
  updated_at: string | null;
}

export interface AccessRequest {
  id: string;
  name: string;
  email: string;
  organization: string | null;
  reason: string | null;
  status: "pending" | "approved" | "denied";
  created_at: string;
  reviewed_at: string | null;
}

export interface ClientOrg {
  id: string;
  name: string;
  max_accounts: number;
  /** Whether this client's accounts can see the full shared incidents pool,
   *  not just what they've personally uploaded — read-only visibility. */
  can_view_all_incidents: boolean;
  /** This client's logo, if set — a base64 data URL. Only present on the
   *  single-client GET/PATCH responses, not the platform-admin list (kept
   *  off that one to avoid bloating a list of many clients with full image
   *  data none of them are being displayed for in that view). */
  logo_data?: string | null;
  account_count: number;
  created_at: string;
}

export interface ClientSharedItem {
  dashboard_id?: string;
  dataset_id?: string;
  name: string;
  created_at: string;
}

export interface EventItem {
  id: string;
  source_type: "social" | "news" | "darkweb" | "forum";
  author: string | null;
  content: string;
  url: string | null;
  sentiment: number | null;
  published_at: string;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_label: string | null;
  matched_query_ids?: string[];
}

export interface AlertItem {
  id: string;
  query_id: string | null;
  query_name?: string;
  category?: string;
  level: "info" | "elevated" | "critical";
  title: string;
  description: string;
  geo_label: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  /** Escalation-incident alerts carry the criteria that were met (see the
   *  backend's escalationIncidents.ts); other alerts carry their own metrics. */
  metric_snapshot?: {
    incidentId?: string;
    criteriaMet?: string[];
    indicators?: string[];
    sourceCount?: number;
    geoPrecision?: string;
    /** "surge" for a coverage surge on a monitoring query (backend: queryWatch.ts). */
    kind?: string;
    major?: boolean;
    last24h?: number;
    usual?: number;
    threshold?: number;
    basisDays?: number;
    headlines?: { title: string; url: string | null; source: string | null; published_at: string }[];
  } & Record<string, unknown>;
}

/** One monitoring-query match located for the Live OSINT map — placed from
 *  the places its own headline/text names, never from where its publisher
 *  is based (see the backend's /api/events/located). */
export interface LocatedMonitoringEvent {
  id: string;
  source_type: string;
  title: string | null;
  snippet: string;
  url: string | null;
  sentiment: number | null;
  published_at: string;
  lat: number;
  lon: number;
  /** "Mekelle, Ethiopia" / "Tigray, Ethiopia" / "Ethiopia". */
  place: string;
  precision: "place" | "region" | "country";
}

export interface LocatedMonitoringResult {
  queryId: string;
  hours: number;
  /** Every match in the window. */
  total: number;
  /** Matches whose text names a place, and so appear on the map. */
  located: number;
  events: LocatedMonitoringEvent[];
  fetchedAt: string;
}

export interface MonitoringQueryItem {
  id: string;
  name: string;
  boolean_query: string;
  category: string;
  is_active: boolean;
  baseline_window_minutes: number;
  elevated_threshold: number;
  critical_threshold: number;
  owner_id: string | null;
  created_at: string;
  /** Matches in the last 2h — included by the queries list endpoint for the query list UI. */
  match_count?: number;
}

export interface PreviewMatch {
  id: string;
  source_type: string;
  title: string | null;
  content: string;
  url: string | null;
  published_at: string;
  geo_label: string | null;
}

/** One article from the live news search in the query editor's preview. */
export interface LivePreviewArticle {
  title: string;
  url: string;
  domain: string | null;
  published_at: string;
  /** Where the headline says the story is, when it names a place. */
  place: string | null;
  /** "feeds" — the news feeds the platform crawls itself; "search" — the wider news search. */
  source?: "feeds" | "search";
}

/** What the query being typed will fetch once saved: matches in the
 *  platform's own news feeds plus a wider news search. */
export interface LivePreview {
  /** "busy" / "error": nothing in the feeds and the wider search was unavailable. */
  status: "ok" | "unsearchable" | "busy" | "error";
  /** The wider search actually sent, so it is visible how the query was read. */
  search: string | null;
  /** False when the query has parts a news search cannot express (NOT,
   *  NEAR, field filters, wildcards); the platform applies those itself. */
  exact: boolean;
  articles: LivePreviewArticle[];
  message: string | null;
  /** Shown above the list when it is partial (e.g. the wider search was rate-limited). */
  notice?: string | null;
}

export interface PreviewResult {
  matches: PreviewMatch[];
  scanned: number;
  lookback_hours: number;
  truncated: boolean;
  /** Set when the scan of already-held articles failed. */
  stored_error?: string | null;
  /** Present only when the request asked for the live search. */
  live?: LivePreview | null;
}
export type StagingStatus = "pending" | "approved" | "rejected" | "pushed";
export interface StagingBatch { batch_date: string; pending: number; approved: number; rejected: number; pushed: number; total: number }
export interface StagedIncident {
  id: string; batch_date: string; status: StagingStatus; row: IncidentRow;
  source_url: string | null; source_title: string | null; source_domain: string | null;
  confidence: string | null; geo_precision: string | null; quote: string | null;
}

export interface IncidentRow {
  date?: string | null;
  time?: string | null;
  country?: string | null;
  province?: string | null;
  county?: string | null;
  district?: string | null;
  city?: string | null;
  suburb?: string | null;
  precise_location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  sector?: string | null;
  actor?: string | null;
  operation?: string | null;
  tactic?: string | null;
  severity?: string | null;
  details?: string | null;
  target?: string | null;
  interest_group?: string | null;
  actual_main_victim?: string | null;
  intended_primary_target?: string | null;
  civilian_death_child?: number | null;
  civilian_death_female?: number | null;
  civilian_death_male?: number | null;
  civilian_death_unknown?: number | null;
  civilian_injury_female?: number | null;
  civilian_injury_male?: number | null;
  civilian_injury_unknown?: number | null;
  kidnappings_ngo?: number | null;
  raw?: Record<string, unknown>;
}

export interface IncidentItem extends Omit<IncidentRow, "date" | "time" | "raw"> {
  id: string;
  owner_id: string | null;
  occurred_date: string | null;
  occurred_time: string | null;
  occurred_at: string | null;
  upload_batch_id: string | null;
  created_at: string;
  raw_row: Record<string, unknown>;
}

export interface SavedUpload {
  id: string;
  owner_id: string | null;
  label: string;
  row_count: number;
  created_at: string;
}

export interface IncidentFilters {
  country: string[];
  province: string[];
  sector: string[];
  actor: string[];
  tactic: string[];
  severity: string[];
  county: string[];
  district: string[];
  city: string[];
  suburb: string[];
  operation: string[];
  target: string[];
  interest_group: string[];
  actual_main_victim: string[];
  intended_primary_target: string[];
}

export interface IncidentStats {
  total: number;
  by_sector: { value: string; count: number }[];
  by_actor: { value: string; count: number }[];
  by_tactic: { value: string; count: number }[];
  by_severity: { value: string; count: number }[];
  by_province: { value: string; count: number }[];
  by_country: { value: string; count: number }[];
  time_series: { bucket: string; count: number }[];
  /** Day-level counts, bounded to roughly the last 13 months — for a
   *  calendar heatmap, which a monthly time_series can't drive. */
  daily: { date: string; count: number }[];
  /** Genuine joint counts of (actor, tactic) pairs actually co-occurring in
   *  the same incident — not independent marginals like the by_X fields
   *  above. Powers Sankey/network widgets with real relationships. */
  actor_tactic: { actor: string; tactic: string; count: number }[];
  casualties: Record<string, number>;
}

export interface ShapeStyle {
  color?: string;
  fillColor?: string;
  fillOpacity?: number;
  weight?: number;
  dashArray?: string | null;
  strokeOpacity?: number;
  /** Fill pattern key (see studio/patterns.ts); "solid" or unset is a plain fill. */
  pattern?: string;
  patternColor?: string;
  patternSize?: number;
  patternWeight?: number;
  /** Icon marker (see studio/icons.ts). */
  icon?: string;
  iconColor?: string;
  iconSize?: number;
  label?: string;
  labelOn?: boolean;
  notes?: string;
}

export type ShapeSource = "drawn" | "shapefile" | "geojson" | "kml" | "gpx" | "csv" | "wkt" | "topojson" | "icon";

export interface SavedShape {
  id: string;
  owner_id: string | null;
  name: string;
  source: ShapeSource;
  geometry: GeoJSON.Feature | GeoJSON.FeatureCollection;
  style: ShapeStyle;
  /** Persisted per-shape, per-owner — whether this shape shows on the map
   *  by default. Sticks across sessions instead of always resetting to on. */
  visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface SavedRoute {
  id: string;
  owner_id: string | null;
  name: string;
  mode: "road" | "freehand";
  waypoints: [number, number][];
  geometry: [number, number][];
  distance_km: number | null;
  duration_min: number | null;
  color: string | null;
  /** Persisted per-route, per-owner — whether this route shows on the map
   *  by default. Sticks across sessions instead of always resetting to on. */
  visible: boolean;
  created_at: string;
  updated_at: string;
}

export type WidgetType =
  | "stat"
  | "bar"
  | "line"
  | "pie"
  | "map"
  | "radar"
  | "funnel"
  | "choropleth"
  | "calendar"
  | "sankey"
  | "network"
  | "bubble"
  | "globe"
  | "heatmap_table"
  | "bullet"
  // A visual built on the any-data engine (components/viz): its definition
  // lives in the widget's `viz` field, not in dataField/datasetId.
  | "viz";

/** Bar/line charts only — one of the pivotable columns the /crosstab
 *  endpoint accepts, matching the backend's PIVOTABLE_FIELDS allowlist
 *  exactly. `details` is deliberately excluded — long free text, not a
 *  usable category. */
export type PivotableField =
  | "sector"
  | "actor"
  | "tactic"
  | "province"
  | "country"
  | "severity"
  | "county"
  | "district"
  | "city"
  | "suburb"
  | "operation"
  | "target"
  | "interest_group"
  | "actual_main_victim"
  | "intended_primary_target";

export interface CrosstabRow {
  primary_value: string;
  secondary_value: string;
  count: number;
}
export type WidgetDataField =
  | "total"
  | "by_sector"
  | "by_actor"
  | "by_tactic"
  | "by_province"
  | "by_country"
  | "by_severity"
  | "time_series"
  | "deaths"
  | "injuries"
  | "kidnappings_ngo"
  // Fetched on demand via /api/incidents/breakdown rather than precomputed
  // on /stats, unlike the five classic by_X fields above.
  | "by_county"
  | "by_district"
  | "by_city"
  | "by_suburb"
  | "by_operation"
  | "by_target"
  | "by_interest_group"
  | "by_actual_main_victim"
  | "by_intended_primary_target";

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  title: string;
  /** Short caption shown under the title — separate from the title itself,
   *  for context like a source note or a description of what's shown. */
  label?: string;
  /** One of WidgetDataField's fixed values for incidents-sourced widgets, or
   *  an arbitrary column name from that dataset's own schema when
   *  datasetId is set — every dataset defines its own columns, so this
   *  can't stay a fixed union once datasets are in play. */
  dataField?: WidgetDataField | string;
  /** Initial size when the widget is first added — after that, the real size
   *  comes from `layout` (drag-resized), this just seeds a sensible starting box. */
  size: "small" | "medium" | "large";
  /** Show the actual value on each bar/slice, not just on hover. */
  showDataLabels?: boolean;
  /** Overrides the default teal series color — used by stat/line/map, and as
   *  the bar-chart series color when no palette is set. */
  color?: string;
  /** Bar/pie only — a full custom color per category, in order, cycling if
   *  there are more categories than colors. Any length; not limited to a
   *  fixed preset. Takes priority over `color` for these two chart types. */
  palette?: string[];
  showLegend?: boolean;
  /** Bar/pie only — truncates to the top N categories by count. */
  topN?: number;
  /** Real drag/resize position, in react-grid-layout's 12-column grid units.
   *  Missing until the widget has been placed at least once. */
  layout?: { x: number; y: number; w: number; h: number };
  /** Locked independently of the dashboard-level lock — hides this widget's
   *  own edit/remove controls and disables its drag/resize even while other
   *  widgets on the same dashboard stay editable. */
  locked?: boolean;
  /** Stat cards only — shows a small monthly trend line beneath the number. */
  showSparkline?: boolean;
  /** Font styling for whichever text labels this widget type renders — bar
   *  value labels, pie slice labels, funnel stage labels, choropleth region
   *  names, bubble category names, network node/link labels. Sankey's node
   *  labels are recharts' own internal rendering and aren't covered by this —
   *  that component doesn't expose the same level of control the others do. */
  labelFontFamily?: string;
  labelFontSize?: number;
  labelBold?: boolean;
  /** Manually-dragged label positions, keyed by the label's own text (a
   *  category name, a node name) since that's stable across re-renders and
   *  re-fetches in a way an array index isn't. Only meaningful for bubble
   *  and network charts currently — the ones with hand-rolled SVG rendering
   *  where an arbitrary per-label offset is actually straightforward to
   *  apply; bar/pie/funnel/choropleth's labels are positioned by recharts
   *  or the projection library respectively, not free-form. */
  labelOffsets?: Record<string, { dx: number; dy: number }>;
  /** Bullet chart only — the actual value comes from dataField (same
   *  total/deaths/injuries/kidnappings_ngo or dataset-sum mechanism as a
   *  stat widget), but the warning/critical/target markers are judgment
   *  calls an analyst sets, not anything derivable from the data itself. */
  bulletWarningThreshold?: number;
  bulletCriticalThreshold?: number;
  bulletTarget?: number;
  /** Choropleth/globe only — bypasses Incidents and any dataset entirely:
   *  values you type in yourself, per country, with an optional specific
   *  color per entry (rather than one base color varying only by intensity).
   *  Presence of this array (even empty) means "manual mode" for that
   *  widget; countries not listed here just render unshaded. */
  manualCountryData?: { country: string; value: number; color?: string }[];
  /** Incident map only — a locked center/zoom, so it opens already framed on
   *  reload or for a public share viewer instead of defaulting to a
   *  world view they'd have to manually zoom in from. */
  mapView?: { lat: number; lng: number; zoom: number };
  /** Incident map only — markers (default) or heatmap density view. */
  mapViewMode?: "markers" | "heatmap";
  /** Globe only — free-standing labeled points (checkpoints, ports,
   *  chokepoints, or any of the LABEL_TYPE_META categories) at a country
   *  name or precise "lat,lng", independent of country shading and routes. */
  manualLabels?: { location: string; text: string; color?: string; type?: LabelType }[];
  /** Globe only — a path through 2 or more named locations, for showing
   *  routes, trajectories, or cross-border/cross-group linkages. A country
   *  name (matched the same way as country shading) or a precise "lat,lng"
   *  at each waypoint — a route can bend through open water via extra
   *  waypoints rather than being a single straight arc. Independent of how
   *  the globe's country shading is sourced — routes can sit on top of
   *  Incidents data, dataset data, manual country data, or no shading at all. */
  manualRoutes?: {
    waypoints: string[];
    label?: string;
    color?: string;
    /** An icon animates along the path when set — "none" (or omitted) is
     *  just the line itself. */
    vehicle?: "plane" | "commercial-ship" | "warship" | "drone" | "none";
    /** Line thickness — same units as react-globe.gl's pathStroke. */
    strokeWidth?: number;
  }[];
  /** Bar/line only — a second dimension to break the primary field down by,
   *  turning a single-variable chart into a genuine two-variable pivot
   *  (stacked/grouped bars, multi-series lines). */
  secondaryField?: PivotableField | string;
  /** Choropleth + dataset only — the dataset column holding the
   *  province/state name, used to re-group data when drilled into a
   *  country. Optional: without it, drilling into a country with boundary
   *  data available still shows the map, just without shading, since
   *  there's no column to pull province-level values from. */
  geoProvinceColumn?: string;
  /** Choropleth + dataset only — the dataset column holding the
   *  county/district name, for the second drill level. Only meaningful
   *  alongside geoProvinceColumn — there's no county-only drill path that
   *  skips province. */
  geoCountyColumn?: string;
  /** Choropleth only — a named key into the frontend's
   *  CHOROPLETH_COLOR_SCHEMES (e.g. "blues", "grey_to_red"), or "single"/
   *  undefined for the original single-base-color-at-varying-opacity
   *  look. Purely a rendering choice, not validated against a fixed enum
   *  server-side — an unrecognized value just falls back to the single-
   *  color behavior on the frontend rather than erroring. */
  choroplethColorScheme?: string;
  /** Choropleth only — computes a rate/ratio (e.g. crime per capita) by
   *  dividing the primary series' value by a matching location's value
   *  from this second dataset, rather than shading the raw primary value
   *  directly. All four are required together for the ratio to actually
   *  apply — any one missing falls back to the plain, undivided value.
   *  Only applied at the top-level/country view for now, not at drilled-
   *  in province/county levels, since that would need this second
   *  dataset to have its own province/county column mapping too. */
  ratioDatasetId?: string;
  /** The column in the ratio dataset holding the matching location name —
   *  not assumed to share the primary dataset's own column name. */
  ratioLocationColumn?: string;
  ratioValueColumn?: string;
  /** E.g. 100000 for "per 100,000" — defaults to 1 (a plain ratio) when
   *  unset. */
  ratioMultiplier?: number;
  /** When set, this widget charts an uploaded dataset instead of incidents —
   *  dataField/secondaryField then hold that dataset's own raw column names
   *  directly, not the incidents by_X convention. Widget types that need
   *  incidents-specific data shapes (calendar's daily buckets, map's
   *  lat/lng) aren't offered once a dataset is the source, since a generic
   *  dataset can't be assumed to have any of that. */
  datasetId?: string;
  /** Only for type "viz": what the visual shows (components/viz/types.ts). */
  viz?: import("./components/viz/types").VizSpec;
}

export type DatasetColumnType = "text" | "number" | "date";

export interface DatasetColumn {
  name: string;
  type: DatasetColumnType;
}

/** A user-uploaded dataset with any schema — not tied to the incidents
 *  table's fixed columns at all. Each row is stored as JSON server-side; the
 *  schema here just describes what keys to expect and how to treat them. */
export interface Dataset {
  id: string;
  owner_id: string | null;
  name: string;
  schema: DatasetColumn[];
  row_count: number;
  created_at: string;
  updated_at: string;
}

export interface DatasetSummary {
  total: number;
  sums: Record<string, number>;
}

export interface CustomDashboard {
  id: string;
  owner_id: string | null;
  name: string;
  widgets: DashboardWidget[];
  is_public: boolean;
  is_auto: boolean;
  /** Read-only mode for the whole dashboard — disables add/edit/remove/rename
   *  and all drag/resize, regardless of any individual widget's own lock state. */
  locked: boolean;
  share_token: string | null;
  /** A dashboard-wide date filter, applied to every Incidents-sourced widget
   *  at once. Set once by whoever builds the dashboard, persisted so it's
   *  still in effect on reload and for public share viewers. Doesn't affect
   *  dataset-sourced widgets — there's no single canonical date column for
   *  those the way Incidents has occurred_at. */
  date_range_from: string | null;
  date_range_to: string | null;
  /** The dashboard's look (components/viz/themes.ts); null is the default. */
  theme?: string | null;
  created_at: string;
  updated_at: string;
}

export interface NormalizedDashboardStats {
  total: number;
  by_sector: { value: string; count: number }[];
  by_actor: { value: string; count: number }[];
  by_tactic: { value: string; count: number }[];
  by_severity: { value: string; count: number }[];
  by_province: { value: string; count: number }[];
  by_country: { value: string; count: number }[];
  time_series: { bucket: string; count: number }[];
  daily: { date: string; count: number }[];
  actor_tactic: { actor: string; tactic: string; count: number }[];
  deaths: number;
  injuries: number;
  kidnappings_ngo: number;
}

export interface PublicDashboardData {
  name: string;
  widgets: DashboardWidget[];
  stats: NormalizedDashboardStats;
  /** The date range this dashboard's owner set, if any — for display only;
   *  stats/breakdowns/etc. above are already computed with it applied. */
  date_range_from: string | null;
  date_range_to: string | null;
  theme?: string | null;
  /** Keyed "primaryColumn|secondaryColumn" — only the specific pairs this
   *  dashboard's own widgets actually use, not every possible combination. */
  crosstabs: Record<string, CrosstabRow[]>;
  /** Keyed by bare column name — single-field breakdowns for widgets using
   *  one of the newer by_X fields as their primary dimension. */
  breakdowns: Record<string, { value: string; count: number }[]>;
  /** Keyed by dataset id — row count + numeric column sums, for any
   *  dataset-sourced stat cards on this dashboard. */
  datasetSummaries: Record<string, DatasetSummary>;
  /** Keyed "ds:<id>:<column>" — daily counts for any dataset-sourced
   *  calendar widget's chosen date column. */
  dailyBreakdowns: Record<string, { date: string; count: number }[]>;
  incidents: { id: string; latitude: number; longitude: number; severity: string | null; actor: string | null; sector: string | null; occurred_date: string | null; city: string | null; province: string | null }[];
  updated_at: string;
}

export interface StatsSummary {
  by_source: { source_type: string; count: number }[];
  sentiment: { negative: number; neutral: number; positive: number };
  volume_series: { minute: string; count: number }[];
  open_alert_count: number;
  top_queries: { id: string; name: string; category: string; matches: number }[];
}

// ── Query dashboard (backend: routes/queryInsights.ts) ──

/** One collected item as the query dashboard shows it. */
export interface QueryStreamItem {
  id: string;
  /** "event" for news reports; "conversation" for social and forum posts. */
  kind: "event" | "conversation";
  source_type: string;
  title: string;
  snippet: string;
  url: string | null;
  /** The outlet's address for news, the author for a post. */
  source: string | null;
  published_at: string;
  /** -1 … 1, a word-based estimate unless the source supplied its own. */
  sentiment: number;
  tone?: "negative" | "neutral" | "positive";
  place: string | null;
}

export interface QueryTopic {
  label: string;
  /** What a search for this topic matches. */
  term: string;
  count: number;
  tone: number;
}

export interface QueryMapPoint {
  id: string;
  lat: number;
  lon: number;
  place: string | null;
  precision: string | null;
  title: string;
  snippet: string;
  url: string | null;
  source: string | null;
  kind: "event" | "conversation";
  published_at: string;
  sentiment: number;
}

export interface QueryOverview {
  queryId: string;
  from: string;
  to: string;
  tz: number;
  /** "day" normally; "hour" when the period is two days or less. Buckets are in the viewer's own time. */
  bucket: "day" | "hour";
  total: number;
  volume: { bucket: string; count: number; events: number; conversations: number }[];
  sentiment: {
    overall: { negative: number; neutral: number; positive: number; average: number };
    series: { bucket: string; negative: number; neutral: number; positive: number; average: number }[];
  };
  topics: QueryTopic[];
  /** The outlets with the most items, and the places most often named. */
  outlets: { label: string; count: number }[];
  places: { label: string; count: number }[];
  points: QueryMapPoint[];
  located: number;
  /** Tone, topics and the map use the most recent `used` of `total` items. */
  sampled: { used: number; total: number };
  /** Where the news outlets are based, relative to the countries the reporting is about. */
  sourceMix?: QuerySourceMix;
  /** The places most often named, period by period. Null when the period is too short to split. */
  placeTrend?: { bucket: "day" | "week"; buckets: string[]; rows: { label: string; total: number; counts: number[] }[] } | null;
  /** The period of the same length just before this one. `partial` when the query is newer than that period, so there is nothing fair to compare with. */
  previous?: { from: string; to: string; total: number; negative: number | null; partial: boolean };
  /** When the newest of these items was collected. */
  lastCollectedAt?: string | null;
  fetchedAt: string;
}

export interface QuerySourceMix {
  countries: string[];
  inCountry: number;
  elsewhereInAfrica: number;
  international: number;
  unclassified: number;
  outlets: number;
  largest: { label: string; share: number } | null;
}

/** Reports of the same event, grouped by their headlines. */
export interface QueryStory {
  id: string;
  title: string;
  url: string | null;
  outlets: number;
  items: number;
  firstAt: string;
  lastAt: string;
  sources: string[];
  place: string | null;
  tone: number;
  members: { id: string; title: string; url: string | null; source: string | null; published_at: string }[];
}

export interface QueryNamed {
  label: string;
  term: string;
  count: number;
  /** Items in the later and the earlier half of the period. */
  recent: number;
  earlier: number;
  fresh?: boolean;
}

export interface QueryInsights {
  queryId: string;
  from: string;
  to: string;
  stories: QueryStory[];
  names: QueryNamed[];
  rising: QueryNamed[];
  splitAt: string;
  used: number;
  fetchedAt: string;
}

/** How a query's last 24 hours compare with what is usual for it (backend: queryWatch.ts). */
export interface QueryWatchStatus {
  last24h: number;
  usual: number;
  basisDays: number;
  busiest: number;
  threshold: number;
  multiple: number;
  state: "learning" | "quiet" | "normal" | "above" | "surge";
  lastItemAt: string | null;
  computedAt: string;
}

/** A flagged escalation incident that a query's own wording matches. */
export interface QueryIncident {
  id: string;
  level: "elevated" | "critical";
  headline: string;
  summary: string;
  place: string;
  lat: number;
  lon: number;
  geoPrecision: string;
  preliminary: boolean;
  criteriaMet: string[];
  fatalitiesMax: number | null;
  reportCount: number;
  lastEventDate: string | null;
  updatedAt: string;
  sources: { n: number; url: string; title: string | null; domain: string }[];
  sourceCount: number;
}

export interface QueryWatch {
  queryId: string;
  status: QueryWatchStatus | null;
  alerts: AlertItem[];
  incidents: QueryIncident[];
  closed: AlertItem[];
  health: {
    feeds: { total: number; ok: number; no_feed: number; error: number; pending: number } | null;
    search: { state: "off" | "ok" | "paused"; minutes?: number };
  };
  fetchedAt: string;
}

export interface QueryNote {
  id: string;
  /** The viewer's day it is pinned to, "2026-10-05". */
  day: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
}

/** The Analyst Notebook's shared analytical summary (backend: lib/notebook.ts). */
export interface QueryNotebook {
  query_id: string;
  body: string;
  /** The text the last AI redraft replaced, kept so it can be restored. */
  previous_body: string | null;
  source: "ai" | "manual";
  model: string | null;
  period_from: string | null;
  period_to: string | null;
  generated_at: string | null;
  /** Null until anything has been saved. */
  updated_at: string | null;
  updated_by_name: string | null;
}

export interface QueryDayDigest {
  total: number;
  events: number;
  conversations: number;
  tone: { negative: number; neutral: number; positive: number };
  topics: QueryTopic[];
  places: { label: string; count: number }[];
  outlets: { label: string; count: number }[];
  headlines: { id: string; title: string; url: string | null; source: string | null; topic: string | null }[];
}

export interface QueryAiDaySummary {
  summary: string;
  developments: { text: string; sources: number[] }[];
  cited: { n: number; id: string; title: string; url: string | null; source: string | null }[];
  model: string;
  created_at: string;
  item_count: number;
}

export type QueryAiSummaryState = { status: "ready"; ai: QueryAiDaySummary } | { status: "unavailable"; reason: string } | { status: "none" };

export interface QueryDay {
  day: string;
  tz: number;
  from: string;
  to: string;
  digest: QueryDayDigest;
  ai: QueryAiSummaryState;
}

export interface LiveLayerFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: string;
    title: string;
    time: string | null;
    intensity: number;
    intensityLabel: string;
    detail: string;
    url: string | null;
    /** Air-traffic only — see the backend's classifyAviation() for exactly
     *  what each value means and how it's derived. Undefined on every
     *  other layer. */
    aviationClass?: "commercial" | "private" | "military";
    /** Space Tracking only — see the backend's SATELLITE_CATEGORY_GROUPS
     *  for exactly which real CelesTrak group(s) each value is sourced
     *  from. Undefined on every other layer. */
    satelliteCategory?: "starlink-comms" | "military-intel" | "gps-nav" | "earth-observation" | "stations-telescopes";
    /** Natural-events only — see the backend's classifyNaturalEvent() for
     *  exactly how this is derived from NASA EONET's own category field.
     *  Undefined on every other layer. */
    naturalHazardCategory?: "wildfire" | "severe-weather";
    /** Conflict Escalation only — see the backend's escalationIncidents.ts.
     *  Undefined on every other layer. */
    escalationLevel?: "elevated" | "critical";
    /** Conflict Escalation only — fetches the full evidence/source-link
     *  list via getConflictEscalationEvidence. Undefined elsewhere. */
    countryCode?: string;
    /** Conflict Escalation only — how many source links are available. */
    evidenceCount?: number;
    /** Conflict Escalation only — the full incident record behind this
     *  marker: criteria met, indicators with quotes, sources, location
     *  precision. Absent only when talking to a backend older than the
     *  incident pipeline. */
    incident?: EscalationIncident;
  };
}

/** One article the escalation pipeline read, and what it decided. */
export interface EscalationAuditEntry {
  url: string;
  domain: string;
  title: string | null;
  origin: string;
  publishedAt: string | null;
  status: "coded" | "rejected" | "unreadable" | "error";
  textBasis: string | null;
  rejectionReason: string | null;
  rejectionNote: string | null;
  processedAt: string;
  reports: { country: string; location: string | null; geoPrecision: string; geoMethod: string; eventDate: string; indicators: string[]; confidence: string; incidentId: string | null; notes: string[] }[];
}

export interface EscalationPipelineStatus {
  provider: { provider: "anthropic" | "workers-ai"; coderModel: string; analystModel: string };
  enabled: boolean;
  /** Today's (UTC) AI use against the platform's own daily ceiling. The
   *  ceiling sits below Cloudflare's free allowance, so reaching it costs nothing. */
  ai?: { day: string; used: number; calls: number; budget: number; freeAllowance: number; remaining: number };
  paidModelKeySet?: boolean;
  translationEnabled?: boolean;
  lastRun: Record<string, unknown> | null;
  last24h: { status: string; count: number }[];
  /** Reports picked up from headlines in the last 24 hours (no AI involved)
   *  and not yet read in full. */
  headline24h?: number;
  headlineTierEnabled?: boolean;
  rejectionReasons24h: { reason: string; count: number }[];
  incidents: { level: string; count: number }[];
}

/** One source article behind an escalation incident; `n` is the citation
 *  number used in the incident's summary/assessment text ("[1]"). */
export interface EscalationSource {
  n: number;
  url: string;
  title: string | null;
  domain: string;
  publishedAt: string | null;
  /** "full_text" when the whole article was read; "feed_summary" when only
   *  the feed's teaser could be; "headline" when only its headline has been
   *  matched by the rule-based first pass so far. */
  textBasis: string | null;
}

/** One codebook indicator found for an incident, with the verbatim quote(s)
 *  that establish it and the source each quote came from. */
export interface EscalationIndicator {
  id: string;
  label: string;
  tier: "critical" | "posture" | "contextual";
  evidence: { quote: string; source: number }[];
}

/** A flagged escalation incident — see the backend's escalationIncidents.ts.
 *  Every incident carries the criteria it met and the evidence behind them. */
export interface EscalationIncident {
  id: string;
  countryCode: string;
  countryName: string;
  /** "Mekelle, Tigray" — null when reporting names no place below the country. */
  locationLabel: string | null;
  lat: number;
  lon: number;
  /** How the marker position was arrived at: a named place, an estimated
   *  position for a named place, a region centroid, or the country centroid. */
  geoPrecision: "place" | "approximate" | "region" | "country";
  geoMethod: string | null;
  level: "elevated" | "critical";
  headline: string;
  summary: string;
  assessment: string;
  outlook: string;
  caveats: string | null;
  analystWritten: boolean;
  /** True while the incident is known only from headlines — no article
   *  behind it has yet been read in full. */
  preliminary?: boolean;
  criteriaMet: string[];
  indicators: EscalationIndicator[];
  sources: EscalationSource[];
  actors: string[];
  places: string[];
  fatalitiesMax: number | null;
  reportCount: number;
  firstEventDate: string | null;
  lastEventDate: string | null;
  updatedAt: string;
}

/** One contributing bulk-ingested GDELT event behind a country's escalation
 *  score — see the backend's getCountryEscalationEvidence(). There's no
 *  literal saved query behind this (unlike Social Listening's boolean
 *  search), since it comes from the QuadClass-filtered bulk pipeline — this
 *  is the real evidence instead. */
export interface EscalationEvidenceItem {
  placeName: string;
  eventCode: string;
  avgTone: number | null;
  numMentions: number | null;
  sourceUrl: string;
  dateAdded: string;
  /** "gdelt" (structured bulk event), "africa-wire" (a real crawled
   *  article whose text matched an escalation keyword), or "gdelt-article"
   *  (a real article from GDELT's own live text search, same keyword
   *  match) — absent on older cached rows, treat as "gdelt" in that case. */
  source?: "gdelt" | "africa-wire" | "gdelt-article" | "article";
  /** Real article title — set for "africa-wire" and "gdelt-article" items. */
  title?: string;
  /** Which escalation keyword(s) matched — set for "africa-wire" and "gdelt-article" items. */
  matchedKeywords?: string[];
}

export interface LiveLayerCollection {
  type: "FeatureCollection";
  features: LiveLayerFeature[];
  fetchedAt: string;
}

/** Approximate territory-change marker — see the backend's
 *  /territory-changes route doc comment for exactly what this is and isn't
 *  (a fixed-radius circle around one reported point, not a verified control
 *  boundary). Polygon geometry, unlike every other live layer here. */
export interface TerritoryChangeFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
  properties: {
    id: string;
    title: string;
    detail: string;
    time: string | null;
    url: string | null;
    eventCode: string;
  };
}

export interface TerritoryChangeCollection {
  type: "FeatureCollection";
  features: TerritoryChangeFeature[];
  fetchedAt: string;
}

export interface IssPosition {
  lat: number;
  lng: number;
  speedKmh: number;
  timestamp: string;
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  link: string;
  publishedAt: string | null;
}

export interface NewsFeed {
  items: NewsItem[];
  fetchedAt: string;
}

export interface SpaceWeather {
  kpIndex: number;
  stormLevel: string;
  stormColor: string;
  kpTimestamp: string | null;
  alerts: { id: string; issuedAt: string | null; message: string }[];
  fetchedAt: string;
}

export interface CyberThreats {
  recentCount: number;
  catalogTotal: number;
  vulnerabilities: { id: string; name: string; vendor: string; product: string; dateAdded: string; dueDate: string; source: string }[];
  fetchedAt: string;
}

export interface MarketsStatus {
  exchanges: { name: string; country: string; open: boolean }[];
  openCount: number;
  commodities: Record<string, { value: number; unit: string; date: string; changePercent: number | null }>;
  commoditiesAvailable: boolean;
  crypto: Record<string, { price: number; changePercent: number }>;
  fetchedAt: string;
}

export interface ActivityIndex {
  countries: { code: string; name: string; activityScore: number }[];
  fetchedAt: string;
}

export interface EconomicIndicators {
  countries: Array<
    { code: string; name: string } & Record<string, number | string | null>
  >;
  indicators: { key: string; label: string; unit: string }[];
  source: string;
  fetchedAt: string;
}

export interface SocialListeningResult {
  query: string;
  effectiveQuery: string;
  latestTone: number | null;
  toneTimeline: { date: string; avgTone: number }[];
  volumeTimeline: { date: string; count: number }[];
  topArticles: { title: string; url: string; domain: string; seenAt: string | null; language: string | null }[];
  mastodonPosts: { id: string; url: string; author: string; content: string; createdAt: string }[];
  mastodonAvailable: boolean;
  geoPoints: { id: string; lat: number; lng: number; title: string; detail: string; count: number }[];
  sourceErrors: { tone?: string; volume?: string; articles?: string; mastodon?: string; geo?: string } | null;
  fetchedAt: string;
}

export interface SavedListeningQuery {
  id: string;
  owner_id: string | null;
  name: string;
  query: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface MaritimeLane {
  label: string;
  points: [number, number][];
}

export interface MaritimeLanes {
  lanes: MaritimeLane[];
  fetchedAt: string;
}

export interface SubmarineCable {
  points: [number, number][];
  label: string;
  color: string;
}

export interface SubmarineCableData {
  cables: SubmarineCable[];
  landingPoints: LiveLayerCollection;
  fetchedAt: string;
}

// --- Crypto Intelligence (backend: lib/chainIntel.ts, adapted from OSIRIS) ---
export type ChainKind = "bitcoin" | "ethereum" | "solana";
export type RiskSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface RiskFactor {
  code: string;
  label: string;
  severity: RiskSeverity;
  weight: number;
  detail: string;
}

export interface SanctionEntry {
  id: string;
  schema: string;
  name: string;
  aliases: string[];
  countries: string[];
  programs: string[];
  sanctions: string;
}

export interface WalletIntel {
  address: string;
  chain: ChainKind;
  chain_label: string;
  symbol: string;
  ambiguous_chain: boolean;
  balance: { native: number; usd: number | null; price_usd: number | null };
  activity: {
    tx_count: number;
    first_seen: string | null;
    last_seen: string | null;
    age_days: number | null;
    dormant_days: number | null;
    sample_size: number;
    history_complete: boolean;
  };
  flow: { total_in: number; total_out: number; net: number } | null;
  counterparties: { address: string; direction: "in" | "out" | "both"; txs: number; value: number }[];
  transactions: { hash: string; time: string | null; direction: "in" | "out" | "self" | "unknown"; value: number; counterparty: string | null; fee?: number; failed?: boolean }[];
  sanctions: { screened: boolean; hit: boolean; entries: SanctionEntry[] };
  risk: { score: number; level: RiskSeverity; factors: RiskFactor[] };
  labels: string[];
  tokens: { symbol: string; name: string; amount: number | null }[];
  sources: string[];
  partial: string[];
  timestamp: string;
}

// --- OSINT Alerts (backend: lib/osintFeed.ts, adapted from OSIRIS) ---
export type NewsBloc = "western" | "russian" | "regional" | "independent";

export interface OsintAlertItem {
  id: string;
  title: string;
  summary: string;
  description: string;
  link: string;
  published: string;
  source: string;
  source_name: string;
  lean: string | null;
  bloc: NewsBloc | null;
  flag: "BREAKING" | null;
  also_reported_by: { source: string; source_name: string; lean: string; bloc: NewsBloc; link: string; published: string }[];
  risk_score: number;
  risk_method: string;
  risk_keywords: string[];
  coords: [number, number] | null;
  coords_default: boolean;
  coords_anchor: string | null;
}

export interface OsintFeedPayload {
  alerts: OsintAlertItem[];
  total: number;
  sources: { handle: string; name: string; lean: string; bloc: NewsBloc; kind: "telegram" | "wire"; count: number; latest: string | null }[];
  fetchedAt: string;
  /** Background crawl status for the ~260-source African country/pan-African/
   *  institutional list (data/africaSources.ts on the backend) — null until
   *  the crawl has processed at least one batch. "pending" sources haven't
   *  been checked yet; a full cycle fills in over time (see africaWireActor.ts). */
  africaWireHealth?: { total: number; ok: number; no_feed: number; error: number; pending: number } | null;
}

// --- Live Broadcasts (backend: /api/live-layers/live-broadcasts, adapted from OSIRIS) ---
export interface LiveBroadcast {
  id: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  url: string;
  embedAllowed: boolean;
  category: string;
}

export interface LiveBroadcastData {
  broadcasts: LiveBroadcast[];
  total: number;
  fetchedAt: string;
}

export type RouteProfile = "driving" | "walking" | "cycling";

export interface RouteResult {
  coordinates: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
}

/** One Regional Spotlight publication. `body` is only present when a single
 *  entry is fetched, not in lists. */
export interface SpotlightEntry {
  id: string;
  region: string;
  title: string;
  product_type: string;
  countries: string | null;
  summary: string | null;
  body?: string | null;
  cover_image_url: string | null;
  link_url: string | null;
  link_label: string | null;
  author: string | null;
  /** YYYY-MM-DD — the date shown to readers. */
  publication_date: string;
  /** draft: admins only. published: live for every signed-in user. */
  status: "draft" | "published";
  /** How much of the page the article takes. */
  layout_width?: "standard" | "wide" | "full";
  /** Published AND public: also readable without signing in, at /spotlight/<id>. */
  is_public: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SpotlightEntryInput = Partial<Omit<SpotlightEntry, "id" | "published_at" | "created_at" | "updated_at">>;

export interface SpotlightRegionCount {
  slug: string;
  name: string;
  published: number;
  /** Always 0 for non-admins. */
  drafts: number;
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}


export type DdOutcome = "potential_sanctions_match" | "pep_indicators" | "adverse_media" | "review" | "incomplete" | "no_adverse_indicators";
export interface DdCheck<T> { id: string; label: string; state: "ok" | "unavailable" | "not_configured"; note?: string; hits: T[] }
export interface DdListHit { list: string; ref: string; kind: string; name: string; matchedName: string; score: number; strength: "strong" | "possible"; countries: string[]; programs: string[]; listedOn: string | null; remarks: string | null }
export interface DdMediaItem { url: string; title: string; domain: string; published: string | null; basis: "full_text" | "headline_only"; relevance: string; category: string; severity: "high" | "medium" | "low" | "none"; status: string; what: string }
export interface DdResult {
  input: { name: string; kind: "person" | "entity"; country: string | null; aliases: string[]; identifiers: string | null };
  outcome: DdOutcome;
  sanctions: { hits: DdListHit[]; lists: { id: string; label: string; status: string; entries?: number; asOf?: string; stale?: boolean; error?: string }[] };
  office: DdCheck<{ url: string; label: string; description: string | null; strength: string; isHuman: boolean; positions: { label: string; from: string | null; to: string | null; current: boolean }[]; facts: string[]; profile?: { inception: string | null; headquarters: string | null; employees: number | null; industry: string[]; leaders: string[]; website: string | null; founders: string[]; image?: string | null }; person?: { born: string | null; died: string | null; occupations: string[]; education: { label: string; from: string | null; to: string | null }[]; employers: { label: string; from: string | null; to: string | null }[]; parties: string[]; memberships: string[]; awards: string[]; image?: string | null }; countries?: string[] }>;
  gleif: DdCheck<{ url: string; name: string; lei: string; status: string | null; jurisdiction: string | null; directParent: string | null; ultimateParent: string | null; strength: string; address?: string | null; incorporated?: string | null; legalForm?: string | null }>;
  companiesHouse: DdCheck<{ url: string; name: string; kind: string; status: string | null; incorporated: string | null; people: { name: string; role: string; resigned: boolean }[]; appointments: number | null; strength: string; companyType?: string | null; address?: string | null; sic?: string[] }>;
  offshore: DdCheck<{ url: string; name: string; type: string | null; strength: string }>;
  media: DdCheck<{ items: DdMediaItem[]; candidates: number; read: number; classified: boolean }>;
  mediaCoverage: DdCheck<{ total: number; byMonth: { month: string; count: number }[]; topOutlets: { domain: string; count: number }[]; recent: { title: string; url: string; domain: string; published: string | null; sentiment?: "positive" | "neutral" | "negative" }[]; themes: string[]; tone: string; overview: string; aiWritten: boolean }>;
  social: DdCheck<{ accounts: { platform: string; url: string; handle: string }[]; accountsFrom: string | null; posts: { network: string; author: string; text: string; url: string; published: string | null }[]; networksSearched: string[]; networksFailed: string[]; searchLinks: { label: string; url: string }[]; overview: string }>;
  environment?: { country: string | null; incidents: { level: string; headline: string; location: string | null; summary: string; assessment: string; lastEventDate: string | null; reportCount: number }[]; note: string };
  registries: { label: string; url: string; note?: string }[];
  sources: { id: string; label: string; state: "ok" | "unavailable" | "not_configured"; note?: string; url?: string }[];
  summary: { text: string; keyPoints: string[]; nextSteps: string[]; aiWritten: boolean };
  coverage: string;
  disclaimer: string;
  generatedAt: string;
}
export interface DdCaseRow { id: string; name: string; subject_type: string; country: string | null; reference: string | null; outcome: DdOutcome; summary: string | null; created_at: string }
export interface DdCase { id: string; name: string; subject_type: "person" | "entity"; reference: string | null; created_at: string; result: DdResult }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${API_URL}${path}`, {
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Routes that wrap upstream calls (liveLayers.ts, socialListening.ts,
    // globalStatus.ts) send { error: "<generic label>", detail: "<actual
    // reason>" } on a 502 — previously only `error` was surfaced, so every
    // failure showed the same generic "Upstream feed unavailable" with no
    // way to tell a timeout from a real HTTP error from a bad query. Both
    // are now included, so the visible message is actually diagnostic.
    const label = typeof body.error === "string" ? body.error : body.error ? JSON.stringify(body.error) : `Request failed: ${res.status}`;
    const message = typeof body.detail === "string" && body.detail ? `${label}: ${body.detail}` : label;
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export { ApiError };

export type AlertChannel = "email" | "signal";
export interface AlertSubscription {
  id: string;
  scope: "query" | "escalations";
  query_id: string | null;
  channel: AlertChannel;
  destination: string;
  min_level: "any" | "elevated" | "critical";
  frequency_minutes: number;
  enabled: boolean;
  last_sent_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
}
export interface AlertSubscriptionList {
  /** Which delivery methods the platform has credentials for. */
  channels: Record<AlertChannel, boolean>;
  subscriptions: AlertSubscription[];
}

export const api = {
  health: () => req<{ status: string }>("/api/health"),

  authStatus: () => req<{ bootstrapNeeded: boolean }>("/api/auth/status"),
  bootstrap: (username: string, password: string, display_name?: string) =>
    req<{ token: string; user: AuthUser }>("/api/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify({ username, password, display_name }),
    }),
  login: (username: string, password: string) =>
    req<{ token: string; user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: () => req<AuthUser>("/api/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean }>("/api/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }),
  changePasswordPublic: (username: string, currentPassword: string, newPassword: string) =>
    req<{ ok: boolean }>("/api/auth/change-password-public", {
      method: "POST",
      body: JSON.stringify({ username, current_password: currentPassword, new_password: newPassword }),
    }),
  requestAccess: (data: { name: string; email: string; organization?: string; reason?: string }) =>
    req<{ ok: boolean }>("/api/auth/request-access", { method: "POST", body: JSON.stringify(data) }),
  listAccessRequests: () => req<AccessRequest[]>("/api/auth/access-requests"),
  reviewAccessRequest: (id: string, status: "approved" | "denied") =>
    req<{ ok: boolean }>(`/api/auth/access-requests/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  listUsers: () => req<AuthUser[]>("/api/auth/users"),
  createUser: (username: string, password: string, display_name?: string, role: UserRole = "client") =>
    req<AuthUser>("/api/auth/users", {
      method: "POST",
      body: JSON.stringify({ username, password, display_name, role }),
    }),

  listClients: () => req<ClientOrg[]>("/api/clients"),
  getClient: (id: string) => req<ClientOrg>(`/api/clients/${id}`),
  createClient: (data: { name: string; max_accounts: number; username: string; password: string; display_name?: string }) =>
    req<ClientOrg & { first_account: AuthUser }>("/api/clients", { method: "POST", body: JSON.stringify(data) }),
  updateClient: (id: string, data: { name?: string; max_accounts?: number; can_view_all_incidents?: boolean }) =>
    req<{ id: string; name: string; max_accounts: number; can_view_all_incidents: boolean }>(`/api/clients/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteClient: (id: string) => req<void>(`/api/clients/${id}`, { method: "DELETE" }),
  updateClientLogo: (clientId: string, logoData: string | null) =>
    req<{ ok: boolean }>(`/api/clients/${clientId}/logo`, { method: "PATCH", body: JSON.stringify({ logo_data: logoData }) }),
  getMapSettings: () => req<MapDefaultSettings>("/api/map-settings"),
  updateMapSettings: (
    data: Partial<
      Pick<
        MapDefaultSettings,
        "show_incidents_by_default" | "default_view_mode" | "default_basemap" | "map_center_lat" | "map_center_lng" | "map_zoom" | "position_locked"
      >
    > & { default_filters?: Record<string, string> | null }
  ) => req<MapDefaultSettings>("/api/map-settings", { method: "PATCH", body: JSON.stringify(data) }),
  listClientAccounts: (clientId: string) => req<AuthUser[]>(`/api/clients/${clientId}/accounts`),
  createClientAccount: (clientId: string, data: { username: string; password: string; display_name?: string }) =>
    req<AuthUser>(`/api/clients/${clientId}/accounts`, { method: "POST", body: JSON.stringify(data) }),
  updateClientAccount: (clientId: string, userId: string, data: { is_client_admin?: boolean; display_name?: string }) =>
    req<AuthUser>(`/api/clients/${clientId}/accounts/${userId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteClientAccount: (clientId: string, userId: string) => req<void>(`/api/clients/${clientId}/accounts/${userId}`, { method: "DELETE" }),
  listClientDashboards: (clientId: string) => req<ClientSharedItem[]>(`/api/clients/${clientId}/dashboards`),
  grantClientDashboard: (clientId: string, dashboardId: string) =>
    req<{ ok: boolean }>(`/api/clients/${clientId}/dashboards`, { method: "POST", body: JSON.stringify({ dashboard_id: dashboardId }) }),
  revokeClientDashboard: (clientId: string, dashboardId: string) =>
    req<void>(`/api/clients/${clientId}/dashboards/${dashboardId}`, { method: "DELETE" }),
  listClientDatasets: (clientId: string) => req<ClientSharedItem[]>(`/api/clients/${clientId}/datasets`),
  grantClientDataset: (clientId: string, datasetId: string) =>
    req<{ ok: boolean }>(`/api/clients/${clientId}/datasets`, { method: "POST", body: JSON.stringify({ dataset_id: datasetId }) }),
  revokeClientDataset: (clientId: string, datasetId: string) =>
    req<void>(`/api/clients/${clientId}/datasets/${datasetId}`, { method: "DELETE" }),
  listClientCountries: (clientId: string) => req<{ country: string; created_at: string }[]>(`/api/clients/${clientId}/countries`),
  grantClientCountry: (clientId: string, country: string) =>
    req<{ ok: boolean }>(`/api/clients/${clientId}/countries`, { method: "POST", body: JSON.stringify({ country }) }),
  revokeClientCountry: (clientId: string, country: string) =>
    req<void>(`/api/clients/${clientId}/countries?country=${encodeURIComponent(country)}`, { method: "DELETE" }),

  getEvents: (params: { limit?: number; source_type?: string; query_id?: string; from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return req<EventItem[]>(`/api/events${qs ? `?${qs}` : ""}`);
  },
  getGeoEvents: (params: { minutes?: number; query_id?: string } = {}) => {
    const qs = new URLSearchParams(params as unknown as Record<string, string>).toString();
    return req<EventItem[]>(`/api/events/geo${qs ? `?${qs}` : ""}`);
  },
  // Query dashboard. `tz` is the viewer's offset from UTC in minutes, so that "a day" is the viewer's day.
  getQueryOverview: (queryId: string, range: { from: string; to: string }, tz: number) =>
    req<QueryOverview>(`/api/query-insights/${encodeURIComponent(queryId)}/overview?${new URLSearchParams({ from: range.from, to: range.to, tz: String(tz) })}`),
  getQueryStream: (queryId: string, params: { from?: string; to?: string; day?: string; tz: number; kind?: "event" | "conversation"; q?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return req<{ total: number; offset: number; limit: number; items: QueryStreamItem[] }>(`/api/query-insights/${encodeURIComponent(queryId)}/stream?${qs}`);
  },
  getQueryInsights: (queryId: string, range: { from: string; to: string }, tz: number) =>
    req<QueryInsights>(`/api/query-insights/${encodeURIComponent(queryId)}/insights?${new URLSearchParams({ from: range.from, to: range.to, tz: String(tz) })}`),
  getQueryWatch: (queryId: string) => req<QueryWatch>(`/api/query-insights/${encodeURIComponent(queryId)}/watch`),
  getQueryNotes: (queryId: string) => req<QueryNote[]>(`/api/query-insights/${encodeURIComponent(queryId)}/notes`),
  addQueryNote: (queryId: string, day: string, body: string) => req<QueryNote>(`/api/query-insights/${encodeURIComponent(queryId)}/notes`, { method: "POST", body: JSON.stringify({ day, body }) }),
  deleteQueryNote: (queryId: string, noteId: string) => req<{ ok: boolean }>(`/api/query-insights/${encodeURIComponent(queryId)}/notes/${encodeURIComponent(noteId)}`, { method: "DELETE" }),
  getQueryNotebook: (queryId: string) => req<QueryNotebook>(`/api/query-insights/${encodeURIComponent(queryId)}/notebook`),
  saveQueryNotebook: (queryId: string, body: string, expectedUpdatedAt: string | null) =>
    req<QueryNotebook>(`/api/query-insights/${encodeURIComponent(queryId)}/notebook`, { method: "PUT", body: JSON.stringify({ body, expected_updated_at: expectedUpdatedAt }) }),
  draftQueryNotebook: (queryId: string, digest: unknown) => req<QueryNotebook>(`/api/query-insights/${encodeURIComponent(queryId)}/notebook/draft`, { method: "POST", body: JSON.stringify({ digest }) }),
  restoreQueryNotebook: (queryId: string) => req<QueryNotebook>(`/api/query-insights/${encodeURIComponent(queryId)}/notebook/restore`, { method: "POST" }),
  getQueryDay: (queryId: string, day: string, tz: number) => req<QueryDay>(`/api/query-insights/${encodeURIComponent(queryId)}/day?${new URLSearchParams({ day, tz: String(tz) })}`),
  writeQueryDaySummary: (queryId: string, day: string, tz: number) =>
    req<QueryAiSummaryState>(`/api/query-insights/${encodeURIComponent(queryId)}/day-summary`, { method: "POST", body: JSON.stringify({ day, tz }) }),
  getLocatedEvents: (queryId: string, hours = 24) =>
    req<LocatedMonitoringResult>(`/api/events/located?query_id=${encodeURIComponent(queryId)}&hours=${hours}`),
  getAlerts: (params: { status?: "open" | "resolved" | "all"; query_id?: string; unscoped?: "1" } = {}) => {
    const qs = new URLSearchParams({ status: "open", ...params } as Record<string, string>).toString();
    return req<AlertItem[]>(`/api/alerts?${qs}`);
  },
  acknowledgeAlert: (id: string) => req<AlertItem>(`/api/alerts/${id}/acknowledge`, { method: "PATCH" }),
  resolveAlert: (id: string) => req<AlertItem>(`/api/alerts/${id}/resolve`, { method: "PATCH" }),
  getSpotlightRegions: () => req<SpotlightRegionCount[]>("/api/spotlight/regions"),
  getSpotlightEntries: (region?: string) => req<SpotlightEntry[]>(`/api/spotlight${region ? `?region=${encodeURIComponent(region)}` : ""}`),
  getSpotlightEntry: (id: string) => req<SpotlightEntry>(`/api/spotlight/${id}`),
  createSpotlightEntry: (data: SpotlightEntryInput) => req<SpotlightEntry>("/api/spotlight", { method: "POST", body: JSON.stringify(data) }),
  updateSpotlightEntry: (id: string, data: SpotlightEntryInput) => req<SpotlightEntry>(`/api/spotlight/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteSpotlightEntry: (id: string) => req<{ ok: boolean }>(`/api/spotlight/${id}`, { method: "DELETE" }),
  /** Uploads one image for an article and returns the address to show it from. */
  uploadSpotlightImage: async (image: Blob) => {
    const saved = await req<{ id: string; path: string }>("/api/spotlight/media", { method: "POST", headers: { "Content-Type": image.type || "application/octet-stream" }, body: image });
    return `${API_URL}${saved.path}`;
  },
  /** No sign-in needed: only answers for an entry that is published and public. */
  getPublicSpotlightEntry: (id: string) => req<SpotlightEntry>(`/api/public/spotlight/${id}`),
  getQueries: () => req<MonitoringQueryItem[]>("/api/queries"),
  createQuery: (data: Partial<MonitoringQueryItem>) =>
    req<MonitoringQueryItem>("/api/queries", { method: "POST", body: JSON.stringify(data) }),
  updateQuery: (id: string, data: Partial<MonitoringQueryItem>) =>
    req<MonitoringQueryItem>(`/api/queries/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteQuery: (id: string) => req<void>(`/api/queries/${id}`, { method: "DELETE" }),

  listDueDiligence: () => req<{ cases: DdCaseRow[] }>("/api/due-diligence"),
  getDueDiligence: (id: string) => req<DdCase>(`/api/due-diligence/${id}`),
  runDueDiligence: (body: { name: string; subject_type: "person" | "entity"; country?: string; aliases?: string[]; identifiers?: string; reference?: string }) => req<DdCase>("/api/due-diligence", { method: "POST", body: JSON.stringify(body) }),
  getDdReport: (id: string) => req<{ report: import("./report/model").Report | null; updated_at: string | null }>(`/api/due-diligence/${id}/report`),
  saveDdReport: (id: string, report: import("./report/model").Report) => req<{ ok: boolean; updated_at: string }>(`/api/due-diligence/${id}/report`, { method: "PUT", body: JSON.stringify({ report }) }),
  deleteDueDiligence: (id: string) => req<void>(`/api/due-diligence/${id}`, { method: "DELETE" }),
  refreshDueDiligenceList: (list: string) => req<{ ok: boolean; entries?: number }>("/api/due-diligence/sources/refresh", { method: "POST", body: JSON.stringify({ list }) }),
  dueDiligenceSources: () => req<{ sanctions: { id: string; label: string; status: string; entries?: number; asOf?: string; error?: string }[]; companies_house: boolean }>("/api/due-diligence/sources/status"),

  listAlertSubscriptions: (target: { scope: "escalations" } | { scope: "query"; queryId: string }) =>
    req<AlertSubscriptionList>(`/api/alert-subscriptions?scope=${target.scope}${target.scope === "query" ? `&query_id=${encodeURIComponent(target.queryId)}` : ""}`),
  createAlertSubscription: (body: { scope: "query" | "escalations"; query_id?: string; channel: AlertChannel; destination: string; min_level?: string; frequency_minutes?: number }) =>
    req<AlertSubscription>("/api/alert-subscriptions", { method: "POST", body: JSON.stringify(body) }),
  updateAlertSubscription: (id: string, patch: { destination?: string; min_level?: string; frequency_minutes?: number; enabled?: boolean }) =>
    req<AlertSubscription>(`/api/alert-subscriptions/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteAlertSubscription: (id: string) => req<void>(`/api/alert-subscriptions/${id}`, { method: "DELETE" }),
  testAlertSubscription: (id: string) => req<{ ok: boolean; note: string | null }>(`/api/alert-subscriptions/${id}/test`, { method: "POST" }),
  validateQuery: (boolean_query: string) =>
    req<{ valid: boolean; error: string | null }>("/api/queries/validate", {
      method: "POST",
      body: JSON.stringify({ boolean_query }),
    }),
  previewQuery: (boolean_query: string, live = false) =>
    req<PreviewResult>("/api/queries/preview", {
      method: "POST",
      body: JSON.stringify({ boolean_query, live }),
    }),
  getSummary: (queryId?: string, range?: { from: string; to: string }) => {
    const params = new URLSearchParams();
    if (queryId) params.set("query_id", queryId);
    if (range) {
      params.set("from", range.from);
      params.set("to", range.to);
    }
    const qs = params.toString();
    return req<StatsSummary>(`/api/stats/summary${qs ? `?${qs}` : ""}`);
  },
  getEscalationHistory: (queryId: string) =>
    req<{ window_end: string; escalation_score: number; volume: number }[]>(`/api/stats/escalation/${queryId}`),

  stagingBatches: () => req<StagingBatch[]>("/api/incident-staging/batches"),
  stagingList: (date: string) => req<StagedIncident[]>(`/api/incident-staging?date=${encodeURIComponent(date)}`),
  stagingCollect: (hours = 24) => req<{ staged: number; batchDate: string }>("/api/incident-staging/collect", { method: "POST", body: JSON.stringify({ hours }) }),
  stagingPatch: (id: string, patch: { status?: StagingStatus; row?: Partial<IncidentRow> }) =>
    req<{ ok: boolean }>(`/api/incident-staging/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  stagingSetStatus: (ids: string[], status: StagingStatus) =>
    req<{ ok: boolean }>("/api/incident-staging/set-status", { method: "POST", body: JSON.stringify({ ids, status }) }),
  stagingPush: (date?: string) => req<{ pushed: number; batch_id?: string }>("/api/incident-staging/push", { method: "POST", body: JSON.stringify({ date }) }),

  uploadIncidentsBulk: (rows: IncidentRow[], batchLabel?: string, batchId?: string) =>
    req<{ inserted: number; batch_id: string; batch_label: string | null }>("/api/incidents/bulk", {
      method: "POST",
      body: JSON.stringify({ rows, batch_label: batchLabel, batch_id: batchId }),
    }),
  getIncidents: (
    params: {
      country?: string;
      province?: string;
      sector?: string;
      actor?: string;
      tactic?: string;
      severity?: string;
      county?: string;
      district?: string;
      city?: string;
      suburb?: string;
      operation?: string;
      target?: string;
      interest_group?: string;
      actual_main_victim?: string;
      intended_primary_target?: string;
      from?: string;
      to?: string;
      limit?: number;
    } = {}
  ) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
    ).toString();
    return req<IncidentItem[]>(`/api/incidents${qs ? `?${qs}` : ""}`);
  },
  getIncidentFilters: () => req<IncidentFilters>("/api/incidents/filters"),
  getIncidentStats: (range: { from?: string; to?: string } & Partial<Record<PivotableField, string>> = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(range).filter(([, v]) => v !== undefined)) as Record<string, string>).toString();
    return req<IncidentStats>(`/api/incidents/stats${qs ? `?${qs}` : ""}`);
  },
  getCrosstab: (
    primary: PivotableField,
    secondary: PivotableField,
    range: { from?: string; to?: string } & Partial<Record<PivotableField, string>> = {}
  ) => {
    const qs = new URLSearchParams({
      primary,
      secondary,
      ...(Object.fromEntries(Object.entries(range).filter(([, v]) => v !== undefined)) as Record<string, string>),
    }).toString();
    return req<CrosstabRow[]>(`/api/incidents/crosstab?${qs}`);
  },
  getBreakdown: (field: PivotableField, range: { from?: string; to?: string } & Partial<Record<PivotableField, string>> = {}) => {
    const qs = new URLSearchParams({
      field,
      ...(Object.fromEntries(Object.entries(range).filter(([, v]) => v !== undefined)) as Record<string, string>),
    }).toString();
    return req<{ value: string; count: number }[]>(`/api/incidents/breakdown?${qs}`);
  },
  getIncidentUploads: () => req<SavedUpload[]>("/api/incidents/uploads"),
  deleteIncident: (id: string) => req<void>(`/api/incidents/${id}`, { method: "DELETE" }),
  deleteIncidentBatch: (batchId: string) => req<void>(`/api/incidents/batch/${batchId}`, { method: "DELETE" }),
  updateIncident: (id: string, data: Partial<IncidentRow>) =>
    req<IncidentItem>(`/api/incidents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  bulkDeleteIncidents: (ids: string[]) =>
    req<{ ok: boolean; deleted: number }>("/api/incidents/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }),

  getMapRoutes: () => req<SavedRoute[]>("/api/map-routes"),
  createMapRoute: (data: Omit<SavedRoute, "id" | "owner_id" | "created_at" | "updated_at" | "visible">) =>
    req<SavedRoute>("/api/map-routes", { method: "POST", body: JSON.stringify(data) }),
  updateMapRoute: (id: string, data: { name?: string; color?: string; visible?: boolean }) =>
    req<SavedRoute>(`/api/map-routes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteMapRoute: (id: string) => req<void>(`/api/map-routes/${id}`, { method: "DELETE" }),

  getMapShapes: () => req<SavedShape[]>("/api/map-shapes"),
  createMapShape: (data: Omit<SavedShape, "id" | "owner_id" | "created_at" | "updated_at" | "visible">) =>
    req<SavedShape>("/api/map-shapes", { method: "POST", body: JSON.stringify(data) }),
  updateMapShape: (id: string, data: { name?: string; style?: ShapeStyle; geometry?: GeoJSON.Feature | GeoJSON.FeatureCollection; visible?: boolean }) =>
    req<SavedShape>(`/api/map-shapes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteMapShape: (id: string) => req<void>(`/api/map-shapes/${id}`, { method: "DELETE" }),

  getCustomDashboards: () => req<CustomDashboard[]>("/api/custom-dashboards"),
  getOrCreateAutoDashboard: () => req<CustomDashboard>("/api/custom-dashboards/auto"),
  createCustomDashboard: (name: string, widgets: DashboardWidget[]) =>
    req<CustomDashboard>("/api/custom-dashboards", { method: "POST", body: JSON.stringify({ name, widgets }) }),
  getCustomDashboard: (id: string) => req<CustomDashboard>(`/api/custom-dashboards/${id}`),
  updateCustomDashboard: (
    id: string,
    data: { name?: string; widgets?: DashboardWidget[]; is_public?: boolean; locked?: boolean; date_range_from?: string | null; date_range_to?: string | null; theme?: string | null }
  ) =>
    req<CustomDashboard>(`/api/custom-dashboards/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // The any-data engine (backend: routes/analytics.ts). A source is "incidents" or "dataset:<id>".
  getVizFields: (source: string) => req<{ source: string; fields: import("./components/viz/types").VizField[] }>(`/api/analytics/fields?source=${encodeURIComponent(source)}`),
  runVizQuery: (source: string, query: import("./components/viz/types").VizQuery, range?: { from?: string | null; to?: string | null }) =>
    req<import("./components/viz/types").VizResult>("/api/analytics/query", { method: "POST", body: JSON.stringify({ source, query, dateFrom: range?.from ?? null, dateTo: range?.to ?? null }) }),
  /** A shared dashboard's visual: runs the query saved with it, optionally narrowed by the viewer's selections. */
  runPublicViz: (token: string, widgetId: string, filters?: import("./components/viz/types").VizFilter[]) =>
    req<import("./components/viz/types").VizResult>(`/api/public/dashboards-viz/${encodeURIComponent(token)}`, { method: "POST", body: JSON.stringify({ widgetId, filters }) }),
  deleteCustomDashboard: (id: string) => req<void>(`/api/custom-dashboards/${id}`, { method: "DELETE" }),
  // Public — no auth token needed, works for anyone with the share link.
  getPublicDashboard: (token: string) => req<PublicDashboardData>(`/api/public/dashboards/${token}`),

  // General-purpose datasets — any schema, not tied to incidents at all.
  getDatasets: () => req<Dataset[]>("/api/datasets"),
  getDataset: (id: string) => req<Dataset>(`/api/datasets/${id}`),
  createDataset: (name: string, schema: DatasetColumn[]) =>
    req<Dataset>("/api/datasets", { method: "POST", body: JSON.stringify({ name, schema }) }),
  uploadDatasetRows: (datasetId: string, rows: Record<string, unknown>[]) =>
    req<{ inserted: number }>(`/api/datasets/${datasetId}/rows`, { method: "POST", body: JSON.stringify({ rows }) }),
  getDatasetRows: (datasetId: string, offset = 0, limit = 50) =>
    req<{ rows: { id: string; data: Record<string, unknown>; created_at: string }[]; total: number; offset: number; limit: number }>(
      `/api/datasets/${datasetId}/rows?offset=${offset}&limit=${limit}`
    ),
  addDatasetRow: (datasetId: string, data: Record<string, unknown>) =>
    req<{ id: string; data: Record<string, unknown>; created_at: string }>(`/api/datasets/${datasetId}/rows/manual`, {
      method: "POST",
      body: JSON.stringify({ data }),
    }),
  updateDatasetRow: (datasetId: string, rowId: string, data: Record<string, unknown>) =>
    req<{ id: string; data: Record<string, unknown> }>(`/api/datasets/${datasetId}/rows/${rowId}`, { method: "PATCH", body: JSON.stringify({ data }) }),
  deleteDatasetRow: (datasetId: string, rowId: string) => req<void>(`/api/datasets/${datasetId}/rows/${rowId}`, { method: "DELETE" }),
  deleteDataset: (id: string) => req<void>(`/api/datasets/${id}`, { method: "DELETE" }),
  getDatasetBreakdown: (datasetId: string, field: string) =>
    req<{ value: string; count: number }[]>(`/api/datasets/${datasetId}/breakdown?field=${encodeURIComponent(field)}`),
  getDatasetValueMap: (datasetId: string, location: string, value: string) =>
    req<{ value: string; count: number }[]>(
      `/api/datasets/${datasetId}/value-map?location=${encodeURIComponent(location)}&value=${encodeURIComponent(value)}`
    ),
  getDatasetCrosstab: (datasetId: string, primary: string, secondary: string) =>
    req<CrosstabRow[]>(`/api/datasets/${datasetId}/crosstab?primary=${encodeURIComponent(primary)}&secondary=${encodeURIComponent(secondary)}`),
  getDatasetGeoDrilldown: (datasetId: string, group: string, filterField: string, filterValue: string, value?: string) =>
    req<{ value: string; count: number }[]>(
      `/api/datasets/${datasetId}/geo-drilldown?group=${encodeURIComponent(group)}&filterField=${encodeURIComponent(filterField)}&filterValue=${encodeURIComponent(filterValue)}${value ? `&value=${encodeURIComponent(value)}` : ""}`
    ),
  getDatasetSummary: (datasetId: string) => req<DatasetSummary>(`/api/datasets/${datasetId}/summary`),
  getDatasetDaily: (datasetId: string, field: string) =>
    req<{ date: string; count: number }[]>(`/api/datasets/${datasetId}/daily?field=${encodeURIComponent(field)}`),

  // Live OSINT layers — each backed by a cached, public upstream feed
  // (USGS, NASA EONET, GDELT). Shared GeoJSON shape across all three so the
  // frontend layer renderer/popup is generic.
  getLiveEarthquakes: () => req<LiveLayerCollection>("/api/live-layers/earthquakes"),
  getLiveNaturalEvents: () => req<LiveLayerCollection>("/api/live-layers/natural-events"),
  getLiveConflictEvents: () => req<LiveLayerCollection>("/api/live-layers/conflict-events"),
  getLiveAirTraffic: () => req<LiveLayerCollection>("/api/live-layers/air-traffic"),
  getLiveMalwareInfrastructure: () => req<LiveLayerCollection>("/api/live-layers/malware-infrastructure"),
  getLiveMaritime: () => req<LiveLayerCollection>("/api/live-layers/maritime"),
  getLiveSatellites: () => req<LiveLayerCollection>("/api/live-layers/satellites"),
  getLiveNuclearFacilities: () => req<LiveLayerCollection>("/api/live-layers/nuclear-facilities"),
  // Real, computed sea-lane geometries (searoute-js over a real maritime
  // network graph) — see backend/src/data/maritimeLanes.ts.
  getLiveMaritimeLines: () => req<MaritimeLanes>("/api/live-layers/maritime-lines"),
  // Real OpenStreetMap submarine-cable routes + landing points (Overpass,
  // seamark:type=cable_submarine / telecom=cable_landing_station) — see
  // the backend route's own comment for why this is OSM rather than
  // TeleGeography's submarinecablemap.com data, and what that trades off.
  getSubmarineCables: () => req<SubmarineCableData>("/api/live-layers/submarine-cables"),
  // On-chain wallet lookup — BTC/ETH/SOL balance, activity, counterparties
  // and OFAC screening. Not cached client-side; every address is a fresh lookup.
  getCryptoIntel: (address: string, chain?: ChainKind) =>
    req<WalletIntel>(`/api/live-layers/crypto-intel?address=${encodeURIComponent(address)}${chain ? `&chain=${chain}` : ""}`),
  // Public Telegram OSINT channels + wire RSS, merged and risk-scored.
  getOsintAlerts: () => req<OsintFeedPayload>("/api/live-layers/osint-alerts"),
  // Static list of major newsrooms' live YouTube broadcasts.
  getLiveBroadcasts: () => req<LiveBroadcastData>("/api/live-layers/live-broadcasts"),
  getLiveAisVessels: () => req<LiveLayerCollection>("/api/live-layers/ais-vessels"),
  getLiveUcdpConflictEvents: () => req<LiveLayerCollection>("/api/live-layers/ucdp-conflict-events"),
  getLiveGlobalIncidents: () => req<LiveLayerCollection>("/api/live-layers/global-incidents"),
  // Flagged escalation incidents — one point per incident, located from the
  // reporting, each carrying its criteria, indicators (with quotes) and
  // sources in `properties.incident` (see backend's escalationIncidents.ts).
  getConflictEscalation: () => req<LiveLayerCollection>("/api/live-layers/conflict-escalation"),
  getConflictEscalationEvidence: (countryCode: string) =>
    req<{ countryCode: string; items: EscalationEvidenceItem[]; fetchedAt: string }>(
      `/api/live-layers/conflict-escalation/${encodeURIComponent(countryCode)}/evidence`
    ),
  // What the escalation pipeline decided about each article it read, and
  // why — the answer to "why is / isn't this flagged".
  getEscalationAudit: (params: { country?: string; q?: string; status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString();
    return req<{ items: EscalationAuditEntry[]; fetchedAt: string }>(`/api/live-layers/conflict-escalation/audit${qs ? `?${qs}` : ""}`);
  },
  // Pipeline health: which model is coding, what the last tick did, and
  // what was read / rejected (and why) in the last 24 hours.
  getEscalationStatus: () => req<EscalationPipelineStatus>("/api/live-layers/conflict-escalation/status"),
  // Approximate circles around flagged incidents that include a territorial
  // change, siege or blockade — see TerritoryChangeFeature's own doc comment
  // for the caveat (not a verified control boundary).
  getTerritoryChanges: () => req<TerritoryChangeCollection>("/api/live-layers/territory-changes"),
  // Real ThreatFox IOC data geolocated via GeoLite2 — returns a real 502
  // ("Upstream feed unavailable") until the backend's abuse.ch Auth-Key
  // and MaxMind license key are set as Worker secrets (see liveLayers.ts).
  getLiveMalware: () => req<LiveLayerCollection>("/api/live-layers/live-malware"),
  getLiveIss: () => req<IssPosition>("/api/live-layers/iss"),
  getLiveNews: () => req<NewsFeed>("/api/live-layers/news"),
  getLiveRoute: (from: [number, number], to: [number, number], mode: RouteProfile) =>
    req<RouteResult>(
      `/api/live-layers/route?from=${from[0]},${from[1]}&to=${to[0]},${to[1]}&mode=${mode}`
    ),

  // Global-status HUD feeds — not map layers, see globalStatus.ts for the
  // real sources behind each and why OSIRIS's own Markets/Country-Risk
  // numbers were rebuilt rather than copied.
  getSpaceWeather: () => req<SpaceWeather>("/api/global-status/space-weather"),
  getCyberThreats: () => req<CyberThreats>("/api/global-status/cyber-threats"),
  getMarkets: () => req<MarketsStatus>("/api/global-status/markets"),
  getActivityIndex: () => req<ActivityIndex>("/api/global-status/activity-index"),
  getEconomicIndicators: () => req<EconomicIndicators>("/api/global-status/economic-indicators"),
  getSocialListening: (query: string) => req<SocialListeningResult>(`/api/social-listening?q=${encodeURIComponent(query)}`),

  // Saved/named Social Listening searches — the "dashboard for listening"
  // and the left-rail toggleable listening queries are both built on these.
  getListeningQueries: () => req<SavedListeningQuery[]>("/api/listening-queries"),
  createListeningQuery: (data: { name: string; query: string; pinned?: boolean }) =>
    req<SavedListeningQuery>("/api/listening-queries", { method: "POST", body: JSON.stringify(data) }),
  updateListeningQuery: (id: string, data: Partial<{ name: string; query: string; pinned: boolean }>) =>
    req<SavedListeningQuery>(`/api/listening-queries/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteListeningQuery: (id: string) => req<{ ok: boolean }>(`/api/listening-queries/${id}`, { method: "DELETE" }),
};

export function connectLiveFeed(onMessage: (type: string, payload: unknown) => void): () => void {
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let retryDelay = 1000;

  function connect() {
    if (!authToken) return; // not logged in yet; App re-invokes once it is
    ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(authToken)}`);
    ws.onmessage = (evt) => {
      try {
        const { type, payload } = JSON.parse(evt.data);
        onMessage(type, payload);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (closedByUser) return;
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 1.5, 15000);
    };
    ws.onopen = () => {
      retryDelay = 1000;
    };
  }

  connect();

  return () => {
    closedByUser = true;
    ws?.close();
  };
}
