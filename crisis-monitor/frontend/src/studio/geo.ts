import simplify from "@turf/simplify";

type Pos = number[];
const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** A circle as a polygon ring, by walking the great circle `steps` times around the centre. */
export function circleRing(lng: number, lat: number, radiusM: number, steps = 72): Pos[] {
  const out: Pos[] = [];
  const d = radiusM / R;
  const φ1 = rad(lat), λ1 = rad(lng);
  for (let i = 0; i <= steps; i++) {
    const θ = (2 * Math.PI * (i % steps)) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    out.push([Number(deg(((λ2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI).toFixed(6)), Number(deg(φ2).toFixed(6))]);
  }
  return out;
}

/** Spherical polygon area of one ring in square metres (unsigned). */
export function ringAreaM2(ring: Pos[]): number {
  if (ring.length < 4) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    sum += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((sum * R * R) / 2);
}

export const polygonAreaM2 = (rings: Pos[][]) => rings.reduce((a, r, i) => a + (i === 0 ? ringAreaM2(r) : -ringAreaM2(r)), 0);

export function lineLengthM(line: Pos[]): number {
  let m = 0;
  for (let i = 1; i < line.length; i++) {
    const [x1, y1] = line[i - 1], [x2, y2] = line[i];
    const a = Math.sin(rad(y2 - y1) / 2) ** 2 + Math.cos(rad(y1)) * Math.cos(rad(y2)) * Math.sin(rad(x2 - x1) / 2) ** 2;
    m += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return m;
}

export interface Measure { kind: "area" | "length" | "point" | "mixed"; areaM2?: number; perimeterM?: number; lengthM?: number; vertices: number }

/** Area, perimeter or length of a drawn feature or layer. */
export function measure(g: GeoJSON.Feature | GeoJSON.FeatureCollection): Measure {
  const feats = g.type === "FeatureCollection" ? g.features : [g];
  let area = 0, perim = 0, len = 0, verts = 0, polys = 0, lines = 0, pts = 0;
  const geom = (x: GeoJSON.Geometry) => {
    if (x.type === "Polygon") {
      polys++;
      area += polygonAreaM2(x.coordinates);
      perim += lineLengthM(x.coordinates[0]);
      verts += x.coordinates[0].length - 1;
    } else if (x.type === "MultiPolygon") x.coordinates.forEach((p) => geom({ type: "Polygon", coordinates: p }));
    else if (x.type === "LineString") {
      lines++;
      len += lineLengthM(x.coordinates);
      verts += x.coordinates.length;
    } else if (x.type === "MultiLineString") x.coordinates.forEach((l) => geom({ type: "LineString", coordinates: l }));
    else if (x.type === "Point" || x.type === "MultiPoint") pts += x.type === "Point" ? 1 : x.coordinates.length;
    else if (x.type === "GeometryCollection") x.geometries.forEach(geom);
  };
  for (const f of feats) if (f.geometry) geom(f.geometry);
  const kinds = [polys, lines, pts].filter(Boolean).length;
  if (kinds > 1) return { kind: "mixed", areaM2: area || undefined, lengthM: len || undefined, vertices: verts };
  if (polys) return { kind: "area", areaM2: area, perimeterM: perim, vertices: verts };
  if (lines) return { kind: "length", lengthM: len, vertices: verts };
  return { kind: "point", vertices: pts };
}

export function fmtArea(m2: number): string {
  if (m2 >= 1e6) return `${(m2 / 1e6).toLocaleString("en-US", { maximumFractionDigits: m2 >= 1e8 ? 0 : 2 })} km²`;
  if (m2 >= 1e4) return `${(m2 / 1e4).toLocaleString("en-US", { maximumFractionDigits: 1 })} ha`;
  return `${Math.round(m2).toLocaleString("en-US")} m²`;
}
export function fmtLength(m: number): string {
  return m >= 1000 ? `${(m / 1000).toLocaleString("en-US", { maximumFractionDigits: m >= 1e5 ? 0 : 2 })} km` : `${Math.round(m)} m`;
}

// ── Size limits ─────────────────────────────────────────────────────────

function roundCoords(c: unknown, dp: number): unknown {
  if (typeof c === "number") return Number(c.toFixed(dp));
  return Array.isArray(c) ? c.map((x) => roundCoords(x, dp)) : c;
}
const roundedFeature = (f: GeoJSON.Feature, dp: number): GeoJSON.Feature => (f.geometry ? { ...f, geometry: { ...f.geometry, coordinates: roundCoords((f.geometry as { coordinates: unknown }).coordinates, dp) } as GeoJSON.Geometry } : f);

/**
 * Keeps an imported layer under the size the database can hold. Coordinates
 * are rounded to ~1 m first; if that is not enough the lines are simplified
 * with growing tolerance. Returns what was done so the user can be told.
 */
export function fitLayerToSize(fc: GeoJSON.FeatureCollection, maxBytes = 1_700_000): { fc: GeoJSON.FeatureCollection; bytes: number; simplified: boolean; tolerance: number } {
  let cur: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: fc.features.map((f) => roundedFeature(f, 5)) };
  let bytes = JSON.stringify(cur).length;
  if (bytes <= maxBytes) return { fc: cur, bytes, simplified: false, tolerance: 0 };
  let tol = 0.0002;
  for (let i = 0; i < 12 && bytes > maxBytes; i++, tol *= 2) {
    cur = {
      type: "FeatureCollection",
      features: fc.features.map((f) => {
        if (!f.geometry || f.geometry.type === "Point" || f.geometry.type === "MultiPoint") return roundedFeature(f, 5);
        try {
          return roundedFeature(simplify(f as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.LineString | GeoJSON.MultiLineString>, { tolerance: tol, highQuality: false, mutate: false }) as GeoJSON.Feature, 5);
        } catch {
          return roundedFeature(f, 5);
        }
      }),
    };
    bytes = JSON.stringify(cur).length;
  }
  return { fc: cur, bytes, simplified: true, tolerance: tol / 2 };
}

// ── Export ──────────────────────────────────────────────────────────────

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kmlColor = (hex: string, opacity = 1) => {
  const h = hex.replace("#", "").padEnd(6, "0");
  const a = Math.round(opacity * 255).toString(16).padStart(2, "0");
  return `${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
};
const coordText = (c: Pos[]) => c.map((p) => `${p[0]},${p[1]},0`).join(" ");

/** The shapes as KML, so they open in Google Earth, QGIS and ArcGIS with their colours. */
export function toKml(name: string, shapes: { name: string; geometry: GeoJSON.Feature | GeoJSON.FeatureCollection; style: { color?: string; fillColor?: string; fillOpacity?: number; weight?: number; label?: string; notes?: string } }[]): string {
  const geomKml = (g: GeoJSON.Geometry): string => {
    switch (g.type) {
      case "Point":
        return `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]},0</coordinates></Point>`;
      case "LineString":
        return `<LineString><tessellate>1</tessellate><coordinates>${coordText(g.coordinates)}</coordinates></LineString>`;
      case "Polygon":
        return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordText(g.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs>${g.coordinates.slice(1).map((r) => `<innerBoundaryIs><LinearRing><coordinates>${coordText(r)}</coordinates></LinearRing></innerBoundaryIs>`).join("")}</Polygon>`;
      case "MultiPoint":
      case "MultiLineString":
      case "MultiPolygon":
      case "GeometryCollection": {
        const parts: GeoJSON.Geometry[] =
          g.type === "MultiPoint" ? g.coordinates.map((c) => ({ type: "Point", coordinates: c })) : g.type === "MultiLineString" ? g.coordinates.map((c) => ({ type: "LineString", coordinates: c })) : g.type === "MultiPolygon" ? g.coordinates.map((c) => ({ type: "Polygon", coordinates: c })) : g.geometries;
        return `<MultiGeometry>${parts.map(geomKml).join("")}</MultiGeometry>`;
      }
    }
  };
  const marks = shapes.flatMap((s, i) => {
    const st = s.style;
    const style = `<Style id="s${i}"><LineStyle><color>${kmlColor(st.color ?? "#3388ff")}</color><width>${st.weight ?? 2}</width></LineStyle><PolyStyle><color>${kmlColor(st.fillColor ?? st.color ?? "#3388ff", st.fillOpacity ?? 0.25)}</color></PolyStyle></Style>`;
    const feats = s.geometry.type === "FeatureCollection" ? s.geometry.features : [s.geometry];
    return [style, ...feats.filter((f) => f.geometry).map((f, j) => `<Placemark><name>${xml(String(f.properties?.name ?? (feats.length > 1 ? `${s.name} ${j + 1}` : st.label || s.name)))}</name>${st.notes ? `<description>${xml(st.notes)}</description>` : ""}<styleUrl>#s${i}</styleUrl>${geomKml(f.geometry)}</Placemark>`)];
  });
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(name)}</name>${marks.join("")}</Document></kml>`;
}

export function downloadText(filename: string, text: string, mime: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
