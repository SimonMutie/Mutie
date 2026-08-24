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
