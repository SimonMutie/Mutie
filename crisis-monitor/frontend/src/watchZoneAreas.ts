import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { MultiPolygon, Polygon, Position } from "geojson";
import type { WatchZone } from "./api";

/**
 * Watch zones as areas on the map, not dots. Each zone is built from real borders (world-atlas, Natural Earth 1:50m):
 *  - a whole-country zone takes its countries' borders (Sudan, Yemen, Ethiopia…; the Central Sahel is Mali, Burkina
 *    Faso and Niger together; Somalia includes Somaliland, as everywhere in the Lens);
 *  - a sub-national zone (Eastern DRC, Northern Nigeria, Cabo Delgado, Gaza) is its country cut to the zone's box, so
 *    its outer edge follows the real border and its inner edge is straight;
 *  - the Red Sea zone is the water itself: the sea from Suez to the Gulf of Aden, with the land taken out.
 * A zone with no recipe here (one added later on the server) is drawn as its box.
 */

type Coords = Position[][][]; // MultiPolygon coordinates

const RECIPES: Record<string, { countries?: string[]; somaliland?: boolean; clip?: boolean; sea?: Position[] }> = {
  sudan: { countries: ["729"] },
  gaza: { countries: ["275"], clip: true },
  drc: { countries: ["180"], clip: true },
  yemen: { countries: ["887"] },
  "red-sea": {
    // A generous outline of the Red Sea, the Gulf of Suez and Aqaba, Bab al-Mandab and the Gulf of Aden; the land is
    // taken out below, so only the water remains.
    sea: [
      [31.9, 30.6], [35.6, 30.2], [36.6, 27.4], [40.6, 21], [43.1, 15.9], [45.2, 14.4], [52.4, 16.6], [52.8, 11], [51.1, 9.6],
      [44, 9.4], [42.4, 11.3], [39, 15.4], [37, 18.8], [35, 23], [33.4, 26.6], [31.9, 30.6],
    ],
  },
  lebanon: { countries: ["422"] },
  syria: { countries: ["760"] },
  sahel: { countries: ["466", "854", "562"] },
  somalia: { countries: ["706"], somaliland: true },
  ethiopia: { countries: ["231"] },
  "south-sudan": { countries: ["728"] },
  nigeria: { countries: ["566"], clip: true },
  libya: { countries: ["434"] },
  mozambique: { countries: ["508"], clip: true },
  iraq: { countries: ["368"] },
};

const box = (b: NonNullable<WatchZone["bounds"]>): Coords => [[[[b.minLng, b.minLat], [b.maxLng, b.minLat], [b.maxLng, b.maxLat], [b.minLng, b.maxLat], [b.minLng, b.minLat]]]];
const asMulti = (g: Polygon | MultiPolygon): Coords => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

let shapes: Promise<{ countries: Map<string, Coords>; somaliland: Coords | null; land: Coords }> | null = null;
function loadShapes() {
  shapes ??= Promise.all([import("world-atlas/countries-50m.json"), import("world-atlas/land-50m.json")]).then(([c, l]) => {
    const topo = (c.default ?? c) as unknown as Topology;
    const fc = feature(topo, topo.objects.countries as GeometryCollection<{ name?: string }>) as unknown as GeoJSON.FeatureCollection<Polygon | MultiPolygon, { name?: string }>;
    const countries = new Map<string, Coords>();
    let somaliland: Coords | null = null;
    for (const f of fc.features) {
      if (!f.geometry) continue;
      if (f.properties?.name === "Somaliland") somaliland = asMulti(f.geometry);
      else if (f.id !== undefined) countries.set(String(f.id), asMulti(f.geometry));
    }
    const ltopo = (l.default ?? l) as unknown as Topology;
    const land = feature(ltopo, ltopo.objects.land as GeometryCollection) as unknown as GeoJSON.FeatureCollection<Polygon | MultiPolygon>;
    return { countries, somaliland, land: land.features.flatMap((f) => (f.geometry ? asMulti(f.geometry) : [])) };
  });
  return shapes;
}

/** Each zone's area, as a MultiPolygon, by zone id. */
export async function buildWatchZoneAreas(zones: WatchZone[]): Promise<Record<string, MultiPolygon>> {
  const [{ countries, somaliland, land }, pc] = await Promise.all([loadShapes(), import("polygon-clipping")]);
  const clip = pc.default ?? pc;
  const out: Record<string, MultiPolygon> = {};
  for (const z of zones) {
    const r = RECIPES[z.id];
    let coords: Coords | null = null;
    try {
      if (r?.sea) {
        // The water: the outline, minus the land near it.
        const near = land.filter((poly) => poly[0].some(([x, y]) => x > 28 && x < 56 && y > 5 && y < 34));
        coords = clip.difference([r.sea] as never, ...(near.map((p) => [p]) as never[])) as unknown as Coords;
      } else if (r?.countries) {
        const parts = r.countries.map((id) => countries.get(id)).filter((p): p is Coords => !!p);
        if (r.somaliland && somaliland) parts.push(somaliland);
        if (parts.length) {
          coords = (parts.length > 1 ? clip.union(parts[0] as never, ...(parts.slice(1) as never[])) : parts[0]) as unknown as Coords;
          if (r.clip && z.bounds) coords = clip.intersection(coords as never, box(z.bounds) as never) as unknown as Coords;
        }
      }
    } catch {
      coords = null;
    }
    if ((!coords || !coords.length) && z.bounds) coords = box(z.bounds);
    if (coords && coords.length) out[z.id] = { type: "MultiPolygon", coordinates: coords };
  }
  return out;
}

/** A spot inside the zone for its label: the middle of its largest part's bounding box, pulled to the zone's own
 *  centre point when that lies inside the box. */
export function labelPoint(z: WatchZone, area: MultiPolygon): [number, number] {
  let best = area.coordinates[0];
  let bestSize = 0;
  for (const poly of area.coordinates) {
    const xs = poly[0].map((p) => p[0]), ys = poly[0].map((p) => p[1]);
    const size = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (size > bestSize) {
      bestSize = size;
      best = poly;
    }
  }
  const xs = best[0].map((p) => p[0]), ys = best[0].map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (z.lng >= minX && z.lng <= maxX && z.lat >= minY && z.lat <= maxY) return [z.lng, z.lat];
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

export const ZONE_STYLE: Record<WatchZone["severity"], { color: string; label: string; fill: number; weight: number; dash?: string; glDash?: number[] }> = {
  war: { color: "#ff3d3d", label: "Active war", fill: 0.16, weight: 2 },
  high: { color: "#ff9500", label: "High tension", fill: 0.12, weight: 1.8 },
  elevated: { color: "#ffd23f", label: "Elevated", fill: 0.09, weight: 1.6, dash: "6 4", glDash: [3, 2] },
};
