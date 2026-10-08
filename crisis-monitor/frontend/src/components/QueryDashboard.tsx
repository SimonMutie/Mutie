import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { api, type AlertItem, type EventItem, type MonitoringQueryItem, type QueryInsights, type QueryNote, type QueryNotebook, type QueryOverview, type QueryTopic, type QueryWatch } from "../api";
import { changeWords, downloadBriefing, printBriefing } from "../queryBriefing";
import { buildNotebookDigest } from "../queryNotebook";
import AlertDeliveryPanel from "./AlertDeliveryPanel";
import CategoryBadge, { categoryMeta } from "./CategoryBadge";
import MapPanel from "./query/MapPanel";
import VolumeLine from "./query/VolumeLine";
import SentimentChart from "./query/SentimentChart";
import TopicBubbles from "./query/TopicBubbles";
import SourcesPanel from "./query/SourcesPanel";
import StreamPanel from "./query/StreamPanel";
import DayView from "./query/DayView";
import AlertsPanel from "./query/AlertsPanel";
import StoriesPanel from "./query/StoriesPanel";
import NamesPanel from "./query/NamesPanel";
import PlaceTrend from "./query/PlaceTrend";
import OwnIncidents from "./query/OwnIncidents";
import NotebookPanel from "./query/NotebookPanel";
import DownloadMenu from "./query/DownloadMenu";
import { Panel, bucketLabel, timeAgo, useSize, viewerTz } from "./query/shared";
import "./query/QueryDashboard.css";

