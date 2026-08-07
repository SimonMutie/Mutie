import { useEffect, useRef, useState, useCallback } from "react";
import { api, connectLiveFeed, type EventItem, type AlertItem, type MonitoringQueryItem, type StatsSummary } from "./api";
import TopBar from "./components/TopBar";
import WorldMap from "./components/WorldMap";
import AlertFeed from "./components/AlertFeed";
import VolumeChart from "./components/VolumeChart";
import SourceBreakdown from "./components/SourceBreakdown";
import QueryBuilder from "./components/QueryBuilder";

export default function App() {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [queries, setQueries] = useState<MonitoringQueryItem[]>([]);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const recentTimestamps = useRef<number[]>([]);
  const [eventsPerMinute, setEventsPerMinute] = useState(0);

  const loadAll = useCallback(async () => {
    const [ev, al, q, s] = await Promise.all([
      api.getEvents({ limit: 150 }),
      api.getAlerts("open"),
      api.getQueries(),
      api.getSummary(),
    ]);
    setEvents(ev);
    setAlerts(al);
    setQueries(q);
    setSummary(s);
    const counts: Record<string, number> = {};
    for (const tq of s.top_queries) counts[tq.id] = tq.matches;
    setMatchCounts(counts);
  }, []);

  useEffect(() => {
    loadAll();
    const summaryInterval = setInterval(() => {
      api.getSummary().then(setSummary).catch(() => {});
    }, 15000);
    return () => clearInterval(summaryInterval);
  }, [loadAll]);

  useEffect(() => {
    const disconnect = connectLiveFeed((type, payload) => {
      setConnected(true);
      if (type === "event") {
        const ev = payload as EventItem;
        setEvents((prev) => [ev, ...prev].slice(0, 200));
        recentTimestamps.current.push(Date.now());
      } else if (type === "alert") {
        setAlerts((prev) => [payload as AlertItem, ...prev]);
      }
    });

    const rateInterval = setInterval(() => {
      const cutoff = Date.now() - 60_000;
      recentTimestamps.current = recentTimestamps.current.filter((t) => t > cutoff);
      setEventsPerMinute(recentTimestamps.current.length);
    }, 2000);

    const heartbeat = setInterval(() => setConnected((c) => c), 5000);

    return () => {
      disconnect();
      clearInterval(rateInterval);
      clearInterval(heartbeat);
    };
  }, []);

  async function handleAcknowledge(id: string) {
    await api.acknowledgeAlert(id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a)));
  }

  async function handleResolve(id: string) {
    await api.resolveAlert(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar
        connected={connected}
        eventsPerMinute={eventsPerMinute}
        openAlertCount={summary?.open_alert_count ?? alerts.length}
      />

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gridTemplateRows: "1.4fr 1fr 0.9fr",
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
          <VolumeChart data={summary?.volume_series ?? []} />
          <SourceBreakdown
            bySource={summary?.by_source ?? []}
            sentiment={summary?.sentiment ?? { negative: 0, neutral: 0, positive: 0 }}
          />
        </div>

        <div style={{ gridColumn: "1 / 3", gridRow: "3 / 4", minHeight: 0 }}>
          <QueryBuilder queries={queries} matchCounts={matchCounts} onChanged={loadAll} />
        </div>
      </div>
    </div>
  );
}
