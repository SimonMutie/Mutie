import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type IncidentItem, type QueryOverview } from "../../api";
import { ACTOR_CATEGORIES, OTHER_CATEGORY, classifyIncident } from "../actorTheme";
import { Empty, Panel, ViewSwitch, bucketLabel } from "./shared";

/**
 * The media volume beside your own record: for the countries this query's
 * reporting is about, the incidents you have recorded (Trends & Patterns)
 * day by day, under the items the query collected on the same days.
 *
 * Two figures on different scales, so two small charts on one time axis,
 * one above the other. They are never drawn on a shared pair of axes: that
 * would let the choice of scales invent a relationship.
 *
 * It answers "is the coverage tracking what I have recorded?": a day of
 * heavy coverage with nothing recorded is a prompt to check the record; a
 * recorded cluster with no coverage is under-reported.
 */

const MEDIA = "#0d9488"; // the events-per-day line's colour, for the same series
const OWN = "#2a78d6";

/** "DR Congo", "Democratic Republic of the Congo" and "DRC" are one country. */
const key = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\b(the|of|republic|democratic|federal|united|state|states)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const ALIASES: Record<string, string> = {
  drc: "congo dr",
  "dr congo": "congo dr",
  "congo kinshasa": "congo dr",
  "cote d ivoire": "ivory coast",
  "cote divoire": "ivory coast",
  car: "central african",
  "cabo verde": "cape verde",
  swaziland: "eswatini",
};
const countryKey = (s: string) => {
  const raw = s.toLowerCase().trim();
  // "Democratic Republic of the Congo" must not collapse to plain "congo".
  if (/democratic republic of (the )?congo/.test(raw)) return "congo dr";
  const k = key(s);
  return ALIASES[k] ?? ALIASES[raw] ?? k;
};

interface Day {
  bucket: string;
  label: string;
  media: number;
  incidents: number;
  deaths: number;
}

