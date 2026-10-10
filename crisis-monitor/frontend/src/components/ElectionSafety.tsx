import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getToken, type EwCategory, type EwDashboard, type EwItem } from "../api";
import ElectionMap, { type Metric } from "./ElectionMap";
import { COUNTIES } from "../data/kenyaElection";

/**
 * Political violence, hate speech and related risks around the election: a
 * live dashboard fed by the platform's own news collection (every fifteen
 * minutes) and kept by analysts. Counts are of EVENTS (reports of the same
 * event are grouped), coded by rules from headlines, so they are a measure
 * of what is reported, not of everything that happens. Analysts verify or
 * reject items, and the page says how many are verified.
 */

export const EW_LABEL: Record<EwCategory, string> = {
  political_violence: "Political violence",
  protest_policing: "Protest violence and policing",
  abduction: "Abductions and disappearances",
  election_admin: "Attacks on election administration",
  intimidation: "Threats and intimidation",
  hate_speech: "Hate speech and incitement",
  disinformation: "Election disinformation",
  coverage: "Election coverage",
};
const EW_HELP: Record<string, string> = {
  political_violence: "Attacks, clashes, killings and arson linked to politicians, rallies or supporters.",
  protest_policing: "Deaths, injuries and force at protests and demonstrations.",
  abduction: "Abductions, kidnappings and disappearances of political actors, activists and critics.",
  election_admin: "Attacks on IEBC offices, registration centres and staff.",
  intimidation: "Reported threats, harassment and intimidation of candidates, voters and journalists.",
  hate_speech: "Reports of hate speech, ethnic incitement and NCIC action.",
  disinformation: "Reported fake or manipulated content about politics and the vote.",
};
const CATS = Object.keys(EW_HELP) as EwCategory[];
const COLORS: Record<string, string> = {
  political_violence: "#d1352b",
  protest_policing: "#e07a1f",
  abduction: "#8a3ffc",
  election_admin: "#2f66f0",
  intimidation: "#b3690b",
  hate_speech: "#c2185b",
  disinformation: "#0d9488",
};

