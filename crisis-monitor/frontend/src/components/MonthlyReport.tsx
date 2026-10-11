import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { reportApi, type RptPeriod, type RptReport, type RptSection, type RptStyle, type RptTheme, type WatchKey } from "../api";
import { WATCH_CONFIG } from "../data/watchConfig";
import ElectionMap from "./ElectionMap";
import { Donut, HBars, LineArea } from "./charts";
import ElectionSafety from "./ElectionSafety";
import Logo from "./Logo";
import { Reveal, useCountUp } from "../lib/motion";
import { exportAllowed } from "../exportGuard";
import { captureElementAsGif, type GifCaptureProgress } from "../gifCapture";
import { logoPng } from "../lib/brandLogo";
import { FONT_CSS, SIZE_SCALE, THEMES, THEME_ORDER, resolveStyle, themeVars } from "../lib/reportTheme";
import { buildDocx, buildPdf, buildPptx, save, snapshot, type ExportPage, type Snapshot } from "../report/monthlyExport";
import "./Election.css";

/**
 * The monthly report. Each part of the report is a page with the Lens mark on
 * it, set in the report's colour theme. Admins edit the text, the font, size
 * and alignment of each page inline; every page downloads on its own as PDF,
 * Word, an animated PowerPoint slide or an animated GIF. The month's numbers
 * are frozen when a report is published.
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
const n0 = (n: number) => n.toLocaleString("en-GB");

/** The data pages a month has before any written report exists. */
const DATA_SECTIONS: RptSection[] = [
  { id: "figures", kind: "figures", title: "The month in figures" },
  { id: "map", kind: "map", title: "Where it happened" },
  { id: "trend", kind: "trend", title: "Twelve months in view" },
  { id: "categories", kind: "categories", title: "What kind of events" },
];

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let p = from; p <= to; p = nextOf(p)) out.push(p);
  return out;
}

type Fmt = "pdf" | "docx" | "pptx" | "gif";
const FORMATS: { fmt: Fmt; label: string; hint: string }[] = [
  { fmt: "pdf", label: "PDF (.pdf)", hint: "The page as it looks" },
  { fmt: "docx", label: "Word (.docx)", hint: "Editable text and tables" },
  { fmt: "pptx", label: "PowerPoint (.pptx)", hint: "One slide, animated in" },
  { fmt: "gif", label: "Animated GIF (.gif)", hint: "The page animating in" },
];

