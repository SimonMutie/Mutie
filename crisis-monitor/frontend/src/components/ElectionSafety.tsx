import { useCallback, useEffect, useMemo, useState } from "react";
import { getToken, watchApi, type EwDashboard, type EwItem, type WatchKey } from "../api";
import { Donut, Spark, StackedColumns, Sunburst } from "./charts";
import ElectionMap, { type Metric, type MapUnit } from "./ElectionMap";
import { KE_WATCH_CONFIG, type WatchConfig } from "../data/watchConfig";

/**
 * Political violence, hate speech and related risks around the election: a
 * live dashboard fed by the platform's own news collection (every fifteen
 * minutes) and kept by analysts. Counts are of EVENTS (reports of the same
 * event are grouped), coded by rules from headlines, so they are a measure
 * of what is reported, not of everything that happens. Analysts verify or
 * reject items, and the page says how many are verified.
 */

export const EW_LABEL = KE_WATCH_CONFIG.labels;

const ago = (iso: string | null) => {
  if (!iso) return "not yet";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default function ElectionSafety({ isAdmin, watch = KE_WATCH_CONFIG, embedded = false }: { isAdmin: boolean; watch?: WatchConfig; embedded?: boolean }) {
  const w = watchApi(watch.key);
  const L = watch.labels;
  const H = watch.help;
  const CATS = watch.categories;
  const COLORS = watch.colors;
  const [days, setDays] = useState(90);
  const [ring, setRing] = useState<"sun" | "donut">("sun");
  const [dash, setDash] = useState<EwDashboard | null>(null);
  const [items, setItems] = useState<EwItem[] | null>(null);
  const [cat, setCat] = useState<string>("");
  const [county, setCounty] = useState("");
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, i] = await Promise.all([w.dashboard(days), w.items({ days, category: cat, county, status: onlyVerified ? "verified" : "", limit: 80 })]);
      setDash(d);
      setItems(i);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the live data.");
    }
  }, [days, cat, county, onlyVerified]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  /** Collects the feeds, then reads the news archive for the period on screen. Says what it found. */
  async function collectNow() {
    setNotice(null);
    const months = days === 365 ? 12 : Math.max(1, Math.round(days / 30));
    setBusy("collect");
    try {
      await w.collect(72);
      const r = await w.backfill(months);
      const when = days === 365 ? "the last year" : `the last ${days} days`;
      const progress = `${r.slicesDone} of ${r.slicesTotal} two-week slices read, ${r.scanned} stories read, ${r.inserted} new items coded`;
      const capped = r.capped ? ` Some slices reached GDELT's limit of 250 stories, so a few may be missing.` : "";
      const text =
        r.status === "done"
          ? `Collected ${when}: ${progress}.${capped}`
          : r.status === "rate_limited"
            ? `Collecting ${when}: ${progress}. GDELT is limiting requests, so the read has paused. It carries on automatically over the next hours, or press Collect now again to continue.${capped}`
            : `Collecting ${when}: ${progress}. Press Collect now to continue.${capped}`;
      setNotice(text);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Collection did not finish.");
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    try {
      const res = await fetch(w.csvUrl(days), { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) throw new Error("Download failed.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = `${watch.csvName}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    }
  }

  const trend = dash ? dash.last7 - dash.prev7 : 0;
  const hate = dash?.byCategory.hate_speech ?? 0;
  const metrics: Metric<MapUnit>[] = useMemo(
    () => [
      { key: "events", label: "Events", note: `Distinct events reported in each ${watch.noun} in the period. Reports of the same event are counted once. ${watch.nouns[0].toUpperCase()}${watch.nouns.slice(1)} with no event named in a report show as zero, which means nothing was reported, not that nothing happened.`, value: (c) => dash?.byCounty[c.code]?.events ?? 0, format: (n) => `${n} event${n === 1 ? "" : "s"}`, short: (n) => String(n) },
      { key: "deaths", label: "Reported deaths", note: `Deaths stated in reports, by ${watch.noun}. Tolls come from headlines and are lower bounds until verified.`, value: (c) => dash?.byCounty[c.code]?.deaths ?? 0, format: (n) => `${n} death${n === 1 ? "" : "s"}`, short: (n) => String(n) },
    ],
    [dash],
  );

  const maxWeek = dash ? Math.max(1, ...dash.weekly.map((w) => CATS.reduce((a, k) => a + Number(w[k] ?? 0), 0))) : 1;
  const weeks = dash?.weekly.slice(-14) ?? [];

  const Wrap = embedded ? "div" : "section";
  return (
    <Wrap className={embedded ? "el-safety-embed" : "el-section"} id="el-safety">
      {!embedded && (
        <>
          <p className="el-kicker">{watch.kicker}</p>
          <h2>{watch.heading}</h2>
          <div className="el-intro">
            <p>{watch.intro}</p>
          </div>
        </>
      )}

      <div className="el-live">
        <span className="el-live__dot" aria-hidden="true" />
        <span>
          Live · last collected {ago(dash?.lastCollectAt ?? null)}
          {dash?.lastScanned != null ? ` · ${dash.lastScanned} articles scanned` : ""}
        </span>
        <span className="el-live__spacer" />
        <div className="el-toggle el-toggle--tight" role="group" aria-label="Period">
          {[30, 90, 365].map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{d === 365 ? "1 year" : `${d} days`}</button>
          ))}
        </div>
        <button type="button" className="el-btn" onClick={download}>Download CSV</button>
        {isAdmin && (
          <button type="button" className="el-btn" disabled={busy === "collect"} onClick={() => collectNow()}>
            {busy === "collect" ? "Collecting…" : "Collect now"}
          </button>
        )}
      </div>
      {error && <p className="el-notice el-notice--error">{error}</p>}
      {notice && !error && <p className="el-notice">{notice}</p>}

      <div className="el-kpis">
        <div><strong>{dash?.events ?? "–"}</strong><span>events in {days === 365 ? "a year" : `${days} days`}</span><small>{dash?.reports ?? 0} reports behind them</small><Spark values={weeks.map((w) => CATS.reduce((a, k) => a + Number(w[k] ?? 0), 0))} label="Events per week" /></div>
        <div className={trend > 0 ? "is-up" : trend < 0 ? "is-down" : ""}>
          <strong>{dash?.last7 ?? "–"}</strong>
          <span>in the last 7 days</span>
          <small>{dash ? (trend === 0 ? "same as the week before" : `${trend > 0 ? "▲" : "▼"} ${Math.abs(trend)} ${trend > 0 ? "more" : "fewer"} than the week before (${dash.prev7})`) : ""}</small>
        </div>
        <div><strong>{dash?.deaths ?? "–"}</strong><span>deaths reported</span><small>from headlines; lower bounds</small></div>
        <div><strong>{hate}</strong><span>hate-speech cases</span><small>incitement and NCIC action reported</small></div>
        <div><strong>{dash && dash.events ? Math.round((dash.verified / dash.events) * 100) : 0}%</strong><span>verified by analysts</span><small>{dash?.verified ?? 0} of {dash?.events ?? 0} events</small></div>
      </div>

      <div className="el-safety__grid">
        <div className="el-card">
          <h3>Events per week</h3>
          {weeks.length === 0 ? (
            <p className="el-muted">Nothing collected yet. The first items appear after the next collection.</p>
          ) : (
            <StackedColumns
              label="Weekly events by type"
              height={190}
              columns={weeks.map((w) => ({
                label: when(String(w.week)),
                segments: CATS.map((k) => ({ key: k, label: L[k], value: Number(w[k] ?? 0), color: COLORS[k] })),
              }))}
            />
          )}
        </div>
        <div className="el-card">
          <h3>By type</h3>
          <div className="el-toggle el-toggle--tight" role="group" aria-label="Chart style">
            <button type="button" aria-pressed={ring === "sun"} onClick={() => setRing("sun")}>Sunburst</button>
            <button type="button" aria-pressed={ring === "donut"} onClick={() => setRing("donut")}>Donut</button>
          </div>
          {ring === "sun" ? (
            <Sunburst
              label="Events by type, grouped into families"
              size={210}
              groups={watch.groups
                .map((g) => ({
                  label: g.label,
                  color: COLORS[g.members[0]] ?? "var(--info)",
                  children: g.members.filter((k) => CATS.includes(k) && k !== "coverage").map((k) => ({ key: k, label: L[k], value: dash?.byCategory[k] ?? 0, color: COLORS[k] })),
                }))
                .filter((g) => g.children.length > 0)}
              selected={cat || null}
              onPick={(k) => setCat(cat === k ? "" : k)}
              centre={
                <>
                  <strong>{dash?.events ?? 0}</strong>
                  <span>events</span>
                </>
              }
            />
          ) : (
            <Donut
              label="Events by type"
              size={170}
              slices={CATS.filter((k) => k !== "coverage").map((k) => ({ key: k, label: L[k], value: dash?.byCategory[k] ?? 0, color: COLORS[k] }))}
              selected={cat || null}
              onPick={(k) => setCat(cat === k ? "" : k)}
              centre={
                <>
                  <strong>{dash?.events ?? 0}</strong>
                  <span>events</span>
                </>
              }
            />
          )}
          <p className="el-muted el-small">Click a type to filter the reports below.</p>
        </div>
      </div>

      <h3 className="el-subhead">Where it is happening</h3>
      <ElectionMap
        metrics={metrics}
        units={watch.mapUnits}
        geoUrl={watch.geoUrl}
        labelCodes={watch.labelCodes}
        noun={watch.nouns}
        aria={`Map of ${watch.nouns} by reported events`}
        rankLabel="Top 12"
        caption={`${watch.nouns[0].toUpperCase()}${watch.nouns.slice(1)} are placed from the place named in the report; reports that name none are not mapped.`}
        detail={(c) => [
          ["Events", String(dash?.byCounty[c.code]?.events ?? 0)],
          ["Reported deaths", String(dash?.byCounty[c.code]?.deaths ?? 0)],
          ...(watch.key === "ke" && "reg2022" in c ? [["Registered voters, 2022", (c as unknown as { reg2022: number }).reg2022.toLocaleString()] as [string, string]] : []),
        ]}
      />

      <h3 className="el-subhead">Latest reports</h3>
      <div className="el-filters">
        <select value={cat} onChange={(e) => setCat(e.target.value as string | "")} aria-label="Type">
          <option value="">All types</option>
          {CATS.filter((k) => k !== "coverage").map((k) => <option key={k} value={k}>{L[k]}</option>)}
        </select>
        <select value={county} onChange={(e) => setCounty(e.target.value)} aria-label={watch.noun[0].toUpperCase() + watch.noun.slice(1)}>
          <option value="">All {watch.nouns}</option>
          {watch.places.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <label><input type="checkbox" checked={onlyVerified} onChange={(e) => setOnlyVerified(e.target.checked)} /> Verified only</label>
        <span className="el-muted el-small">{items ? `${items.length} events shown` : ""}</span>
      </div>
      <ul className="el-reports">
        {items === null && <li className="el-muted">Loading…</li>}
        {items?.length === 0 && <li className="el-muted">No reports match. Collection runs every 15 minutes.</li>}
        {items?.map((it) => (
          <li key={it.id} className={it.status === "verified" ? "is-verified" : ""}>
            <span className="el-reports__bar" style={{ background: COLORS[it.category] ?? "var(--text-faint)" }} aria-hidden="true" />
            <div className="el-reports__body">
              <p className="el-reports__meta">
                <span className="el-reports__cat" style={{ color: COLORS[it.category] }}>{L[it.category]}</span>
                <span>{when(it.published_at)}</span>
                {it.county && <span>{it.county}</span>}
                {it.fatalities ? <span className="el-reports__deaths">{it.fatalities} dead</span> : null}
                {it.reports > 1 && <span>{it.reports} reports</span>}
                <span className={`el-status el-status--${it.status}`}>{it.status === "verified" ? "Verified" : "Unverified"}</span>
              </p>
              <a href={it.url} target="_blank" rel="noreferrer noopener">{it.title}</a>
              <p className="el-muted el-small">{it.domain}</p>
              {isAdmin && (
                <div className="el-reports__admin">
                  <button type="button" className="el-btn el-btn--small" disabled={busy === it.id} onClick={() => act(it.id, () => w.patchItem(it.id, { status: it.status === "verified" ? "auto" : "verified" }))}>
                    {it.status === "verified" ? "Unverify" : "Verify"}
                  </button>
                  <button type="button" className="el-btn el-btn--small" disabled={busy === it.id} onClick={() => act(it.id, () => w.patchItem(it.id, { status: "rejected" }))}>Reject</button>
                  <select value={it.category} aria-label="Type" onChange={(e) => act(it.id, () => w.patchItem(it.id, { category: e.target.value as string }))}>
                    {[...CATS, "coverage" as string].map((k) => <option key={k} value={k}>{L[k]}</option>)}
                  </select>
                  <select value={it.county_code ?? ""} aria-label={watch.noun} onChange={(e) => act(it.id, () => w.patchItem(it.id, { county_code: e.target.value || null }))}>
                    <option value="">No {watch.noun}</option>
                    {watch.places.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {isAdmin && <AddReport watch={watch} onAdded={load} />}
      <p className="el-muted el-small">Method: {watch.method} The page stores the headline, a short summary and the link, never the content of a hateful message. Rules can misread a headline, which is why items are marked unverified and can be corrected or rejected. Violence figures come from media reports and undercount events in remote areas and in counties with fewer outlets.</p>
    </Wrap>
  );
}

function AddReport({ watch, onAdded }: { watch: WatchConfig; onAdded: () => void }) {
  const w = watchApi(watch.key);
  const L = watch.labels;
  const CATS = watch.categories;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", url: "", category: CATS[0] as string, county_code: "", published_at: new Date().toISOString().slice(0, 10), fatalities: "" });
  const [msg, setMsg] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await w.addItem({ title: f.title.trim(), url: f.url.trim(), category: f.category, county_code: f.county_code || null, published_at: f.published_at, fatalities: f.fatalities === "" ? null : Number(f.fatalities) });
      setF({ ...f, title: "", url: "", fatalities: "" });
      setMsg("Added as verified.");
      onAdded();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not add that.");
    }
  }
  if (!open) return <button type="button" className="el-btn" onClick={() => setOpen(true)}>Add a report by hand</button>;
  return (
    <form className="el-form" onSubmit={save}>
      <h4>Add a report</h4>
      <label>Headline<input required minLength={5} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label>Link<input required type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
      <div className="el-form__row">
        <label>Type<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as string })}>{CATS.filter((k) => k !== "coverage").map((k) => <option key={k} value={k}>{L[k]}</option>)}</select></label>
        <label>{watch.noun[0].toUpperCase() + watch.noun.slice(1)}<select value={f.county_code} onChange={(e) => setF({ ...f, county_code: e.target.value })}><option value="">Not stated</option>{watch.places.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <label>Date<input required type="date" value={f.published_at} onChange={(e) => setF({ ...f, published_at: e.target.value })} /></label>
        <label>Deaths<input type="number" min={0} value={f.fatalities} onChange={(e) => setF({ ...f, fatalities: e.target.value })} /></label>
      </div>
      <div className="el-form__actions">
        <button type="submit" className="el-btn el-btn--primary">Add report</button>
        <button type="button" className="el-btn" onClick={() => setOpen(false)}>Close</button>
        {msg && <span className="el-muted el-small">{msg}</span>}
      </div>
    </form>
  );
}
