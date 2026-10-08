import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Tooltip as LTooltip, useMap } from "react-leaflet";
import { feature } from "topojson-client";
import worldTopology from "world-atlas/countries-50m.json?url";
import { findGeoHierarchy, getGeoLevel } from "../registry";
import * as L from "leaflet";
import { api, type CrosstabRow, type DashboardWidget, type IncidentItem, type IncidentStats, type NormalizedDashboardStats } from "../api";
import DashboardWidgetCard, { breakdownKeyFor, crosstabKeyFor } from "./DashboardWidgetCard";
import { HeatmapLayer } from "./HeatmapLayer";
import VizCard from "./viz/VizCard";
import { VizProvider } from "./viz/context";
import { THEMES, themeStyle } from "./viz/themes";
import type { VizSpec } from "./viz/types";
import "./viz/viz.css";
import { classifyActor, classifyIncident, pinSvg } from "./actorTheme";

/**
 * Country dashboard: one country's incidents at a glance — headline figures, a live map
 * (icons in your actor colours, or a heatmap), the trend, who/what/where, the calendar,
 * and the relationships between actors, tactics and places. It is built from the same
 * widgets as the Auto Dashboard, locked to the chosen country, so switching country or
 * period redraws everything. No incident listing: the map and charts are the view.
 */

const PERIODS: { id: string; label: string; days: number | null }[] = [
  { id: "all", label: "All time", days: null },
  { id: "365", label: "12 months", days: 365 },
  { id: "180", label: "6 months", days: 180 },
  { id: "90", label: "90 days", days: 90 },
  { id: "30", label: "30 days", days: 30 },
];
const DEFAULT_COUNTRY = "Kenya";
const iso = (d: Date) => d.toISOString().slice(0, 10);

function normalize(s: IncidentStats): NormalizedDashboardStats {
  const sum = (p: string) => Object.entries(s.casualties).filter(([k]) => k.startsWith(p)).reduce((a, [, v]) => a + (v ?? 0), 0);
  return { total: s.total, by_sector: s.by_sector, by_actor: s.by_actor, by_tactic: s.by_tactic, by_severity: s.by_severity, by_province: s.by_province, by_country: s.by_country, time_series: s.time_series, daily: s.daily, actor_tactic: s.actor_tactic, deaths: sum("deaths_"), injuries: sum("injuries_"), kidnappings_ngo: s.casualties.kidnappings_ngo ?? 0 };
}

type Located = IncidentItem & { latitude: number; longitude: number };

/* ── the map: icons in the actor colours, or a heatmap, framed on the country's own incidents ── */

const pins = new Map<string, L.DivIcon>();
const pin = (color: string) => {
  let ic = pins.get(color);
  if (!ic) {
    ic = L.divIcon({ html: pinSvg(color, 12), className: "incident-marker-icon", iconSize: [12, 16], iconAnchor: [6, 15], tooltipAnchor: [0, -14] });
    pins.set(color, ic);
  }
  return ic;
};

/** The basemap, drawn from boundary files that ship with the app (country outlines from world-atlas, and state
 *  boundaries where the app holds them): no tile server, no key, no outside request. */
const NAME_ALIASES: Record<string, string> = { "south sudan": "s. sudan", "democratic republic of the congo": "dem. rep. congo", "dr congo": "dem. rep. congo", drc: "dem. rep. congo", "central african republic": "central african rep.", "ivory coast": "côte d'ivoire", "cote d'ivoire": "côte d'ivoire", eswatini: "eswatini", "western sahara": "w. sahara", "equatorial guinea": "eq. guinea" };
const norm = (v: string) => v.toLowerCase().trim();

