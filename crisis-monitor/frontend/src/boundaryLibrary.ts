import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { api, type BoundaryCountry, type BoundaryLayer, type BoundaryUnit } from "./api";

/**
 * The administrative boundary library in the app: the catalogue of countries and their levels, each level's areas
 * (fetched once per visit), the world's countries from Natural Earth (with Somaliland part of Somalia), and the
 * geometry helpers watch zones are built with (joining areas, their extent).
 */

/** The world's countries, the "Countries" level for every country at once. */
export const WORLD = "WLD";

let catalogue: Promise<BoundaryCountry[]> | null = null;
export function boundaryCatalogue(): Promise<BoundaryCountry[]> {
  catalogue ??= api.getBoundaryCatalogue().then((r) => r.countries);
  catalogue.catch(() => (catalogue = null));
  return catalogue;
}

const layers = new Map<string, Promise<BoundaryLayer>>();
export function boundaryLayer(iso: string, level: string): Promise<BoundaryLayer> {
  const k = `${iso}:${level}`;
  let p = layers.get(k);
  if (!p) {
    p = iso === WORLD ? worldCountries() : api.getBoundaryLayer(iso, level);
    p.catch(() => layers.delete(k));
    layers.set(k, p);
  }
  return p;
}

async function worldCountries(): Promise<BoundaryLayer> {
  const m = await import("world-atlas/countries-50m.json");
  const topo = (m.default ?? m) as unknown as Topology;
  const fc = feature(topo, topo.objects.countries as GeometryCollection<{ name?: string }>) as unknown as GeoJSON.FeatureCollection<Polygon | MultiPolygon, { name?: string }>;
  const somaliland = fc.features.find((f) => f.properties?.name === "Somaliland");
  const pc = await import("polygon-clipping");
  const clip = pc.default ?? pc;
  const features = fc.features
    .filter((f) => f.geometry && f.properties?.name !== "Somaliland")
    .map((f) => {
      let geometry = f.geometry as Polygon | MultiPolygon;
      // Somalia as one country, as everywhere in the Lens.
      if (f.properties?.name === "Somalia" && somaliland?.geometry) geometry = { type: "MultiPolygon", coordinates: clip.union(geometry.coordinates as never, somaliland.geometry.coordinates as never) as never };
      return { type: "Feature" as const, properties: { id: String(f.id ?? f.properties?.name), name: f.properties?.name ?? "Country", iso: WORLD, level: "ADM0" }, geometry };
    });
  return { type: "FeatureCollection", iso: WORLD, level: "ADM0", canonical: "Countries", license: "Natural Earth (public domain)", features };
}

export const unitKey = (iso: string, level: string, id: string) => `${iso}:${level}:${id}`;

/** The shape of each of these areas, joined into one. */
export async function unitsGeometry(units: BoundaryUnit[]): Promise<MultiPolygon | null> {
  if (!units.length) return null;
  const parts: Position[][][] = [];
  for (const u of units) {
    const layer = await boundaryLayer(u.iso, u.level);
    const f = layer.features.find((x) => x.properties.id === u.id);
    if (!f) continue;
    parts.push(...(f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates));
  }
  return joinShapes(parts);
}

/** Several shapes joined into one (shared borders dissolved). */
export async function joinShapes(parts: Position[][][]): Promise<MultiPolygon | null> {
  if (!parts.length) return null;
  const pc = await import("polygon-clipping");
  const clip = pc.default ?? pc;
  try {
    return { type: "MultiPolygon", coordinates: clip.union(parts[0] as never, ...(parts.slice(1) as never[])) as unknown as Position[][][] };
  } catch {
    return { type: "MultiPolygon", coordinates: parts };
  }
}

export function extentOf(g: MultiPolygon | null): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  if (!g || !g.coordinates.length) return null;
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const poly of g.coordinates)
    for (const [x, y] of poly[0]) {
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
      if (x < minLng) minLng = x;
      if (x > maxLng) maxLng = x;
    }
  return { minLat, maxLat, minLng, maxLng };
}

/** What a level is called for a country ("States", "Counties"…), with the general name as a fallback. */
export function levelName(level: string, canonical?: string): string {
  if (canonical) return canonical;
  return { ADM0: "Country", ADM1: "States / provinces", ADM2: "Districts", ADM3: "Sub-districts", ADM4: "Localities", ADM5: "Villages" }[level] ?? level;
}

export function downloadGeoJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/geo+json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\w.-]+/g, "_")}.geojson`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