const ago = (iso: string | null) => {
  if (!iso) return "not yet";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default function ElectionSafety({ isAdmin }: { isAdmin: boolean }) {
  const [days, setDays] = useState(90);
  const [dash, setDash] = useState<EwDashboard | null>(null);
  const [items, setItems] = useState<EwItem[] | null>(null);
  const [cat, setCat] = useState<EwCategory | "">("");
  const [county, setCounty] = useState("");
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, i] = await Promise.all([api.ewDashboard(days), api.ewItems({ days, category: cat, county, status: onlyVerified ? "verified" : "", limit: 80 })]);
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

  async function download() {
    try {
      const res = await fetch(api.ewCsvUrl(days), { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) throw new Error("Download failed.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = `kenya-election-watch-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    }
  }

  const trend = dash ? dash.last7 - dash.prev7 : 0;
  const hate = dash?.byCategory.hate_speech ?? 0;
  const metrics: Metric[] = useMemo(
    () => [
      { key: "events", label: "Events", note: "Distinct events reported in each county in the period. Reports of the same event are counted once. Counties with no event named in a report show as zero, which means nothing was reported, not that nothing happened.", value: (c) => dash?.byCounty[c.code]?.events ?? 0, format: (n) => `${n} event${n === 1 ? "" : "s"}`, short: (n) => String(n) },
      { key: "deaths", label: "Reported deaths", note: "Deaths stated in reports of political violence, protest policing, abductions and attacks on election administration, by county. Tolls come from headlines and are lower bounds until verified.", value: (c) => dash?.byCounty[c.code]?.deaths ?? 0, format: (n) => `${n} death${n === 1 ? "" : "s"}`, short: (n) => String(n) },
    ],
    [dash],
  );

  const maxWeek = dash ? Math.max(1, ...dash.weekly.map((w) => CATS.reduce((a, k) => a + Number(w[k] ?? 0), 0))) : 1;
  const weeks = dash?.weekly.slice(-14) ?? [];

  return (
    <section className="el-section" id="el-safety">
      <p className="el-kicker">Live monitoring</p>
      <h2>Violence and hate speech</h2>
      <div className="el-intro">
        <p>
          Political violence, intimidation, hate speech, election disinformation and attacks on election administration, collected from the platform’s news feeds every 15 minutes and coded by type and county. Counts are of events, with duplicate reports grouped. They measure what is reported, so they undercount, and every item starts unverified until an analyst checks it.
        </p>
      </div>

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
          <button type="button" className="el-btn" disabled={busy === "collect"} onClick={() => act("collect", () => api.ewCollect(72))}>
            {busy === "collect" ? "Collecting…" : "Collect now"}
          </button>
        )}
      </div>
      {error && <p className="el-notice el-notice--error">{error}</p>}

      <div className="el-kpis">
        <div><strong>{dash?.events ?? "–"}</strong><span>events in {days === 365 ? "a year" : `${days} days`}</span><small>{dash?.reports ?? 0} reports behind them</small></div>
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
          <div className="el-weeks" role="img" aria-label="Stacked weekly bars of events by type">
            {weeks.length === 0 && <p className="el-muted">Nothing collected yet. The first items appear after the next collection.</p>}
            {weeks.map((w) => {
              const total = CATS.reduce((a, k) => a + Number(w[k] ?? 0), 0);
              return (
                <div key={String(w.week)} className="el-weeks__col" title={`Week of ${w.week}: ${total} events`}>
                  <span className="el-weeks__n">{total || ""}</span>
                  <span className="el-weeks__stack" style={{ height: `${(total / maxWeek) * 100}%` }}>
                    {CATS.map((k) => (Number(w[k] ?? 0) > 0 ? <i key={k} style={{ flex: Number(w[k]), background: COLORS[k] }} /> : null))}
                  </span>
                  <span className="el-weeks__d">{when(String(w.week))}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="el-card">
          <h3>By type</h3>
          <ul className="el-types">
            {CATS.map((k) => (
              <li key={k}>
                <button type="button" aria-pressed={cat === k} onClick={() => setCat(cat === k ? "" : k)}>
                  <i style={{ background: COLORS[k] }} />
                  <span><b>{EW_LABEL[k]}</b><small>{EW_HELP[k]}</small></span>
                  <strong>{dash?.byCategory[k] ?? 0}</strong>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <h3 className="el-subhead">Where it is happening</h3>
      <ElectionMap
        metrics={metrics}
        rankLabel="Top 12"
        caption="Counties are placed from the place named in the report; reports that name none are not mapped."
        detail={(c) => [
          ["Events", String(dash?.byCounty[c.code]?.events ?? 0)],
          ["Reported deaths", String(dash?.byCounty[c.code]?.deaths ?? 0)],
          ["Registered voters, 2022", c.reg2022.toLocaleString()],
        ]}
      />

      <h3 className="el-subhead">Latest reports</h3>
      <div className="el-filters">
        <select value={cat} onChange={(e) => setCat(e.target.value as EwCategory | "")} aria-label="Type">
          <option value="">All types</option>
          {CATS.map((k) => <option key={k} value={k}>{EW_LABEL[k]}</option>)}
        </select>
        <select value={county} onChange={(e) => setCounty(e.target.value)} aria-label="County">
          <option value="">All counties</option>
          {COUNTIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
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
                <span className="el-reports__cat" style={{ color: COLORS[it.category] }}>{EW_LABEL[it.category]}</span>
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
                  <button type="button" className="el-btn el-btn--small" disabled={busy === it.id} onClick={() => act(it.id, () => api.ewPatchItem(it.id, { status: it.status === "verified" ? "auto" : "verified" }))}>
                    {it.status === "verified" ? "Unverify" : "Verify"}
                  </button>
                  <button type="button" className="el-btn el-btn--small" disabled={busy === it.id} onClick={() => act(it.id, () => api.ewPatchItem(it.id, { status: "rejected" }))}>Reject</button>
                  <select value={it.category} aria-label="Type" onChange={(e) => act(it.id, () => api.ewPatchItem(it.id, { category: e.target.value as EwCategory }))}>
                    {[...CATS, "coverage" as EwCategory].map((k) => <option key={k} value={k}>{EW_LABEL[k]}</option>)}
                  </select>
                  <select value={it.county_code ?? ""} aria-label="County" onChange={(e) => act(it.id, () => api.ewPatchItem(it.id, { county_code: e.target.value || null }))}>
                    <option value="">No county</option>
                    {COUNTIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {isAdmin && <AddReport onAdded={load} />}
      <p className="el-muted el-small">Method: headlines and feed summaries from Kenyan and regional outlets are coded by written rules (type, county, stated deaths). The page stores the headline, a short summary and the link, never the content of a hateful message. Rules can misread a headline, which is why items are marked unverified and can be corrected or rejected. Violence figures come from media reports and undercount events in remote areas and in counties with fewer outlets.</p>
    </section>
  );
}

function AddReport({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", url: "", category: "political_violence" as EwCategory, county_code: "", published_at: new Date().toISOString().slice(0, 10), fatalities: "" });
  const [msg, setMsg] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.ewAddItem({ title: f.title.trim(), url: f.url.trim(), category: f.category, county_code: f.county_code || null, published_at: f.published_at, fatalities: f.fatalities === "" ? null : Number(f.fatalities) });
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
        <label>Type<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as EwCategory })}>{CATS.map((k) => <option key={k} value={k}>{EW_LABEL[k]}</option>)}</select></label>
        <label>County<select value={f.county_code} onChange={(e) => setF({ ...f, county_code: e.target.value })}><option value="">Not stated</option>{COUNTIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
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