function CoverageView({ overview, tabs }: { overview: QueryOverview | null; tabs: React.ReactNode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [rows, setRows] = useState<{ country: string; day: string; incidents: number; deaths: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The countries the reporting is about; failing that, the countries of the places most often named.
  const countries = useMemo(() => {
    if (!overview) return [];
    if (overview.sourceMix?.countries.length) return overview.sourceMix.countries;
    return [...new Set(overview.places.slice(0, 3).map((p) => p.label.split(",").pop()!.trim()))];
  }, [overview]);
  const from = overview?.from.slice(0, 10);
  const to = overview?.to.slice(0, 10);

  useEffect(() => {
    if (!from || !to) return;
    let live = true;
    setError(null);
    api
      .runVizQuery(
        "incidents",
        {
          dimensions: [{ field: "country" }, { field: "date", grain: "day" }],
          measures: [{ agg: "count" }, { field: "deaths", agg: "sum" }],
          limit: 5000,
        },
        { from, to },
      )
      .then((r) => live && setRows(r.rows.map((row) => ({ country: String(row.d[0] ?? ""), day: String(row.d[1] ?? ""), incidents: row.m[0] ?? 0, deaths: row.m[1] ?? 0 }))))
      .catch((err) => live && (setRows([]), setError(err instanceof Error ? err.message : "Your incidents could not be read.")));
    return () => {
      live = false;
    };
  }, [from, to]);

  const data = useMemo(() => {
    if (!overview || !rows) return null;
    const wanted = new Set(countries.map(countryKey));
    const days = new Map<string, Day>();
    for (const v of overview.volume) {
      const day = v.bucket.slice(0, 10);
      const d = days.get(day) ?? { bucket: day, label: bucketLabel(day), media: 0, incidents: 0, deaths: 0 };
      d.media += v.count;
      days.set(day, d);
    }
    let incidents = 0;
    let deaths = 0;
    let anywhere = 0;
    for (const r of rows) {
      anywhere += r.incidents;
      if (!wanted.has(countryKey(r.country))) continue;
      incidents += r.incidents;
      deaths += r.deaths;
      const d = days.get(r.day.slice(0, 10));
      if (!d) continue;
      d.incidents += r.incidents;
      d.deaths += r.deaths;
    }
    return { days: [...days.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)), incidents, deaths, anywhere };
  }, [overview, rows, countries]);

  const where = countries.length > 1 ? `${countries.slice(0, -1).join(", ")} and ${countries[countries.length - 1]}` : countries[0];

  return (
    <Panel title="Your incidents" note={data && countries.length ? `${data.incidents.toLocaleString()} recorded in ${where}` : undefined} actions={<>{tabs}<ViewSwitch view={view} onChange={setView} /></>}>
      {!overview || !rows ? (
        <Empty>Loading…</Empty>
      ) : error ? (
        <Empty>{error}</Empty>
      ) : countries.length === 0 ? (
        <Empty>The items in this period do not name a country, so there is nothing to match your incidents to.</Empty>
      ) : !data || data.incidents === 0 ? (
        <Empty>
          No incidents are recorded for {where} in this period
          {data && data.anywhere > 0 ? `, though ${data.anywhere.toLocaleString()} are recorded elsewhere` : ""}. Incidents are added under Trends &amp; Patterns, Upload.
        </Empty>
      ) : view === "table" ? (
        <div className="qd-scroll">
          <table className="qd-table">
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Items collected</th>
                <th className="num">Incidents recorded</th>
                <th className="num">Civilian deaths</th>
              </tr>
            </thead>
            <tbody>
              {[...data.days].reverse().map((d) => (
                <tr key={d.bucket}>
                  <td>{bucketLabel(d.bucket, "row")}</td>
                  <td className="num">{d.media.toLocaleString()}</td>
                  <td className="num">{d.incidents.toLocaleString()}</td>
                  <td className="num">{d.deaths.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="qd-pair">
            <div className="qd-pair__chart">
              <div className="qd-pair__label">
                <i style={{ background: MEDIA }} /> Items this query collected, per day
              </div>
              <div className="qd-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.days} syncId="own-incidents" margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border-soft)" vertical={false} />
                    <XAxis dataKey="label" hide />
                    <YAxis allowDecimals={false} tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={34} tickCount={3} />
                    <Tooltip cursor={{ stroke: "var(--text-faint)", strokeWidth: 1 }} content={<PairTip />} />
                    <Line
                      type="linear"
                      dataKey="media"
                      stroke={MEDIA}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: MEDIA, stroke: "var(--panel)", strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="qd-pair__chart">
              <div className="qd-pair__label">
                <i style={{ background: OWN }} /> Incidents you recorded in {where}, per day
              </div>
              <div className="qd-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.days} syncId="own-incidents" margin={{ top: 6, right: 12, left: 0, bottom: 0 }} barCategoryGap={1}>
                    <CartesianGrid stroke="var(--border-soft)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
                    <YAxis allowDecimals={false} tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={34} tickCount={3} />
                    <Tooltip cursor={{ fill: "var(--panel-raised)" }} content={<PairTip />} />
                    <Bar dataKey="incidents" fill={OWN} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          <div className="qd-hint">
            {data.incidents.toLocaleString()} incidents and {data.deaths.toLocaleString()} civilian deaths recorded in {where} in this period. Two charts on one time axis, each with its own scale.
          </div>
        </>
      )}
    </Panel>
  );
}

function PairTip({ active, payload }: { active?: boolean; payload?: { payload: Day }[] }) {
  const d = active ? payload?.[0]?.payload : undefined;
  if (!d) return null;
  return (
    <div className="qd-tip">
      <div className="qd-tip__label">{bucketLabel(d.bucket, true)}</div>
      <div className="qd-tip__value">
        <i className="qd-key" style={{ background: MEDIA }} />
        <b>{d.media.toLocaleString()}</b> item{d.media === 1 ? "" : "s"} collected
      </div>
      <div className="qd-tip__value">
        <i className="qd-key" style={{ background: OWN }} />
        <b>{d.incidents.toLocaleString()}</b> incident{d.incidents === 1 ? "" : "s"} recorded
      </div>
      {d.incidents > 0 && <div className="qd-tip__sub">{d.deaths.toLocaleString()} civilian deaths recorded</div>}
    </div>
  );
}


/* ── the overview: what you have recorded for this query's countries, at a glance ── */

const ALL_CATEGORIES = [...ACTOR_CATEGORIES, OTHER_CATEGORY];
const deathsOf = (i: IncidentItem) => (i.civilian_death_child ?? 0) + (i.civilian_death_female ?? 0) + (i.civilian_death_male ?? 0) + (i.civilian_death_unknown ?? 0);
const placeOf = (i: IncidentItem) => [i.city, i.province].filter(Boolean).join(", ") || i.precise_location || i.country || "Unknown place";
const dayOf = (i: IncidentItem) => (i.occurred_date ?? i.occurred_at ?? "").slice(0, 10);

function topN(rows: IncidentItem[], pick: (i: IncidentItem) => string | null | undefined, n = 5) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = pick(r)?.trim();
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function Bars({ items, color }: { items: [string, number][]; color: string }) {
  const max = Math.max(1, ...items.map((i) => i[1]));
  return (
    <div style={{ display: "grid", gap: 5 }}>
      {items.map(([label, n]) => (
        <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 34px", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <div style={{ position: "relative", background: "var(--panel-raised)", borderRadius: 4, overflow: "hidden", height: 22 }}>
            <div style={{ position: "absolute", inset: 0, width: `${(n / max) * 100}%`, background: color, opacity: 0.28 }} />
            <span style={{ position: "relative", padding: "0 8px", lineHeight: "22px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{label}</span>
          </div>
          <b style={{ textAlign: "right" }}>{n.toLocaleString()}</b>
        </div>
      ))}
    </div>
  );
}

function OverviewView({ overview, tabs }: { overview: QueryOverview | null; tabs: React.ReactNode }) {
  const [inPeriod, setInPeriod] = useState<IncidentItem[] | null>(null);
  const [latest, setLatest] = useState<IncidentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const countries = useMemo(() => {
    if (!overview) return [];
    if (overview.sourceMix?.countries.length) return overview.sourceMix.countries;
    return [...new Set(overview.places.slice(0, 3).map((p) => p.label.split(",").pop()!.trim()))];
  }, [overview]);
  const wanted = useMemo(() => new Set(countries.map(countryKey)), [countries]);
  const from = overview?.from.slice(0, 10);
  const to = overview?.to.slice(0, 10);

  useEffect(() => {
    if (!from || !to) return;
    let live = true;
    setError(null);
    api
      .getIncidents({ from, to, limit: 5000 })
      .then(async (rows) => {
        if (!live) return;
        const mine = rows.filter((r) => r.country && wanted.has(countryKey(r.country)));
        setInPeriod(mine);
        if (mine.length === 0) {
          // Nothing in this period: show the latest recorded for these countries instead of an empty box.
          const all = await api.getIncidents({ limit: 4000 });
          if (live) setLatest(all.filter((r) => r.country && wanted.has(countryKey(r.country))).slice(0, 12));
        } else setLatest(null);
      })
      .catch((err) => live && (setInPeriod([]), setError(err instanceof Error ? err.message : "Your incidents could not be read.")));
    return () => {
      live = false;
    };
  }, [from, to, wanted]);

  const where = countries.length > 1 ? `${countries.slice(0, -1).join(", ")} and ${countries[countries.length - 1]}` : countries[0];

  // Days the media covered heavily with nothing recorded, and days recorded with no coverage.
  const gaps = useMemo(() => {
    if (!overview || !inPeriod) return null;
    const rec = new Map<string, number>();
    for (const r of inPeriod) rec.set(dayOf(r), (rec.get(dayOf(r)) ?? 0) + 1);
    const days = overview.volume.filter((v) => v.bucket.length === 10);
    const avg = days.length ? days.reduce((a, d) => a + d.count, 0) / days.length : 0;
    const silent = days.filter((d) => d.count >= Math.max(3, avg * 1.5) && !rec.get(d.bucket)).sort((a, b) => b.count - a.count).slice(0, 4);
    const covered = new Set(days.filter((d) => d.count > 0).map((d) => d.bucket));
    const unreported = [...rec.entries()].filter(([d]) => !covered.has(d)).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return { silent, unreported };
  }, [overview, inPeriod]);

  const rows = inPeriod && inPeriod.length > 0 ? inPeriod : null;
  const fallback = !rows && latest && latest.length > 0 ? latest : null;
  const shown = rows ?? fallback;

  const stats = useMemo(() => {
    if (!shown) return null;
    const cats = new Map<string, { n: number; color: string }>();
    for (const r of shown) {
      const c = classifyIncident(r);
      const cur = cats.get(c.label) ?? { n: 0, color: c.color };
      cur.n++;
      cats.set(c.label, cur);
    }
    const breakdown = ALL_CATEGORIES.map((c) => ({ label: c.label, color: c.color, n: cats.get(c.label)?.n ?? 0 })).filter((c) => c.n > 0);
    return {
      deaths: shown.reduce((a, r) => a + deathsOf(r), 0),
      places: new Set(shown.map(placeOf)).size,
      breakdown,
      tactics: topN(shown, (i) => i.tactic),
      topPlaces: topN(shown, placeOf),
      latest: [...shown].sort((a, b) => dayOf(b).localeCompare(dayOf(a))).slice(0, 8),
    };
  }, [shown]);

  const tile = (label: string, value: string) => (
    <div style={{ background: "var(--panel-raised)", borderRadius: 8, padding: "8px 12px", minWidth: 96 }}>
      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{label}</div>
    </div>
  );
  const head = (t: string) => <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)", margin: "14px 0 6px" }}>{t}</div>;

  return (
    <Panel title="Your incidents" note={rows && where ? `${rows.length.toLocaleString()} recorded in ${where}` : fallback ? `latest recorded in ${where}` : undefined} actions={tabs}>
      {!overview || !inPeriod ? (
        <Empty>Loading…</Empty>
      ) : error ? (
        <Empty>{error}</Empty>
      ) : countries.length === 0 ? (
        <Empty>The items in this period do not name a country, so there is nothing to match your incidents to.</Empty>
      ) : !stats ? (
        <Empty>
          You have no incidents recorded for {where}, in this period or any other. Add them under Live OSINT › Incidents (Add one, Bulk upload, or Daily review), and they will appear here beside the coverage.
        </Empty>
      ) : (
        <div className="qd-scroll" style={{ paddingRight: 4 }}>
          {fallback && (
            <div style={{ background: "var(--panel-raised)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10 }}>
              Nothing of yours is recorded for {where} in this period — showing the {fallback.length} most recent ones recorded for {countries.length > 1 ? "these countries" : "this country"} instead.
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {tile(fallback ? "latest shown" : "incidents recorded", shown!.length.toLocaleString())}
            {tile("civilian deaths", stats.deaths.toLocaleString())}
            {tile("different places", stats.places.toLocaleString())}
          </div>

          {head("Who was involved")}
          <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "var(--panel-raised)" }}>
            {stats.breakdown.map((c) => (
              <div key={c.label} title={`${c.label}: ${c.n}`} style={{ width: `${(c.n / shown!.length) * 100}%`, background: c.color }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: "4px 14px", flexWrap: "wrap", marginTop: 6, fontSize: 12 }}>
            {stats.breakdown.map((c) => (
              <span key={c.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <i style={{ width: 10, height: 10, borderRadius: "50%", background: c.color, display: "inline-block" }} />
                {c.label} <b>{c.n}</b>
              </span>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 18 }}>
            <div>
              {head("Most affected places")}
              <Bars items={stats.topPlaces} color="#2a78d6" />
            </div>
            <div>
              {head("Most common tactics")}
              {stats.tactics.length > 0 ? <Bars items={stats.tactics} color="#e34948" /> : <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No tactic recorded on these rows.</div>}
            </div>
          </div>

          {rows && gaps && (gaps.silent.length > 0 || gaps.unreported.length > 0) && (
            <>
              {head("Worth a second look")}
              <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
                {gaps.silent.length > 0 && (
                  <div>
                    <b>Heavy coverage, nothing recorded:</b>{" "}
                    {gaps.silent.map((d) => `${bucketLabel(d.bucket)} (${d.count} items)`).join(" · ")}. These days may be missing from your record.
                  </div>
                )}
                {gaps.unreported.length > 0 && (
                  <div>
                    <b>Recorded, but this query collected nothing:</b>{" "}
                    {gaps.unreported.map(([d, n]) => `${bucketLabel(d)} (${n} incident${n === 1 ? "" : "s"})`).join(" · ")}. Possibly under-reported in the media.
                  </div>
                )}
              </div>
            </>
          )}

          {head("Latest recorded")}
          <div style={{ display: "grid", gap: 6 }}>
            {stats.latest.map((i) => {
              const c = classifyIncident(i);
              return (
                <div key={i.id} style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr)", gap: 9, fontSize: 12.5, lineHeight: 1.4 }}>
                  <i style={{ width: 10, height: 10, borderRadius: "50%", background: c.color, marginTop: 4 }} title={c.label} />
                  <div>
                    <b>{placeOf(i)}</b> <span style={{ color: "var(--text-faint)" }}>· {dayOf(i) || "no date"}{i.tactic ? ` · ${i.tactic}` : ""}{i.actor ? ` · ${i.actor}` : ""}{deathsOf(i) ? ` · ${deathsOf(i)} civilian death${deathsOf(i) === 1 ? "" : "s"}` : ""}</span>
                    {i.details && <div style={{ opacity: 0.8 }}>{i.details.length > 170 ? `${i.details.slice(0, 170)}…` : i.details}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

/** "Your incidents": an overview of what you have recorded for the countries this query's reporting is about, and
 *  (second tab) the coverage-versus-record charts. */
export default function OwnIncidents({ overview }: { overview: QueryOverview | null }) {
  const [tab, setTab] = useState<"overview" | "coverage">("overview");
  const tabs = (
    <div className="qd-seg" role="group" aria-label="Show">
      {(["overview", "coverage"] as const).map((t) => (
        <button key={t} type="button" className={tab === t ? "is-on" : ""} aria-pressed={tab === t} onClick={() => setTab(t)}>
          {t === "overview" ? "Overview" : "Coverage vs record"}
        </button>
      ))}
    </div>
  );
  return tab === "overview" ? <OverviewView overview={overview} tabs={tabs} /> : <CoverageView overview={overview} tabs={tabs} />;
}
