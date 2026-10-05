/**
 * Geography for the escalation pipeline: which country a point is really in,
 * which country a name really refers to, and where a named place really is.
 *
 * Everything here exists to replace two things that produced wrong map
 * placements and wrong country attributions:
 *
 *   1. Substring matching on country names (`place_name LIKE '%Mali%'`
 *      matches "Somalia" and "Somaliland"; "Niger" matches "Nigeria";
 *      "Sudan" matches "South Sudan"; "Guinea" matches three countries).
 *      resolveCountryCode() below is exact-match only, on a normalised name
 *      or a listed alias.
 *
 *   2. Trusting GDELT's own lat/lon. Coordinates in this pipeline come only
 *      from a place the article itself names, resolved through
 *      resolvePlace(), and any coordinate that did not come from a curated
 *      or GeoNames entry is checked against the real border of the country
 *      the article says the event is in (isInOrNearCountry) before it is
 *      used. A point in Riyadh cannot be accepted for an event in Yemen, and
 *      a point in Djibouti cannot be accepted for an event in Tigray.
 */

import shapesJson from "../data/africaShapes.json";
import placesJson from "../data/africaPlaces.json";
import { CONFLICT_GAZETTEER, type GazetteerPlace } from "./conflictGazetteer";

type Ring = [number, number][]; // [lon, lat]
const SHAPES = shapesJson as unknown as Record<string, Ring[]>;
/** [name, ISO2, lat, lon, population] — GeoNames cities1000, Africa only. */
const GEONAMES_PLACES = placesJson as unknown as [string, string, number, number, number][];

export interface CountryInfo {
  name: string;
  /** Other names this country goes by in English/French/Portuguese/Arabic-
   *  transliterated press, plus sub-state entities that are internationally
   *  part of it (Somaliland, Puntland -> Somalia). Exact-match only. */
  aliases: string[];
}

/** The app's 54 countries plus Western Sahara (drawn separately by Natural
 *  Earth and reported on separately, so an event there is not silently
 *  folded into Morocco). */
export const AFRICA_GEO_COUNTRIES: Record<string, CountryInfo> = {
  DZ: { name: "Algeria", aliases: ["algerie"] },
  AO: { name: "Angola", aliases: [] },
  BJ: { name: "Benin", aliases: ["republic of benin"] },
  BW: { name: "Botswana", aliases: [] },
  BF: { name: "Burkina Faso", aliases: ["burkina"] },
  BI: { name: "Burundi", aliases: [] },
  CM: { name: "Cameroon", aliases: ["cameroun"] },
  CV: { name: "Cabo Verde", aliases: ["cape verde"] },
  CF: { name: "Central African Republic", aliases: ["car", "centrafrique", "republique centrafricaine", "central african rep"] },
  TD: { name: "Chad", aliases: ["tchad"] },
  KM: { name: "Comoros", aliases: ["comores"] },
  CG: { name: "Republic of the Congo", aliases: ["congo (rep.)", "congo rep", "congo-brazzaville", "congo brazzaville", "congo republic", "republic of congo"] },
  CD: {
    name: "Democratic Republic of the Congo",
    aliases: ["congo (drc)", "drc", "dr congo", "d.r. congo", "dem. rep. congo", "dem rep congo", "congo-kinshasa", "congo kinshasa", "rdc", "rd congo", "democratic republic of congo", "republique democratique du congo"],
  },
  CI: { name: "Côte d'Ivoire", aliases: ["cote d ivoire", "cote divoire", "ivory coast"] },
  DJ: { name: "Djibouti", aliases: [] },
  EG: { name: "Egypt", aliases: ["egypte"] },
  GQ: { name: "Equatorial Guinea", aliases: ["guinee equatoriale", "eq. guinea", "eq guinea"] },
  ER: { name: "Eritrea", aliases: ["erythree"] },
  SZ: { name: "Eswatini", aliases: ["swaziland"] },
  ET: { name: "Ethiopia", aliases: ["ethiopie"] },
  GA: { name: "Gabon", aliases: [] },
  GM: { name: "Gambia", aliases: ["the gambia", "gambie"] },
  GH: { name: "Ghana", aliases: [] },
  GN: { name: "Guinea", aliases: ["guinee", "guinea-conakry", "guinea conakry", "guinee conakry"] },
  GW: { name: "Guinea-Bissau", aliases: ["guinea bissau", "guine-bissau", "guine bissau", "guinee-bissau", "guinee bissau"] },
  KE: { name: "Kenya", aliases: [] },
  LS: { name: "Lesotho", aliases: [] },
  LR: { name: "Liberia", aliases: [] },
  LY: { name: "Libya", aliases: ["libye"] },
  MG: { name: "Madagascar", aliases: [] },
  MW: { name: "Malawi", aliases: [] },
  ML: { name: "Mali", aliases: [] },
  MR: { name: "Mauritania", aliases: ["mauritanie"] },
  MU: { name: "Mauritius", aliases: ["maurice"] },
  MA: { name: "Morocco", aliases: ["maroc"] },
  MZ: { name: "Mozambique", aliases: ["mocambique"] },
  NA: { name: "Namibia", aliases: ["namibie"] },
  NE: { name: "Niger", aliases: ["republic of niger", "niger republic"] },
  NG: { name: "Nigeria", aliases: [] },
  RW: { name: "Rwanda", aliases: [] },
  ST: { name: "São Tomé and Príncipe", aliases: ["sao tome", "sao tome and principe", "sao tome e principe"] },
  SN: { name: "Senegal", aliases: [] },
  SC: { name: "Seychelles", aliases: [] },
  SL: { name: "Sierra Leone", aliases: [] },
  SO: { name: "Somalia", aliases: ["somaliland", "puntland", "somalie"] },
  ZA: { name: "South Africa", aliases: ["afrique du sud", "rsa"] },
  SS: { name: "South Sudan", aliases: ["soudan du sud", "s. sudan", "s sudan"] },
  SD: { name: "Sudan", aliases: ["soudan", "the sudan"] },
  TZ: { name: "Tanzania", aliases: ["tanzanie"] },
  TG: { name: "Togo", aliases: [] },
  TN: { name: "Tunisia", aliases: ["tunisie"] },
  UG: { name: "Uganda", aliases: ["ouganda"] },
  ZM: { name: "Zambia", aliases: ["zambie"] },
  ZW: { name: "Zimbabwe", aliases: [] },
  EH: { name: "Western Sahara", aliases: ["sahara occidental", "w. sahara", "sahrawi arab democratic republic"] },
};

