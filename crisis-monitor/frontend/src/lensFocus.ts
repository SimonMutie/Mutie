import { merge } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

/**
 * The Lens basemap's focus: Africa and the Middle East at full strength, the rest of the world dimmed, with a fine
 * outline around the region. Built once from world-atlas (Natural Earth, 1:50m): one polygon covering the world,
 * with the region cut out as holes. Somaliland is part of Somalia here as everywhere in the Lens. Both map engines
 * draw it: Leaflet as a GeoJSON layer, MapLibre as a fill and line layer.
 */

/** Africa (ISO numeric, as world-atlas numbers them), plus Somaliland's unnumbered shape. */
const AFRICA = [
  "012", "024", "072", "108", "120", "132", "140", "148", "174", "175", "178", "180", "204", "226", "231", "232", "262", "266", "270", "288", "324", "384",
  "404", "426", "430", "434", "450", "454", "466", "478", "480", "504", "508", "516", "562", "566", "624", "646", "678", "686", "690", "694", "706",
  "710", "716", "728", "729", "732", "748", "768", "788", "800", "818", "834", "854", "894",
];
/** The Middle East: the Gulf, the Levant, Iraq, Iran, Yemen, Türkiye and Cyprus. */
const MIDDLE_EAST = ["048", "196", "275", "364", "368", "376", "400", "414", "422", "512", "634", "682", "760", "784", "792", "887"];
const REGION = new Set([...AFRICA, ...MIDDLE_EAST]);

type Ring = [number, number][];
type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };

export interface LensFocus {
  /** The world with the region cut out (to dim). */
  mask: Feature;
  /** The region's outline. */
  outline: Feature;
}

const signedArea = (r: Ring) => r.reduce((a, [x1, y1], i) => {
  const [x2, y2] = r[(i + 1) % r.length];
  return a + (x2 - x1) * (y2 + y1);
}, 0);
/** Clockwise (positive here) or anticlockwise, as asked. */
const orient = (r: Ring, clockwise: boolean) => ((signedArea(r) > 0) === clockwise ? r : [...r].reverse());

let loading: Promise<LensFocus> | null = null;
export function loadLensFocus(): Promise<LensFocus> {
  loading ??= import("world-atlas/countries-50m.json").then((m) => {
    const topo = (m.default ?? m) as unknown as Topology;
    const countries = topo.objects.countries as GeometryCollection<{ name?: string }>;
    const inRegion = countries.geometries.filter((g) => REGION.has(String(g.id)) || (g.properties as { name?: string } | undefined)?.name === "Somaliland");
    const region = merge(topo, inRegion as never) as unknown as { coordinates: Ring[][] };
    const outer: Ring = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    // The world anticlockwise, the region's outlines as clockwise holes (the winding both engines expect).
    const holes = region.coordinates.map((poly) => orient(poly[0], true));
    return {
      mask: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [orient(outer, false), ...holes] } },
      outline: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: region.coordinates.map((poly) => poly[0]) } },
    };
  });
  return loading;
}

export const LENS_FOCUS_STYLE = { maskColor: "#02050b", maskOpacity: 0.55, line: "#14b8a6", lineOpacity: 0.7 };
