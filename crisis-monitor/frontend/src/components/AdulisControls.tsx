import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { GeoJSON, Marker, useMap } from "react-leaflet";
import { divIcon, type LatLngBoundsExpression } from "leaflet";
import { loadWorldCountries } from "./worldCountries";
import "./FireWaves.css";

/** Region views, as Adulis's region tabs. Bounds are approximate, south-west and north-east corners. */
export interface RegionView {
  key: string;
  label: string;
  bounds: [[number, number], [number, number]];
}
export const ADULIS_REGIONS: RegionView[] = [
  { key: "tigray", label: "Tigray", bounds: [[12.2, 36.4], [14.95, 39.9]] },
  { key: "ethiopia", label: "Ethiopia", bounds: [[3.3, 32.9], [15.0, 48.1]] },
  { key: "sudan", label: "Sudan", bounds: [[8.6, 21.8], [23.2, 38.6]] },
  { key: "somalia", label: "Somalia", bounds: [[-1.7, 40.9], [12.0, 51.5]] },
  { key: "horn", label: "Horn", bounds: [[-2.0, 32.0], [18.0, 51.5]] },
];

/** Horn countries as numeric ISO codes, as the world outline data identifies them: Ethiopia, Eritrea, Sudan, South Sudan, Somalia, Djibouti, Kenya. */
const HORN_IDS = new Set(["231", "232", "729", "728", "706", "262", "404"]);

/** Flies the map to a region each time `seq` changes. */
export function RegionFly({ region, seq }: { region: RegionView | null; seq: number }) {
  const map = useMap();
  useEffect(() => {
    if (region) map.flyToBounds(region.bounds as LatLngBoundsExpression, { duration: 0.8, padding: [20, 20] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);
  return null;
}

type WorldCollection = Awaited<ReturnType<typeof loadWorldCountries>>;

/** Dashed outlines of the Horn countries, on top of the basemap. */
export function HornOutlines() {
  const [world, setWorld] = useState<WorldCollection | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadWorldCountries().then((w) => !cancelled && setWorld(w)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const data = useMemo<WorldCollection | null>(
    () => (world ? { ...world, features: world.features.filter((f) => HORN_IDS.has(String(f.id))) } : null),
    [world]
  );
  if (!data) return null;
  return (
    <GeoJSON
      data={data}
      interactive={false}
      style={() => ({ color: "#ffd23f", weight: 1.2, opacity: 0.85, dashArray: "5 4", fillOpacity: 0 })}
    />
  );
}

export interface HotCell {
  lat: number;
  lng: number;
  count: number;
}

/** Where fire detections bunch up: range cells already carry a count; a single day is grouped into 0.1-degree squares. */
export function hotCellsFrom(
  features: { geometry: { coordinates: [number, number] }; properties: { count?: number } }[],
  cells: boolean,
  minCount: number,
  limit: number
): HotCell[] {
  if (cells) {
    return features
      .filter((f) => (f.properties.count ?? 0) >= minCount)
      .map((f) => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], count: f.properties.count ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
  const squares = new Map<string, { lat: number; lng: number; n: number }>();
  for (const f of features) {
    const lat = f.geometry.coordinates[1];
    const lng = f.geometry.coordinates[0];
    const key = `${Math.floor(lat / 0.1)}:${Math.floor(lng / 0.1)}`;
    const sq = squares.get(key) ?? { lat: 0, lng: 0, n: 0 };
    sq.lat += lat;
    sq.lng += lng;
    sq.n += 1;
    squares.set(key, sq);
  }
  return [...squares.values()]
    .filter((sq) => sq.n >= minCount)
    .map((sq) => ({ lat: sq.lat / sq.n, lng: sq.lng / sq.n, count: sq.n }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Beam and ripple waves radiating from each hotspot; larger hotspots get larger waves. */
export function HotspotWaves({ cells }: { cells: HotCell[] }) {
  return (
    <>
      {cells.map((c, i) => {
        const size = Math.min(110, 34 + c.count * 2);
        return (
          <Marker
            key={i}
            position={[c.lat, c.lng]}
            interactive={false}
            icon={divIcon({
              className: "fire-wave-icon",
              iconSize: [0, 0],
              html: `<span class="fire-beam" style="--fire-size:${size}px"></span><span class="fire-wave" style="--fire-size:${size}px"></span><span class="fire-wave fire-wave--late" style="--fire-size:${size}px"></span><span class="fire-wave fire-wave--later" style="--fire-size:${size}px"></span>`,
            })}
          />
        );
      })}
    </>
  );
}

const chip = (on: boolean): CSSProperties => ({
  padding: "4px 9px",
  fontSize: 11,
  fontFamily: "inherit",
  cursor: "pointer",
  color: "#e6edf7",
  background: on ? "rgba(255,122,26,0.35)" : "rgba(8, 14, 24, 0.82)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  whiteSpace: "nowrap",
});

/** Region tabs, plus the outline and wave toggles, under the imagery control. */
export function AdulisBar({
  region,
  onRegion,
  outlines,
  onOutlines,
  waves,
  onWaves,
}: {
  region: string | null;
  onRegion: (r: RegionView) => void;
  outlines: boolean;
  onOutlines: (on: boolean) => void;
  waves: boolean;
  onWaves: (on: boolean) => void;
}) {
  return (
    <div role="group" aria-label="Region and map overlays" style={{ position: "absolute", top: 44, left: "var(--lens-pad-left, 10px)", zIndex: 500, display: "flex", gap: 4, flexWrap: "wrap", maxWidth: "70%" }}>
      {ADULIS_REGIONS.map((r) => (
        <button key={r.key} onClick={() => onRegion(r)} aria-pressed={region === r.key} style={chip(region === r.key)}>
          {r.label}
        </button>
      ))}
      <button onClick={() => onOutlines(!outlines)} aria-pressed={outlines} style={chip(outlines)}>Horn outlines</button>
      <button onClick={() => onWaves(!waves)} aria-pressed={waves} style={chip(waves)}>Hotspot waves</button>
    </div>
  );
}
