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
  created_at?: string;
}

export interface ClientOrg {
  id: string;
  name: string;
  max_accounts: number;
  /** Whether this client's accounts can see the full shared incidents pool,
   *  not just what they've personally uploaded — read-only visibility. */
  can_view_all_incidents: boolean;
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

export interface PreviewResult {
  matches: PreviewMatch[];
  scanned: number;
  lookback_hours: number;
  truncated: boolean;
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
}

export interface SavedShape {
  id: string;
  owner_id: string | null;
  name: string;
  source: "drawn" | "shapefile" | "geojson";
  geometry: GeoJSON.Feature | GeoJSON.FeatureCollection;
  style: ShapeStyle;
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
  created_at: string;
  updated_at: string;
}

export type WidgetType = "stat" | "bar" | "line" | "pie" | "map" | "radar" | "funnel" | "choropleth" | "calendar" | "sankey" | "network" | "bubble" | "globe";

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
  /** Manually-dragged label positions, keyed by the label's own text (a
   *  category name, a node name) since that's stable across re-renders and
   *  re-fetches in a way an array index isn't. Only meaningful for bubble
   *  and network charts currently — the ones with hand-rolled SVG rendering
   *  where an arbitrary per-label offset is actually straightforward to
   *  apply; bar/pie/funnel/choropleth's labels are positioned by recharts
   *  or the projection library respectively, not free-form. */
  labelOffsets?: Record<string, { dx: number; dy: number }>;
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
  /** Globe only — free-standing text labels (checkpoints, ports, chokepoints,
   *  anything worth naming directly on the map) at a country name or precise
   *  "lat,lng", independent of country shading and routes. */
  manualLabels?: { location: string; text: string; color?: string }[];
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
  /** When set, this widget charts an uploaded dataset instead of incidents —
   *  dataField/secondaryField then hold that dataset's own raw column names
   *  directly, not the incidents by_X convention. Widget types that need
   *  incidents-specific data shapes (choropleth's place names, calendar's
   *  daily buckets, map's lat/lng, globe) aren't offered once a dataset is
   *  the source, since a generic dataset can't be assumed to have any of that. */
  datasetId?: string;
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

class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${API_URL}${path}`, {
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ? JSON.stringify(body.error) : `Request failed: ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export { ApiError };

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

