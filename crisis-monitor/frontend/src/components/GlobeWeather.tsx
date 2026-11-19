import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Pause, Play, X } from "lucide-react";

/**
 * MapTiler Weather on the 3D globe: radar, precipitation, temperature, wind (moving particles) and pressure, from
 * MapTiler's global forecast model, animated over its forecast window (the past few hours to several days ahead).
 * Needs the MapTiler key (the globe is then MapTiler's SDK map, which the weather layers draw on). The weather
 * package is large, so it is only loaded when a weather layer is first turned on.
 */

export type GlobeWeatherKind = "radar" | "precipitation" | "temperature" | "wind" | "pressure";

export const GLOBE_WEATHER: { key: GlobeWeatherKind; label: string; hint: string }[] = [
  { key: "radar", label: "Radar", hint: "Rain and storms, as radar would show them, worldwide" },
  { key: "precipitation", label: "Precipitation", hint: "Rain and snow, mm an hour" },
  { key: "temperature", label: "Temperature", hint: "Air temperature at 2 m, °C" },
  { key: "wind", label: "Wind", hint: "Moving wind particles, speed and direction" },
  { key: "pressure", label: "Pressure", hint: "Sea-level pressure, hPa, with isobars" },
];

/** The weather layer's interface as used here (the package's layers all share it). */
interface WeatherLayer {
  id: string;
  on(event: string, fn: (...args: unknown[]) => void): void;
  onSourceReadyAsync(): Promise<void>;
  getAnimationStart(): number;
  getAnimationEnd(): number;
  getAnimationTime(): number;
  setAnimationTime(t: number): void;
  animateByFactor(f: number): void;
  isPlaying(): boolean;
  setOpacity(o: number): void;
  pickAt(lng: number, lat: number): Record<string, unknown> | null;
}

/** Hours of forecast passed per real second while playing. */
const PLAY_FACTOR = 3600 * 3;

function readout(kind: GlobeWeatherKind, v: Record<string, unknown> | null): string {
  if (!v) return "";
  const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : null);
  switch (kind) {
    case "temperature": {
      const t = n("value");
      return t === null ? "" : `${t.toFixed(1)} °C`;
    }
    case "precipitation": {
      const p = n("value");
      return p === null ? "" : `${p.toFixed(1)} mm/h`;
    }
    case "radar": {
      const r = n("value");
      return r === null ? "" : `${r.toFixed(0)} dBZ`;
    }
    case "pressure": {
      const p = n("value");
      return p === null ? "" : `${p.toFixed(0)} hPa`;
    }
    case "wind": {
      const s = n("speedKilometersPerHour");
      const d = typeof v.compassDirection === "string" ? v.compassDirection : "";
      return s === null ? "" : `${s.toFixed(0)} km/h ${d}`;
    }
  }
}

