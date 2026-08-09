import { useCallback, useEffect, useState } from "react";
import { api, type AlertItem, type EventItem, type MonitoringQueryItem, type StatsSummary } from "../api";
import WorldMap from "./WorldMap";
import AlertFeed from "./AlertFeed";
import VolumeChart from "./VolumeChart";
import SourceBreakdown from "./SourceBreakdown";
import TimeRangeControl, { type TimeRange } from "./TimeRangeControl";

interface Props {
  query: MonitoringQueryItem;
  liveMessage: { type: string; payload: unknown } | null;
  onBack: () => void;
}

export default function QueryDashboard({ query, liveMessage, onBack }: Props) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [range, setRange] = useState<TimeRange | null>(null); // null = live rolling window

  const loadAll = useCallback(async () => {
    const [ev, al, s] = await Promise.all([
      api.getEvents({ query_id: query.id, limit: range ? 500 : 150, ...(range ?? {}) }),
      api.getAlerts({ query_id: query.id, status: "open" }),
      api.getSummary(query.id, range ?? undefined),
    ]);
    setEvents(ev);
    setAlerts(al);
    setSummary(s);
  }, [query.id, range]);

  useEffect(() => {
    setEvents([]);
    setAlerts([]);
    setSummary(null);
    loadAll();

    if (range) return; // browsing a fixed historical range — no need to keep polling it

    const interval = setInterval(() => {
      api.getSummary(query.id).then(setSummary).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [loadAll, query.id, range]);

  useEffect(() => {
    if (!liveMessage || range) return; // ignore the live feed while browsing history
    if (liveMessage.type === "event") {
      const ev = liveMessage.payload as EventItem;
      if (ev.matched_query_ids?.includes(query.id)) {
        setEvents((prev) => [ev, ...prev].slice(0, 200));
      }
    } else if (liveMessage.type === "alert") {
      const al = liveMessage.payload as AlertItem;
      if (al.query_id === query.id) {
        setAlerts((prev) => [al, ...prev]);
      }
    }
  }, [liveMessage, query.id, range]);

  async function handleAcknowledge(id: string) {
    await api.acknowledgeAlert(id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a)));
  }

  async function handleResolve(id: string) {
    await api.resolveAlert(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "12px 24px",
          borderBottom: "1px solid var(--border-soft)",
          flexWrap: "wrap",
          rowGap: 8,
        }}
      >
        <button onClick={onBack} style={backBtnStyle}>
          ← All queries
        </button>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {query.name}
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
            {query.boolean_query}
          </div>
        </div>
        <TimeRangeControl value={range} onChange={setRange} />
        <span className="eyebrow">{query.category.replace(/_/g, " ")}</span>
      </div>

      {range && (
        <div
          style={{
            padding: "6px 24px",
            fontSize: 11.5,
            color: "var(--text-faint)",
            borderBottom: "1px solid var(--border-soft)",
          }}
        >
          Showing {new Date(range.from).toLocaleString()} – {new Date(range.to).toLocaleString()}. The alert feed
          still shows currently open alerts (alerts aren't scoped to this range).
        </div>
      )}

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gridTemplateRows: "1.4fr 1fr",
          gap: 12,
          padding: 12,
          minHeight: 0,
        }}
      >
        <div className="panel" style={{ gridColumn: "1 / 2", gridRow: "1 / 2", overflow: "hidden" }}>
          <WorldMap events={events} alerts={alerts} />
        </div>

        <div style={{ gridColumn: "2 / 3", gridRow: "1 / 3" }}>
          <AlertFeed alerts={alerts} onAcknowledge={handleAcknowledge} onResolve={handleResolve} />
        </div>

        <div style={{ gridColumn: "1 / 2", gridRow: "2 / 3", display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12, minHeight: 0 }}>
          <VolumeChart data={summary?.volume_series ?? []} label={range ? "SELECTED RANGE" : undefined} />
          <SourceBreakdown
            bySource={summary?.by_source ?? []}
            sentiment={summary?.sentiment ?? { negative: 0, neutral: 0, positive: 0 }}
            label={range ? "SELECTED RANGE" : undefined}
          />
        </div>
      </div>
    </div>
  );
}

const backBtnStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 10px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-muted)",
  cursor: "pointer",
  flexShrink: 0,
};
