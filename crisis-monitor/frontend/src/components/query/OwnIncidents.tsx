import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type QueryOverview } from "../../api";
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

export default function OwnIncidents({ overview }: { overview: QueryOverview | null }) {
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
    <Panel title="Your incidents" note={data && countries.length ? `${data.incidents.toLocaleString()} recorded in ${where}` : undefined} actions={<ViewSwitch view={view} onChange={setView} />}>
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
