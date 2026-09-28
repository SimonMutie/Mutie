import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, ZoomControl } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { api, type LiveLayerCollection } from "../api";
import { BASEMAPS } from "./mapConstants";

/**
 * "Live Intelligence" — a new, separate view rather than a restyle of the
 * existing (light) dashboards/choropleth. Modeled on OSIRIS's own dark
 * HUD aesthetic (osirisai.live): dark basemap, monospace status readouts,
 * a toggleable layer rail instead of a fixed legend. Nothing here touches
 * IncidentsMap/IncidentSearch or their data — this is a read-only view over
 * three public feeds proxied through /api/live-layers.
 *
 * Phase 1 scope, deliberately: three keyless public feeds (earthquakes,
 * NASA EONET open natural events, GDELT conflict-related news mentions).
 * Not the full multi-layer/ADM-hierarchy/animation engine — see the layer
 * definitions below for exactly what each one is and isn't.
 */

interface LayerDef {
  key: "earthquakes" | "natural-events" | "conflict-events";
  label: string;
  color: string;
  fetcher: () => Promise<LiveLayerCollection>;
}

const LAYER_DEFS: LayerDef[] = [
  { key: "earthquakes", label: "Earthquakes", color: "#ff5d5d", fetcher: api.getLiveEarthquakes },
  { key: "natural-events", label: "Natural Events", color: "#ffb020", fetcher: api.getLiveNaturalEvents },
  { key: "conflict-events", label: "Conflict Reports", color: "#7c9cff", fetcher: api.getLiveConflictEvents },
];

const POLL_MS = 60_000; // matches the backend's Cache API TTL — polling faster wouldn't get fresher data

type LayerState = {
  data: LiveLayerCollection | null;
  loading: boolean;
  error: string | null;
};

export default function LiveIntelView() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    earthquakes: true,
    "natural-events": true,
    "conflict-events": true,
  });
  const [layers, setLayers] = useState<Record<string, LayerState>>(() =>
    Object.fromEntries(LAYER_DEFS.map((d) => [d.key, { data: null, loading: true, error: null }]))
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());

  const loadLayer = useCallback(async (def: LayerDef) => {
    setLayers((prev) => ({ ...prev, [def.key]: { ...prev[def.key], loading: true } }));
    try {
      const data = await def.fetcher();
      setLayers((prev) => ({ ...prev, [def.key]: { data, loading: false, error: null } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Feed unavailable";
      setLayers((prev) => ({ ...prev, [def.key]: { ...prev[def.key], loading: false, error: message } }));
    }
  }, []);

  useEffect(() => {
    LAYER_DEFS.forEach((def) => loadLayer(def));
    const interval = setInterval(() => LAYER_DEFS.forEach((def) => loadLayer(def)), POLL_MS);
    return () => clearInterval(interval);
  }, [loadLayer]);

  // Local clock readout in the HUD status bar — purely cosmetic, matches
  // OSIRIS's own always-on status-bar clock; not tied to any feed's own
  // "as of" time (each layer chip shows its own fetchedAt separately).
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const totalFeatures = useMemo(
    () => LAYER_DEFS.reduce((sum, d) => sum + (enabled[d.key] ? (layers[d.key]?.data?.features.length ?? 0) : 0), 0),
    [layers, enabled]
  );

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#05070a",
        color: "#d7e4f2",
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
      }}
    >
      <HudToolbar
        defs={LAYER_DEFS}
        enabled={enabled}
        layers={layers}
        onToggle={(key) => setEnabled((prev) => ({ ...prev, [key]: !prev[key] }))}
        onRefresh={() => LAYER_DEFS.forEach((def) => loadLayer(def))}
      />

      <div style={{ position: "relative", flex: 1 }}>
        <MapContainer
          center={[15, 20]}
          zoom={3}
          minZoom={2}
          worldCopyJump
          zoomControl={false}
          style={{ height: "100%", width: "100%", background: "#05070a" }}
        >
          <ZoomControl position="bottomright" />
          <TileLayer url={BASEMAPS.dark.url} attribution={BASEMAPS.dark.attribution} />

          {LAYER_DEFS.map((def) => {
            if (!enabled[def.key]) return null;
            const state = layers[def.key];
            if (!state?.data) return null;
            return state.data.features.map((f) => {
              const [lon, lat] = f.geometry.coordinates;
              const radius = 4 + f.properties.intensity * 10;
              const id = `${def.key}:${f.properties.id}`;
              return (
                <CircleMarker
                  key={id}
                  center={[lat, lon]}
                  radius={radius}
                  pathOptions={{
                    color: def.color,
                    fillColor: def.color,
                    fillOpacity: 0.55,
                    weight: selectedId === id ? 2.5 : 1,
                    opacity: selectedId === id ? 1 : 0.85,
                  }}
                  eventHandlers={{ click: () => setSelectedId(id) }}
                >
                  <Popup>
                    <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, minWidth: 180 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{f.properties.title}</div>
                      <div style={{ color: "#666" }}>{def.label}</div>
                      <div>{f.properties.intensityLabel}</div>
                      {f.properties.time && <div>{new Date(f.properties.time).toLocaleString()}</div>}
                      {f.properties.detail && <div style={{ marginTop: 4 }}>{f.properties.detail}</div>}
                      {f.properties.url && (
                        <a href={f.properties.url} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 4 }}>
                          Source ↗
                        </a>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              );
            });
          })}
        </MapContainer>

        <StatusBar totalFeatures={totalFeatures} clock={clock} />
      </div>
    </div>
  );
}

