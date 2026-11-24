/**
 * Builds public/zone-shapes.json: the outlines of the standing watch zones and the maritime security areas, from
 * Natural Earth 1:10m borders and coastlines (world-atlas), so the map's zones follow every bend of a border or
 * coast. Country zones are the countries' borders (unioned); sea zones are an outer outline with the land cut out,
 * so they keep to the water along the real coast. Each ring is thinned with Douglas–Peucker at about 300 m, which
 * keeps the shape while keeping the file small.
 *
 * Run after changing a recipe below:  node scripts/buildZoneShapes.mjs
 * (The frontend's watchZoneAreas.ts and MaritimeRisk.tsx read the file; they fall back to 1:50m if it is missing.)
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { feature } from "topojson-client";
import pc from "polygon-clipping";

const require = createRequire(import.meta.url);
const countriesTopo = require("world-atlas/countries-10m.json");
const landTopo = require("world-atlas/land-10m.json");

const TOLERANCE = 0.003; // degrees, about 300 m
const DECIMALS = 4;

const asMulti = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
const countries = new Map();
let somaliland = null;
for (const f of feature(countriesTopo, countriesTopo.objects.countries).features) {
  if (!f.geometry) continue;
  if (f.properties?.name === "Somaliland") somaliland = asMulti(f.geometry);
  else if (f.id !== undefined) countries.set(String(f.id), asMulti(f.geometry));
}
const land = feature(landTopo, landTopo.objects.land).features.flatMap((f) => (f.geometry ? asMulti(f.geometry) : []));

/** Land polygons touching a box, to cut out of a sea outline. */
function landNear(minX, minY, maxX, maxY) {
  return land.filter((poly) => poly[0].some(([x, y]) => x > minX && x < maxX && y > minY && y < maxY));
}

function sea(outline) {
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const near = landNear(Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1);
  return pc.difference([[outline]], ...near.map((p) => [p]));
}

/* ── Douglas–Peucker, per ring, keeping rings closed and dropping slivers ─────────────────────────────────────── */
function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const q = [a[0] + t * dx, a[1] + t * dy];
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}
function dp(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(points[i], points[s], points[e]);
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return points.filter((_, i) => keep[i]);
}
function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return Math.abs(a / 2);
}
const round = (v) => +v.toFixed(DECIMALS);
function thin(multi) {
  const out = [];
  for (const poly of multi) {
    const rings = [];
    for (const [k, ring] of poly.entries()) {
      // Split the closed ring in two so Douglas–Peucker has two fixed ends, then join.
      const mid = Math.floor(ring.length / 2);
      const a = dp(ring.slice(0, mid + 1), TOLERANCE), b = dp(ring.slice(mid), TOLERANCE);
      const r = [...a, ...b.slice(1)].map(([x, y]) => [round(x), round(y)]);
      if (r.length < 4 || ringArea(r) < 0.0004) { if (k === 0) break; else continue; } // islets under ~5 km²
      rings.push(r);
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

/* ── Recipes ──────────────────────────────────────────────────────────────────────────────────────────────────── */

const countryZones = {
  sudan: ["729"],
  gaza: ["275"],
  drc: ["180"],
  yemen: ["887"],
  lebanon: ["422"],
  syria: ["760"],
  sahel: ["466", "854", "562"],
  somalia: ["706", "somaliland"],
  ethiopia: ["231"],
  "south-sudan": ["728"],
  nigeria: ["566"],
  libya: ["434"],
  mozambique: ["508"],
  iraq: ["368"],
};

/**
 * Sea zones, as generous outlines (land is cut out). The extents are the Lens's assessment, set out in the backend
 * zone descriptions (lib/watchZones.ts):
 *  - red-sea, the Houthi (Ansar Allah) threat: the Red Sea south of 20°N (where Houthi missiles, drones, boats and
 *    boardings have reached shipping; JMIC rates it SUBSTANTIAL), Bab el-Mandeb, and the Gulf of Aden east to 55°E,
 *    past Socotra (attacks have reached ships there).
 *  - piracy, Somali piracy: the Gulf of Aden from Bab el-Mandeb, and the Somali Basin out to the Lloyd's market
 *    war-risk limit (10°48′N 60°15′E to 6°45′S 48°45′E) and south to the Kenya border, the range pirate action
 *    groups have shown in 2024–26 (JMIC: Gulf of Aden SUBSTANTIAL, Somali Basin MODERATE).
 */
const seaZones = {
  "red-sea": [[36.4, 20.0], [41.6, 20.0], [44.0, 15.0], [45.0, 13.6], [49.0, 15.2], [52.3, 16.4], [55.0, 16.2], [55.0, 11.0], [51.6, 11.0], [51.2, 10.2], [44.0, 9.5], [42.6, 11.0], [40.0, 14.5], [37.5, 17.5], [36.4, 20.0]],
  piracy: [[43.55, 12.85], [45.0, 13.6], [49.0, 15.2], [52.3, 16.4], [56.0, 15.4], [60.25, 10.8], [48.75, -6.75], [41.567, -1.667], [40.6, -1.0], [41.5, 2.0], [44.5, 5.0], [47.5, 9.0], [44.0, 9.6], [42.6, 11.3], [43.2, 12.2], [43.55, 12.85]],
};

/** The maritime security areas (data/maritimeRisk.ts), as the water within their named seas. */
const riskAreas = {
  "mrisk-srs-bam": [[37.6, 18.0], [42.4, 18.0], [43.9, 14.0], [43.55, 12.85], [43.2, 12.2], [42.0, 13.0], [39.5, 15.5], [37.6, 18.0]],
  "mrisk-goa": [[43.55, 12.85], [45.0, 13.6], [49.0, 15.2], [52.22, 16.2], [52.22, 15.62], [51.27, 11.83], [51.0, 10.6], [44.0, 9.6], [42.6, 11.3], [43.2, 12.2], [43.55, 12.85]],
  "mrisk-nrs-suez": [[31.9, 30.6], [35.2, 29.6], [36.6, 27.4], [40.0, 21.5], [42.4, 18.0], [37.6, 18.0], [36.5, 20.5], [35.0, 23.0], [33.4, 26.6], [31.9, 30.6]],
  "mrisk-somali": [[51.27, 11.83], [54.6, 12.6], [60.25, 10.8], [48.75, -6.75], [41.567, -1.667], [40.6, -1.0], [41.5, 2.0], [44.5, 5.0], [47.5, 9.0], [51.0, 10.6], [51.27, 11.83]],
};

const out = { source: "Natural Earth 1:10m (world-atlas), thinned at ~300 m; built by scripts/buildZoneShapes.mjs", zones: {} };
for (const [id, ids] of Object.entries(countryZones)) {
  const parts = ids.map((c) => (c === "somaliland" ? somaliland : countries.get(c))).filter(Boolean);
  if (!parts.length) { console.warn("no country for", id); continue; }
  const u = parts.length > 1 ? pc.union(...parts) : parts[0];
  out.zones[id] = thin(u);
}
for (const [id, outline] of Object.entries({ ...seaZones, ...riskAreas })) out.zones[id] = thin(sea(outline));

const json = JSON.stringify(out);
writeFileSync(new URL("../public/zone-shapes.json", import.meta.url), json);
const counts = Object.fromEntries(Object.entries(out.zones).map(([k, v]) => [k, v.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0)]));
console.log(`zone-shapes.json: ${(json.length / 1024).toFixed(0)} KB`, counts);