function Basemap({ country }: { country: string }) {
  const map = useMap();
  useEffect(() => {
    let dead = false;
    const layers: L.Layer[] = [];
    const wanted = NAME_ALIASES[norm(country)] ?? norm(country);
    fetch(worldTopology)
      .then((r) => r.json())
      .then((topo) => {
        if (dead) return;
        const fc = feature(topo, topo.objects.countries) as unknown as GeoJSON.FeatureCollection;
        const land = L.geoJSON(fc, {
          style: (f) => {
            const mine = norm(String((f?.properties as { name?: string })?.name ?? "")) === wanted;
            return { color: mine ? "#0f766e" : "#a8b3bd", weight: mine ? 1.6 : 0.8, fillColor: mine ? "#e6f4ef" : "#f3f1ea", fillOpacity: 1 };
          },
          onEachFeature: (f, layer) => layer.bindTooltip(String((f.properties as { name?: string })?.name ?? ""), { sticky: true, direction: "top" }),
        }).addTo(map);
        land.bringToBack();
        layers.push(land);
      })
      .catch(() => {});
    // State boundaries, where the app holds them for this country.
    const lvl = (() => {
      const h = findGeoHierarchy(country);
      return h ? getGeoLevel(h, 1) : undefined;
    })();
    if (lvl) {
      fetch(lvl.boundaryUrl)
        .then((r) => r.json())
        .then((data) => {
          if (dead) return;
          const fc = (data.type === "Topology" ? feature(data, data.objects[Object.keys(data.objects)[0]]) : data) as GeoJSON.FeatureCollection;
          const states = L.geoJSON(fc, {
            style: { color: "#0f766e", weight: 1, fillOpacity: 0, dashArray: "3 3" },
            onEachFeature: (f, layer) => layer.bindTooltip(String((f.properties as Record<string, string>)?.[lvl.namePropertyKey] ?? ""), { sticky: true }),
          }).addTo(map);
          layers.push(states);
        })
        .catch(() => {});
    }
    return () => {
      dead = true;
      layers.forEach((l) => l.remove());
    };
  }, [map, country]);
  return null;
}

function FitTo({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    map.invalidateSize();
    try {
      map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 8, animate: false });
    } catch {
      /* the map was removed while this ran */
    }
  }, [map, points]);
  return null;
}

