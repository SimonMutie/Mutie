import { useEffect, useMemo, useState } from "react";
import { api, type CountrySpotlightPage, type SpotlightScenario } from "../api";
import "./CountrySpotlight.css";

/**
 * The self-updating country spotlight at the top of a country's page under Regional Spotlight: built from the Lens's
 * escalation and strategic-picture data and written to US intelligence tradecraft (bottom line, key judgements on the
 * ICD 203 scale, alternative futures from two critical uncertainties, signposts, key assumptions, a wildcard, an
 * indicator matrix). Between editions the Lens checks every signpost against new incidents, so the page shows
 * which futures are gaining ground, and every edition's scenario likelihoods are kept to show their drift.
 */

const STATUS: Record<string, string> = { active: "Active armed conflict", "risk-high": "At risk of armed conflict (high)", "risk-low": "At risk of armed conflict (low)", none: "No armed conflict" };
const TREND: Record<string, { arrow: string; label: string; cls: string }> = { worsening: { arrow: "↓", label: "Worsening", cls: "bad" }, steady: { arrow: "→", label: "Steady", cls: "flat" }, improving: { arrow: "↑", label: "Improving", cls: "good" } };
const LEVEL_RANK = { negligible: 1, low: 2, moderate: 3, substantial: 4, serious: 5 } as const;
const SCEN_COLOR: Record<string, string> = { A: "#2f66f0", B: "#b3690b", C: "#0d9488", D: "#d1352b" };

const paras = (s: string) => s.split(/\n\s*\n/).filter(Boolean).map((p, i) => <p key={i}>{p.trim()}</p>);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? "no change" : "up from none") : `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}% on the 30 days before`);

