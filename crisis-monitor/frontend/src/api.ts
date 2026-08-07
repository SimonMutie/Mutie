const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000";

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
  created_at: string;
}

export interface StatsSummary {
  by_source: { source_type: string; count: number }[];
  sentiment: { negative: number; neutral: number; positive: number };
  volume_series: { minute: string; count: number }[];
  open_alert_count: number;
  top_queries: { id: string; name: string; category: string; matches: number }[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  health: () => req<{ status: string }>("/api/health"),
  getEvents: (params: { limit?: number; source_type?: string; query_id?: string } = {}) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return req<EventItem[]>(`/api/events${qs ? `?${qs}` : ""}`);
  },
  getGeoEvents: (minutes = 120) => req<EventItem[]>(`/api/events/geo?minutes=${minutes}`),
  getAlerts: (status: "open" | "resolved" | "all" = "open") => req<AlertItem[]>(`/api/alerts?status=${status}`),
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
  getSummary: () => req<StatsSummary>("/api/stats/summary"),
  getEscalationHistory: (queryId: string) =>
    req<{ window_end: string; escalation_score: number; volume: number }[]>(`/api/stats/escalation/${queryId}`),
};

export function connectLiveFeed(onMessage: (type: string, payload: unknown) => void): () => void {
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let retryDelay = 1000;

  function connect() {
    ws = new WebSocket(`${WS_URL}/ws`);
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
