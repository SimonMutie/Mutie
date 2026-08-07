/** D1/SQLite rows use TEXT for JSON and INTEGER (0/1) for booleans — convert to the app's real types here. */
import type { MonitoringQuery, EventRecord, AlertRecord } from "./types";

export function rowToMonitoringQuery(row: Record<string, unknown>): MonitoringQuery {
  return {
    id: String(row.id),
    name: String(row.name),
    boolean_query: String(row.boolean_query),
    category: String(row.category ?? "general"),
    is_active: Boolean(row.is_active),
    baseline_window_minutes: Number(row.baseline_window_minutes),
    elevated_threshold: Number(row.elevated_threshold),
    critical_threshold: Number(row.critical_threshold),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function rowToEvent(row: Record<string, unknown>): Partial<EventRecord> {
  return {
    ...row,
    raw_metadata: row.raw_metadata ? JSON.parse(String(row.raw_metadata)) : {},
  } as Partial<EventRecord>;
}

export function rowToAlert(row: Record<string, unknown>): AlertRecord & { query_name?: string; category?: string } {
  return {
    ...row,
    metric_snapshot: row.metric_snapshot ? JSON.parse(String(row.metric_snapshot)) : {},
  } as AlertRecord & { query_name?: string; category?: string };
}
