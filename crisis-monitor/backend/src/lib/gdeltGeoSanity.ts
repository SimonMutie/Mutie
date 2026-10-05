import { CONFLICT_GAZETTEER } from "./conflictGazetteer";
import { AFRICA_GEO_COUNTRIES, normalizeName } from "./africaGeo";

/**
 * A consistency check for the RAW GDELT map layers (GDELT Events, Global
 * Incidents) — the layers that plot GDELT's own coordinates directly.
 *
 * GDELT geocodes an event from place names it finds anywhere in the article,
 * and regularly picks the wrong one: a battle in Taiz, Yemen pinned on
 * Riyadh because the article mentions the Saudi-led coalition; a Tigray
 * story pinned on Djibouti because it mentions the port. Those layers have
 * no article text to re-locate the event from, so they cannot be corrected
 * — but they can refuse to plot a point whose own URL contradicts it.
 *
 * A point is dropped when the article's URL slug names a country, or a
 * well-known conflict town, that is NOT the country GDELT placed the event
 * in, and never names the country GDELT did place it in. A point is kept
 * whenever the slug says nothing about location (ID-style URLs), so this
 * only removes points that are positively contradicted.
 *
 * The escalation pipeline does not use this — it reads the article and
 * locates the event from the text.
 */

/** Country names as they appear in GDELT's ActionGeo full names and in URL slugs. */
const WORLD_COUNTRIES: string[] = [
  "afghanistan", "albania", "argentina", "armenia", "australia", "austria", "azerbaijan", "bahrain", "bangladesh", "belarus", "belgium", "bolivia",
  "bosnia", "brazil", "bulgaria", "cambodia", "canada", "chile", "china", "colombia", "croatia", "cuba", "cyprus", "czechia", "denmark", "ecuador",
  "estonia", "finland", "france", "georgia", "germany", "greece", "guatemala", "haiti", "honduras", "hungary", "iceland", "india", "indonesia", "iran",
  "iraq", "ireland", "israel", "italy", "jamaica", "japan", "jordan", "kazakhstan", "kosovo", "kuwait", "kyrgyzstan", "laos", "latvia", "lebanon",
  "lithuania", "malaysia", "mexico", "moldova", "mongolia", "myanmar", "nepal", "netherlands", "new zealand", "nicaragua", "north korea", "norway",
  "oman", "pakistan", "palestine", "panama", "papua new guinea", "paraguay", "peru", "philippines", "poland", "portugal", "qatar", "romania", "russia", "saudi arabia",
  "serbia", "singapore", "slovakia", "slovenia", "south korea", "spain", "sri lanka", "sweden", "switzerland", "syria", "taiwan", "tajikistan",
  "thailand", "turkey", "turkmenistan", "ukraine", "united arab emirates", "united kingdom", "united states", "uruguay", "uzbekistan", "venezuela",
  "vietnam", "yemen",
];

/** Well-known conflict places outside Africa -> their country. Only names
 *  specific enough not to be ordinary words. */
const NON_AFRICAN_PLACE_COUNTRY: Record<string, string> = {
  taiz: "yemen", sanaa: "yemen", hodeidah: "yemen", marib: "yemen", aden: "yemen", houthi: "yemen", houthis: "yemen",
  riyadh: "saudi arabia", jeddah: "saudi arabia",
  gaza: "palestine", rafah: "palestine", "west bank": "palestine", jenin: "palestine",
  "tel aviv": "israel", jerusalem: "israel",
  beirut: "lebanon", damascus: "syria", aleppo: "syria", idlib: "syria", baghdad: "iraq", mosul: "iraq", tehran: "iran",
  kyiv: "ukraine", kharkiv: "ukraine", odesa: "ukraine", donetsk: "ukraine", moscow: "russia", kabul: "afghanistan", islamabad: "pakistan",
};

interface NameMatcher {
  country: string; // normalised country name
  rx: RegExp;
}

function wordRx(term: string): RegExp {
  return new RegExp(`(?:^| )${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`);
}