/**
 * One monitoring query's dashboard: where its items are, how many a day and
 * how that compares with the period before, what is open against it, its
 * top stories, the names and places in it and where its outlets are based,
 * the incidents it reads from live open-source reports, your notes, the items themselves,
 * and — from a click on any day — that day in detail.
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

const LAYOUT_KEY = "lens.queryDashboard.layout.v2";
const COLS = 12;
const ROW = 30;
const DEFAULT_LAYOUT: Layout[] = [
  { i: "map", x: 0, y: 0, w: 8, h: 14, minW: 4, minH: 8 },
  { i: "alerts", x: 8, y: 0, w: 4, h: 14, minW: 3, minH: 6 },
  { i: "volume", x: 0, y: 14, w: 6, h: 9, minW: 4, minH: 7 },
  { i: "sentiment", x: 6, y: 14, w: 3, h: 9, minW: 3, minH: 7 },
  { i: "sources", x: 9, y: 14, w: 3, h: 9, minW: 3, minH: 6 },
  { i: "stories", x: 0, y: 23, w: 7, h: 13, minW: 4, minH: 8 },
  { i: "names", x: 7, y: 23, w: 5, h: 13, minW: 3, minH: 8 },
  { i: "places", x: 0, y: 36, w: 6, h: 10, minW: 4, minH: 7 },
  { i: "incidents", x: 6, y: 36, w: 6, h: 14, minW: 3, minH: 8 },
  { i: "notes", x: 0, y: 46, w: 7, h: 18, minW: 4, minH: 10 },
  { i: "topics", x: 7, y: 46, w: 5, h: 18, minW: 3, minH: 8 },
  { i: "stream", x: 0, y: 64, w: 12, h: 13, minW: 4, minH: 8 },
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
  const [showAlerts, setShowAlerts] = useState(false);

  const [overview, setOverview] = useState<QueryOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The period the stream is showing. It only moves when the period changes or new items have arrived, so that a routine refresh does not reset a list the viewer is reading. */
  const [streamRange, setStreamRange] = useState<{ from: string; to: string } | null>(null);
  const [watch, setWatch] = useState<QueryWatch | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [insights, setInsights] = useState<QueryInsights | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [notes, setNotes] = useState<QueryNote[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notebook, setNotebook] = useState<QueryNotebook | null>(null);
  const [notebookError, setNotebookError] = useState<string | null>(null);
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
        if (fresh || lastTotal.current !== data.total) {
          setStreamRange(range);
          // Stories, names and rising terms: worked out afresh only when the period or its items have changed.
          api
            .getQueryInsights(query.id, range, tz)
            .then((i) => mine === request.current && (setInsights(i), setInsightsError(null)))
            .catch((err) => mine === request.current && setInsightsError(err instanceof Error ? err.message : "Could not be worked out just now."));
        }
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
    setInsights(null);
    setInsightsError(null);
    setStreamRange(null);
    setFilter(null);
    setSelectedDay(null);
    lastTotal.current = null;
    load(true);
    if (!("preset" in (JSON.parse(periodKey) as Period))) return;
    const timer = setInterval(() => load(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, periodKey]);

  // The watch: status against usual, open alerts, matching incidents. It is scored every 15 minutes; asking as often as the rest of the dashboard is plenty.
  const loadWatch = useCallback(() => {
    api
      .getQueryWatch(query.id)
      .then((w) => (setWatch(w), setWatchError(null)))
      .catch((err) => setWatchError(err instanceof Error ? err.message : "Alerts could not be loaded."));
  }, [query.id]);
  useEffect(() => {
    setWatch(null);
    setWatchError(null);
    loadWatch();
    const timer = setInterval(loadWatch, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadWatch]);

  useEffect(() => {
    setNotes(null);
    setNotesError(null);
    api
      .getQueryNotes(query.id)
      .then(setNotes)
      .catch((err) => (setNotes([]), setNotesError(err instanceof Error ? err.message : "Notes could not be loaded.")));
  }, [query.id]);

  useEffect(() => {
    setNotebook(null);
    setNotebookError(null);
    api
      .getQueryNotebook(query.id)
      .then(setNotebook)
      .catch((err) => setNotebookError(err instanceof Error ? err.message : "The summary could not be loaded."));
  }, [query.id]);

  // Live messages: a new alert appears at once; a new item brings the figures up to date a few seconds later.
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!liveMessage) return;
    if (liveMessage.type === "alert") {
      const al = liveMessage.payload as AlertItem;
      // An alert for this query, or a new escalation incident (not tied to any query) that may match it.
      if (al.query_id === query.id || al.query_id == null) loadWatch();
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
    setWatch((w) => w && { ...w, alerts: w.alerts.map((a) => (a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a)) });
  }
  async function handleResolve(id: string) {
    await api.resolveAlert(id);
    setWatch((w) => {
      if (!w) return w;
      const done = w.alerts.find((a) => a.id === id);
      const closed = done && done.metric_snapshot?.kind === "surge" ? [{ ...done, resolved_at: new Date().toISOString() }, ...w.closed].slice(0, 5) : w.closed;
      return { ...w, alerts: w.alerts.filter((a) => a.id !== id), closed };
    });
  }

  async function addNote(day: string, body: string) {
    const note = await api.addQueryNote(query.id, day, body);
    setNotes((prev) => [note, ...(prev ?? [])].sort((a, b) => b.day.localeCompare(a.day) || b.created_at.localeCompare(a.created_at)));
  }
  async function saveSummary(body: string) {
    setNotebook(await api.saveQueryNotebook(query.id, body, notebook?.updated_at ?? null));
  }
  async function draftSummary() {
    if (!overview) throw new Error("Wait for the figures to finish loading.");
    setNotebook(await api.draftQueryNotebook(query.id, buildNotebookDigest({ query, periodLabel, overview, insights, watch })));
  }
  async function restoreSummary() {
    setNotebook(await api.restoreQueryNotebook(query.id));
  }
  const briefingInput = () => (overview ? { query, periodLabel, overview, insights, watch, notes: notes ?? [], summary: notebook?.body.trim() ? notebook : null } : null);
  const downloadWord = () => {
    const b = briefingInput();
    if (b) downloadBriefing(b);
  };
  const downloadPdf = () => {
    const b = briefingInput();
    if (b) printBriefing(b);
  };

  async function deleteNote(id: string) {
    await api.deleteQueryNote(query.id, id);
    setNotes((prev) => (prev ?? []).filter((n) => n.id !== id));
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
    // The period just before, where the query is old enough for that to be a fair comparison.
    const prev = overview.previous && !overview.previous.partial ? overview.previous : null;
    const negative = toned ? Math.round((tone.negative / toned) * 100) : null;
    const prevNegative = prev?.negative != null ? Math.round(prev.negative * 100) : null;
    return {
      total: overview.total,
      totalChange: prev ? changeWords(overview.total, prev.total) : overview.previous?.partial ? "this query is newer than the previous period" : null,
      perDay: days.length ? overview.total / days.length : null,
      busiest: busiest && busiest.count > 0 ? busiest : null,
      negative,
      negativeChange:
        negative != null && prevNegative != null
          ? negative === prevNegative
            ? `the same as the previous period`
            : `${negative > prevNegative ? "up" : "down"} ${Math.abs(negative - prevNegative)} points on the previous period (${prevNegative}%)`
          : null,
    };
  }, [overview]);

  const openAlerts = (watch?.alerts.length ?? 0) + (watch?.incidents.length ?? 0);
  /** Today in the viewer's own calendar: the day a new note is offered for. */
  const today = useMemo(() => new Date(Date.now() + tz * 60_000).toISOString().slice(0, 10), [tz]);
  const search = (term: string, label?: string) => setFilter({ term: term.toLowerCase(), label: label ?? term });

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
        <DownloadMenu
          onWord={downloadWord}
          onPdf={downloadPdf}
          disabled={!overview}
          label="⭳ Briefing"
          title="One document of what this dashboard shows for the chosen period: your analytical summary, figures, open alerts, top stories, names, places, sources and notes"
        />
        <button onClick={onEdit} className="qd-btn">
          Edit
        </button>
        <button onClick={() => setShowAlerts((v) => !v)} className="qd-btn" aria-expanded={showAlerts}>
          {showAlerts ? "Hide alerts ▴" : "Alerts ▾"}
        </button>
        <button onClick={() => setShowQuery((v) => !v)} className="qd-btn" aria-expanded={showQuery}>
          {showQuery ? "Hide query syntax ▴" : "View query syntax ▾"}
        </button>
      </div>

      {showAlerts && (
        <div style={{ padding: "14px 24px", background: "var(--panel-raised)", borderBottom: "1px solid var(--border-soft)" }}>
          <div style={{ maxWidth: 640 }}>
            <AlertDeliveryPanel target={{ scope: "query", queryId: query.id }} />
          </div>
        </div>
      )}

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
          <Stat label="Items collected" value={stats ? stats.total.toLocaleString() : "—"} sub={`in ${periodLabel}`} change={stats?.totalChange} arrow={arrowOf(stats?.totalChange)} />
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
          <Stat
            label="Negative in tone"
            value={stats?.negative != null ? `${stats.negative}%` : "—"}
            sub="estimate from the wording"
            change={stats?.negativeChange}
            arrow={arrowOf(stats?.negativeChange)}
          />
          <Stat
            label="Open alerts"
            value={watch ? openAlerts.toLocaleString() : "—"}
            sub={watch?.status ? `${watch.status.last24h.toLocaleString()} items in the last 24 hours` : "for this query, now"}
            change={
              watch?.status && watch.status.state !== "learning"
                ? `a usual day has ${watch.status.usual < 1 ? "fewer than one" : `about ${Number.isInteger(watch.status.usual) ? watch.status.usual : watch.status.usual.toFixed(1)}`}`
                : null
            }
          />
        </div>

        <Health overview={overview} watch={watch} />

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
                <AlertsPanel watch={watch} error={watchError} onAcknowledge={handleAcknowledge} onResolve={handleResolve} onSearch={search} />
              </div>
              <div key="volume">
                <VolumeLine overview={overview} selectedDay={selectedDay} onSelectDay={setSelectedDay} notes={notes} />
              </div>
              <div key="sentiment">
                <SentimentChart overview={overview} onSelectDay={setSelectedDay} />
              </div>
              <div key="sources">
                <SourcesPanel overview={overview} onSearch={search} />
              </div>
              <div key="stories">
                <StoriesPanel insights={insights} error={insightsError} />
              </div>
              <div key="names">
                <NamesPanel insights={insights} error={insightsError} onSearch={search} />
              </div>
              <div key="places">
                <PlaceTrend overview={overview} onSearch={search} />
              </div>
              <div key="incidents">
                <OwnIncidents overview={overview} />
              </div>
              <div key="notes">
                <NotebookPanel
                  notebook={notebook}
                  notebookError={notebookError}
                  onSaveSummary={saveSummary}
                  onDraft={draftSummary}
                  onRestore={restoreSummary}
                  canDraft={!!overview}
                  onDownloadWord={downloadWord}
                  onDownloadPdf={downloadPdf}
                  notes={notes}
                  defaultDay={selectedDay ?? today}
                  error={notesError}
                  onAdd={addNote}
                  onDelete={deleteNote}
                  onOpenDay={setSelectedDay}
                />
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