function HudToolbar({
  defs,
  enabled,
  layers,
  onToggle,
  onRefresh,
}: {
  defs: LayerDef[];
  enabled: Record<string, boolean>;
  layers: Record<string, LayerState>;
  onToggle: (key: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderBottom: "1px solid rgba(124,156,255,0.18)",
        background: "linear-gradient(180deg, #0a0e16, #05070a)",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#7c9cff",
          fontWeight: 700,
          marginRight: 4,
        }}
      >
        Live Intelligence
      </span>

      {defs.map((def) => {
        const state = layers[def.key];
        const isOn = enabled[def.key];
        const count = state?.data?.features.length;
        return (
          <button
            key={def.key}
            onClick={() => onToggle(def.key)}
            title={state?.error ?? undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              padding: "5px 10px",
              borderRadius: 999,
              border: `1px solid ${isOn ? def.color : "rgba(215,228,242,0.25)"}`,
              background: isOn ? `${def.color}22` : "transparent",
              color: isOn ? "#eef3ff" : "#7f8ea3",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: state?.error ? "#ff5d5d" : def.color,
                opacity: isOn ? 1 : 0.35,
              }}
            />
            {def.label}
            <span style={{ opacity: 0.65 }}>
              {state?.loading ? "…" : state?.error ? "ERR" : (count ?? 0)}
            </span>
          </button>
        );
      })}

      <button
        onClick={onRefresh}
        style={{
          marginLeft: "auto",
          fontSize: 11,
          padding: "5px 12px",
          borderRadius: 6,
          border: "1px solid rgba(124,156,255,0.35)",
          background: "transparent",
          color: "#7c9cff",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        ⟳ Refresh
      </button>
    </div>
  );
}

function StatusBar({ totalFeatures, clock }: { totalFeatures: number; clock: Date }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        display: "flex",
        gap: 16,
        fontSize: 11,
        color: "#7f8ea3",
        background: "rgba(5,7,10,0.72)",
        border: "1px solid rgba(124,156,255,0.18)",
        borderRadius: 6,
        padding: "6px 12px",
        backdropFilter: "blur(4px)",
        zIndex: 500,
      }}
    >
      <span>
        TRACKS <span style={{ color: "#eef3ff" }}>{totalFeatures}</span>
      </span>
      <span>{clock.toISOString().replace("T", " ").slice(0, 19)} UTC</span>
    </div>
  );
}