/** Approximate geographic centroids — the last-resort marker position, used
 *  only when reporting names no place more specific than the country, and
 *  always labelled as country-level in the output. */
export const AFRICA_CENTROIDS: Record<string, [number, number]> = {
  DZ: [28.0, 1.6], AO: [-11.2, 17.9], BJ: [9.3, 2.3], BW: [-22.3, 24.7], BF: [12.2, -1.6], BI: [-3.4, 29.9],
  CM: [7.4, 12.3], CV: [16.0, -24.0], CF: [6.6, 20.9], TD: [15.5, 18.7], KM: [-11.6, 43.3],
  CG: [-0.2, 15.8], CD: [-2.9, 23.6], CI: [7.5, -5.5], DJ: [11.6, 42.6], EG: [26.8, 30.8],
  GQ: [1.6, 10.5], ER: [15.2, 39.8], SZ: [-26.5, 31.5], ET: [9.1, 40.5], GA: [-0.6, 11.6], GM: [13.4, -15.3],
  GH: [7.9, -1.0], GN: [10.6, -10.9], GW: [12.0, -15.2], KE: [1.0, 38.0], LS: [-29.6, 28.2], LR: [6.4, -9.4],
  LY: [26.3, 17.2], MG: [-18.9, 46.9], MW: [-13.5, 34.3], ML: [17.0, -4.0], MR: [20.3, -10.3], MU: [-20.3, 57.6],
  MA: [31.8, -7.1], MZ: [-18.7, 35.5], NA: [-22.0, 17.1], NE: [17.6, 8.1], NG: [9.1, 8.7], RW: [-1.9, 29.9],
  ST: [0.2, 6.6], SN: [14.5, -14.5], SC: [-4.7, 55.5], SL: [8.5, -11.8], SO: [5.2, 46.2],
  ZA: [-30.6, 22.9], SS: [7.9, 30.0], SD: [15.5, 30.2], TZ: [-6.4, 34.9], TG: [8.6, 0.8], TN: [34.0, 9.5],
  UG: [1.4, 32.3], ZM: [-13.1, 27.8], ZW: [-19.0, 29.8], EH: [24.6, -13.0],
};

