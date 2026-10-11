import { useEffect, useMemo, useRef, useState } from "react";
import { reportApi, type RptPeriod, type RptReport, type RptSection, type WatchKey } from "../api";
import { WATCH_CONFIG } from "../data/watchConfig";
import ElectionMap from "./ElectionMap";
import { Donut, HBars, LineArea } from "./charts";
import { Reveal, useCountUp } from "../lib/motion";
import "./Election.css";

/**
 * The monthly report: a dashboard that runs through time, and the written
 * report for each month. Scrub or play through the months and the figures,
 * map, trend and categories move with them. Each month's written report is an
 * editable record; publishing freezes its numbers, and Save as PDF prints the
 * report page. Only admins edit.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (p: string) => `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;
const shortLabel = (p: string) => `${MONTHS[Number(p.slice(5)) - 1].slice(0, 3)} ${p.slice(2, 4)}`;
const nowPeriod = () => new Date().toISOString().slice(0, 7);
const prevOf = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};
const nextOf = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};
const EMPTY = (period: string): RptPeriod => ({ period, reports: 0, events: 0, verified: 0, fatalities: 0, byCategory: {}, byPlace: {} });

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let p = from; p <= to; p = nextOf(p)) out.push(p);
  return out;
}

export default function MonthlyReport({ country, isAdmin }: { country: WatchKey; isAdmin: boolean }) {
  const cfg = WATCH_CONFIG[country];
  const api = useMemo(() => reportApi(country), [country]);
  const [series, setSeries] = useState<RptPeriod[]>([]);
  const [published, setPublished] = useState<string[]>([]);
  const [period, setPeriod] = useState<string>(nowPeriod());
  const [report, setReport] = useState<RptReport | null | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RptSection[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const picked = useRef(false);

  const months = useMemo(() => {
    const first = series[0]?.period ?? nowPeriod();
    return monthsBetween(first < prevOf(nowPeriod()) ? first : prevOf(nowPeriod()), nowPeriod());
  }, [series]);

  // Load the series and the list of reports once, then open the latest published month.
  useEffect(() => {
    api.series().then((r) => setSeries(r.periods)).catch(() => {});
    api.list().then((rows) => {
      const pubs = rows.filter((r) => r.status === "published").map((r) => r.period).sort();
      setPublished(pubs);
      if (!picked.current && pubs.length) setPeriod(pubs[pubs.length - 1]);
    }).catch(() => {});
  }, [api]);

  const loadReport = () =>
    api.get(period).then((r) => {
      setReport(r.report);
      setTitle(r.report?.title ?? r.title);
      setCanEdit(Boolean(r.can_edit));
    }).catch(() => setReport(null));
  useEffect(() => {
    setEditing(false);
    setMsg(null);
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, period]);

  // Playback through the months.
  useEffect(() => {
    if (!playing) return;
    const i = months.indexOf(period);
    if (i < 0 || i >= months.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setPeriod(months[i + 1]), 1400);
    return () => clearTimeout(t);
  }, [playing, period, months]);

  const choose = (p: string) => {
    picked.current = true;
    setPeriod(p);
  };

  // The month's numbers: frozen at publish for a published report, live otherwise.
  const liveRow = series.find((p) => p.period === period) ?? EMPTY(period);
  const row: RptPeriod = report?.status === "published" && report.snapshot ? report.snapshot : liveRow;
  const prevRow = series.find((p) => p.period === prevOf(period)) ?? EMPTY(prevOf(period));
  const isFrozen = report?.status === "published" && Boolean(report.snapshot);

  const events = useCountUp(row.events);
  const verified = useCountUp(row.verified);
  const fatalities = useCountUp(row.fatalities);
  const reports = useCountUp(row.reports);

  const categories = (cfg.categories as string[]).filter((c) => c !== "coverage");
  const catRows = categories.map((c) => ({ key: c, n: row.byCategory[c] ?? 0 })).sort((a, b) => b.n - a.n);

  const trend = useMemo(() => {
    const idx = months.indexOf(period);
    const window = months.slice(Math.max(0, idx - 11), idx + 1);
    return window.map((p) => ({ p, v: (series.find((s) => s.period === p)?.events ?? 0) }));
  }, [months, period, series]);
  const trendMax = Math.max(1, ...trend.map((t) => t.v));

  const metrics = useMemo(
    () => [
      {
        key: "events",
        label: "Events",
        note: `Events placed by ${cfg.nouns} in ${monthLabel(period)}.`,
        value: (u: { code: string }) => row.byPlace[u.code] ?? 0,
        format: (n: number) => `${n} event${n === 1 ? "" : "s"}`,
      },
    ],
    [row.byPlace, period, cfg.nouns],
  );

  const delta = row.events - prevRow.events;

  /* ── editing ─────────────────────────────────────────────── */

  const startEdit = () => {
    if (!report) return;
    setDraft(report.sections.map((s) => ({ ...s })));
    setTitle(report.title);
    setEditing(true);
  };
  const flash = (text: string) => setMsg(text);
  const saveDraft = async () => {
    const r = await api.save(period, { title, sections: draft });
    if (r.ok) {
      flash("Saved.");
      await loadReport();
      return true;
    }
    flash(r.error ?? "Could not save.");
    return false;
  };
  const publish = async () => {
    if (!(await saveDraft())) return;
    const r = await api.publish(period);
    if (r.ok) {
      flash("Published. The month’s figures are now frozen in this report.");
      setPublished((p) => [...new Set([...p, period])].sort());
      setEditing(false);
      await loadReport();
    } else flash(r.error ?? "Could not publish.");
  };
  const reopen = async () => {
    const r = await api.reopen(period);
    if (r.ok) {
      flash("Reopened for editing. Publishing again refreshes the frozen figures.");
      setPublished((p) => p.filter((x) => x !== period));
      await loadReport();
      startEdit();
    } else flash(r.error ?? "Could not reopen.");
  };
  const startThis = async () => {
    const r = await api.start(period);
    if (r.ok) await loadReport();
    else flash(r.error ?? "Could not start the report.");
  };
  const startNext = async () => {
    const next = nextOf(period);
    const r = await api.start(next);
    if (r.ok) {
      flash(`Started ${monthLabel(next)}. The narrative carried over is marked for review.`);
      choose(next);
    } else flash(r.error ?? "Could not start the next month.");
  };

  const move = (i: number, d: -1 | 1) =>
    setDraft((ds) => {
      const j = i + d;
      if (j < 0 || j >= ds.length) return ds;
      const copy = [...ds];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const addNarrative = () =>
    setDraft((ds) => [...ds, { id: `note-${Date.now().toString(36)}`, kind: "narrative", title: "Analyst note", body: "" }]);
  const removeSection = (i: number) => setDraft((ds) => ds.filter((_, k) => k !== i));
  const patch = (i: number, p: Partial<RptSection>) => setDraft((ds) => ds.map((s, k) => (k === i ? { ...s, ...p, carried: false } : s)));

  const savePdf = () => {
    const prev = document.title;
    document.title = `${country.toUpperCase()} monthly report, ${monthLabel(period)}`;
    window.print();
    setTimeout(() => (document.title = prev), 500);
  };

  const isPub = report?.status === "published";
  const hasNarrative = report?.sections.some((s) => s.kind === "narrative" && (s.body ?? "").trim());

  return (
    <div className="rpt-wrap">
      {/* ── the time controls ─────────────────────────────── */}
      <div className="rpt-scrub rpt-noprint">
        <div className="rpt-scrub__head">
          <div>
            <p className="el-kicker">Animate across the months</p>
            <p className="rpt-scrub__now" aria-live="polite">{monthLabel(period)}</p>
          </div>
          <div className="rpt-scrub__btns">
            <button type="button" className="rpt-btn" onClick={() => choose(months[Math.max(0, months.indexOf(period) - 1)])} disabled={months.indexOf(period) <= 0} aria-label="Previous month">◀</button>
            <button type="button" className="rpt-btn rpt-btn--play" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>{playing ? "Pause" : "Play"}</button>
            <button type="button" className="rpt-btn" onClick={() => choose(months[Math.min(months.length - 1, months.indexOf(period) + 1)])} disabled={months.indexOf(period) >= months.length - 1} aria-label="Next month">▶</button>
          </div>
        </div>
        <input
          type="range"
          className="rpt-range"
          min={0}
          max={Math.max(0, months.length - 1)}
          value={Math.max(0, months.indexOf(period))}
          onChange={(e) => {
            setPlaying(false);
            choose(months[Number(e.target.value)]);
          }}
          aria-label="Choose a month"
          aria-valuetext={monthLabel(period)}
        />
        <div className="rpt-ticks" aria-hidden="true">
          {months.map((m) => (
            <button key={m} type="button" tabIndex={-1} className={`rpt-tick ${m === period ? "is-on" : ""} ${published.includes(m) ? "is-pub" : ""}`} onClick={() => choose(m)} title={monthLabel(m)}>
              <span>{shortLabel(m)}</span>
            </button>
          ))}
        </div>
        <p className="rpt-legend rpt-noprint"><span className="rpt-dot rpt-dot--pub" /> Published report <span className="rpt-dot" /> Live figures, no report yet</p>
      </div>

      {/* ── the report ───────────────────────────────────── */}
      <article className="rpt-doc" aria-label={`Monthly report, ${monthLabel(period)}`}>
        <header className="rpt-masthead">
          <p className="rpt-kicker">{cfg.kicker} · Monthly report</p>
          <h2 className="rpt-title">{title || `${monthLabel(period)} · ${cfg.heading}`}</h2>
          <p className="rpt-meta">
            {monthLabel(period)} ·{" "}
            {isPub ? (
              <span className="rpt-status rpt-status--pub">Published {report?.published_at ? new Date(report.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}{isFrozen ? ", figures frozen" : ""}</span>
            ) : report ? (
              <span className="rpt-status">Draft</span>
            ) : (
              <span className="rpt-status">Live figures, no report yet</span>
            )}
          </p>
        </header>

        {/* admin bar */}
        {isAdmin && (
          <div className="rpt-admin rpt-noprint">
            {!report && <button type="button" className="rpt-btn rpt-btn--primary" onClick={startThis}>Start the {monthLabel(period)} report</button>}
            {report && !editing && !isPub && <button type="button" className="rpt-btn rpt-btn--primary" onClick={startEdit}>Edit report</button>}
            {report && !editing && isPub && <button type="button" className="rpt-btn" onClick={reopen}>Reopen to edit</button>}
            {report && <button type="button" className="rpt-btn" onClick={startNext}>Start {monthLabel(nextOf(period))}</button>}
            {editing && (
              <>
                <button type="button" className="rpt-btn rpt-btn--primary" onClick={saveDraft}>Save draft</button>
                <button type="button" className="rpt-btn rpt-btn--primary" onClick={publish}>Save and publish</button>
                <button type="button" className="rpt-btn" onClick={() => setEditing(false)}>Stop editing</button>
              </>
            )}
            {msg && <span className="rpt-msg" role="status">{msg}</span>}
          </div>
        )}

        {/* figures */}
        <section className="rpt-section" aria-labelledby="rpt-figs">
          <h3 id="rpt-figs" className="rpt-h">The month in figures</h3>
          <div className="rpt-kpis">
            <Kpi n={events} label="events" delta={delta} prev={prevRow.events} />
            <Kpi n={verified} label="verified by an analyst" />
            <Kpi n={fatalities} label="reported deaths" />
            <Kpi n={reports} label="reports collected" />
          </div>
          <p className="rpt-note">Events are counted once, in the month their first report appeared. Counts measure what is reported and undercount.</p>
        </section>

        {/* map */}
        <section className="rpt-section" aria-labelledby="rpt-map">
          <h3 id="rpt-map" className="rpt-h">Where it happened</h3>
          <Reveal>
            <ElectionMap
              key={`${country}-${period}`}
              metrics={metrics}
              defaultKey="events"
              units={cfg.mapUnits}
              geoUrl={cfg.geoUrl}
              labelCodes={cfg.labelCodes}
              noun={cfg.noun}
              aria={`Map of ${cfg.nouns} by events in ${monthLabel(period)}`}
              rankLabel="Top 12"
              withBubbles={country === "ke"}
              caption={`${monthLabel(period)}, placed by the place named in each report.`}
              detail={(c) => [["Events", String(row.byPlace[c.code] ?? 0)]]}
            />
          </Reveal>
        </section>

        {/* trend */}
        <section className="rpt-section" aria-labelledby="rpt-trend">
          <h3 id="rpt-trend" className="rpt-h">Twelve months in view</h3>
          <LineArea
            label="Events per month over the last twelve months"
            height={190}
            current={trend.findIndex((t) => t.p === period)}
            points={trend.map((t) => ({ label: shortLabel(t.p), value: t.v }))}
          />
          {trend.length < 3 && <p className="rpt-note">The trend fills in as each month adds to the record.</p>}
        </section>

        {/* categories */}
        <section className="rpt-section" aria-labelledby="rpt-cats">
          <h3 id="rpt-cats" className="rpt-h">What kind of events</h3>
          <div className="rpt-two">
            <Donut
              label="Share of events by kind"
              size={170}
              slices={catRows.filter((c) => c.n > 0).map((c) => ({ key: c.key, label: cfg.labels[c.key] ?? c.key, value: c.n, color: cfg.colors[c.key] ?? "var(--info)" }))}
              centre={
                <>
                  <strong>{row.events}</strong>
                  <span>events</span>
                </>
              }
            />
            <HBars
              label="Events by kind"
              data={catRows.map((c) => ({ label: cfg.labels[c.key] ?? c.key, value: c.n, color: cfg.colors[c.key] ?? "var(--info)" }))}
            />
          </div>
          {catRows.every((c) => c.n === 0) && <p className="rpt-note">No events were placed in this month.</p>}
        </section>

        {/* the written report */}
        {report === null && !isAdmin && (
          <p className="rpt-empty">The written report for {monthLabel(period)} has not been published yet. The figures above are live.</p>
        )}
        {report && !editing && report.sections.map((s) => (s.kind === "narrative" ? <Narrative key={s.id} s={s} /> : null))}
        {report && !editing && !hasNarrative && <p className="rpt-empty">The analysis for this month is still being written.</p>}

        {editing && (
          <div className="rpt-editor rpt-noprint">
            <label className="rpt-field">
              <span>Report title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            {draft.map((s, i) => (
              <div key={s.id} className="rpt-edit-card">
                <div className="rpt-edit-card__head">
                  <input className="rpt-edit-title" value={s.title} onChange={(e) => patch(i, { title: e.target.value })} aria-label="Section title" />
                  <span className="rpt-edit-kind">{s.kind === "narrative" ? "Written" : `Live: ${s.kind}`}</span>
                  <button type="button" className="rpt-btn" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button type="button" className="rpt-btn" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button type="button" className="rpt-btn" onClick={() => removeSection(i)} aria-label="Remove section">Remove</button>
                </div>
                {s.kind === "narrative" ? (
                  <>
                    {s.carried && <p className="rpt-carried">Carried over from last month. Review before publishing.</p>}
                    <textarea
                      rows={Math.min(18, Math.max(4, (s.body ?? "").split("\n").length + 2))}
                      value={s.body ?? ""}
                      onChange={(e) => patch(i, { body: e.target.value })}
                      placeholder="Write the analysis. Separate paragraphs with a blank line."
                    />
                  </>
                ) : (
                  <p className="rpt-note">This section draws from the month’s data and needs no text.</p>
                )}
              </div>
            ))}
            <button type="button" className="rpt-btn" onClick={addNarrative}>+ Add an analyst note</button>
          </div>
        )}

        <footer className="rpt-foot">
          <p>Sources and method are in the report. Counts are of collected reports, coded by written rules and verified where marked.</p>
          <div className="rpt-noprint">
            <button type="button" className="rpt-btn rpt-btn--primary" onClick={savePdf}>Save as PDF</button>
          </div>
        </footer>
      </article>
    </div>
  );
}

function Kpi({ n, label, delta, prev }: { n: number; label: string; delta?: number; prev?: number }) {
  return (
    <div className="rpt-kpi">
      <strong>{n.toLocaleString("en-GB")}</strong>
      <span>{label}</span>
      {delta !== undefined && prev !== undefined && (
        <small className={delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}>
          {delta === 0 ? "level with last month" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)} on ${prev} last month`}
        </small>
      )}
    </div>
  );
}

function Narrative({ s }: { s: RptSection }) {
  const paras = (s.body ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return null;
  return (
    <section className="rpt-section rpt-section--text" aria-labelledby={`rpt-${s.id}`}>
      <Reveal>
        <h3 id={`rpt-${s.id}`} className="rpt-h">{s.title}</h3>
        {paras.map((p, i) => (
          <p key={i} className="rpt-prose">{p}</p>
        ))}
      </Reveal>
    </section>
  );
}
