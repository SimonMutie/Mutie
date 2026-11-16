import { useEffect, useState } from "react";
import { TileLayer } from "react-leaflet";

/**
 * Rain radar and infrared cloud imagery from RainViewer's free public API (as OSIRIS's Rain and Live Clouds layers),
 * on the flat map. Radar is where ground radars exist, which in Africa is little beyond South Africa and the
 * Mediterranean coast; the infrared clouds cover everywhere. Both refresh every ten minutes.
 */
interface Frames {
  host: string;
  radar: string | null;
  clouds: string | null;
  time: number | null;
}

export function useRainViewer(on: boolean): { frames: Frames | null; error: string | null } {
  const [frames, setFrames] = useState<Frames | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    const load = () =>
      fetch("https://api.rainviewer.com/public/weather-maps.json")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`RainViewer returned ${r.status}`))))
        .then((d: { host?: string; radar?: { past?: { time: number; path: string }[] }; satellite?: { infrared?: { time: number; path: string }[] } }) => {
          if (cancelled) return;
          const past = d.radar?.past ?? [];
          const irs = d.satellite?.infrared ?? [];
          const radar = past.length ? past[past.length - 1] : null;
          const ir = irs.length ? irs[irs.length - 1] : null;
          setFrames({ host: d.host ?? "https://tilecache.rainviewer.com", radar: radar?.path ?? null, clouds: ir?.path ?? null, time: radar?.time ?? ir?.time ?? null });
          setError(null);
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "RainViewer unavailable"));
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [on]);
  return { frames, error };
}

export function WeatherTiles({ frames, rain, clouds }: { frames: Frames; rain: boolean; clouds: boolean }) {
  return (
    <>
      {clouds && frames.clouds && <TileLayer key={`ir:${frames.clouds}`} url={`${frames.host}${frames.clouds}/256/{z}/{x}/{y}/0/0_0.png`} opacity={0.55} zIndex={6} maxNativeZoom={6} attribution="Clouds: RainViewer" />}
      {rain && frames.radar && <TileLayer key={`rd:${frames.radar}`} url={`${frames.host}${frames.radar}/256/{z}/{x}/{y}/2/1_1.png`} opacity={0.75} zIndex={7} maxNativeZoom={7} attribution="Rain radar: RainViewer" />}
    </>
  );
}