const fmt = (t: number) => {
  const d = new Date(t < 1e12 ? t * 1000 : t);
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function GlobeWeather({ map, kind, visible, onClose }: { map: MapLibreMap | null; kind: GlobeWeatherKind; visible: boolean; onClose: () => void }) {
  const layerRef = useRef<WeatherLayer | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Add the chosen layer (beneath the Lens's markers), and take it off again when it changes or closes.
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    let added: WeatherLayer | null = null;
    setRange(null);
    setError(null);
    setValue("");
    setPlaying(false);
    import("@maptiler/weather")
      .then((w) => {
        if (cancelled) return;
        const id = `lens-weather-${kind}`;
        const opts = { id, opacity: kind === "temperature" || kind === "pressure" ? 0.6 : 0.85 };
        const layer = (kind === "radar" ? new w.RadarLayer(opts) : kind === "precipitation" ? new w.PrecipitationLayer(opts) : kind === "temperature" ? new w.TemperatureLayer(opts) : kind === "wind" ? new w.WindLayer({ id }) : new w.PressureLayer(opts)) as unknown as WeatherLayer;
        const before = (map.getStyle().layers ?? []).find((l) => l.id === "lens-heat-layer" || l.id === "lens-points-circle")?.id;
        map.addLayer(layer as never, before);
        added = layer;
        layerRef.current = layer;
        layer.on("tick", () => setTime(layer.getAnimationTime()));
        // If MapTiler's weather data does not arrive, say so rather than loading forever.
        const late = window.setTimeout(() => !cancelled && setError("MapTiler's weather data did not load. Try again later."), 25000);
        return layer.onSourceReadyAsync().then(() => {
          window.clearTimeout(late);
          if (cancelled) return;
          const start = layer.getAnimationStart(), end = layer.getAnimationEnd();
          // Start at the frame nearest now.
          const nowT = start < 1e12 ? Date.now() / 1000 : Date.now();
          const t = Math.min(end, Math.max(start, nowT));
          layer.setAnimationTime(t);
          setRange({ start, end });
          setTime(t);
        });
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "The weather layer could not load."));
    return () => {
      cancelled = true;
      layerRef.current = null;
      if (added && map.getLayer(added.id)) map.removeLayer(added.id);
    };
  }, [map, kind]);

  // Hidden with the globe (switching to the flat map): pause and hide, so it costs nothing.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !map || !map.getLayer(layer.id)) return;
    map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
    if (!visible && layer.isPlaying()) {
      layer.animateByFactor(0);
      setPlaying(false);
    }
  }, [visible, map, range]);

  // The value under the pointer.
  useEffect(() => {
    if (!map) return;
    const move = (e: { lngLat: { lng: number; lat: number } }) => {
      const layer = layerRef.current;
      if (!layer) return;
      try {
        setValue(readout(kind, layer.pickAt(e.lngLat.lng, e.lngLat.lat)));
      } catch {
        setValue("");
      }
    };
    map.on("mousemove", move);
    return () => {
      map.off("mousemove", move);
    };
  }, [map, kind]);

  if (!visible) return null;
  const label = GLOBE_WEATHER.find((k) => k.key === kind)?.label ?? "Weather";
  const toggle = () => {
    const layer = layerRef.current;
    if (!layer) return;
    if (layer.isPlaying()) {
      layer.animateByFactor(0);
      setPlaying(false);
    } else {
      if (layer.getAnimationTime() >= layer.getAnimationEnd()) layer.setAnimationTime(layer.getAnimationStart());
      layer.animateByFactor(PLAY_FACTOR);
      setPlaying(true);
    }
  };
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 46,
        transform: "translateX(-50%)",
        zIndex: 450,
        width: "min(560px, 70vw)",
        padding: "8px 12px",
        borderRadius: 10,
        background: "rgba(6, 10, 18, 0.88)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "#e6edf7",
        fontSize: 11,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <button onClick={toggle} disabled={!range} title={playing ? "Pause" : "Play the forecast"} style={{ background: "none", border: "none", color: "#d4af37", cursor: range ? "pointer" : "default", padding: 0, display: "flex" }}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontWeight: 700, letterSpacing: "0.06em" }}>{label.toUpperCase()}</span>
          <span style={{ color: "#9fb0c6" }}>{error ? error : range ? fmt(time) : "Loading forecast…"}</span>
          <span style={{ color: "#d4af37", minWidth: 80, textAlign: "right" }}>{value}</span>
        </div>
        <input
          type="range"
          min={range?.start ?? 0}
          max={range?.end ?? 1}
          step="any"
          value={range ? time : 0}
          disabled={!range}
          onChange={(e) => {
            const t = Number(e.target.value);
            layerRef.current?.setAnimationTime(t);
            setTime(t);
          }}
          style={{ width: "100%", accentColor: "#d4af37" }}
          aria-label="Forecast time"
        />
      </div>
      <button onClick={onClose} title="Close weather" style={{ background: "none", border: "none", color: "#9fb0c6", cursor: "pointer", padding: 0, display: "flex" }}>
        <X size={15} />
      </button>
    </div>
  );
}