  getEvents: (params: { limit?: number; source_type?: string; query_id?: string; from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return req<EventItem[]>(`/api/events${qs ? `?${qs}` : ""}`);
  },
  getGeoEvents: (params: { minutes?: number; query_id?: string } = {}) => {
    const qs = new URLSearchParams(params as unknown as Record<string, string>).toString();
    return req<EventItem[]>(`/api/events/geo${qs ? `?${qs}` : ""}`);
  },
  getAlerts: (params: { status?: "open" | "resolved" | "all"; query_id?: string } = {}) => {
    const qs = new URLSearchParams({ status: "open", ...params } as Record<string, string>).toString();
    return req<AlertItem[]>(`/api/alerts?${qs}`);
  },
  acknowledgeAlert: (id: string) => req<AlertItem>(`/api/alerts/${id}/acknowledge`, { method: "PATCH" }),
  resolveAlert: (id: string) => req<AlertItem>(`/api/alerts/${id}/resolve`, { method: "PATCH" }),
  getQueries: () => req<MonitoringQueryItem[]>("/api/queries"),
  createQuery: (data: Partial<MonitoringQueryItem>) =>
    req<MonitoringQueryItem>("/api/queries", { method: "POST", body: JSON.stringify(data) }),
  updateQuery: (id: string, data: Partial<MonitoringQueryItem>) =>
    req<MonitoringQueryItem>(`/api/queries/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteQuery: (id: string) => req<void>(`/api/queries/${id}`, { method: "DELETE" }),
  validateQuery: (boolean_query: string) =>
    req<{ valid: boolean; error: string | null }>("/api/queries/validate", {
      method: "POST",
      body: JSON.stringify({ boolean_query }),
    }),
  previewQuery: (boolean_query: string) =>
    req<PreviewResult>("/api/queries/preview", {
      method: "POST",
      body: JSON.stringify({ boolean_query }),
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

  uploadIncidentsBulk: (rows: IncidentRow[], batchLabel?: string, batchId?: string) =>
    req<{ inserted: number; batch_id: string; batch_label: string | null }>("/api/incidents/bulk", {
      method: "POST",
      body: JSON.stringify({ rows, batch_label: batchLabel, batch_id: batchId }),
    }),
  getIncidents: (params: { country?: string; province?: string; sector?: string; actor?: string; tactic?: string; severity?: string; from?: string; to?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
    ).toString();
    return req<IncidentItem[]>(`/api/incidents${qs ? `?${qs}` : ""}`);
  },
  getIncidentFilters: () => req<IncidentFilters>("/api/incidents/filters"),
  getIncidentStats: (range: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(range).filter(([, v]) => v !== undefined))).toString();
    return req<IncidentStats>(`/api/incidents/stats${qs ? `?${qs}` : ""}`);
  },
  getCrosstab: (primary: PivotableField, secondary: PivotableField, range: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams({ primary, secondary, ...Object.fromEntries(Object.entries(range).filter(([, v]) => v !== undefined)) }).toString();
    return req<CrosstabRow[]>(`/api/incidents/crosstab?${qs}`);
  },
  getBreakdown: (field: PivotableField, range: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams({ field, ...Object.fromEntries(Object.entries(range).filter(([, v]) => v !== undefined)) }).toString();
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
  createMapRoute: (data: Omit<SavedRoute, "id" | "owner_id" | "created_at" | "updated_at">) =>
    req<SavedRoute>("/api/map-routes", { method: "POST", body: JSON.stringify(data) }),
  updateMapRoute: (id: string, data: { name?: string; color?: string }) =>
    req<SavedRoute>(`/api/map-routes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteMapRoute: (id: string) => req<void>(`/api/map-routes/${id}`, { method: "DELETE" }),

  getMapShapes: () => req<SavedShape[]>("/api/map-shapes"),
  createMapShape: (data: Omit<SavedShape, "id" | "owner_id" | "created_at" | "updated_at">) =>
    req<SavedShape>("/api/map-shapes", { method: "POST", body: JSON.stringify(data) }),
  updateMapShape: (id: string, data: { name?: string; style?: ShapeStyle; geometry?: GeoJSON.Feature | GeoJSON.FeatureCollection }) =>
    req<SavedShape>(`/api/map-shapes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteMapShape: (id: string) => req<void>(`/api/map-shapes/${id}`, { method: "DELETE" }),

  getCustomDashboards: () => req<CustomDashboard[]>("/api/custom-dashboards"),
  getOrCreateAutoDashboard: () => req<CustomDashboard>("/api/custom-dashboards/auto"),
  createCustomDashboard: (name: string, widgets: DashboardWidget[]) =>
    req<CustomDashboard>("/api/custom-dashboards", { method: "POST", body: JSON.stringify({ name, widgets }) }),
  getCustomDashboard: (id: string) => req<CustomDashboard>(`/api/custom-dashboards/${id}`),
  updateCustomDashboard: (
    id: string,
    data: { name?: string; widgets?: DashboardWidget[]; is_public?: boolean; locked?: boolean; date_range_from?: string | null; date_range_to?: string | null }
  ) =>
    req<CustomDashboard>(`/api/custom-dashboards/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
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
  getDatasetCrosstab: (datasetId: string, primary: string, secondary: string) =>
    req<CrosstabRow[]>(`/api/datasets/${datasetId}/crosstab?primary=${encodeURIComponent(primary)}&secondary=${encodeURIComponent(secondary)}`),
  getDatasetSummary: (datasetId: string) => req<DatasetSummary>(`/api/datasets/${datasetId}/summary`),
  getDatasetDaily: (datasetId: string, field: string) =>
    req<{ date: string; count: number }[]>(`/api/datasets/${datasetId}/daily?field=${encodeURIComponent(field)}`),
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
