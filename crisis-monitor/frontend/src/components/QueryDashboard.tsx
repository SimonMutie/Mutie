import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { api, type AlertItem, type EventItem, type MonitoringQueryItem, type QueryOverview, type QueryTopic } from "../api";
import AlertFeed from "./AlertFeed";
import CategoryBadge, { categoryMeta } from "./CategoryBadge";
import MapPanel from "./query/MapPanel";
import VolumeLine from "./query/VolumeLine";
import SentimentChart from "./query/SentimentChart";
import TopicBubbles from "./query/TopicBubbles";
import SourcesPanel from "./query/SourcesPanel";
import StreamPanel from "./query/StreamPanel";
import DayView from "./query/DayView";
import { Panel, bucketLabel, useSize, viewerTz } from "./query/shared";
import "./query/QueryDashboard.css";

/**
 * One monitoring query's dashboard: where its items are, how many a day,
 * what they are about and in what tone, the items themselves, and — from a
 * click on any day — that day in detail.
 *
 * The panels sit on a grid: each can be dragged by its header and resized
 * from its corner, and the arrangement is remembered on this browser.
 */

interface Props {
  query: MonitoringQueryItem;
  liveMessage: { type: string; payload: unknown } | null;
  onBack: () => void;
  onEdit: () => void;
  /** Switches this query's layer on and returns to the Live OSINT map. */
  onShowOnMap: () => void;
}

// ── The period ───────────────────────────────────────────────────────────

const PRESETS = [
  { key: "24h", label: "24 hours", hours: 24 },
  { key: "7d", label: "7 days", hours: 24 * 7 },
  { key: "30d", label: "30 days", hours: 24 * 30 },
  { key: "90d", label: "90 days", hours: 24 * 90 },
] as const;
type PresetKey = (typeof PRESETS)[number]["key"];
/** A preset keeps moving with the clock; a custom period is fixed. */
type Period = { preset: PresetKey } | { from: string; to: string };

function resolve(period: Period): { from: string; to: string } {
  if (!("preset" in period)) return period;
  const hours = PRESETS.find((p) => p.key === period.preset)!.hours;
  const now = new Date();
  // Whole days start at the viewer's midnight, so the first day on the line is a full one.
  const start = new Date(now.getTime() - hours * 3_600_000);
  if (hours > 48) start.setHours(0, 0, 0, 0);
  return { from: start.toISOString(), to: now.toISOString() };
}

/** New items arrive with the platform's five-minute collection run (and
 *  are also announced live, which refreshes sooner), so there is nothing to
 *  gain from asking more often — and each refresh costs the server work. */
const REFRESH_MS = 5 * 60_000;

// ── The arrangement of panels ────────────────────────────────────────────

const LAYOUT_KEY = "lens.queryDashboard.layout.v1";
const COLS = 12;
const ROW = 30;
const DEFAULT_LAYOUT: Layout[] = [
  { i: "map", x: 0, y: 0, w: 8, h: 14, minW: 4, minH: 8 },
  { i: "alerts", x: 8, y: 0, w: 4, h: 14, minW: 3, minH: 6 },
  { i: "volume", x: 0, y: 14, w: 6, h: 9, minW: 4, minH: 7 },
  { i: "sentiment", x: 6, y: 14, w: 3, h: 9, minW: 3, minH: 7 },
  { i: "sources", x: 9, y: 14, w: 3, h: 9, minW: 3, minH: 6 },
  { i: "topics", x: 0, y: 23, w: 5, h: 13, minW: 3, minH: 8 },
  { i: "stream", x: 5, y: 23, w: 7, h: 13, minW: 4, minH: 8 },
];

/** The saved arrangement, if it still describes exactly today's panels. */
function loadLayout(): Layout[] {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Layout[] | null;
    if (Array.isArray(saved) && saved.length === DEFAULT_LAYOUT.length && DEFAULT_LAYOUT.every((d) => saved.some((s) => s.i === d.i))) {
      return DEFAULT_LAYOUT.map((d) => {
        const s = saved.find((x) => x.i === d.i)!;
        return { ...d, x: Number(s.x) || 0, y: Number(s.y) || 0, w: Math.max(d.minW ?? 1, Number(s.w) || d.w), h: Math.max(d.minH ?? 1, Number(s.h) || d.h) };
      });
    }
  } catch {
    // unreadable or unavailable: the default arrangement applies
  }
  return DEFAULT_LAYOUT;
}

