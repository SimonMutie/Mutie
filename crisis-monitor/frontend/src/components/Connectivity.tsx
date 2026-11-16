import { useEffect, useMemo, useState } from "react";
import { GeoJSON } from "react-leaflet";
import { api, type ConnectivityResult } from "../api";
import { loadWorldCountries } from "./worldCountries";

/**
 * Internet connectivity (IODA, Georgia Tech): each Horn country is dimmed by how far its connectivity has fallen
 * against 15 to 21 September 2026. Below 90% is dimmed, below 60% more strongly, and a grey dashed outline marks a
 * country with too few networks to measure.
 */
type World = Awaited<ReturnType<typeof loadWorldCountries>>;

const LEVEL_TEXT: Record<string, string> = { normal: "normal", degraded: "degraded", severe: "serious loss", unmeasured: "not measurable" };

export function useConnectivity(on: boolean): { data: ConnectivityResult | null; error: string | null } {
  const [data, setData] = useState<ConnectivityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    const load = () =>
      api
        .getConnectivity()
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Connectivity feed unavailable"));
    load();
    const id = setInterval(load, 15 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [on]);
  return { data, error };
}

export function ConnectivityLayer({ data }: { data: ConnectivityResult }) {
  const [world, setWorld] = useState<World | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadWorldCountries().then((w) => !cancelled && setWorld(w)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const byId = useMemo(() => new Map(data.countries.map((c) => [c.numeric, c])), [data]);
  const shapes = useMemo<World | null>(() => (world ? { ...world, features: world.features.filter((f) => byId.has(String(f.id))) } : null), [world, byId]);
  if (!shapes) return null;
  return (
    <GeoJSON
      key={data.fetchedAt}
      data={shapes}
      style={(f) => {
        const c = byId.get(String(f?.id));
        if (!c || c.level === "unmeasured") return { color: "#9aa7b8", weight: 1.2, dashArray: "3 5", fillOpacity: 0 };
        if (c.level === "severe") return { color: "#0b0f17", weight: 1, fillColor: "#05070c", fillOpacity: 0.7 };
        if (c.level === "degraded") return { color: "#0b0f17", weight: 1, fillColor: "#05070c", fillOpacity: 0.4 };
        return { color: "#4dff9e", weight: 1, opacity: 0.5, fillOpacity: 0 };
      }}
      onEachFeature={(f, layer) => {
        const c = byId.get(String(f.id));
        if (!c) return;
        layer.bindTooltip(`${c.name}: ${c.ratio === null ? "connectivity not measurable" : `${Math.round(c.ratio * 100)}% of the baseline week (${LEVEL_TEXT[c.level]})`}`, { sticky: true });
      }}
    />
  );
}

/** The figures behind the shading, and what IODA answered when something is missing. */
export function ConnectivityPanel({ data, error }: { data: ConnectivityResult | null; error: string | null }) {
  const [showChecks, setShowChecks] = useState(false);
  const failed = data ? data.countries.filter((c) => c.error) : [];
  return (
    <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
      <div style={{ fontWeight: 600 }}>Internet connectivity (IODA)</div>
      {!data && !error && <div style={{ opacity: 0.7 }}>Reading IODA…</div>}
      {error && <div style={{ color: "#ff9a9a" }}>Could not read connectivity: {error}</div>}
      {data && (
        <>
          <div style={{ opacity: 0.7, marginBottom: 3 }}>Last six hours against 15 to 21 Sept. Weakest signal per country.</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 10.5 }}>
            <tbody>
              {data.countries.map((c) => (
                <tr key={c.code} title={c.signals.map((s) => `${s.datasource}: ${s.ratio === null ? "n/a" : `${Math.round(s.ratio * 100)}%`}`).join(" · ") || c.error || ""}>
                  <td style={{ padding: "1px 0" }}>{c.name}</td>
                  <td style={{ textAlign: "right" }}>{c.ratio === null ? "—" : `${Math.round(c.ratio * 100)}%`}</td>
                  <td style={{ textAlign: "right", color: c.level === "severe" ? "#ff6b6b" : c.level === "degraded" ? "#ffd23f" : c.level === "normal" ? "#4dff9e" : "#9aa7b8" }}>{LEVEL_TEXT[c.level]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {failed.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <span style={{ color: "#ff9a9a" }}>{failed.length} of {data.countries.length} countries could not be read.</span>{" "}
              <button onClick={() => setShowChecks((v) => !v)} style={{ padding: "1px 6px", fontSize: 10.5, fontFamily: "inherit", cursor: "pointer", color: "#e6edf7", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 4 }}>
                {showChecks ? "Hide" : "Show"} what IODA answered
              </button>
              {showChecks && (
                <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 10, lineHeight: 1.4, wordBreak: "break-all", opacity: 0.85 }}>
                  {data.diagnostics.slice(0, 6).map((d, i) => (
                    <div key={i}>{String(d.status)} · {d.series} series · keys [{d.topLevelKeys.join(", ")}] · {d.url.replace(/^https:\/\/[^/]+/, "")}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div style={{ opacity: 0.6, marginTop: 3 }}>Countries only. Regions inside a country (such as Tigray) are not broken out yet.</div>
        </>
      )}
    </div>
  );
}
