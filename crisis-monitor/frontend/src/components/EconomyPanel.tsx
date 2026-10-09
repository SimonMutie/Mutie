import { useMemo, useState } from "react";
import type { EconomicIndicators } from "../api";

type Ind = EconomicIndicators["indicators"][number];

const GOLD = "#D4AF37";
const TEXT = "#E8E6E0";
const MUTED = "#9B978E";
const UP = "#00E676";
const DOWN = "#FF3D3D";
const AMBER = "#FF9500";

/** Group tabs: which columns show. */
const VIEWS: { key: string; label: string; keys: string[] }[] = [
  { key: "overview", label: "Overview", keys: ["gdpUsd", "gdpGrowthPct", "inflationPct", "govDebtPctGdp"] },
  { key: "debt", label: "Debt", keys: ["govDebtPctGdp", "externalDebtUsd", "externalDebtPctGni", "debtServicePctExports"] },
  { key: "prices", label: "Prices & jobs", keys: ["inflationPct", "gdpGrowthPct", "unemploymentPct", "gdpPerCapitaUsd"] },
  { key: "external", label: "External", keys: ["currentAccountPctGdp", "reservesUsd", "tradePctGdp", "fiscalBalancePctGdp"] },
];

function fmt(v: unknown, unit: string): string {
  if (typeof v !== "number") return "—";
  if (unit === "US$") {
    const a = Math.abs(v);
    if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  return `${v.toFixed(1)}%`;
}

/** Colour a value where there is a widely used warning level; leave the rest plain. */
function tone(key: string, v: unknown): string {
  if (typeof v !== "number") return MUTED;
  if (key === "inflationPct") return v >= 20 ? DOWN : v >= 10 ? AMBER : TEXT;
  if (key === "govDebtPctGdp") return v >= 100 ? DOWN : v >= 70 ? AMBER : TEXT;
  if (key === "externalDebtPctGni") return v >= 60 ? DOWN : v >= 40 ? AMBER : TEXT;
  if (key === "debtServicePctExports") return v >= 25 ? DOWN : v >= 15 ? AMBER : TEXT;
  if (key === "gdpGrowthPct") return v < 0 ? DOWN : v >= 5 ? UP : TEXT;
  if (key === "currentAccountPctGdp" || key === "fiscalBalancePctGdp") return v < -5 ? DOWN : v > 0 ? UP : TEXT;
  return TEXT;
}

/** Economy tool for Live Intel: World Bank figures for Africa and the Middle East, one row per country. */
export function EconomyPanel({ data, loading, error }: { data: EconomicIndicators | null; loading: boolean; error: string | null }) {
  const [view, setView] = useState("overview");
  const [region, setRegion] = useState<"All" | "Africa" | "Middle East">("All");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("gdpUsd");
  const [desc, setDesc] = useState(true);

  const cols: Ind[] = useMemo(() => {
    if (!data) return [];
    const keys = VIEWS.find((v) => v.key === view)!.keys;
    return keys.map((k) => data.indicators.find((i) => i.key === k)).filter((i): i is Ind => Boolean(i));
  }, [data, view]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const list = data.countries.filter((c) => (region === "All" || c.region === region) && (!needle || String(c.name).toLowerCase().includes(needle)));
    return list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = typeof av === "number";
      const bn = typeof bv === "number";
      if (!an && !bn) return 0;
      if (!an) return 1;
      if (!bn) return -1;
      return desc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
  }, [data, region, q, sortKey, desc]);

  const pick = (key: string) => {
    if (key === sortKey) setDesc(!desc);
    else {
      setSortKey(key);
      setDesc(true);
    }
  };
  const grid = `minmax(110px,1.3fr) ${cols.map(() => "minmax(64px,1fr)").join(" ")}`;
  const btn = (on: boolean) => ({ padding: "4px 9px", fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase" as const, fontWeight: 700, cursor: "pointer", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: on ? "rgba(212,175,55,0.2)" : "transparent", color: on ? GOLD : MUTED, fontFamily: "inherit" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {loading && !data && <div style={{ fontSize: 11, color: MUTED }}>Loading World Bank figures…</div>}
      {error && <div style={{ fontSize: 11, color: DOWN }}>{error}</div>}
      {data && (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a country"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: TEXT, padding: "6px 9px", fontSize: 12, fontFamily: "inherit", outline: "none" }}
          />
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {VIEWS.map((v) => (
              <button key={v.key} style={btn(view === v.key)} onClick={() => { setView(v.key); setSortKey(v.keys[0]); setDesc(true); }}>{v.label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {(["All", "Africa", "Middle East"] as const).map((r) => (
              <button key={r} style={btn(region === r)} onClick={() => setRegion(r)}>{r}</button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: grid, gap: 6, fontSize: 9.5, letterSpacing: "0.05em", textTransform: "uppercase", color: MUTED, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
            <span>Country · {rows.length}</span>
            {cols.map((c) => (
              <button key={c.key} onClick={() => pick(c.key)} title={`${c.label} (${c.unit}) — click to sort`} style={{ background: "none", border: "none", textAlign: "right", color: sortKey === c.key ? GOLD : MUTED, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", letterSpacing: "inherit", textTransform: "inherit", padding: 0, lineHeight: 1.25 }}>
                {c.label}
                <br />
                <span style={{ opacity: 0.7 }}>{c.unit}{sortKey === c.key ? (desc ? " ▼" : " ▲") : ""}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rows.map((r) => (
              <div key={String(r.code)} style={{ display: "grid", gridTemplateColumns: grid, gap: 6, alignItems: "center", fontSize: 12, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(r.name)}</span>
                {cols.map((c) => {
                  const year = r[`${c.key}Date`];
                  return (
                    <span key={c.key} title={typeof year === "string" ? `${c.label}: ${year}` : "Not reported"} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: tone(c.key, r[c.key]), fontWeight: 600 }}>
                      {fmt(r[c.key], c.unit)}
                      {typeof year === "string" && <span style={{ display: "block", fontSize: 9, fontWeight: 400, color: MUTED }}>{year}</span>}
                    </span>
                  );
                })}
              </div>
            ))}
            {rows.length === 0 && <div style={{ fontSize: 12, color: MUTED, padding: 8 }}>No country matches.</div>}
          </div>
          <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45 }}>
            {data.source}. {data.note}
            {data.failed.length > 0 && <span style={{ color: AMBER }}> Not available just now: {data.failed.join(", ")}.</span>}
            {data.errors && data.errors.length > 0 && <span style={{ display: "block", color: MUTED }}>Reason given: {data.errors[0]}</span>}
          </div>
          <div style={{ fontSize: 10, color: MUTED }}>Amber and red mark commonly used warning levels (for example govt debt above 70% and 100% of GDP, inflation above 10% and 20%).</div>
        </>
      )}
    </div>
  );
}