/** Lowercase, strip diacritics/apostrophes/punctuation, collapse whitespace.
 *  "Côte d'Ivoire" -> "cote d ivoire"; "Mek'ele" -> "mekele"; "N'Djamena" ->
 *  "n djamena". */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’ʼ`´']/g, "")
    .replace(/[^a-z0-9()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A looser key for matching transliteration variants of the same place
 *  WITHIN one country: doubled letters collapsed, Arabic article prefixes
 *  dropped, common suffix words removed. "Mekelle"/"Mek'ele" -> "mekele";
 *  "El Fasher"/"Al-Fashir" -> "fasher"/"fashir" (vowel variants are covered
 *  by aliases, not guessed here). Never used across countries. */
export function looseKey(s: string): string {
  return normalizeName(s)
    .replace(/[()]/g, " ")
    .replace(/\b(?:city|town|village|district|county|province|state|region|locality|prefecture|woreda|zone|area|camp)\b/g, " ")
    .replace(/^(?:al|el|ad|ed|an|en|ar|er|as|es|at|et|az|ez)\s+/, "")
    .replace(/\s+/g, "")
    .replace(/(.)\1+/g, "$1");
}

const COUNTRY_NAME_TO_CODE: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [code, info] of Object.entries(AFRICA_GEO_COUNTRIES)) {
    m.set(normalizeName(info.name), code);
    m.set(code.toLowerCase(), code);
    for (const a of info.aliases) m.set(normalizeName(a), code);
  }
  return m;
})();

/** Exact-match country resolution — a full normalised name, a listed alias,
 *  or an ISO2 code. Returns null for anything else, including every non-
 *  African country. Never a substring match. */
export function resolveCountryCode(nameOrCode: string | null | undefined): string | null {
  if (!nameOrCode) return null;
  return COUNTRY_NAME_TO_CODE.get(normalizeName(nameOrCode)) ?? null;
}

export function countryName(code: string): string {
  return AFRICA_GEO_COUNTRIES[code]?.name ?? code;
}

// ── Point-in-country ─────────────────────────────────────────────────────

interface CountryShape {
  code: string;
  rings: Ring[];
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
  area: number;
}

const COUNTRY_SHAPES: CountryShape[] = Object.entries(SHAPES).map(([code, rings]) => {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { code, rings, bbox: [minLon, minLat, maxLon, maxLat], area: (maxLon - minLon) * (maxLat - minLat) };
});
const SHAPE_BY_CODE = new Map(COUNTRY_SHAPES.map((s) => [s.code, s]));

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function strictlyInside(shape: CountryShape, lat: number, lon: number): boolean {
  const [minLon, minLat, maxLon, maxLat] = shape.bbox;
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return false;
  return shape.rings.some((r) => pointInRing(lon, lat, r));
}

const KM_PER_DEG = 111.32;

/** Distance in km from a point to the nearest edge of a country's border. */
function distanceToBorderKm(shape: CountryShape, lat: number, lon: number): number {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const ring of shape.rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const ax = (ring[i][0] - lon) * cosLat * KM_PER_DEG;
      const ay = (ring[i][1] - lat) * KM_PER_DEG;
      const bx = (ring[i + 1][0] - lon) * cosLat * KM_PER_DEG;
      const by = (ring[i + 1][1] - lat) * KM_PER_DEG;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const px = ax + t * dx;
      const py = ay + t * dy;
      const d = Math.hypot(px, py);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Which African country a point falls inside, or null (sea, or outside
 *  Africa). When borders nest (Lesotho inside South Africa — the generator
 *  drops interior holes), the smallest containing country wins. */
export function countryAt(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: CountryShape | null = null;
  for (const s of COUNTRY_SHAPES) {
    if (strictlyInside(s, lat, lon) && (!best || s.area < best.area)) best = s;
  }
  return best?.code ?? null;
}

/** Borders in the bundled data are simplified to ~1 km and drawn at 1:50m,
 *  so a real coastal or border town can sit a few km outside its own
 *  polygon. This tolerance absorbs that; it is far too small to let a point
 *  in the wrong country's interior through (Djibouti city is ~90 km from
 *  Ethiopia; Riyadh is ~900 km from Yemen). */
export const BORDER_TOLERANCE_KM = 20;

/** True when the point is inside the given country, or within
 *  BORDER_TOLERANCE_KM of its border. The check used on every coordinate
 *  that did not come from a curated or GeoNames entry. */
export function isInOrNearCountry(code: string, lat: number, lon: number): boolean {
  const shape = SHAPE_BY_CODE.get(code);
  if (!shape || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (strictlyInside(shape, lat, lon)) {
    // Nested border (Lesotho/Eswatini inside South Africa's outer ring): a
    // point inside a smaller country is that country's, not the enclosing one's.
    const actual = countryAt(lat, lon);
    return actual === code || actual === null;
  }
  const [minLon, minLat, maxLon, maxLat] = shape.bbox;
  const pad = BORDER_TOLERANCE_KM / KM_PER_DEG + 0.3;
  if (lon < minLon - pad || lon > maxLon + pad || lat < minLat - pad || lat > maxLat + pad) return false;
  return distanceToBorderKm(shape, lat, lon) <= BORDER_TOLERANCE_KM;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// ── Place resolution ─────────────────────────────────────────────────────

/** How a marker's position was arrived at — shown to the user, so a pin on
 *  a regional or country centroid is never presented as an exact location. */
export type GeoPrecision =
  | "place" // a named town/site, from the curated gazetteer, GeoNames, or the geocoder
  | "approximate" // a named place whose coordinates were estimated and border-checked
  | "region" // only a region/state/province was named
  | "country"; // reporting named nothing more specific than the country

export interface ResolvedLocation {
  lat: number;
  lon: number;
  precision: GeoPrecision;
  /** The name as it should be displayed ("Mekelle", "Tigray"). Null at country level. */
  label: string | null;
  /** Where the coordinates came from, for the audit trail. */
  method: "curated" | "geonames" | "geocoder" | "model-estimate" | "region-centroid" | "country-centroid";
}

interface PlaceIndexEntry {
  name: string;
  lat: number;
  lon: number;
  kind: "place" | "region";
  rank: number; // curated beats GeoNames; within GeoNames, population
  method: "curated" | "geonames";
}

/** country code -> key -> entry. Built once at module load. */
const EXACT_INDEX = new Map<string, Map<string, PlaceIndexEntry>>();
const LOOSE_INDEX = new Map<string, Map<string, PlaceIndexEntry>>();

function addToIndex(index: Map<string, Map<string, PlaceIndexEntry>>, country: string, key: string, entry: PlaceIndexEntry) {
  if (!key) return;
  let m = index.get(country);
  if (!m) index.set(country, (m = new Map()));
  const existing = m.get(key);
  if (!existing || entry.rank > existing.rank) m.set(key, entry);
}

(function buildIndex() {
  for (const p of CONFLICT_GAZETTEER as GazetteerPlace[]) {
    const entry: PlaceIndexEntry = {
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      kind: p.kind === "region" ? "region" : "place",
      rank: 1e12,
      method: "curated",
    };
    for (const n of [p.name, ...(p.aliases ?? [])]) {
      addToIndex(EXACT_INDEX, p.country, normalizeName(n), entry);
      addToIndex(LOOSE_INDEX, p.country, looseKey(n), entry);
    }
  }
  for (const [name, country, lat, lon, population] of GEONAMES_PLACES) {
    const entry: PlaceIndexEntry = { name, lat, lon, kind: "place", rank: population, method: "geonames" };
    addToIndex(EXACT_INDEX, country, normalizeName(name), entry);
    addToIndex(LOOSE_INDEX, country, looseKey(name), entry);
  }
})();

/** Looks a place name up within ONE country only — never across borders.
 *  Exact normalised match first, then the transliteration-tolerant key. */
export function lookupKnownPlace(countryCode: string, name: string | null | undefined): PlaceIndexEntry | null {
  if (!name) return null;
  const exact = EXACT_INDEX.get(countryCode)?.get(normalizeName(name));
  if (exact) return exact;
  const loose = looseKey(name);
  if (loose.length < 4) return null; // too short to trust a loose match
  return LOOSE_INDEX.get(countryCode)?.get(loose) ?? null;
}

export interface PlaceQuery {
  countryCode: string;
  /** Most specific place the article names (town, village, camp, base). */
  place?: string | null;
  /** Region / state / province the article names. */
  admin1?: string | null;
  /** Coordinates estimated by the coding model for `place` — used only if
   *  nothing better is known, and only if they pass the border check. */
  modelLat?: number | null;
  modelLon?: number | null;
}

/** Offline resolution: curated gazetteer and GeoNames first, then a border-
 *  checked model estimate, then the named region, then the country centroid.
 *  The online geocoder (lib/geocoder.ts) slots in between the first and
 *  second steps when it is available. Never returns a point outside the
 *  stated country. */
export function resolvePlaceOffline(q: PlaceQuery): ResolvedLocation {
  const known = lookupKnownPlace(q.countryCode, q.place);
  if (known) {
    return { lat: known.lat, lon: known.lon, precision: known.kind === "region" ? "region" : "place", label: known.name, method: known.method };
  }

  if (q.place && q.modelLat != null && q.modelLon != null && isInOrNearCountry(q.countryCode, q.modelLat, q.modelLon)) {
    return { lat: q.modelLat, lon: q.modelLon, precision: "approximate", label: q.place, method: "model-estimate" };
  }

  const region = lookupKnownPlace(q.countryCode, q.admin1);
  if (region) {
    // The article named a specific place we could not locate; the marker sits
    // on the region it is in, and says so.
    return { lat: region.lat, lon: region.lon, precision: "region", label: q.place ? `${q.place} (${region.name})` : region.name, method: region.kind === "region" ? "region-centroid" : region.method };
  }

  const centroid = AFRICA_CENTROIDS[q.countryCode];
  return {
    lat: centroid ? centroid[0] : 0,
    lon: centroid ? centroid[1] : 0,
    precision: "country",
    label: q.place ?? q.admin1 ?? null,
    method: "country-centroid",
  };
}

/** A stable key for grouping reports about the same locality. Uses the
 *  resolved display label when there is one so "Mekelle" and "Mek'ele" land
 *  in the same incident; falls back to the region, then the country. */
export function localityKey(countryCode: string, loc: ResolvedLocation, admin1: string | null | undefined): string {
  const regionEntry = lookupKnownPlace(countryCode, admin1);
  const regionPart = regionEntry ? looseKey(regionEntry.name) : admin1 ? looseKey(admin1) : "";
  if (loc.precision === "place" || loc.precision === "approximate") return `${countryCode}:${looseKey(loc.label ?? "")}`;
  if (loc.precision === "region") return `${countryCode}:r:${regionPart || looseKey(loc.label ?? "")}`;
  return `${countryCode}:c`;
}

/** Words that mark a text as being about somewhere in Africa: country names
 *  and aliases, and curated place/region names long enough not to be
 *  ordinary words. Used only to keep generalist world-news feeds from
 *  filling the reading queue with stories from other continents — a loose
 *  relevance check, never an attribution. */
const AFRICA_MENTION_TERMS: Set<string> = (() => {
  const terms = new Set<string>(["africa", "african", "africaine", "afrique", "sahel", "maghreb"]);
  for (const info of Object.values(AFRICA_GEO_COUNTRIES)) {
    for (const n of [info.name, ...info.aliases]) {
      const k = normalizeName(n).replace(/[()]/g, "").trim();
      if (k.length >= 4) terms.add(k);
    }
  }
  for (const p of CONFLICT_GAZETTEER as GazetteerPlace[]) {
    const k = normalizeName(p.name);
    if (k.replace(/ /g, "").length >= 6) terms.add(k);
  }
  return terms;
})();
const AFRICA_MENTION_MAX_WORDS = 6;

export function mentionsAfrica(text: string): boolean {
  const words = normalizeName(text).replace(/[()]/g, " ").replace(/\bpapua new guinea\b/g, " ").split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let phrase = "";
    for (let j = i; j < Math.min(words.length, i + AFRICA_MENTION_MAX_WORDS); j++) {
      phrase = phrase ? `${phrase} ${words[j]}` : words[j];
      if (AFRICA_MENTION_TERMS.has(phrase)) return true;
    }
    // Demonyms: "Sudanese", "Ethiopian", "Malian", "Somali", "Congolese"...
    if (/^(?:sudanese|ethiopian|eritrean|somali|kenyan|ugandan|rwandan|burundian|tanzanian|congolese|malian|nigerien|nigerian|burkinabe|chadian|cameroonian|libyan|egyptian|tunisian|algerian|moroccan|mozambican|ivorian|ghanaian|senegalese|guinean|zimbabwean|zambian|angolan|malawian|togolese|beninese|mauritanian|gambian|liberian|namibian|malagasy|sahrawi|tigrayan|darfuri)s?$/.test(words[i])) return true;
  }
  return false;
}
