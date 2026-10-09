import { useEffect, useRef, useState } from "react";
import { api, type DashboardWidget } from "../api";
import DashboardEditor from "./DashboardEditor";

const DEFAULT_COUNTRY = "Kenya";

const W = (id: string, type: DashboardWidget["type"], title: string, layout: { x: number; y: number; w: number; h: number }, extra: Partial<DashboardWidget> = {}): DashboardWidget => ({
  id,
  type,
  title,
  size: "medium",
  layout,
  ...extra,
});

const FIELD_LABELS = {
  province: { label: "Province", type: "text" as const },
  sector: { label: "Sector", type: "text" as const },
};

/** What a new country dashboard starts with. After that it is the person's own: every card can be moved, resized,
 *  edited or removed, more can be added, and it can be given a look and published like any other dashboard. */
function templateFor(): DashboardWidget[] {
  return [
    W("kpi-total", "stat", "Incidents", { x: 0, y: 0, w: 3, h: 4 }, { dataField: "total", color: "#e34948" }),
    W("kpi-deaths", "stat", "Civilian deaths", { x: 3, y: 0, w: 3, h: 4 }, { dataField: "deaths", color: "#7c3aed" }),
    W("kpi-injuries", "stat", "Civilian injuries", { x: 6, y: 0, w: 3, h: 4 }, { dataField: "injuries", color: "#ea580c" }),
    W("kpi-kidnap", "stat", "NGO kidnappings", { x: 9, y: 0, w: 3, h: 4 }, { dataField: "kidnappings_ngo", color: "#0d9488" }),
    W("map", "map", "Where incidents happened", { x: 0, y: 4, w: 12, h: 12 }, { mapViewMode: "markers", mapBasemap: "osm" }),
    W("trend", "line", "Incidents over time", { x: 0, y: 16, w: 8, h: 8 }, { dataField: "time_series", color: "#e34948" }),
    W("severity", "pie", "Severity", { x: 8, y: 16, w: 4, h: 8 }, { dataField: "by_severity", showLegend: true }),
    W("province", "bar", "Where — by province / county", { x: 0, y: 24, w: 4, h: 9 }, { dataField: "by_province", topN: 12, color: "#2a78d6", showDataLabels: true }),
    W("actor", "bar", "Who — actors involved", { x: 4, y: 24, w: 4, h: 9 }, { dataField: "by_actor", topN: 10, showDataLabels: true }),
    W("tactic", "pie", "What — tactics", { x: 8, y: 24, w: 4, h: 9 }, { dataField: "by_tactic", topN: 8, showLegend: true }),
    W("calendar", "calendar", "Daily activity calendar", { x: 0, y: 33, w: 12, h: 6 }, { color: "#e34948" }),
    W("victims", "victims", "Women, men and children killed in criminal incidents", { x: 0, y: 39, w: 5, h: 11 }, { victimGroup: "Criminal" }),
    {
      id: "province-sector",
      type: "viz",
      title: "Rows by province and sector",
      size: "medium",
      layout: { x: 5, y: 39, w: 7, h: 11 },
      viz: {
        kind: "bar",
        source: "incidents",
        rows: [{ field: "province" }],
        columns: [{ field: "sector" }],
        values: [{ agg: "count" }],
        filters: [],
        options: { stack: "stacked", orientation: "horizontal", topN: 14, labels: true, fields: FIELD_LABELS },
      },
    },
    W("sankey", "sankey", "Who does what — actor → tactic", { x: 0, y: 50, w: 6, h: 10 }, { dataField: "by_actor", secondaryField: "tactic", topN: 8 }),
    W("network", "network", "Where each sector is hit — sector ↔ province", { x: 6, y: 50, w: 6, h: 10 }, { dataField: "by_sector", secondaryField: "province", topN: 8 }),
    W("table", "heatmap_table", "Province × tactic", { x: 0, y: 60, w: 6, h: 10 }, { dataField: "by_province", secondaryField: "tactic", topN: 10 }),
    W("bubble", "bubble", "Sectors affected", { x: 6, y: 60, w: 3, h: 10 }, { dataField: "by_sector", topN: 14 }),
    W("radar", "radar", "Tactic profile", { x: 9, y: 60, w: 3, h: 10 }, { dataField: "by_tactic", topN: 8, color: "#7c3aed" }),
    W("towns", "bar", "Hotspot towns", { x: 0, y: 70, w: 12, h: 8 }, { dataField: "by_city", topN: 10, color: "#0d9488", showDataLabels: true }),
  ];
}

const opening = new Map<string, Promise<string>>();
/** The dashboard for a country: the one already made for it, or a new one built from the template. */
function dashboardFor(country: string): Promise<string> {
  const key = country.toLowerCase();
  let p = opening.get(key);
  if (!p) {
    p = (async () => {
      const all = await api.getCustomDashboards();
      const found = all.find((d) => !d.is_auto && (d.country ?? "").toLowerCase() === key);
      if (found) return found.id;
      const created = await api.createCustomDashboard(`${country} — country dashboard`, templateFor());
      await api.updateCustomDashboard(created.id, { country });
      return created.id;
    })();
    opening.set(key, p);
    p.catch(() => opening.delete(key));
  }
  return p;
}

/** Trends & Patterns › Country Dashboard: pick a country and get a dashboard for it that works exactly like any other —
 *  edit, add, move and resize cards, choose a look, set the period, and publish it as a live link. */
export default function CountryDashboard() {
  const [countries, setCountries] = useState<{ value: string; count: number }[] | null>(null);
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    let live = true;
    api
      .getBreakdown("country")
      .then((list) => {
        if (!live) return;
        setCountries(list);
        const kenya = list.find((c) => c.value.toLowerCase() === DEFAULT_COUNTRY.toLowerCase());
        if (!kenya && list[0]) setCountry(list[0].value);
      })
      .catch(() => live && setCountries([]));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    setId(null);
    setError(null);
    dashboardFor(country)
      .then((d) => mine === seq.current && setId(d))
      .catch((e) => mine === seq.current && setError(e instanceof Error ? e.message : "The dashboard could not be opened."));
  }, [country]);

  const options = countries && countries.length ? countries : [{ value: country, count: 0 }];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 24px", borderBottom: "1px solid var(--border-soft)", flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ fontSize: 11, opacity: 0.7 }}>COUNTRY</span>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          style={{ fontSize: 14, fontWeight: 600, padding: "6px 10px", background: "var(--panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 8 }}
        >
          {options.map((c) => (
            <option key={c.value} value={c.value}>
              {c.value}
              {c.count ? ` (${c.count.toLocaleString()})` : ""}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Each country keeps its own dashboard — edit it, restyle it, and publish it like any other.</span>
      </div>
      {error ? (
        <div style={{ padding: 24, color: "var(--text-faint)" }}>{error}</div>
      ) : id ? (
        <DashboardEditor key={id} mode={{ kind: "bespoke", id }} />
      ) : (
        <div style={{ padding: 24, color: "var(--text-faint)" }}>Opening the {country} dashboard…</div>
      )}
    </div>
  );
}
