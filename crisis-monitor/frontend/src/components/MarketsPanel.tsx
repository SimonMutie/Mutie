import { useEffect, useState } from "react";
import { api, type MarketBoardRow, type MarketsBoard } from "../api";

type Tab = "fx" | "crypto" | "energy" | "hours";
const TABS: { key: Tab; label: string }[] = [
  { key: "fx", label: "FX" },
  { key: "crypto", label: "Crypto" },
  { key: "energy", label: "Energy" },
  { key: "hours", label: "Hours" },
];

const UP = "#3ddc84";
const DOWN = "#ff5a5a";
const MUTED = "rgba(255,255,255,0.55)";

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <span style={{ width: 64 }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 64).toFixed(1)},${(18 - ((v - min) / span) * 16 - 1).toFixed(1)}`).join(" ");
  return (
    <svg width={64} height={18} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? UP : DOWN} strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(4));

function Row({ r }: { r: MarketBoardRow }) {
  const ch = r.changePercent;
  const up = (ch ?? 0) >= 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 64px 78px", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</div>
        <div style={{ color: MUTED, fontSize: 10 }}>{r.unit ?? ""}</div>
      </div>
      <Spark values={r.series} up={up} />
      <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        <div>{fmt(r.value)}</div>
        <div style={{ color: ch == null ? MUTED : up ? UP : DOWN, fontSize: 11 }}>{ch == null ? "—" : `${up ? "+" : ""}${ch.toFixed(2)}%`}</div>
      </div>
    </div>
  );
}

/** Markets tool for Live Intel: FX, crypto and energy prices with sparklines, and which exchanges are open. */
export function MarketsPanel() {
  const [data, setData] = useState<MarketsBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("fx");

  useEffect(() => {
    let cancelled = false;
    const load = () => api.getMarketsBoard().then((d) => !cancelled && (setData(d), setError(null))).catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load markets"));
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const rows = data ? (tab === "fx" ? data.fx : tab === "crypto" ? data.crypto : tab === "energy" ? data.energy : []) : [];
  const advancing = rows.filter((r) => (r.changePercent ?? 0) >= 0).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{ flex: 1, padding: "5px 0", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, cursor: "pointer", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: tab === t.key ? "rgba(212,175,55,0.2)" : "transparent", color: tab === t.key ? "#d4af37" : MUTED, fontFamily: "inherit" }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && !data && <div style={{ color: DOWN, fontSize: 12 }}>{error}</div>}
      {!data && !error && <div style={{ color: MUTED, fontSize: 12 }}>Loading markets…</div>}
      {data && tab !== "hours" && (
        <>
          {rows.length > 0 && (
            <div>
              <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", background: DOWN }}>
                <div style={{ width: `${(advancing / rows.length) * 100}%`, background: UP }} />
              </div>
              <div style={{ color: MUTED, fontSize: 10, marginTop: 3 }}>{advancing} up · {rows.length - advancing} down</div>
            </div>
          )}
          {rows.map((r) => <Row key={r.key} r={r} />)}
          {rows.length === 0 && (
            <div style={{ color: MUTED, fontSize: 12 }}>
              {tab === "energy" && !data.energyAvailable ? "Energy prices need a FRED API key on the server." : "No data came back from the source just now."}
            </div>
          )}
          <div style={{ color: MUTED, fontSize: 10 }}>
            {data.sources[tab as "fx" | "crypto" | "energy"]}. Daily moves; FX and energy update once a day. Share indices are not shown: no free, licensed source exists for them.
          </div>
        </>
      )}
      {data && tab === "hours" && (
        <>
          {data.exchanges.map((e) => (
            <div key={e.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span>{e.name} <span style={{ color: MUTED }}>{e.country}</span></span>
              <span style={{ color: e.open ? UP : MUTED, fontWeight: 600 }}>{e.open ? "Open" : "Closed"}</span>
            </div>
          ))}
          <div style={{ color: MUTED, fontSize: 10 }}>Regular weekday hours; public holidays are not accounted for.</div>
        </>
      )}
    </div>
  );
}