/** "up …" and "down …" get an arrow; everything else is plain words. Direction is in the words too, never in colour: more coverage is neither good nor bad. */
const arrowOf = (change: string | null | undefined): "up" | "down" | undefined => (change?.startsWith("up ") ? "up" : change?.startsWith("down ") ? "down" : undefined);

function Stat({ label, value, sub, change, arrow }: { label: string; value: string; sub?: string; change?: string | null; arrow?: "up" | "down" }) {
  return (
    <div className="panel qd-stat">
      <div className="qd-stat__label">{label}</div>
      <div className="qd-stat__value">{value}</div>
      {sub && <div className="qd-stat__sub">{sub}</div>}
      {change && (
        <div className="qd-stat__change">
          {arrow && <span aria-hidden>{arrow === "up" ? "▲" : "▼"} </span>}
          {change}
        </div>
      )}
    </div>
  );
}

/** One line on whether collection is healthy: when the newest item came in, how the platform's own feeds are answering, and whether the wider news search is running. */
function Health({ overview, watch }: { overview: QueryOverview | null; watch: QueryWatch | null }) {
  const last = watch?.status?.lastItemAt ?? overview?.lastCollectedAt ?? null;
  const feeds = watch?.health.feeds ?? null;
  const search = watch?.health.search;
  if (!last && !feeds && !search) return null;
  const stale = last ? Date.now() - Date.parse(last) > 24 * 3_600_000 : false;
  return (
    <div className="qd-health" role="status">
      <span className="qd-health__label">Collection</span>
      {last ? (
        <span className={stale ? "is-warn" : ""} title={new Date(last).toLocaleString()}>
          {stale ? "⚠ " : ""}newest item {timeAgo(last)}
        </span>
      ) : (
        <span>no items yet</span>
      )}
      {feeds && feeds.ok + feeds.error + feeds.no_feed > 0 && (
        <span
          className={feeds.error > feeds.ok ? "is-warn" : ""}
          title={`Of the ${feeds.total} outlets the platform reads directly: ${feeds.ok} answering, ${feeds.error} failing, ${feeds.no_feed} with no feed to read, ${feeds.pending} not yet tried.`}
        >
          {feeds.error > feeds.ok ? "⚠ " : ""}
          {feeds.ok.toLocaleString()} of {feeds.total.toLocaleString()} outlet feeds answering{feeds.error > 0 ? `, ${feeds.error.toLocaleString()} failing` : ""}
        </span>
      )}
      {search?.state === "paused" && (
        <span className="is-warn" title="The wider news search limits how often it can be asked. The platform's own feeds are not affected.">
          ⚠ wider news search paused for about {search.minutes} min
        </span>
      )}
      {search?.state === "ok" && <span>wider news search running</span>}
      {search?.state === "off" && <span title="Items come from the outlets the platform reads directly.">wider news search off</span>}
    </div>
  );
}
