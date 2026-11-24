import { toMgrs } from "../coords";
import { shapefileZip } from "./shapefile";

/** A map feature as the GIS tools see it: the fields the Live map's points carry. */
export interface GisFeature {
  id: string;
  layer: string;
  title: string;
  subtitle?: string;
  time?: string | null;
  url?: string | null;
  lat: number;
  lng: number;
  color?: string;
  extra?: Record<string, unknown>;
}

export type ExportFormat = "geojson" | "kml" | "csv" | "shp";
export const EXPORT_LABEL: Record<ExportFormat, string> = { geojson: "GeoJSON", kml: "KML (Google Earth)", csv: "CSV (lat/lon)", shp: "Shapefile (.zip)" };

/** Plain attributes for a feature: what every format carries. */
export function attributes(f: GisFeature): Record<string, string | number> {
  return {
    id: f.id,
    layer: f.layer,
    title: f.title,
    detail: f.subtitle ?? "",
    time: f.time ?? "",
    url: f.url ?? "",
    lat: +f.lat.toFixed(6),
    lon: +f.lng.toFixed(6),
    mgrs: toMgrs(f.lat, f.lng),
    ...Object.fromEntries(Object.entries(f.extra ?? {}).filter(([, v]) => v != null && typeof v !== "object").map(([k, v]) => [k, typeof v === "number" ? v : String(v)])),
  };
}

export function toFeatureCollection(features: GisFeature[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({ type: "Feature", geometry: { type: "Point", coordinates: [+f.lng.toFixed(6), +f.lat.toFixed(6)] }, properties: attributes(f) })),
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(features: GisFeature[]): string {
  const rows = features.map(attributes);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** KML colours are aabbggrr. */
function kmlColour(hex?: string): string {
  const m = (hex ?? "#ff9d4f").match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  return m ? `ff${m[3]}${m[2]}${m[1]}`.toLowerCase() : "ff4f9dff";
}

/** KML with one folder per layer and the attributes as ExtendedData, for Google Earth and desktop GIS. */
export function toKml(features: GisFeature[], name: string): string {
  const byLayer = new Map<string, GisFeature[]>();
  for (const f of features) byLayer.set(f.layer, [...(byLayer.get(f.layer) ?? []), f]);
  const folders = [...byLayer].map(([layer, fs]) => {
    const style = `s${Math.abs([...layer].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}`;
    return `<Style id="${style}"><IconStyle><color>${kmlColour(fs[0].color)}</color><scale>0.9</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
<Folder><name>${xml(layer)}</name>${fs.map((f) => {
      const a = attributes(f);
      return `<Placemark><name>${xml(f.title)}</name><styleUrl>#${style}</styleUrl>${f.time ? `<TimeStamp><when>${xml(f.time)}</when></TimeStamp>` : ""}<description>${xml([f.subtitle, f.url].filter(Boolean).join("\n"))}</description><ExtendedData>${Object.entries(a).map(([k, v]) => `<Data name="${xml(k)}"><value>${xml(String(v))}</value></Data>`).join("")}</ExtendedData><Point><coordinates>${f.lng.toFixed(6)},${f.lat.toFixed(6)},0</coordinates></Point></Placemark>`;
    }).join("\n")}</Folder>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(name)}</name>\n${folders.join("\n")}\n</Document></kml>`;
}

function save(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Downloads features in a format. Shapefile export also takes any extra geometry (drawn shapes, rings). */
export async function exportFeatures(features: GisFeature[], format: ExportFormat, name: string, extraGeometry: GeoJSON.Feature[] = []): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const base = `${name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "lens"}-${stamp}`;
  if (format === "csv") return save(new Blob(["﻿" + toCsv(features)], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
  if (format === "kml") return save(new Blob([toKml(features, name)], { type: "application/vnd.google-earth.kml+xml" }), `${base}.kml`);
  const fc = toFeatureCollection(features);
  fc.features.push(...extraGeometry);
  if (format === "geojson") return save(new Blob([JSON.stringify(fc)], { type: "application/geo+json" }), `${base}.geojson`);
  return save(await shapefileZip(fc, base), `${base}-shapefile.zip`);
}
