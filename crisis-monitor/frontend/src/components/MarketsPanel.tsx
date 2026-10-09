import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import { api, type MarketBoardRow, type MarketsBoard } from "../api";

type Tab = "rates" | "fx" | "nrg" | "crypto" | "watch" | "hours";
const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "rates", label: "RATES", hint: "US Treasury yields and the dollar" },
  { key: "fx", label: "FX", hint: "Currencies against the US dollar" },
  { key: "nrg", label: "NRG", hint: "Oil, gas and fuels" },
  { key: "crypto", label: "CRYPTO", hint: "Top coins by market value" },
  { key: "watch", label: "WATCH", hint: "Rows you starred" },
  { key: "hours", label: "HOURS", hint: "Which exchanges are open" },
];

const UP = "#00E676";
const DOWN = "#FF3D3D";
const GOLD = "#D4AF37";
const MUTED = "#9B978E";
const TEXT = "#E8E6E0";
const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const WATCH_KEY = "lens.markets.watch";

function loadWatch(): string[] {
  try { return JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]") as string[]; } catch { return []; }
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(4));

function Spark({ values, up, w = 74, h = 20 }: { values: number[]; up: boolean; w?: number; h?: number }) {
  if (values.length < 2) return <span style={{ width: w }} />;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? UP : DOWN} strokeWidth={1.3} strokeLinejoin="round" />
    </svg>
  );
}

function chg(r: MarketBoardRow): { text: string; up: boolean | null } {
  if (r.change != null) return { text: `${r.change >= 0 ? "+" : ""}${r.change.toFixed(2)} pp`, up: r.change >= 0 };
  if (r.changePercent == null) return { text: "—", up: null };
  return { text: `${r.changePercent >= 0 ? "+" : ""}${r.changePercent.toFixed(2)}%`, up: r.changePercent >= 0 };
}

/** Markets tool for Live Intel, laid out like OSIRIS's: tabs, search, headline tiles, a breadth bar, and a table
 *  with 1-month sparklines. Only data this platform is licensed to show: ECB rates, CoinGecko, EIA and the Federal
 *  Reserve (through FRED). Share indices, metals and stock quotes are not here (no licensed free source). */