const COUNTRY_MATCHERS: NameMatcher[] = (() => {
  const out: NameMatcher[] = [];
  for (const c of WORLD_COUNTRIES) out.push({ country: c, rx: wordRx(c) });
  for (const info of Object.values(AFRICA_GEO_COUNTRIES)) {
    const canonical = normalizeName(info.name);
    for (const n of [info.name, ...info.aliases]) {
      const norm = normalizeName(n).replace(/[()]/g, "").trim();
      if (norm.length >= 4) out.push({ country: canonical, rx: wordRx(norm) });
    }
  }
  return out;
})();

const PLACE_MATCHERS: NameMatcher[] = (() => {
  const out: NameMatcher[] = [];
  for (const [place, country] of Object.entries(NON_AFRICAN_PLACE_COUNTRY)) out.push({ country, rx: wordRx(place) });
  // African conflict towns that exist in exactly one country in the gazetteer
  // and are long enough not to collide with ordinary words.
  const owners = new Map<string, Set<string>>();
  for (const p of CONFLICT_GAZETTEER) {
    if (p.kind === "region") continue;
    const k = normalizeName(p.name);
    if (!owners.has(k)) owners.set(k, new Set());
    owners.get(k)!.add(p.country);
  }
  for (const [name, codes] of owners) {
    if (codes.size !== 1 || name.replace(/ /g, "").length < 6) continue;
    out.push({ country: normalizeName(AFRICA_GEO_COUNTRIES[[...codes][0]].name), rx: wordRx(name) });
  }
  return out;
})();

function slugText(url: string): string {
  try {
    const u = new URL(url);
    return ` ${normalizeName(decodeURIComponent(u.pathname).replace(/[-_/.+]+/g, " "))} `;
  } catch {
    return "";
  }
}

function geocodedCountry(placeName: string): string {
  const last = placeName.split(",").pop() ?? "";
  const norm = normalizeName(last).replace(/[()]/g, "").trim();
  // Map an African alias back to its canonical name so "Ivory Coast" == "Cote d'Ivoire".
  for (const info of Object.values(AFRICA_GEO_COUNTRIES)) {
    if ([info.name, ...info.aliases].some((n) => normalizeName(n).replace(/[()]/g, "").trim() === norm)) return normalizeName(info.name);
  }
  return norm;
}

const KNOWN_COUNTRIES = new Set(COUNTRY_MATCHERS.map((m) => m.country));
// Longest names first, so "south sudan" is consumed before "sudan" is tested
// and "equatorial guinea" before "guinea".
const COUNTRY_MATCHERS_BY_LENGTH = [...COUNTRY_MATCHERS].sort((a, b) => b.rx.source.length - a.rx.source.length);

/** True when the article's own URL names a different country (or a
 *  well-known town in a different country) than the one GDELT geocoded the
 *  event to, and does not name the geocoded country at all. Returns false
 *  whenever it cannot tell — an unrecognised country name, or a URL with no
 *  location words in it. */
export function isGeocodeContradictedBySlug(placeName: string, sourceUrl: string): boolean {
  if (!placeName || !sourceUrl) return false;
  const text = slugText(sourceUrl);
  if (text.trim().length < 8) return false;
  const geo = geocodedCountry(placeName);
  if (!geo || !KNOWN_COUNTRIES.has(geo)) return false;

  const placeCountries = new Set<string>();
  for (const m of PLACE_MATCHERS) if (m.rx.test(text)) placeCountries.add(m.country);

  const mentioned = new Set<string>();
  let remaining = text;
  for (const m of COUNTRY_MATCHERS_BY_LENGTH) {
    if (m.rx.test(remaining)) {
      mentioned.add(m.country);
      remaining = remaining.replace(new RegExp(m.rx.source, "g"), " ");
    }
  }

  // A named town in another country is decisive, even if the geocoded
  // country's name also appears ("saudi-arabia-backed forces in Taiz").
  if (placeCountries.size > 0 && !placeCountries.has(geo)) return true;
  if (mentioned.size > 0 && !mentioned.has(geo) && !placeCountries.has(geo)) return true;
  return false;
}
