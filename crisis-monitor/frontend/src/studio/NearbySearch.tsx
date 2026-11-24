import { useMemo, useState, type CSSProperties } from "react";
import { Download, Flame, MapPinned, Search, Waypoints, X } from "lucide-react";
import { api, type IncidentItem } from "../api";
import { classifyIncident } from "../components/actorTheme";
import { fmtLength } from "./geo";
import { HUD, inputStyle } from "./hud";
import { chainageKm, distanceKm, incidentsNear, lineLengthKm, partsOf, searchBox } from "./proximity";

/** What the map is currently narrowed to, so the panel can show and clear it. */
export interface NearbyState {
  label: string;
  km: number;
  count: number;
}

/** One incident found: from the incident database ("db") or flagged by the Lens itself ("lens"). */
interface Hit {
  key: string;
  kind: "db" | "lens";
  lat: number;
  lng: number;
  /** Distance from the route, line, area or point. */
  km: number;
  /** Distance from the start of the route or line, where the incident sits along it. */
  along: number | null;
  date: string | null;
  title: string;
  sub: string;
  color: string;
}

const btn = (active = false): CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "6px 9px", borderRadius: 7,
  border: `1px solid ${active ? HUD.gold : HUD.border}`, background: active ? "rgba(212,175,55,.18)" : "rgba(255,255,255,.03)", color: active ? HUD.goldLight : HUD.textSecondary, fontFamily: "inherit",
});

