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
  created_at?: string;
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

  uploadIncidentsBulk: (rows: IncidentRow[], batchLabel?: string) =>
    req<{ inserted: number; batch_id: string; batch_label: string | null }>("/api/incidents/bulk", {
      method: "POST",
      body: JSON.stringify({ rows, batch_label: batchLabel }),
    }),
  getIncidents: (params: { country?: string; province?: string; sector?: string; actor?: string; tactic?: string; severity?: string; from?: string; to?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
    ).toString();
    return req<IncidentItem[]>(`/api/incidents${qs ? `?${qs}` : ""}`);
  },
  getIncidentFilters: () => req<IncidentFilters>("/api/incidents/filters"),
  getIncidentStats: () => req<IncidentStats>("/api/incidents/stats"),
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