function CountryMap({ incidents, country }: { incidents: Located[]; country: string }) {
  const [mode, setMode] = useState<"icons" | "heat">("icons");
  const points = useMemo(() => incidents.map((i) => [i.latitude, i.longitude] as [number, number]), [incidents]);
  const seg = (on: boolean): React.CSSProperties => ({ fontSize: 12, padding: "4px 12px", cursor: "pointer", border: "none", background: on ? "var(--signal)" : "var(--panel)", color: on ? "#fff" : "var(--text-muted)" });
  return (
    <div style={{ position: "relative", height: "100%", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border-soft)" }}>
      <MapContainer center={[1, 38]} zoom={5} style={{ width: "100%", height: "100%", background: "#d6e6f2" }} scrollWheelZoom zoomControl attributionControl={false}>
        <Basemap country={country} />
        <FitTo points={points} />
        {mode === "heat" ? (
          <HeatmapLayer points={points.slice(0, 8000).map(([a, b]) => [a, b, 1] as [number, number, number])} />
        ) : (
          incidents.slice(0, 4000).map((i) => (
            <Marker key={i.id} position={[i.latitude, i.longitude]} icon={pin(classifyIncident(i).color)}>
              <LTooltip direction="top" opacity={0.95}>
                <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                  <b>{[i.city, i.province].filter(Boolean).join(", ") || country}</b>
                  <div>{[i.occurred_date, i.tactic, i.actor].filter(Boolean).join(" · ")}</div>
                </div>
              </LTooltip>
            </Marker>
          ))
        )}
      </MapContainer>
      <div style={{ position: "absolute", top: 10, left: 54, zIndex: 500, display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)", boxShadow: "0 2px 8px #0004" }}>
        <button type="button" style={seg(mode === "icons")} onClick={() => setMode("icons")}>Icons</button>
        <button type="button" style={seg(mode === "heat")} onClick={() => setMode("heat")}>Heatmap</button>
      </div>
      <div style={{ position: "absolute", left: 10, bottom: 10, zIndex: 500, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 9px", fontSize: 11.5 }}>
        <b>{incidents.length.toLocaleString()}</b> mapped incidents
      </div>
    </div>
  );
}

const W = (id: string, type: DashboardWidget["type"], title: string, extra: Partial<DashboardWidget> = {}): DashboardWidget => ({ id, type, title, size: "medium", ...extra });
/** The widgets, all drawn by the same cards as the Auto Dashboard. Fixed, so a change of country only refetches the data. */
const WIDGETS = {
  trend: W("trend", "line", "Incidents over time", { dataField: "time_series", color: "#e34948" }),
  severity: W("severity", "pie", "Severity", { dataField: "by_severity", showLegend: true }),
  province: W("province", "bar", "Where — by province / county", { dataField: "by_province", topN: 12, color: "#2a78d6", showDataLabels: true }),
  actor: W("actor", "bar", "Who — actors involved", { dataField: "by_actor", topN: 10, showDataLabels: true }),
  tactic: W("tactic", "pie", "What — tactics", { dataField: "by_tactic", topN: 8, showLegend: true }),
  calendar: W("calendar", "calendar", "Daily activity calendar", { color: "#e34948" }),
  sankey: W("sankey", "sankey", "Who does what — actor → tactic", { dataField: "by_actor", secondaryField: "tactic", topN: 8 }),
  network: W("network", "network", "Where each sector is hit — sector ↔ province", { dataField: "by_sector", secondaryField: "province", topN: 8 }),
  bubble: W("bubble", "bubble", "Sectors affected", { dataField: "by_sector", topN: 14 }),
  table: W("table", "heatmap_table", "Province × tactic", { dataField: "by_province", secondaryField: "tactic", topN: 10 }),
  radar: W("radar", "radar", "Tactic profile", { dataField: "by_tactic", topN: 8, color: "#7c3aed" }),
  funnel: W("funnel", "bar", "Hotspot towns", { dataField: "by_city", topN: 10, color: "#0d9488", showDataLabels: true }),
};

/** The "deep dive" visuals, built on the any-data engine and locked to the chosen country. */
const FIELD_LABELS = {
  deaths_men: { label: "Deaths: men", type: "number" as const },
  deaths_women: { label: "Deaths: women", type: "number" as const },
  deaths_children: { label: "Deaths: children", type: "number" as const },
  province: { label: "Province", type: "text" as const },
  sector: { label: "Sector", type: "text" as const },
};
const vizWidget = (id: string, title: string, viz: Omit<VizSpec, "source" | "columns" | "filters"> & Partial<Pick<VizSpec, "columns">>, country: string): DashboardWidget => ({
  id,
  type: "viz",
  title,
  size: "medium",
  viz: { source: "incidents", columns: [], filters: [{ field: "country", op: "in", values: [country] }], ...viz, options: { ...viz.options, fields: FIELD_LABELS } },
});
const hemicycle = (field: keyof typeof FIELD_LABELS) => ({ kind: "parliament" as const, rows: [{ field }], values: [{ agg: "count" as const }], options: { topN: 7 } });
const SITUATION = THEMES.find((t) => t.key === "situation") ?? THEMES[0];

/* ── the page ── */

export default function CountryDashboard() {
  const [countries, setCountries] = useState<{ value: string; count: number }[] | null>(null);
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [period, setPeriod] = useState("all");
  const [stats, setStats] = useState<NormalizedDashboardStats | null>(null);
  const [incidents, setIncidents] = useState<Located[]>([]);
  const [crosstabs, setCrosstabs] = useState<Record<string, CrosstabRow[]>>({});
  const [breakdowns, setBreakdowns] = useState<Record<string, { value: string; count: number }[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getIncidentStats()
      .then((s) => {
        if (!live) return;
        setCountries(s.by_country);
        const kenya = s.by_country.find((c) => c.value.toLowerCase() === DEFAULT_COUNTRY.toLowerCase());
        setCountry(kenya?.value ?? s.by_country[0]?.value ?? DEFAULT_COUNTRY);
      })
      .catch(() => live && setCountries([]));
    return () => {
      live = false;
    };
  }, []);

  const range = useMemo(() => {
    const days = PERIODS.find((p) => p.id === period)?.days;
    return days ? { from: iso(new Date(Date.now() - days * 86_400_000)), to: iso(new Date()) } : {};
  }, [period]);

  useEffect(() => {
    let live = true;
    setStats(null);
    setError(null);
    setCrosstabs({});
    setBreakdowns({});
    const filters = { ...range, country };
    api
      .getIncidentStats(filters)
      .then((s) => live && setStats(normalize(s)))
      .catch((e) => live && setError(e instanceof Error ? e.message : "The figures could not be read."));
    api
      .getIncidents({ ...filters, limit: 5000 })
      .then((r) => live && setIncidents(r.filter((i): i is Located => i.latitude != null && i.longitude != null)))
      .catch(() => live && setIncidents([]));
    for (const w of Object.values(WIDGETS)) {
      const ck = crosstabKeyFor(w);
      if (ck) {
        const [p, s] = ck.split("|") as [never, never];
        api.getCrosstab(p, s, filters).then((rows) => live && setCrosstabs((prev) => ({ ...prev, [ck]: rows }))).catch(() => {});
      }
      const bk = breakdownKeyFor(w);
      if (bk) api.getBreakdown(bk as never, filters).then((rows) => live && setBreakdowns((prev) => ({ ...prev, [bk]: rows }))).catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [country, range]);

  const actorPalette = (stats?.by_actor ?? []).map((a) => classifyActor(a.value).color);
  const card = (w0: DashboardWidget, h: number, cols: string) => {
    const w = w0.id === "actor" && actorPalette.length ? { ...w0, palette: actorPalette } : w0;
    return (
    stats && (
      <div key={w.id} style={{ gridColumn: cols, height: h, minWidth: 0 }}>
        <DashboardWidgetCard widget={w} stats={stats} incidents={incidents} crosstabs={crosstabs} breakdowns={breakdowns} />
      </div>
    )
    );
  };

  const top = (rows: { value: string; count: number }[] | undefined) => rows?.[0]?.value ?? "—";
  const sel: React.CSSProperties = { fontSize: 13, padding: "7px 10px", background: "var(--panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 8 };
  const kpi = (label: string, value: string, tint: string, sub?: string) => (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border-soft)", borderTop: `3px solid ${tint}`, borderRadius: 10, padding: "12px 16px", minWidth: 0 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ background: "linear-gradient(120deg, var(--signal-dim), transparent 70%)", borderBottom: "1px solid var(--border-soft)", padding: "20px 24px 16px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)" }}>Country dashboard</div>
            <h2 style={{ margin: "2px 0 0", fontSize: 34, letterSpacing: "-0.02em" }}>{country}</h2>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select value={country} onChange={(e) => setCountry(e.target.value)} style={sel} aria-label="Country">
              {(countries ?? []).some((c) => c.value === country) ? null : <option value={country}>{country}</option>}
              {(countries ?? []).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value} ({c.count.toLocaleString()})
                </option>
              ))}
            </select>
            <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }} role="group" aria-label="Period">
              {PERIODS.map((p) => (
                <button key={p.id} type="button" onClick={() => setPeriod(p.id)} style={{ fontSize: 12.5, padding: "7px 12px", cursor: "pointer", border: "none", background: period === p.id ? "var(--signal)" : "var(--panel)", color: period === p.id ? "#fff" : "var(--text-muted)" }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {countries && countries.length > 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            {countries.slice(0, 12).map((c) => (
              <button key={c.value} type="button" onClick={() => setCountry(c.value)} style={{ fontSize: 12, padding: "4px 11px", borderRadius: 999, cursor: "pointer", border: `1px solid ${c.value === country ? "var(--signal)" : "var(--border)"}`, background: c.value === country ? "var(--signal-dim)" : "var(--panel)", color: c.value === country ? "var(--text-primary)" : "var(--text-muted)" }}>
                {c.value}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "16px 24px 36px" }}>
        {error ? (
          <div style={{ color: "var(--text-faint)" }}>{error}</div>
        ) : !stats ? (
          <div style={{ color: "var(--text-faint)" }}>Loading…</div>
        ) : stats.total === 0 ? (
          <div style={{ color: "var(--text-faint)" }}>No incidents are recorded for {country} in this period. Upload data, push approved rows from Daily review, or pick another country or period.</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
              {kpi("Incidents", stats.total.toLocaleString(), "#e34948")}
              {kpi("Civilian deaths", (stats.deaths ?? 0).toLocaleString(), "#7c3aed")}
              {kpi("Civilian injuries", (stats.injuries ?? 0).toLocaleString(), "#ea580c")}
              {kpi("Most affected", top(stats.by_province), "#2a78d6", stats.by_province[0] ? `${stats.by_province[0].count.toLocaleString()} incidents` : undefined)}
              {kpi("Leading actor", top(stats.by_actor), "#166534", stats.by_actor[0] ? `${stats.by_actor[0].count.toLocaleString()} incidents` : undefined)}
              {kpi("Main tactic", top(stats.by_tactic), "#eab308", stats.by_tactic[0] ? `${stats.by_tactic[0].count.toLocaleString()} incidents` : undefined)}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 12 }}>
              <div style={{ gridColumn: "span 12", height: 480 }}>
                <CountryMap key={`${country}-${period}`} incidents={incidents} country={country} />
              </div>
              {card(WIDGETS.trend, 300, "span 8")}
              {card(WIDGETS.severity, 300, "span 4")}
              {card(WIDGETS.province, 380, "span 4")}
              {card(WIDGETS.actor, 380, "span 4")}
              {card(WIDGETS.tactic, 380, "span 4")}
              {card(WIDGETS.calendar, 250, "span 12")}
              <div style={{ gridColumn: "span 12", borderRadius: 12, overflow: "hidden" }}>
                <VizProvider mode="edit" theme={SITUATION} dateFrom={range.from ?? null} dateTo={range.to ?? null}>
                  <div data-viz-theme={SITUATION.key} style={{ ...themeStyle(SITUATION), padding: 14, display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 12 }}>
                    <div style={{ gridColumn: "span 4", height: 360 }}>
                      <VizCard widget={vizWidget("hc-men", "Incidents by deaths: men", hemicycle("deaths_men"), country)} editable={false} />
                    </div>
                    <div style={{ gridColumn: "span 4", height: 360 }}>
                      <VizCard widget={vizWidget("hc-women", "Incidents by deaths: women", hemicycle("deaths_women"), country)} editable={false} />
                    </div>
                    <div style={{ gridColumn: "span 4", height: 360 }}>
                      <VizCard widget={vizWidget("hc-children", "Incidents by deaths: children", hemicycle("deaths_children"), country)} editable={false} />
                    </div>
                    <div style={{ gridColumn: "span 12", height: 420 }}>
                      <VizCard
                        widget={vizWidget("province-sector", "Rows by province and sector", { kind: "bar", rows: [{ field: "province" }], columns: [{ field: "sector" }], values: [{ agg: "count" }], options: { stack: "stacked", orientation: "horizontal", topN: 14, labels: true } }, country)}
                        editable={false}
                      />
                    </div>
                  </div>
                </VizProvider>
              </div>
              {card(WIDGETS.sankey, 420, "span 6")}
              {card(WIDGETS.network, 420, "span 6")}
              {card(WIDGETS.table, 400, "span 6")}
              {card(WIDGETS.bubble, 400, "span 3")}
              {card(WIDGETS.radar, 400, "span 3")}
              {stats && card(WIDGETS.funnel, 340, "span 12")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