const PERIODS: { days: number | null; label: string }[] = [
  { days: null, label: "All time" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
];
const SHOWN = 300;

const fmtKm = (km: number) => fmtLength(km * 1000);
const levelColor = (l?: string) => (l === "critical" ? "#ff5d5d" : l === "watch" ? "#c9a227" : "#ff9d4f");

/**
 * Finds the incidents within any distance of a route, line, area or point: every incident in the database inside
 * the band (asked of the server, not only those loaded on the map), and the Lens's own flagged incidents. Along a
 * route or line they are listed in order from its start, with how far along and how far off it each one is. The
 * database incidents found narrow what the map shows; they can be left as markers or turned into a heatmap.
 */
export function NearbySearch({
  title = "Incidents nearby",
  geometry,
  label,
  incidents,
  state,
  viewMode,
  onResults,
  onViewMode,
  onCorridor,
  onFocus,
}: {
  title?: string;
  geometry: GeoJSON.Feature | GeoJSON.FeatureCollection | null;
  label: string;
  /** The incidents loaded on the map: searched if the server cannot be reached. */
  incidents: IncidentItem[];
  state: NearbyState | null;
  viewMode: "markers" | "heatmap";
  onResults: (rows: IncidentItem[] | null, s: NearbyState | null) => void;
  onViewMode: (m: "markers" | "heatmap") => void;
  /** Draws the search band as a layer, when the host can. */
  onCorridor?: (km: number) => void;
  /** Centres the map on a result. */
  onFocus?: (lat: number, lng: number) => void;
}) {
  const [km, setKm] = useState(10);
  const [days, setDays] = useState<number | null>(null);
  const [withLens, setWithLens] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const mine = state?.label === label;
  const isLine = useMemo(() => !!geometry && partsOf(geometry).lines.length > 0, [geometry]);
  const lengthKm = useMemo(() => (geometry && isLine ? lineLengthKm(geometry) : 0), [geometry, isLine]);

  const byActor = useMemo(() => {
    const m = new Map<string, { color: string; n: number }>();
    for (const h of hits ?? []) {
      const name = h.kind === "lens" ? "Lens flagged" : h.sub.split(" · ")[0] || "Unattributed";
      const e = m.get(name) ?? { color: h.color, n: 0 };
      e.n++;
      m.set(name, e);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  }, [hits]);

  async function run() {
    if (!geometry) return;
    setBusy(true);
    setNote(null);
    const from = days ? new Date(Date.now() - days * 864e5).toISOString().slice(0, 10) : undefined;
    const box = searchBox(geometry, km);
    // Every incident in the database inside the band; the loaded ones only if the server cannot be reached.
    let rows: IncidentItem[];
    try {
      rows = await api.getIncidents({ ...(box ?? {}), from, limit: 250000 });
    } catch {
      rows = from ? incidents.filter((r) => (r.occurred_date ?? r.occurred_at ?? "").slice(0, 10) >= from) : incidents;
      setNote(`The server could not be reached, so only the ${incidents.length.toLocaleString()} incidents loaded on the map were searched.`);
    }
    const found = incidentsNear(rows, geometry, km);
    const out: Hit[] = found.map(({ row, km: off }) => {
      const place = row.precise_location || row.city || row.district || row.county || row.province;
      return {
        key: `db:${row.id}`,
        kind: "db",
        lat: row.latitude as number,
        lng: row.longitude as number,
        km: off,
        along: isLine ? chainageKm(row.longitude as number, row.latitude as number, geometry) : null,
        date: (row.occurred_date ?? row.occurred_at ?? "").slice(0, 10) || null,
        title: row.tactic || row.operation || row.sector || "Incident",
        sub: [row.actor, [place, row.country].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
        color: classifyIncident(row).color,
      };
    });
    // The Lens's own flagged incidents (the Conflict Escalation layer) in the same band.
    if (withLens) {
      try {
        const parts = partsOf(geometry);
        const col = await api.getConflictEscalation();
        for (const f of col.features) {
          const [lng, lat] = f.geometry.coordinates as [number, number];
          if (lng == null || lat == null) continue;
          const time = (f.properties.time ?? "").slice(0, 10);
          if (from && time && time < from) continue;
          const off = distanceKm(lng, lat, parts);
          if (off > km) continue;
          out.push({
            key: `lens:${f.properties.id}`,
            kind: "lens",
            lat,
            lng,
            km: off,
            along: isLine ? chainageKm(lng, lat, geometry) : null,
            date: time || null,
            title: f.properties.title,
            sub: f.properties.detail ?? "",
            color: f.properties.incident?.terrorism ? "#111" : levelColor(f.properties.escalationLevel),
          });
        }
      } catch {
        setNote((n) => n ?? "The Lens's flagged incidents could not be fetched; only the incident database was searched.");
      }
    }
    out.sort((a, b) => (isLine ? (a.along ?? 0) - (b.along ?? 0) : a.km - b.km) || a.km - b.km);
    setHits(out);
    onResults(found.map((x) => x.row), { label, km, count: out.length });
    setBusy(false);
  }
  function clear() {
    setHits(null);
    setNote(null);
    onResults(null, null);
  }
  function exportCsv() {
    if (!hits?.length) return;
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["source", "date", ...(isLine ? ["km_along_route"] : []), "km_off_route", "incident", "details", "latitude", "longitude"];
    const lines = hits.map((h) =>
      [h.kind === "lens" ? "Lens flagged" : "Incident database", h.date, ...(isLine ? [h.along?.toFixed(2)] : []), h.km.toFixed(2), h.title, h.sub, h.lat.toFixed(5), h.lng.toFixed(5)].map(q).join(",")
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `incidents-within-${km}km-of-${label.replace(/[^a-z0-9]+/gi, "-")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const dbCount = hits?.filter((h) => h.kind === "db").length ?? 0;
  const lensCount = (hits?.length ?? 0) - dbCount;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 10, border: `1px solid ${HUD.borderStrong}`, background: "rgba(212,175,55,.05)" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.gold, fontWeight: 700 }}>{title}</div>
      {isLine && lengthKm > 0 && <div style={{ fontSize: 10.5, color: HUD.textMuted }}>Route length {fmtKm(lengthKm)}</div>}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: HUD.textSecondary }}>
          <span>{isLine ? "Either side of the route, within" : "Within"}</span>
          <span style={{ color: HUD.text }}>{fmtKm(km)}</span>
        </div>
        <input type="range" min={0} max={100} step={1} value={Math.round(Math.log10(Math.max(0.1, km) / 0.1) * (100 / 4))} onChange={(e) => setKm(Number((0.1 * 10 ** ((Number(e.target.value) * 4) / 100)).toPrecision(2)))} style={{ width: "100%", accentColor: HUD.gold }} title="100 m to 1,000 km" />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2, alignItems: "center" }}>
          {[0.5, 1, 5, 10, 25, 50, 100, 250].map((v) => (
            <button key={v} style={{ ...btn(km === v), padding: "2px 7px", fontSize: 10 }} onClick={() => setKm(v)}>{v < 1 ? `${v * 1000} m` : `${v} km`}</button>
          ))}
          <input type="number" min={0.01} step="any" value={km} onChange={(e) => setKm(Math.max(0.01, Number(e.target.value) || 1))} style={{ ...inputStyle, width: 66, padding: "2px 6px" }} title="Any distance, in km" />
          <span style={{ fontSize: 10, color: HUD.textMuted }}>km</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <select value={days ?? ""} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)} style={{ ...inputStyle, width: "auto", padding: "3px 6px", fontSize: 11 }}>
          {PERIODS.map((p) => <option key={p.label} value={p.days ?? ""}>{p.label}</option>)}
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: HUD.textSecondary, cursor: "pointer" }}>
          <input type="checkbox" checked={withLens} onChange={(e) => setWithLens(e.target.checked)} /> Lens flagged incidents too
        </label>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={{ ...btn(true), flex: 1 }} onClick={() => void run()} disabled={!geometry || busy}>
          <Search size={13} /> {busy ? "Searching…" : isLine ? "Find incidents along it" : "Search"}
        </button>
        {onCorridor && (
          <button style={btn()} onClick={() => onCorridor(km)} title="Draw the search band as a layer">
            <Waypoints size={13} /> Band
          </button>
        )}
      </div>
      {note && <div style={{ fontSize: 10.5, color: HUD.textMuted }}>{note}</div>}
      {mine && state && hits && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ fontSize: 12, color: HUD.text, fontWeight: 600 }}>
            {hits.length.toLocaleString()} incident{hits.length === 1 ? "" : "s"} within {fmtKm(state.km)}
            {lensCount > 0 && <span style={{ fontWeight: 400, color: HUD.textSecondary }}> ({dbCount.toLocaleString()} from the database, {lensCount} flagged by the Lens)</span>}
          </div>
          {byActor.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", fontSize: 10.5, color: HUD.textSecondary }}>
              {byActor.map(([name, v]) => (
                <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: v.color, border: "1.5px solid #fff" }} />
                  {name} {v.n}
                </span>
              ))}
            </div>
          )}
          {hits.length > 0 && (
            <div style={{ maxHeight: 260, overflow: "auto", border: `1px solid ${HUD.border}`, borderRadius: 7 }}>
              {hits.slice(0, SHOWN).map((h) => (
                <button
                  key={h.key}
                  onClick={() => onFocus?.(h.lat, h.lng)}
                  title={onFocus ? "Show on the map" : undefined}
                  style={{ display: "flex", gap: 7, width: "100%", textAlign: "left", padding: "5px 7px", border: "none", borderBottom: `1px solid ${HUD.border}`, background: "transparent", cursor: onFocus ? "pointer" : "default", fontFamily: "inherit", color: HUD.textSecondary }}
                >
                  <span style={{ marginTop: 3, flex: "0 0 auto", width: 8, height: 8, borderRadius: h.kind === "lens" ? 1 : "50%", background: h.color, border: "1.5px solid #fff" }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 10, color: HUD.textMuted }}>
                      <span>{h.date ?? "Undated"}{h.kind === "lens" ? " · Lens flagged" : ""}</span>
                      <span style={{ whiteSpace: "nowrap" }}>{h.along != null ? `km ${h.along.toFixed(1)} · ` : ""}{h.km < 0.05 ? "on it" : `${fmtKm(h.km)} off`}</span>
                    </span>
                    <span style={{ display: "block", fontSize: 11, color: HUD.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</span>
                    {h.sub && <span style={{ display: "block", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.sub}</span>}
                  </span>
                </button>
              ))}
              {hits.length > SHOWN && <div style={{ padding: "5px 7px", fontSize: 10, color: HUD.textMuted }}>And {(hits.length - SHOWN).toLocaleString()} more: download the list to see them all.</div>}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button style={{ ...btn(viewMode === "markers"), flex: 1 }} onClick={() => onViewMode("markers")}><MapPinned size={13} /> Markers</button>
            <button style={{ ...btn(viewMode === "heatmap"), flex: 1 }} onClick={() => onViewMode("heatmap")} disabled={!dbCount}><Flame size={13} /> Heatmap</button>
            <button style={btn()} onClick={exportCsv} disabled={!hits.length} title="Download the list (CSV)"><Download size={13} /></button>
            <button style={btn()} onClick={clear} title="Show every incident again"><X size={13} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