export default function MonthlyReport({ country, isAdmin, liveExtra }: { country: WatchKey; isAdmin: boolean; liveExtra?: ReactNode }) {
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
  const [draftTheme, setDraftTheme] = useState<RptTheme>("lens");
  const [msg, setMsg] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<"live" | "month">("live");
  const [replay, setReplay] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [gifJob, setGifJob] = useState<{ sid: string; key: number } | null>(null);
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
    setMode("month");
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
    setDraftTheme(report.theme ?? "lens");
    setTitle(report.title);
    setEditing(true);
  };
  const flash = (text: string) => setMsg(text);
  const saveDraft = async () => {
    const r = await api.save(period, { title, theme: draftTheme, sections: draft });
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
  const patchStyle = (i: number, p: RptStyle) => setDraft((ds) => ds.map((s, k) => (k === i ? { ...s, style: { ...s.style, ...p } } : s)));

  /* ── the pages ───────────────────────────────────────────── */

  const sectionsShown: RptSection[] = editing ? draft : report ? report.sections : DATA_SECTIONS;
  const themeShown: RptTheme = editing ? draftTheme : report?.theme ?? "lens";
  const kicker = `${cfg.kicker} · Monthly report · ${monthLabel(period)}`;
  const footerLeft = `Afrilens Consulting · ${cfg.heading}`;

  // Which pages show: data pages for the month (figures, map, trend, categories) when in month mode,
  // written pages with text (all of them while editing), in the order the report sets.
  const pages: { id: string; kind: string; section?: RptSection; index?: number }[] = [{ id: "cover", kind: "cover" }];
  if (mode === "live") pages.push({ id: "live", kind: "live" });
  sectionsShown.forEach((s, i) => {
    if (s.kind === "narrative") {
      if (!editing && !(s.body ?? "").trim()) return;
      pages.push({ id: s.id, kind: "narrative", section: s, index: i });
    } else if (mode === "month") pages.push({ id: s.id, kind: s.kind, section: s, index: i });
  });
  const total = pages.length;

  const pageDisplay = (s: RptSection | undefined): CSSProperties => {
    const st = resolveStyle(s?.style);
    return {
      ...themeVars(themeShown),
      fontFamily: FONT_CSS[st.font],
      ["--font-display" as string]: FONT_CSS[st.font],
      ["--rp-scale" as string]: String(SIZE_SCALE[st.size]),
      textAlign: st.align,
    } as CSSProperties;
  };

  /* ── exports ─────────────────────────────────────────────── */

  const exportPageFor = (s: RptSection | undefined, id: string, kind: string, pageTitle: string, paragraphs: string[]): ExportPage => {
    const base = `${country}-${period}-${id}`;
    const common = { id, kind, title: pageTitle, paragraphs, kicker, theme: themeShown, style: s?.style, fileBase: base };
    if (kind === "figures")
      return {
        ...common,
        kpis: [
          { label: "events", value: n0(row.events) },
          { label: "verified by an analyst", value: n0(row.verified) },
          { label: "reported deaths", value: n0(row.fatalities) },
          { label: "reports collected", value: n0(row.reports) },
        ],
        table: {
          head: ["Measure", monthLabel(period), monthLabel(prevOf(period))],
          rows: [
            ["Events", row.events, prevRow.events],
            ["Verified by an analyst", row.verified, prevRow.verified],
            ["Reported deaths", row.fatalities, prevRow.fatalities],
            ["Reports collected", row.reports, prevRow.reports],
          ],
        },
      };
    if (kind === "map") {
      const placed = cfg.mapUnits.map((u) => ({ name: u.name, n: row.byPlace[u.code] ?? 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
      return { ...common, table: { head: [cfg.noun[0].toUpperCase() + cfg.noun.slice(1), "Events"], rows: placed.map((x) => [x.name, x.n]) } };
    }
    if (kind === "trend") return { ...common, table: { head: ["Month", "Events"], rows: trend.map((t) => [monthLabel(t.p), t.v]) } };
    if (kind === "categories") return { ...common, table: { head: ["Kind of event", "Events"], rows: catRows.map((c) => [cfg.labels[c.key] ?? c.key, c.n]) } };
    return common;
  };

  const runExport = async (fmt: Fmt, sid: string, pageEl: HTMLElement | null, page: ExportPage, bodyEl: HTMLElement | null, theme: RptTheme) => {
    if (!exportAllowed()) return;
    if (!pageEl) return;
    const label = (t: string) => setBusy((b) => ({ ...b, [sid]: t }));
    try {
      if (fmt === "gif") {
        setGifJob({ sid, key: Date.now() });
        return;
      }
      label("Preparing…");
      const logo = await logoPng(theme);
      if (fmt === "pdf") {
        const snap = await snapshot(pageEl, theme);
        save(buildPdf(snap), `${page.fileBase}.pdf`);
      } else {
        // Charts go into Word and slides as pictures; figures are drawn as figures and tables.
        const chart = bodyEl && ["map", "trend", "categories"].includes(page.kind) ? await snapshot(bodyEl, theme) : undefined;
        if (fmt === "docx") save(await buildDocx(page, chart, logo), `${page.fileBase}.docx`);
        else save(await buildPptx(page, { snap: chart, logo }), `${page.fileBase}.pptx`);
      }
    } catch {
      flash("That download did not work. Try again.");
    } finally {
      setBusy((b) => {
        const { [sid]: _gone, ...rest } = b;
        return rest;
      });
    }
  };

  // GIF: play the page's animation again from the start, and record it.
  useEffect(() => {
    if (!gifJob) return;
    const el = document.querySelector<HTMLElement>(`.rpt-page[data-sid="${gifJob.sid}"]`);
    const sid = gifJob.sid;
    setGifJob(null);
    if (!el) return;
    const label = (t: string) => setBusy((b) => ({ ...b, [sid]: t }));
    captureElementAsGif(
      el,
      (p: GifCaptureProgress) => label(p.phase === "capturing" ? `Recording ${p.current}/${p.total}…` : `Encoding ${Math.round(p.current * 100)}%…`),
      { frameCount: 24, frameDelayMs: 150, ignore: (n) => n.classList.contains("rpt-noprint") },
    )
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${country}-${period}-${sid}.gif`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      })
      .catch(() => flash("The GIF could not be recorded. Try again."))
      .finally(() =>
        setBusy((b) => {
          const { [sid]: _gone, ...rest } = b;
          return rest;
        }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gifJob]);

  const download = (sid: string, fmt: Fmt, page: ExportPage | null) => {
    if (fmt === "gif") {
      if (!exportAllowed()) return;
      setBusy((b) => ({ ...b, [sid]: "Recording…" }));
      setReplay((r) => ({ ...r, [sid]: (r[sid] ?? 0) + 1 }));
      setGifJob({ sid, key: Date.now() });
      return;
    }
    const pageEl = document.querySelector<HTMLElement>(`.rpt-page[data-sid="${sid}"]`);
    const bodyEl = pageEl?.querySelector<HTMLElement>(".rpt-page__body") ?? null;
    if (!page) return;
    void runExport(fmt, sid, pageEl, page, bodyEl, themeShown);
  };

  const isPub = report?.status === "published";

  return (
    <div className="rpt-wrap">
      {/* ── the time controls ─────────────────────────────── */}
      <div className="rpt-scrub rpt-noprint">
        <div className="rpt-scrub__head">
          <div>
            <p className="el-kicker">One dashboard: live, or month by month</p>
            <p className="rpt-scrub__now" aria-live="polite">{mode === "live" ? "Live" : monthLabel(period)}</p>
          </div>
          <div className="rpt-scrub__btns">
            <button type="button" className="rpt-btn" aria-pressed={mode === "live"} onClick={() => { setPlaying(false); setMode("live"); }}>Live</button>
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

      {/* ── admin bar ─────────────────────────────────────── */}
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

      {editing && (
        <div className="rpt-theme rpt-noprint" role="group" aria-label="Colour theme">
          <span className="rpt-theme__label">Colour theme</span>
          {THEME_ORDER.map((t) => (
            <button key={t} type="button" className="rpt-theme__btn" aria-pressed={draftTheme === t} onClick={() => setDraftTheme(t)}>
              <span className="rpt-theme__sw" style={{ background: THEMES[t].paper, borderColor: THEMES[t].rule }}>
                <i style={{ background: THEMES[t].band }} />
                <i style={{ background: THEMES[t].accent }} />
                <i style={{ background: THEMES[t].accent2 }} />
              </span>
              <span>
                <b>{THEMES[t].name}</b>
                <small>{THEMES[t].blurb}</small>
              </span>
            </button>
          ))}
          <label className="rpt-field rpt-field--inline">
            <span>Report title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>
      )}

      {/* ── the pages ─────────────────────────────────────── */}
      <article className="rpt-doc" aria-label={`Monthly report, ${monthLabel(period)}`}>
        {pages.map((pg, n) => {
          const s = pg.section;
          const sid = pg.id;
          const pageNo = n + 1;
          const dl = pg.kind !== "live";
          const page = buildPage(pg, s);
          const replayKey = `${sid}-${replay[sid] ?? 0}`;
          return (
            <Page
              key={replayKey}
              id={sid}
              pageNo={pageNo}
              total={total}
              style={pageDisplay(s)}
              kicker={kicker}
              footerLeft={footerLeft}
              title={pg.kind === "cover" ? title || `${monthLabel(period)} · ${cfg.heading}` : s?.title ?? ""}
              busy={busy[sid]}
              onDownload={dl ? (fmt) => download(sid, fmt, page) : undefined}
              editor={editing && s && pg.index !== undefined ? (
                <PageEditor
                  s={s}
                  index={pg.index}
                  count={draft.length}
                  onPatch={(p) => patch(pg.index!, p)}
                  onStyle={(p) => patchStyle(pg.index!, p)}
                  onMove={(d) => move(pg.index!, d)}
                  onRemove={() => removeSection(pg.index!)}
                />
              ) : undefined}
              isCover={pg.kind === "cover"}
            >
              {pg.kind === "cover" && (
                <header className="rpt-masthead">
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
                  {!report && !isAdmin && <p className="rpt-note">The written report for {monthLabel(period)} has not been published yet. The figures are live.</p>}
                </header>
              )}
              {pg.kind === "live" && (
                <>
                  <ElectionSafety isAdmin={isAdmin} watch={cfg} embedded />
                  {liveExtra}
                </>
              )}
              {pg.kind === "figures" && (
                <>
                  <div className="rpt-kpis">
                    <Kpi n={events} label="events" delta={delta} prev={prevRow.events} />
                    <Kpi n={verified} label="verified by an analyst" />
                    <Kpi n={fatalities} label="reported deaths" />
                    <Kpi n={reports} label="reports collected" />
                  </div>
                  <p className="rpt-note">Events are counted once, in the month their first report appeared. Counts measure what is reported and undercount.</p>
                </>
              )}
              {pg.kind === "map" && (
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
              )}
              {pg.kind === "trend" && (
                <>
                  <LineArea
                    label="Events per month over the last twelve months"
                    height={190}
                    current={trend.findIndex((t) => t.p === period)}
                    points={trend.map((t) => ({ label: shortLabel(t.p), value: t.v }))}
                  />
                  {trend.length < 3 && <p className="rpt-note">The trend fills in as each month adds to the record.</p>}
                </>
              )}
              {pg.kind === "categories" && (
                <>
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
                </>
              )}
              {pg.kind === "narrative" && s && <Narrative s={s} />}
            </Page>
          );
        })}

        {report === null && !isAdmin && <p className="rpt-empty">The written report for {monthLabel(period)} has not been published yet. The figures above are live.</p>}
        {report && !editing && !sectionsShown.some((s) => s.kind === "narrative" && (s.body ?? "").trim()) && <p className="rpt-empty">The analysis for this month is still being written.</p>}
        {editing && (
          <div className="rpt-editor rpt-noprint">
            <button type="button" className="rpt-btn" onClick={addNarrative}>+ Add an analyst note</button>
          </div>
        )}
      </article>
    </div>
  );

  /** The export data for a page, built from the month's numbers and the page's text and style. */
  function buildPage(pg: { id: string; kind: string }, s: RptSection | undefined): ExportPage | null {
    if (pg.kind === "live") return null;
    if (pg.kind === "cover")
      return exportPageFor(undefined, "cover", "cover", title || `${monthLabel(period)} · ${cfg.heading}`, [
        `${monthLabel(period)} · ${isPub ? "published" : report ? "draft" : "live figures, no report yet"}`,
        "Counts are of collected reports, coded by written rules and verified where marked. They measure what is reported and undercount.",
      ]);
    if (pg.kind === "narrative" && s) return exportPageFor(s, s.id, "narrative", s.title, (s.body ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean));
    if (s) return exportPageFor(s, s.id, s.kind, s.title, []);
    return null;
  }
}

/* ── a page ──────────────────────────────────────────────── */

function Page({
  id,
  pageNo,
  total,
  style,
  kicker,
  footerLeft,
  title,
  busy,
  onDownload,
  editor,
  isCover,
  children,
}: {
  id: string;
  pageNo: number;
  total: number;
  style: CSSProperties;
  kicker: string;
  footerLeft: string;
  title: string;
  busy?: string;
  onDownload?: (fmt: Fmt) => void;
  editor?: ReactNode;
  isCover: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`rpt-page ${isCover ? "rpt-page--cover" : ""}`} data-sid={id} style={style} aria-label={title || kicker}>
      <header className="rpt-page__band">
        <span className="rpt-page__mark"><Logo standalone size={28} /></span>
        <span className="rpt-page__brand">Afrilens · The Lens</span>
        <span className="rpt-page__kicker">{kicker}</span>
        {onDownload && <PageDownload busy={busy} onPick={onDownload} />}
      </header>
      {editor}
      <div className="rpt-page__body">
        {!isCover && title && <h3 className="rpt-h rpt-page__title">{title}</h3>}
        {isCover && <h2 className="rpt-title rpt-page__title">{title}</h2>}
        {children}
      </div>
      <footer className="rpt-page__foot">
        <span>{footerLeft}</span>
        <span>Page {pageNo} of {total}</span>
      </footer>
    </section>
  );
}

function PageDownload({ busy, onPick }: { busy?: string; onPick: (fmt: Fmt) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={ref} className="rpt-dl rpt-noprint">
      <button type="button" className="rpt-dl__btn" aria-haspopup="menu" aria-expanded={open} disabled={Boolean(busy)} onClick={() => setOpen((v) => !v)}>
        {busy ?? "Download ▾"}
      </button>
      {open && (
        <div role="menu" className="rpt-dl__menu">
          {FORMATS.map((f) => (
            <button
              key={f.fmt}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(f.fmt);
              }}
            >
              <b>{f.label}</b>
              <small>{f.hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The editor that sits on a page while it is being edited: text, font, size, alignment and order. */
function PageEditor({
  s,
  index,
  count,
  onPatch,
  onStyle,
  onMove,
  onRemove,
}: {
  s: RptSection;
  index: number;
  count: number;
  onPatch: (p: Partial<RptSection>) => void;
  onStyle: (p: RptStyle) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const font = s.style?.font ?? "sans";
  const size = s.style?.size ?? "m";
  const align = s.style?.align ?? "left";
  const seg = (label: string, pressed: boolean, set: () => void) => (
    <button type="button" className="rpt-seg" aria-pressed={pressed} onClick={set}>
      {label}
    </button>
  );
  return (
    <div className="rpt-pe rpt-noprint">
      <div className="rpt-pe__row">
        <input className="rpt-edit-title" value={s.title} onChange={(e) => onPatch({ title: e.target.value })} aria-label="Section title" />
        <span className="rpt-edit-kind">{s.kind === "narrative" ? "Written" : `Live: ${s.kind}`}</span>
        <button type="button" className="rpt-btn" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">↑</button>
        <button type="button" className="rpt-btn" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down">↓</button>
        <button type="button" className="rpt-btn" onClick={onRemove} aria-label="Remove section">Remove</button>
      </div>
      <div className="rpt-pe__row rpt-pe__style" role="group" aria-label="Text style">
        <span className="rpt-pe__lab">Font</span>
        {seg("Serif", font === "serif", () => onStyle({ font: "serif" }))}
        {seg("Sans", font === "sans", () => onStyle({ font: "sans" }))}
        {seg("Mono", font === "mono", () => onStyle({ font: "mono" }))}
        <span className="rpt-pe__lab">Size</span>
        {seg("S", size === "s", () => onStyle({ size: "s" }))}
        {seg("M", size === "m", () => onStyle({ size: "m" }))}
        {seg("L", size === "l", () => onStyle({ size: "l" }))}
        {seg("XL", size === "xl", () => onStyle({ size: "xl" }))}
        <span className="rpt-pe__lab">Align</span>
        {seg("Left", align === "left", () => onStyle({ align: "left" }))}
        {seg("Centre", align === "center", () => onStyle({ align: "center" }))}
        {seg("Right", align === "right", () => onStyle({ align: "right" }))}
        {seg("Justify", align === "justify", () => onStyle({ align: "justify" }))}
      </div>
      {s.kind === "narrative" ? (
        <>
          {s.carried && <p className="rpt-carried">Carried over from last month. Review before publishing.</p>}
          <textarea
            rows={Math.min(18, Math.max(4, (s.body ?? "").split("\n").length + 2))}
            value={s.body ?? ""}
            onChange={(e) => onPatch({ body: e.target.value })}
            placeholder="Write the analysis. Separate paragraphs with a blank line."
            aria-label="Section text"
          />
        </>
      ) : (
        <p className="rpt-note">This page draws from the month’s data. Its title and style can be changed; the figures cannot.</p>
      )}
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
  return (
    <Reveal>
      {paras.length ? paras.map((p, i) => <p key={i} className="rpt-prose">{p}</p>) : <p className="rpt-note">Nothing written yet.</p>}
    </Reveal>
  );
}