export default function QueryDashboard({ query, liveMessage, onBack, onEdit, onShowOnMap }: Props) {
  const tz = viewerTz();
  const [period, setPeriod] = useState<Period>({ preset: "30d" });
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showQuery, setShowQuery] = useState(false);

  const [overview, setOverview] = useState<QueryOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The period the stream is showing. It only moves when the period changes or new items have arrived, so that a routine refresh does not reset a list the viewer is reading. */
  const [streamRange, setStreamRange] = useState<{ from: string; to: string } | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  /** Names the query and period whose data is on screen. It changes together with that data — not when a new period is merely chosen — so the map re-frames the new items, never the old ones. */
  const [shownKey, setShownKey] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ term: string; label: string } | null>(null);

  const [layout, setLayout] = useState<Layout[]>(loadLayout);
  const [gridRef, gridSize] = useSize<HTMLDivElement>();
  /** On a narrow screen the panels simply stack, full width, in reading order. */
  const stacked = gridSize.width > 0 && gridSize.width < 900;

  const periodKey = JSON.stringify(period);
  const lastTotal = useRef<number | null>(null);
  const request = useRef(0);

  const load = useCallback(
    async (fresh: boolean) => {
      const mine = ++request.current;
      const range = resolve(JSON.parse(periodKey) as Period);
      setLoading(true);
      try {
        const data = await api.getQueryOverview(query.id, range, tz);
        if (mine !== request.current) return;
        setOverview(data);
        if (fresh) setShownKey(`${query.id}:${periodKey}`);
        setError(null);
        if (fresh || lastTotal.current !== data.total) setStreamRange(range);
        lastTotal.current = data.total;
      } catch (err) {
        if (mine === request.current) setError(err instanceof Error ? err.message : "Could not load this dashboard.");
      } finally {
        if (mine === request.current) setLoading(false);
      }
    },
    [query.id, periodKey, tz],
  );

  // A new query or period starts clean; a moving period is then refreshed every few minutes.
  useEffect(() => {
    setOverview(null);
    setStreamRange(null);
    setFilter(null);
    setSelectedDay(null);
    lastTotal.current = null;
    load(true);
    if (!("preset" in (JSON.parse(periodKey) as Period))) return;
    const timer = setInterval(() => load(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, periodKey]);

  useEffect(() => {
    api
      .getAlerts({ query_id: query.id, status: "open" })
      .then(setAlerts)
      .catch(() => setAlerts([]));
  }, [query.id]);

  // Live messages: a new alert appears at once; a new item brings the figures up to date a few seconds later.
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!liveMessage) return;
    if (liveMessage.type === "alert") {
      const al = liveMessage.payload as AlertItem;
      if (al.query_id === query.id) setAlerts((prev) => (prev.some((a) => a.id === al.id) ? prev : [al, ...prev]));
    } else if (liveMessage.type === "event" && "preset" in period) {
      const ev = liveMessage.payload as EventItem;
      if (!ev.matched_query_ids?.includes(query.id)) return;
      if (liveTimer.current) clearTimeout(liveTimer.current);
      liveTimer.current = setTimeout(() => load(false), 4000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMessage]);
  useEffect(() => () => void (liveTimer.current && clearTimeout(liveTimer.current)), []);

  async function handleAcknowledge(id: string) {
    await api.acknowledgeAlert(id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a)));
  }
  async function handleResolve(id: string) {
    await api.resolveAlert(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  function applyCustom() {
    if (!customFrom || !customTo) return;
    // Whole days in the viewer's own time: from the first midnight to the end of the last day.
    const from = new Date(`${customFrom}T00:00:00`);
    const to = new Date(`${customTo}T23:59:59`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return;
    setPeriod({ from: from.toISOString(), to: to.toISOString() });
  }

  function onLayoutChange(next: Layout[]) {
    if (stacked) return; // the stacked arrangement is not the viewer's own; never save it
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))));
    } catch {
      // not remembered; it still applies now
    }
  }
  function resetLayout() {
    setLayout(DEFAULT_LAYOUT);
    try {
      localStorage.removeItem(LAYOUT_KEY);
    } catch {
      // nothing to forget
    }
  }
  const rearranged = useMemo(() => layout.some((l) => DEFAULT_LAYOUT.some((d) => d.i === l.i && (d.x !== l.x || d.y !== l.y || d.w !== l.w || d.h !== l.h))), [layout]);

  const periodLabel = useMemo(() => {
    if ("preset" in period) return `the last ${PRESETS.find((p) => p.key === period.preset)!.label}`;
    return `${new Date(period.from).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} – ${new Date(period.to).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  }, [period]);

  // Headline figures for the period.
  const stats = useMemo(() => {
    if (!overview) return null;
    const days = overview.volume.filter((v) => v.bucket.length === 10);
    const busiest = overview.volume.reduce<QueryOverview["volume"][number] | null>((best, v) => (v.count > (best?.count ?? 0) ? v : best), null);
    const tone = overview.sentiment.overall;
    const toned = tone.negative + tone.neutral + tone.positive;
    return {
      total: overview.total,
      perDay: days.length ? overview.total / days.length : null,
      busiest: busiest && busiest.count > 0 ? busiest : null,
      negative: toned ? Math.round((tone.negative / toned) * 100) : null,
    };
  }, [overview]);

  const stackedLayout = useMemo<Layout[]>(() => {
    let y = 0;
    return DEFAULT_LAYOUT.map((d) => {
      const item = { i: d.i, x: 0, y, w: 1, h: d.h, static: true };
      y += d.h;
      return item;
    });
  }, []);

  const selectTopic = (t: QueryTopic | null) => setFilter(t ? { term: t.term, label: t.label } : null);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 24px", borderBottom: "1px solid var(--border-soft)", flexWrap: "wrap", rowGap: 8 }}>
        <button onClick={onBack} className="qd-btn">
          ← Live OSINT
        </button>
        <CategoryBadge category={query.category} size={26} />
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{query.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{categoryMeta(query.category).label}</div>
        </div>
        <button onClick={onShowOnMap} className="qd-btn" style={{ borderColor: "var(--signal)", color: "var(--text-primary)", background: "var(--signal-dim)", fontWeight: 600 }}>
          Show on Live OSINT map
        </button>
        <button onClick={onEdit} className="qd-btn">
          Edit
        </button>
        <button onClick={() => setShowQuery((v) => !v)} className="qd-btn" aria-expanded={showQuery}>
          {showQuery ? "Hide query syntax ▴" : "View query syntax ▾"}
        </button>
      </div>

      {showQuery && (
        <div
          className="mono"
          style={{ padding: "10px 24px", fontSize: 12, color: "var(--text-muted)", background: "var(--panel-raised)", borderBottom: "1px solid var(--border-soft)", wordBreak: "break-word" }}
        >
          {query.boolean_query}
        </div>
      )}

      {/* One filter row; everything below it shows the same period. */}
      <div className="qd-filters">
        <span>Period</span>
        <div className="qd-seg" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={"preset" in period && period.preset === p.key ? "is-on" : ""}
              aria-pressed={"preset" in period && period.preset === p.key}
              onClick={() => {
                setPeriod({ preset: p.key });
                setCustomOpen(false);
              }}
            >
              {p.label}
            </button>
          ))}
          <button type="button" className={!("preset" in period) || customOpen ? "is-on" : ""} aria-pressed={!("preset" in period)} aria-expanded={customOpen} onClick={() => setCustomOpen((v) => !v)}>
            Custom…
          </button>
        </div>
        {customOpen && (
          <>
            <input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From" />
            <span>to</span>
            <input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} aria-label="To" />
            <button type="button" className="qd-btn" onClick={applyCustom} disabled={!customFrom || !customTo}>
              Apply
            </button>
          </>
        )}
        <span style={{ color: "var(--text-faint)" }}>
          {overview ? `Showing ${periodLabel}` : "Loading…"}
          {loading && overview && " · updating…"}
        </span>
        <span className="qd-filters__spacer" />
        {!stacked && (
          <>
            <span style={{ color: "var(--text-faint)" }}>Drag a panel by its title · resize from its corner</span>
            <button type="button" className="qd-btn" onClick={resetLayout} disabled={!rearranged}>
              Reset layout
            </button>
          </>
        )}
      </div>

      <div className="qd-root">
        {error && (
          <div className="qd-error" style={{ padding: "10px 24px" }}>
            {error}
          </div>
        )}

        <div className="qd-stats" style={{ opacity: loading && overview ? 0.7 : 1 }}>
          <Stat label="Items collected" value={stats ? stats.total.toLocaleString() : "—"} sub={`in ${periodLabel}`} />
          <Stat
            label="Average per day"
            value={stats?.perDay != null ? (stats.perDay >= 10 ? Math.round(stats.perDay).toLocaleString() : stats.perDay.toFixed(1)) : "—"}
            sub={overview?.bucket === "hour" ? "period under two days" : undefined}
          />
          <Stat
            label={overview?.bucket === "hour" ? "Busiest hour" : "Busiest day"}
            value={stats?.busiest ? stats.busiest.count.toLocaleString() : "—"}
            sub={stats?.busiest ? bucketLabel(stats.busiest.bucket, overview?.bucket === "hour") : undefined}
          />
          <Stat label="Negative in tone" value={stats?.negative != null ? `${stats.negative}%` : "—"} sub="estimate from the wording" />
          <Stat label="Open alerts" value={alerts.filter((a) => !a.resolved_at).length.toLocaleString()} sub="for this query, now" />
        </div>

        <div ref={gridRef} className={`qd-grid${stacked ? " qd-static" : ""}`}>
          {gridSize.width > 0 && (
            <GridLayout
              width={gridSize.width}
              layout={stacked ? stackedLayout : layout}
              cols={stacked ? 1 : COLS}
              rowHeight={ROW}
              margin={[12, 12]}
              containerPadding={[10, 12]}
              isDraggable={!stacked}
              isResizable={!stacked}
              draggableHandle=".qd-panel__head"
              draggableCancel=".qd-panel__actions"
              resizeHandles={["se"]}
              onLayoutChange={onLayoutChange}
            >
              <div key="map">
                <MapPanel overview={overview} fitKey={shownKey} />
              </div>
              <div key="alerts">
                <Panel title="Alerts" note="open, for this query" bodyStyle={{ padding: 0 }}>
                  <AlertFeed embedded alerts={alerts} onAcknowledge={handleAcknowledge} onResolve={handleResolve} />
                </Panel>
              </div>
              <div key="volume">
                <VolumeLine overview={overview} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
              </div>
              <div key="sentiment">
                <SentimentChart overview={overview} onSelectDay={setSelectedDay} />
              </div>
              <div key="sources">
                <SourcesPanel overview={overview} onSearch={(term) => setFilter({ term: term.toLowerCase(), label: term })} />
              </div>
              <div key="topics">
                <TopicBubbles overview={overview} selected={filter?.term ?? null} onSelect={selectTopic} />
              </div>
              <div key="stream">
                {streamRange ? (
                  <StreamPanel
                    queryId={query.id}
                    queryName={query.name}
                    selection={{ ...streamRange, tz }}
                    periodLabel={periodLabel.replace(/^the /, "The ")}
                    topic={filter}
                    onClearTopic={() => setFilter(null)}
                  />
                ) : (
                  <Panel title="Information stream">
                    <div className="qd-empty">Loading…</div>
                  </Panel>
                )}
              </div>
            </GridLayout>
          )}
        </div>
      </div>

      {selectedDay && <DayView queryId={query.id} queryName={query.name} day={selectedDay} onClose={() => setSelectedDay(null)} />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel qd-stat">
      <div className="qd-stat__label">{label}</div>
      <div className="qd-stat__value">{value}</div>
      {sub && <div className="qd-stat__sub">{sub}</div>}
    </div>
  );
}
