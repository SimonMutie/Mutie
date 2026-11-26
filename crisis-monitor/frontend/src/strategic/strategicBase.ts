import type { Map as MapLibreMap, SkySpecification } from "maplibre-gl";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

/**
 * The "Strategic" basemap on the 3D globe: a navy ocean, muted land, fine country borders and a bright atmosphere,
 * drawn from the Lens's own Natural Earth borders (no map tiles), so the data stands out. Somaliland is drawn as
 * part of Somalia, with no border between them, as everywhere in the Lens.
 */

export const STRATEGIC_PREFIX = "lens-basemap-strategic--";
export const DEFAULT_SKY: SkySpecification = { "sky-color": "#000308", "horizon-color": "#1a2a4d", "horizon-fog-blend": 0.6, "atmosphere-blend": 0.4 };
export const STRATEGIC_SKY: SkySpecification = { "sky-color": "#02060f", "horizon-color": "#2f74c4", "horizon-fog-blend": 0.85, "atmosphere-blend": 0.95 };

let loading: Promise<void> | null = null;

/** Adds the Strategic basemap's layers (hidden until shown), once; resolves when they are there. */
export function ensureStrategicBase(map: MapLibreMap): Promise<void> {
  if (map.getLayer(`${STRATEGIC_PREFIX}ocean`)) return Promise.resolve();
  loading ??= Promise.all([import("world-atlas/countries-50m.json"), import("world-atlas/land-50m.json")])
    .then(([c, l]) => {
      if (map.getLayer(`${STRATEGIC_PREFIX}ocean`)) return;
      const topo = (c.default ?? c) as unknown as Topology;
      const countries = topo.objects.countries as GeometryCollection<{ name?: string }>;
      const isSomali = (g: { id?: string | number; properties?: { name?: string } }) => String(g.id) === "706" || g.properties?.name === "Somaliland";
      const borders = mesh(topo, countries, (a, b) => a !== b && !(isSomali(a as never) && isSomali(b as never)));
      const ltopo = (l.default ?? l) as unknown as Topology;
      const land = feature(ltopo, ltopo.objects.land as GeometryCollection);
      const before = (map.getStyle().layers ?? []).find((x) => x.id.startsWith("lens-") && !x.id.startsWith("lens-basemap-"))?.id;
      const hidden = { visibility: "none" as const };
      map.addSource(`${STRATEGIC_PREFIX}land`, { type: "geojson", data: land as never });
      map.addSource(`${STRATEGIC_PREFIX}borders`, { type: "geojson", data: borders as never });
      map.addLayer({ id: `${STRATEGIC_PREFIX}ocean`, type: "background", layout: hidden, paint: { "background-color": "#0b1f3a" } }, before);
      map.addLayer({ id: `${STRATEGIC_PREFIX}land`, type: "fill", source: `${STRATEGIC_PREFIX}land`, layout: hidden, paint: { "fill-color": "#132c4b" } }, before);
      map.addLayer({ id: `${STRATEGIC_PREFIX}coast`, type: "line", source: `${STRATEGIC_PREFIX}land`, layout: hidden, paint: { "line-color": "#3d7cc0", "line-width": 0.7, "line-opacity": 0.55 } }, before);
      map.addLayer({ id: `${STRATEGIC_PREFIX}borders`, type: "line", source: `${STRATEGIC_PREFIX}borders`, layout: hidden, paint: { "line-color": "#2f5b8c", "line-width": 0.6, "line-opacity": 0.8 } }, before);
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}
