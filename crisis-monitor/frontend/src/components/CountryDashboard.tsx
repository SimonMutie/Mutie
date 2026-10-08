import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type IncidentItem, type IncidentStats } from "../api";
import { classifyActor } from "./actorTheme";

/**
 * Country dashboard: the headline picture of the incidents you hold for ONE country,
 * with a switch to move between countries. Everything comes from the incidents table
 * (the same data as the Auto Dashboard), filtered to the chosen country and period.
 */

const PERIODS: { id: string; label: string; days: number | null }[] = [
  { id: "all", label: "All time", days: null },
  { id: "365", label: "Last 12 months", days: 365 },
  { id: "180", label: "Last 6 months", days: 180 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "30", label: "Last 30 days", days: 30 },
];
const DEFAULT_COUNTRY = "Kenya";

const sum = (o: Record<string, number>, prefix: string) => Object.entries(o).filter(([k]) => k.startsWith(prefix)).reduce((a, [, v]) => a + (v || 0), 0);
const iso = (d: Date) => d.toISOString().slice(0, 10);

function Bars({ items, color, colorOf, total }: { items: { value: string; count: number }[]; color?: string; colorOf?: (v: string) => string; total?: number }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div style={{ display: "grid", gap: 5 }}>
      {items.map((i) => (
        <div key={i.value} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 64px", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <div style={{ position: "relative", background: "var(--panel-raised)", borderRadius: 4, overflow: "hidden", height: 22 }}>
            <div style={{ position: "absolute", inset: 0, width: `${(i.count / max) * 100}%`, background: colorOf?.(i.value) ?? color ?? "#2a78d6", opacity: 0.35 }} />
            <span style={{ position: "relative", padding: "0 8px", lineHeight: "22px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }} title={i.value}>
              {i.value}
            </span>
          </div>
          <span style={{ textAlign: "right" }}>
            <b>{i.count.toLocaleString()}</b>
            {total ? <span style={{ color: "var(--text-faint)" }}> {Math.round((i.count / total) * 100)}%</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function Card({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section style={{ background: "var(--panel)", border: "1px solid var(--border-soft)", borderRadius: 10, padding: "12px 14px", gridColumn: wide ? "1 / -1" : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 10 }}>{title}</div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{children}</div>;

export default function CountryDashboard() {
  const [countries, setCountries] = useState<{ value: string; count: number }[] | null>(null);
  const [country, setCountry] = useState<string>(DEFAULT_COUNTRY);
  const [period, setPeriod] = useState("all");
  const [stats, setStats] = useState<IncidentStats | null>(null);
  const [recent, setRecent] = useState<IncidentItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The countries the data covers, busiest first. Kenya is the starting view when it is there.
  useEffect(() => {
    let live = true;
    api
      .getIncidentStats()
      .then((s) => {
        if (!live) return;
        setCountries(s.by_country);
        if (s.by_country.length && !s.by_country.some((c) => c.value.toLowerCase() === DEFAULT_COUNTRY.toLowerCase())) setCountry(s.by_country[0].value);
        else {
          const k = s.by_country.find((c) => c.value.toLowerCase() === DEFAULT_COUNTRY.toLowerCase());
          if (k) setCountry(k.value);
        }
      })
      .catch(() => live && setCountries([]));
    return () => {
      live = false;
    };
  }, []);

  const range = useMemo(() => {
    const days = PERIODS.find((p) => p.id === period)?.days;
    if (!days) return {};
    return { from: iso(new Date(Date.now() - days * 86_400_000)), to: iso(new Date()) };
  }, [period]);

  useEffect(() => {
    if (!country) return;
    let live = true;
    setStats(null);
    setError(null);
    api
      .getIncidentStats({ ...range, country })
      .then((s) => live && setStats(s))
      .catch((e) => live && setError(e instanceof Error ? e.message : "The figures could not be read."));
    api
      .getIncidents({ ...range, country, limit: 12 })
      .then((r) => live && setRecent(r))
      .catch(() => live && setRecent([]));
    return () => {
      live = false;
    };
  }, [country, range]);

  const deaths = stats ? sum(stats.casualties, "deaths_") : 0;
  const injuries = stats ? sum(stats.casualties, "injuries_") : 0;
  const last = recent[0]?.occurred_date ?? recent[0]?.occurred_at?.slice(0, 10) ?? null;
  const actorColor = (v: string) => classifyActor(v).color;
  const tile = (label: string, value: string) => (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border-soft)", borderRadius: 10, padding: "10px 14px", minWidth: 130 }}>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 3 }}>{label}</div>
    </div>
  );
  const select: React.CSSProperties = { fontSize: 13, padding: "6px 10px", background: "var(--panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 6 };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{country}</h2>
        <span style={{ color: "var(--text-faint)", fontSize: 13 }}>country dashboard</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 6 }}>
            Country
            <select value={country} onChange={(e) => setCountry(e.target.value)} style={select} aria-label="Country">
              {(countries ?? []).some((c) => c.value === country) ? null : <option value={country}>{country}</option>}
              {(countries ?? []).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value} ({c.count.toLocaleString()})
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 6 }}>
            Period
            <select value={period} onChange={(e) => setPeriod(e.target.value)} style={select} aria-label="Period">
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {countries && countries.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {countries.slice(0, 10).map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCountry(c.value)}
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, cursor: "pointer", border: `1px solid ${c.value === country ? "var(--signal)" : "var(--border)"}`, background: c.value === country ? "var(--signal-dim)" : "transparent", color: c.value === country ? "var(--text-primary)" : "var(--text-muted)" }}
            >
              {c.value}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <Empty>{error}</Empty>
      ) : !stats ? (
        <Empty>Loading…</Empty>
      ) : stats.total === 0 ? (
        <Empty>
          No incidents are recorded for {country} in this period. Upload data under Upload, push approved rows from Daily review, or pick another country or a longer period.
        </Empty>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            {tile("incidents", stats.total.toLocaleString())}
            {tile("civilian deaths", deaths.toLocaleString())}
            {tile("civilian injuries", injuries.toLocaleString())}
            {tile("provinces affected", stats.by_province.length.toLocaleString())}
            {tile("armed actors named", stats.by_actor.length.toLocaleString())}
            {last && tile("latest incident", last)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
            <Card title="Incidents over time" wide>
              <div style={{ height: 210 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.time_series} margin={{ top: 6, right: 10, bottom: 0, left: -14 }}>
                    <CartesianGrid stroke="var(--border-soft, #8884)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "var(--text-faint)" }} minTickGap={30} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--text-faint)" }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="count" name="Incidents per month" stroke="#e34948" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="By province / county">
              {stats.by_province.length ? <Bars items={stats.by_province.slice(0, 12)} color="#2a78d6" total={stats.total} /> : <Empty>No province recorded on these rows.</Empty>}
            </Card>

            <Card title="Who is involved (actor)">
              {stats.by_actor.length ? <Bars items={stats.by_actor.slice(0, 12)} colorOf={actorColor} total={stats.total} /> : <Empty>No actor recorded.</Empty>}
            </Card>

            <Card title="What happened (tactic)">
              {stats.by_tactic.length ? <Bars items={stats.by_tactic.slice(0, 12)} color="#e34948" total={stats.total} /> : <Empty>No tactic recorded.</Empty>}
            </Card>

            <Card title="Severity">
              {stats.by_severity.length ? (
                <div style={{ height: 190 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.by_severity} margin={{ top: 6, right: 10, bottom: 0, left: -14 }}>
                      <CartesianGrid stroke="var(--border-soft, #8884)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="value" tick={{ fontSize: 10, fill: "var(--text-faint)" }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--text-faint)" }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      <Bar dataKey="count" name="Incidents" fill="#7c3aed" isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty>No severity recorded.</Empty>
              )}
            </Card>

            <Card title="Sector">
              {stats.by_sector.length ? <Bars items={stats.by_sector.slice(0, 10)} color="#0d9488" total={stats.total} /> : <Empty>No sector recorded.</Empty>}
            </Card>

            <Card title="Who did what (most common actor + tactic)">
              {stats.actor_tactic.length ? (
                <Bars items={stats.actor_tactic.slice(0, 8).map((p) => ({ value: `${p.actor} — ${p.tactic}`, count: p.count }))} colorOf={(v) => actorColor(v.split(" — ")[0])} />
              ) : (
                <Empty>No rows have both an actor and a tactic.</Empty>
              )}
            </Card>

            <Card title="Latest incidents" wide>
              <div style={{ display: "grid", gap: 7 }}>
                {recent.map((i) => (
                  <div key={i.id} style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr)", gap: 9, fontSize: 12.5, lineHeight: 1.4 }}>
                    <i style={{ width: 10, height: 10, borderRadius: "50%", background: actorColor(i.actor ?? ""), marginTop: 4 }} />
                    <div>
                      <b>{[i.city, i.province].filter(Boolean).join(", ") || i.precise_location || country}</b>
                      <span style={{ color: "var(--text-faint)" }}>
                        {" "}
                        · {i.occurred_date ?? i.occurred_at?.slice(0, 10) ?? "no date"}
                        {i.tactic ? ` · ${i.tactic}` : ""}
                        {i.actor ? ` · ${i.actor}` : ""}
                      </span>
                      {i.details && <div style={{ opacity: 0.8 }}>{i.details.length > 200 ? `${i.details.slice(0, 200)}…` : i.details}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