function MonthlyChart({ months }: { months: CountrySpotlightPage["months"] }) {
  if (!months.length) return <p className="cs-empty">No incidents recorded since January 2025.</p>;
  const W = 760, H = 180, pad = 26;
  const maxN = Math.max(1, ...months.map((m) => m.incidents));
  const maxD = Math.max(1, ...months.map((m) => m.deaths));
  const bw = (W - pad * 2) / months.length;
  const line = months.map((m, i) => `${pad + i * bw + bw / 2},${H - pad - (m.deaths / maxD) * (H - pad * 2)}`).join(" ");
  return (
    <figure className="cs-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Incidents and reported deaths per month since January 2025">
        {months.map((m, i) => {
          const h = (m.incidents / maxN) * (H - pad * 2);
          return (
            <g key={m.month}>
              <rect x={pad + i * bw + 2} y={H - pad - h} width={Math.max(2, bw - 4)} height={h} rx={2} fill="#9db7e0">
                <title>{`${m.month}: ${m.incidents} incidents, ${m.critical} critical, ${m.deaths} reported deaths`}</title>
              </rect>
              {m.critical > 0 && <rect x={pad + i * bw + 2} y={H - pad - (m.critical / maxN) * (H - pad * 2)} width={Math.max(2, bw - 4)} height={(m.critical / maxN) * (H - pad * 2)} fill="#d1352b" opacity={0.85} />}
              {(m.month.endsWith("-01") || i === months.length - 1) && <text x={pad + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#5b6577">{m.month.endsWith("-01") ? m.month.slice(0, 4) : new Date(`${m.month}-15`).toLocaleDateString("en-GB", { month: "short" })}</text>}
            </g>
          );
        })}
        <polyline points={line} fill="none" stroke="#131722" strokeWidth={1.8} strokeDasharray="4 3" />
      </svg>
      <figcaption>
        <span><i className="sw" style={{ background: "#9db7e0" }} /> Incidents per month</span>
        <span><i className="sw" style={{ background: "#d1352b" }} /> of which critical</span>
        <span><i className="sw line" /> Reported deaths (scaled)</span>
      </figcaption>
    </figure>
  );
}

function DriftChart({ history }: { history: CountrySpotlightPage["history"] }) {
  if (history.length < 2) return <p className="cs-empty">The drift of each future’s likelihood appears here once a second edition has been written.</p>;
  const W = 520, H = 160, pad = 24;
  const x = (i: number) => pad + (i / (history.length - 1)) * (W - pad * 2);
  const y = (p: number) => H - pad - (p / 100) * (H - pad * 2);
  return (
    <figure className="cs-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Each future’s likelihood edition by edition">
        {[0, 50, 100].map((g) => (
          <g key={g}><line x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="#e6eaf1" /><text x={2} y={y(g) + 4} fontSize="10" fill="#8892a3">{g}%</text></g>
        ))}
        {["A", "B", "C", "D"].map((id) => (
          <polyline key={id} fill="none" stroke={SCEN_COLOR[id]} strokeWidth={2.2} points={history.map((h, i) => `${x(i)},${y(h.likelihoods.find((l) => l.id === id)?.likelihood ?? 0)}`).join(" ")} />
        ))}
      </svg>
      <figcaption>
        {history[history.length - 1].likelihoods.map((l) => <span key={l.id}><i className="sw" style={{ background: SCEN_COLOR[l.id] }} /> {l.id}. {l.name}</span>)}
        <span>{history.length} editions, {fmtDate(history[0].generatedAt)} to {fmtDate(history[history.length - 1].generatedAt)}</span>
      </figcaption>
    </figure>
  );
}

export function CountrySpotlight({ iso2, isAdmin }: { iso2: string; isAdmin: boolean }) {
  const [page, setPage] = useState<CountrySpotlightPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    api
      .getCountrySpotlight(iso2)
      .then((p) => {
        setPage(p);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  useEffect(() => {
    setPage(null);
    setOpen(null);
    void load();
    const t = setInterval(() => void load(), 10 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso2]);

  const tracking = useMemo(() => new Map((page?.signposts?.tracking ?? []).map((t) => [t.scenario, t])), [page]);
  const seen = useMemo(() => new Map((page?.signposts?.hits ?? []).map((h) => [`${h.scenario}${h.index}`, h.seen])), [page]);
  const term = (p: number) => page?.scale.find((l) => p <= l.max)?.term ?? "almost certain";
  const range = (t: string) => {
    const l = page?.scale.find((x) => x.term === t);
    return l ? `${l.min}–${l.max}%` : "";
  };

  async function regenerate() {
    setBusy(true);
    try {
      await api.regenerateSpotlight(iso2);
      await load();
    } catch (e) {
      window.alert(`Could not write a new edition: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (failed) return <section className="cs"><p className="cs-empty">The country spotlight could not be loaded just now.</p></section>;
  if (!page) return <section className="cs"><p className="cs-empty">Loading the country spotlight…</p></section>;

  const s = page.spotlight?.body;
  const m = page.metrics;
  const row = page.row;
  const status = row?.status ?? page.spotlight?.status ?? "none";
  const trend = row?.trend ? TREND[row.trend] : null;
  const hours = page.refreshHours[status as keyof typeof page.refreshHours] ?? 168;

  const header = (
    <div className="cs-strip">
      <span className={`cs-status cs-status--${status}`}>{STATUS[status]}</span>
      {trend && <span className={`cs-trend cs-trend--${trend.cls}`}>{trend.arrow} {trend.label}</span>}
      <span className="cs-strip__meta">
        {page.spotlight ? <>Edition of {fmtDate(page.spotlight.generatedAt)} · rewritten every {Math.round(hours / 24)} days, and sooner when the status changes or signposts trip · confidence {s?.confidence}</> : "Self-updating country spotlight"}
      </span>
      {isAdmin && <button type="button" className="cs-btn" disabled={busy} onClick={() => void regenerate()}>{busy ? "Writing a new edition (up to two minutes)…" : "Write a new edition now"}</button>}
    </div>
  );

  const record = (
    <div className="cs-record">
      <div className="cs-stats">
        <div><strong>{m.n30}</strong><span>incidents, last 30 days</span><em>{pct(m.n30, m.nPrev30)}</em></div>
        <div><strong>{m.deaths30}</strong><span>reported deaths, 30 days</span><em>{m.deathsPrev30} the 30 days before</em></div>
        <div><strong>{m.critical30}</strong><span>critical incidents, 30 days</span><em>{m.n90} incidents over 90 days</em></div>
        <div><strong>{m.terror30}</strong><span>terrorist attacks, 30 days</span><em>{m.terror90} over 90 days</em></div>
        <div><strong>{m.hybrid30}</strong><span>hybrid-warfare incidents</span><em>last 30 days</em></div>
      </div>
      <MonthlyChart months={page.months} />
      {(m.actors90.length > 0 || m.places30.length > 0) && (
        <p className="cs-small">
          {m.actors90.length > 0 && <><b>Actors most named (90 days):</b> {m.actors90.slice(0, 6).map((a) => `${a.name} (${a.n})`).join(", ")}. </>}
          {m.places30.length > 0 && <><b>Hotspots (30 days):</b> {m.places30.slice(0, 6).map((p) => `${p.name} (${p.n})`).join(", ")}.</>}
        </p>
      )}
    </div>
  );

  if (!s) {
    return (
      <section className="cs" aria-label="Country spotlight">
        {header}
        <h2 className="cs-h">The record</h2>
        {record}
        <p className="cs-empty">The written spotlight, with its scenarios and projections, is being prepared: the Lens writes one for each country it follows, the hottest first, and keeps it up to date.</p>
      </section>
    );
  }

  const [u1, u2] = s.uncertainties;
  const quad = (a: "low" | "high", b: "low" | "high") => s.scenarios.find((x) => x.u1 === a && x.u2 === b) ?? null;
  const leading = s.scenarios.reduce((a, b) => (b.likelihood > a.likelihood ? b : a));

  const scenarioCard = (x: SpotlightScenario | null) => {
    if (!x) return <div className="cs-quad cs-quad--empty" />;
    const t = tracking.get(x.id);
    return (
      <button type="button" className={`cs-quad ${open === x.id ? "is-open" : ""}`} onClick={() => setOpen(open === x.id ? null : x.id)} style={{ borderTopColor: SCEN_COLOR[x.id] }}>
        <span className="cs-quad__id" style={{ color: SCEN_COLOR[x.id] }}>Scenario {x.id}{x.id === leading.id ? " · most likely" : ""}</span>
        <strong>{x.name}</strong>
        <span className="cs-quad__p">{x.likelihood}%<em>{term(x.likelihood)}</em></span>
        {t && (
          <span className="cs-quad__signs">
            Signposts since this edition: {t.seenToward} of {t.totalToward} for it{t.totalAway ? `, ${t.seenAway} of ${t.totalAway} against` : ""}
            {t.seenToward > t.seenAway ? " · gaining ground" : t.seenAway > t.seenToward ? " · losing ground" : ""}
          </span>
        )}
      </button>
    );
  };
  const detail = open ? s.scenarios.find((x) => x.id === open) : null;

  return (
    <section className="cs" aria-label="Country spotlight">
      {header}
      <h2 className="cs-headline">{s.headline}</h2>
      <p className="cs-bl">{s.bottomLine}</p>

      <h3 className="cs-h">Key judgements</h3>
      <div className="cs-judgements">
        {s.keyJudgements.map((k, i) => (
          <div key={i} className="cs-judgement">
            <p className="cs-judgement__text">{k.judgement}</p>
            <p className="cs-judgement__meta"><span className="cs-like">{k.likelihood} · {range(k.likelihood)}</span> <span>{k.confidence} confidence</span></p>
            <p className="cs-small">{k.basis}</p>
          </div>
        ))}
      </div>

      <h3 className="cs-h">The record</h3>
      {record}

      <div className="cs-cols">
        <div><h3 className="cs-h">The situation now</h3><div className="cs-prose">{paras(s.situation)}</div></div>
        <div>
          <h3 className="cs-h">Trajectory</h3><div className="cs-prose">{paras(s.trajectory)}</div>
          <h3 className="cs-h">History and patterns</h3><div className="cs-prose">{paras(s.history)}</div>
        </div>
      </div>

      <h3 className="cs-h">What drives it</h3>
      <div className="cs-drivers">
        {s.drivers.map((d, i) => (
          <div key={i} className={`cs-driver cs-driver--${d.direction}`}><span>{d.direction}</span><strong>{d.name}</strong><p>{d.note}</p></div>
        ))}
      </div>
      {s.predetermined.length > 0 && <p className="cs-small"><b>Predetermined, whatever happens:</b> {s.predetermined.join(" · ")}</p>}

      <h3 className="cs-h">Alternative futures, next 6–12 months</h3>
      <p className="cs-small">Built from the two most critical and least predictable forces. Likelihoods add up to 100%; the Lens checks each future’s signposts against new incidents every few minutes. Click a future for its narrative, pathway, implications and signposts.</p>
      {u1 && u2 && (
        <div className="cs-matrix">
          <div className="cs-axis-y"><span>{u2.high}</span><b>{u2.name}</b><span>{u2.low}</span></div>
          <div className="cs-grid">
            {scenarioCard(quad("low", "high"))}
            {scenarioCard(quad("high", "high"))}
            {scenarioCard(quad("low", "low"))}
            {scenarioCard(quad("high", "low"))}
          </div>
          <div className="cs-axis-x"><span>{u1.low}</span><b>{u1.name}</b><span>{u1.high}</span></div>
        </div>
      )}
      {detail && (
        <div className="cs-detail" style={{ borderLeftColor: SCEN_COLOR[detail.id] }}>
          <h4>Scenario {detail.id}: {detail.name} <span>{detail.likelihood}% · {term(detail.likelihood)}</span></h4>
          <div className="cs-cols">
            <div><h5>What it looks like</h5><p>{detail.narrative}</p><h5>How it could come about</h5><p>{detail.pathway}</p></div>
            <div>
              <h5>What it means</h5>
              <p><b>Investors:</b> {detail.implications.investors}</p>
              <p><b>Humanitarian operations:</b> {detail.implications.humanitarian}</p>
              <p><b>Security managers:</b> {detail.implications.security}</p>
            </div>
          </div>
          <h5>Signposts</h5>
          <ul className="cs-signs">
            {detail.signposts.map((g, i) => {
              const hit = seen.get(`${detail.id}${i}`);
              return (
                <li key={i} className={hit ? "is-seen" : ""}>
                  <span className={`cs-dir cs-dir--${g.direction}`}>{g.direction === "toward" ? "For it" : "Against it"}</span>
                  {g.text}
                  <span className="cs-seen">{hit ? `Seen: ${hit.map((h) => `${h.date} · ${h.headline}`).join("; ")}` : "Not seen yet"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="cs-cols">
        <div><h3 className="cs-h">How the futures have moved</h3><DriftChart history={page.history} /></div>
        <div>
          <h3 className="cs-h">Wildcard: {s.wildcard.name}</h3>
          <p className="cs-small">{s.wildcard.description}</p>
          {s.wildcard.triggers.length > 0 && <p className="cs-small"><b>Could be set off by:</b> {s.wildcard.triggers.join("; ")}.</p>}
          {s.wildcard.indicators.length > 0 && <p className="cs-small"><b>Early signs:</b> {s.wildcard.indicators.join("; ")}.</p>}
        </div>
      </div>

      <div className="cs-cols">
        <div>
          <h3 className="cs-h">Indicator matrix</h3>
          <table className="cs-table">
            <thead><tr><th>Area</th><th>Concern</th><th>Trend</th></tr></thead>
            <tbody>
              {s.indicatorMatrix.map((r, i) => (
                <tr key={i} title={r.note}>
                  <td>{r.area}<span className="cs-small">{r.note}</span></td>
                  <td><span className="cs-level"><i style={{ width: `${LEVEL_RANK[r.level] * 20}%` }} className={`lv${LEVEL_RANK[r.level]}`} /></span>{r.level}</td>
                  <td>{r.trend === "rising" ? "↑ rising" : r.trend === "easing" ? "↓ easing" : "→ steady"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="cs-h">Triggers ahead</h3>
          <ul className="cs-list">{s.triggers.map((t, i) => <li key={i}><b>{t.when ?? "Undated"}</b> {t.event}</li>)}</ul>
          <h3 className="cs-h">Key assumptions</h3>
          <ul className="cs-list">{s.assumptions.map((a, i) => <li key={i}>{a.assumption}<span className="cs-small">Wrong if: {a.invalidatedBy}</span></li>)}</ul>
        </div>
      </div>

      {s.changes && (<><h3 className="cs-h">What changed since the last edition</h3><div className="cs-prose">{paras(s.changes)}</div></>)}
      <p className="cs-foot">
        <b>Confidence: {s.confidence}.</b> {s.confidenceBasis} {s.sourcesNote} Built from the Lens’s escalation incidents, terrorism and hybrid-warfare flags and country status, and written to intelligence-community tradecraft: key judgements on the ICD 203 probability scale, alternative futures from two critical uncertainties, signposts, a key assumptions check and an indicator matrix.
      </p>
    </section>
  );
}