export function MarketsPanel() {
  const [data, setData] = useState<MarketsBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("rates");
  const [q, setQ] = useState("");
  const [watch, setWatch] = useState<string[]>(loadWatch);

  useEffect(() => {
    let cancelled = false;
    const load = () => api.getMarketsBoard().then((d) => !cancelled && (setData(d), setError(null))).catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load markets"));
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const all = useMemo(() => (data ? [...data.rates.map((r) => ({ ...r, k: `rates:${r.key}` })), ...data.fx.map((r) => ({ ...r, k: `fx:${r.key}` })), ...data.energy.map((r) => ({ ...r, k: `nrg:${r.key}` })), ...data.crypto.map((r) => ({ ...r, k: `crypto:${r.key}` }))] : []), [data]);
  const tabRows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const base = tab === "watch" ? all.filter((r) => watch.includes(r.k)) : tab === "hours" ? [] : all.filter((r) => r.k.startsWith(`${tab}:`));
    // A search looks across every tab, as OSIRIS's does.
    const pool = needle ? all.filter((r) => r.label.toLowerCase().includes(needle) || r.key.toLowerCase().includes(needle)) : base;
    return pool;
  }, [data, all, tab, q, watch]);

  const toggleStar = (k: string) => {
    const next = watch.includes(k) ? watch.filter((x) => x !== k) : [...watch, k];
    setWatch(next);
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)); } catch { /* not saved */ }
  };

  const tiles = useMemo(() => {
    const want = ["rates:DTWEXBGS", "rates:DGS10", "rates:DGS2", "nrg:DCOILWTICO", "nrg:DCOILBRENTEU", "nrg:DHHNGSP", "crypto:bitcoin", "crypto:ethereum"];
    const short: Record<string, string> = { "rates:DTWEXBGS": "DOLLAR", "rates:DGS10": "US 10Y", "rates:DGS2": "US 2Y", "nrg:DCOILWTICO": "WTI", "nrg:DCOILBRENTEU": "BRENT", "nrg:DHHNGSP": "NAT GAS", "crypto:bitcoin": "BITCOIN", "crypto:ethereum": "ETHEREUM" };
    return want.map((k) => ({ r: all.find((x) => x.k === k), label: short[k] })).filter((t): t is { r: (typeof all)[number]; label: string } => Boolean(t.r));
  }, [all]);

  const universe = tabRows;
  const withMove = universe.filter((r) => chg(r).up !== null);
  const adv = withMove.filter((r) => chg(r).up).length;
  const dec = withMove.length - adv;
  const best = [...withMove].sort((a, b) => (b.changePercent ?? b.change ?? 0) - (a.changePercent ?? a.change ?? 0));
  const upd = data ? new Date(data.fetchedAt).toISOString().slice(11, 16) + "Z" : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search · yield · oil · bitcoin · USD/KES"
          style={{ flex: 1, minWidth: 0, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: TEXT, padding: "8px 10px", fontSize: 12.5, fontFamily: mono, outline: "none" }}
        />
        {q && <button onClick={() => setQ("")} style={{ background: "rgba(212,175,55,0.14)", border: "1px solid rgba(212,175,55,0.4)", borderRadius: 8, color: GOLD, fontWeight: 700, padding: "0 12px", cursor: "pointer", fontFamily: "inherit" }}>CLEAR</button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {TABS.map((t, i) => (
          <button
            key={t.key}
            title={t.hint}
            onClick={() => { setTab(t.key); setQ(""); }}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 9px", fontSize: 11, letterSpacing: "0.06em", fontWeight: 700, cursor: "pointer", borderRadius: 8, border: `1px solid ${tab === t.key && !q ? "rgba(212,175,55,0.7)" : "rgba(255,255,255,0.1)"}`, background: tab === t.key && !q ? "rgba(212,175,55,0.14)" : "transparent", color: tab === t.key && !q ? GOLD : MUTED, fontFamily: "inherit" }}
          >
            <span>{t.label}</span>
            <span style={{ opacity: 0.5, fontSize: 10 }}>{i + 1}</span>
          </button>
        ))}
      </div>

      {error && !data && <div style={{ color: DOWN, fontSize: 12 }}>{error}</div>}
      {!data && !error && <div style={{ color: MUTED, fontSize: 12 }}>Loading markets…</div>}

      {data && tiles.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {tiles.map(({ r, label }) => {
            const c = chg(r);
            return (
              <div key={r.k} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 8px", background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontSize: 9.5, letterSpacing: "0.08em", color: MUTED }}>{label}</div>
                <div style={{ fontFamily: mono, fontSize: 13.5, fontWeight: 700, color: TEXT, marginTop: 2 }}>{fmt(r.value)}</div>
                <div style={{ fontFamily: mono, fontSize: 10.5, fontWeight: 700, color: c.up == null ? MUTED : c.up ? UP : DOWN }}>{c.text}</div>
              </div>
            );
          })}
        </div>
      )}

      {data && tab !== "hours" && withMove.length > 0 && (
        <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 10, letterSpacing: "0.08em", color: MUTED }}>
            <span>BREADTH</span>
            <span style={{ color: UP, fontFamily: mono, fontWeight: 700 }}>{adv}▲</span>
            <span style={{ color: DOWN, fontFamily: mono, fontWeight: 700 }}>{dec}▼</span>
            <div style={{ flex: 1, display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: DOWN }}>
              <div style={{ width: `${(adv / withMove.length) * 100}%`, background: UP }} />
            </div>
          </div>
          {best.length > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11.5, fontFamily: mono, fontWeight: 700 }}>
              <span style={{ color: UP }}>▲ {best[0].label.split(" (")[0]} {chg(best[0]).text}</span>
              <span style={{ color: DOWN }}>▼ {best[best.length - 1].label.split(" (")[0]} {chg(best[best.length - 1]).text}</span>
            </div>
          )}
        </div>
      )}

      {data && tab !== "hours" && (
        <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, letterSpacing: "0.08em", color: GOLD, fontWeight: 700, marginBottom: 6 }}>
            <span>{q ? `SEARCH · ${tabRows.length}` : TABS.find((t) => t.key === tab)!.label}</span>
            <span style={{ color: MUTED, fontWeight: 400 }}>{tabRows.length} ROWS</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "18px 1fr 74px 76px 74px", gap: 6, fontSize: 9.5, letterSpacing: "0.08em", color: MUTED, padding: "0 0 4px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <span />
            <span>SECURITY</span>
            <span style={{ textAlign: "right" }}>LAST</span>
            <span style={{ textAlign: "right" }}>CHG</span>
            <span style={{ textAlign: "right" }}>1M</span>
          </div>
          {tabRows.map((r) => {
            const c = chg(r);
            const starred = watch.includes(r.k);
            return (
              <div key={r.k} style={{ display: "grid", gridTemplateColumns: "18px 1fr 74px 76px 74px", gap: 6, alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <button onClick={() => toggleStar(r.k)} title={starred ? "Remove from watchlist" : "Add to watchlist"} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}>
                  <Star size={13} color={starred ? GOLD : MUTED} fill={starred ? GOLD : "none"} />
                </button>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</div>
                  {r.unit && <div style={{ fontSize: 9.5, color: MUTED }}>{r.unit}</div>}
                </div>
                <div style={{ textAlign: "right", fontFamily: mono, fontSize: 12.5, color: TEXT }}>{fmt(r.value)}</div>
                <div style={{ textAlign: "right", fontFamily: mono, fontSize: 11.5, fontWeight: 700, color: c.up == null ? MUTED : c.up ? UP : DOWN }}>{c.text}</div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}><Spark values={r.series} up={c.up !== false} /></div>
              </div>
            );
          })}
          {tabRows.length === 0 && (
            <div style={{ color: MUTED, fontSize: 12, padding: "10px 0" }}>
              {q ? "Nothing matches that search." : tab === "watch" ? "Star a row (☆) on any tab and it appears here." : (tab === "nrg" || tab === "rates") && !data.energyAvailable ? "These prices need a FRED API key on the server." : "No data came back from the source just now."}
            </div>
          )}
        </div>
      )}

      {data && tab === "hours" && (
        <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.08em", color: GOLD, fontWeight: 700, marginBottom: 6 }}>EXCHANGES · {data.exchanges.filter((e) => e.open).length} OF {data.exchanges.length} OPEN</div>
          {data.exchanges.map((e) => (
            <div key={e.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ fontWeight: 700, color: TEXT }}>{e.name} <span style={{ color: MUTED, fontWeight: 400 }}>{e.country}</span></span>
              <span style={{ color: e.open ? UP : MUTED, fontWeight: 700, fontFamily: mono }}>{e.open ? "OPEN" : "CLOSED"}</span>
            </div>
          ))}
          <div style={{ color: MUTED, fontSize: 10, marginTop: 6 }}>Regular weekday hours; public holidays are not accounted for.</div>
        </div>
      )}

      {data && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, letterSpacing: "0.06em", color: MUTED }}>
          <span>{data.sources.fx.split(" via")[0].toUpperCase()} · COINGECKO · EIA · FED</span>
          <span>UPD {upd}</span>
        </div>
      )}
      {data && <div style={{ fontSize: 9.5, color: MUTED, lineHeight: 1.4 }}>FX, rates and energy are daily figures; crypto moves through the day. Share indices, gold and silver are not shown: there is no licensed free source for them.</div>}
    </div>
  );
}
