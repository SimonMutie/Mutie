import type { GeoPermissibleObjects } from "d3-geo";
import { feature, merge } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

/** African countries' ISO numeric codes, as world-atlas numbers them. */
const AFRICA_IDS = new Set([
  "012", "024", "072", "108", "120", "132", "140", "148", "174", "178", "180", "204", "226", "231", "232", "262", "266", "270", "288", "324", "384",
  "404", "426", "430", "434", "450", "454", "466", "478", "480", "504", "508", "516", "562", "566", "624", "646", "678", "686", "690", "694", "706",
  "710", "716", "728", "729", "732", "748", "768", "788", "800", "818", "834", "854", "894",
]);

export interface GlobeShapes {
  land: GeoPermissibleObjects;
  africa: GeoPermissibleObjects;
}

let loading: Promise<GlobeShapes> | null = null;
/** The world's countries and Africa's, for the drawn globes (opening sequence, alert pop-ups); loaded once. */
export function loadGlobeShapes(): Promise<GlobeShapes> {
  loading ??= import("world-atlas/countries-110m.json").then((m) => {
    const topo = (m.default ?? m) as unknown as Topology;
    const countries = topo.objects.countries as GeometryCollection<{ name?: string }>;
    // Somalia as one state: the map data draws Somaliland as a separate, unrecognised shape (Puntland is already part
    // of Somalia); it is merged into Somalia, with no border between them.
    const isSomalia = (g: { id?: string | number; properties?: { name?: string } | null }) => String(g.id) === "706" || g.properties?.name === "Somaliland";
    const somalia = { type: "Feature", id: "706", properties: { name: "Somalia" }, geometry: merge(topo, countries.geometries.filter(isSomalia) as never) };
    const others = feature(topo, { ...countries, geometries: countries.geometries.filter((g) => !isSomalia(g)) }).features;
    const all = [...others, somalia];
    return {
      land: { type: "FeatureCollection", features: all } as GeoPermissibleObjects,
      africa: { type: "FeatureCollection", features: all.filter((f) => AFRICA_IDS.has(String(f.id))) } as GeoPermissibleObjects,
    };
  });
  return loading;
}
