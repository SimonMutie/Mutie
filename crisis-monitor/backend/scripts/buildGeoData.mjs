#!/usr/bin/env node
/**
 * One-off generator for the two static geography files the escalation
 * pipeline uses (src/data/africaShapes.json, src/data/africaPlaces.json).
 * Not part of the Worker build — run by hand only when the source data
 * needs refreshing:
 *
 *   mkdir /tmp/geo && cd /tmp/geo && npm init -y
 *   npm i world-atlas topojson-client all-the-cities
 *   node <repo>/crisis-monitor/backend/scripts/buildGeoData.mjs <repo>/crisis-monitor/backend/src/data
 *
 * Sources (see THIRD_PARTY_NOTICES.md):
 *   - Country borders: Natural Earth 1:50m via the `world-atlas` package (public domain).
 *   - Populated places: GeoNames cities1000 via the `all-the-cities` package (CC BY 4.0).
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "noop.js"));
const topo = require("world-atlas/countries-50m.json");
const { feature } = require("topojson-client");
const cities = require("all-the-cities");

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: buildGeoData.mjs <output dir>");

// ISO 3166-1 numeric -> alpha-2, Africa only (plus Western Sahara, which
// Natural Earth draws separately and which is not in the app's 54-country list).
const NUMERIC_TO_ISO2 = {
  "012": "DZ", "024": "AO", "204": "BJ", "072": "BW", "854": "BF", "108": "BI", "120": "CM", "132": "CV",
  "140": "CF", "148": "TD", "174": "KM", "178": "CG", "180": "CD", "384": "CI", "262": "DJ", "818": "EG",
  "226": "GQ", "232": "ER", "748": "SZ", "231": "ET", "266": "GA", "270": "GM", "288": "GH", "324": "GN",
  "624": "GW", "404": "KE", "426": "LS", "430": "LR", "434": "LY", "450": "MG", "454": "MW", "466": "ML",
  "478": "MR", "480": "MU", "504": "MA", "508": "MZ", "516": "NA", "562": "NE", "566": "NG", "646": "RW",
  "678": "ST", "686": "SN", "690": "SC", "694": "SL", "706": "SO", "710": "ZA", "728": "SS", "729": "SD",
  "834": "TZ", "768": "TG", "788": "TN", "800": "UG", "894": "ZM", "716": "ZW", "732": "EH",
};

const round = (n) => Math.round(n * 100) / 100; // ~1.1 km — plenty for "is this point inside this country"

function simplifyRing(ring) {
  const out = [];
  for (const [lon, lat] of ring) {
    const p = [round(lon), round(lat)];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;
}

const fc = feature(topo, topo.objects.countries);
const shapes = {};
for (const f of fc.features) {
  // Natural Earth draws Somaliland as its own feature with no ISO code; it
  // is internationally recognised as part of Somalia, so its polygons are
  // folded into SO (the gazetteer still names "Somaliland" as a region).
  const iso2 = f.properties.name === "Somaliland" ? "SO" : NUMERIC_TO_ISO2[f.id];
  if (!iso2) continue;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    const outer = simplifyRing(poly[0]); // outer ring only; holes (Lesotho inside South Africa) are handled by smallest-country-wins in lookup
    if (outer) (shapes[iso2] ??= []).push(outer);
  }
}
writeFileSync(join(outDir, "africaShapes.json"), JSON.stringify(shapes));

const AFRICA = new Set(Object.values(NUMERIC_TO_ISO2));
const places = cities
  .filter((c) => AFRICA.has(c.country))
  .map((c) => [c.name, c.country, Math.round(c.loc.coordinates[1] * 1e4) / 1e4, Math.round(c.loc.coordinates[0] * 1e4) / 1e4, c.population || 0])
  .sort((a, b) => (a[1] === b[1] ? b[4] - a[4] : a[1] < b[1] ? -1 : 1));
writeFileSync(join(outDir, "africaPlaces.json"), JSON.stringify(places));

console.log(`countries: ${Object.keys(shapes).length}, places: ${places.length}`);
