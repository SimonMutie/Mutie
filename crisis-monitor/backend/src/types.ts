export type SourceType = "social" | "news" | "darkweb" | "forum";
export type AlertLevel = "info" | "elevated" | "critical";

export interface EventRecord {
  id: string;
  source_id: string | null;
  source_type: SourceType;
  external_id: string | null;
  author: string | null;
  content: string;
  url: string | null;
  lang: string;
  sentiment: number | null;
  published_at: string;
  ingested_at: string;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_label: string | null;
  raw_metadata: Record<string, unknown>;
}

export interface MonitoringQuery {
  id: string;
  name: string;
  boolean_query: string;
  category: string;
  is_active: boolean;
  baseline_window_minutes: number;
  elevated_threshold: number;
  critical_threshold: number;
  /** NULL = "house" query not owned by any client, visible only to admins. */
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export type UserRole = "admin" | "client";

export interface UserRecord {
  id: string;
  username: string;
  display_name: string | null;
  role: UserRole;
  created_at: string;
}

export interface AlertRecord {
  id: string;
  query_id: string | null;
  level: AlertLevel;
  title: string;
  description: string;
  metric_snapshot: Record<string, unknown>;
  geo_label: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}
