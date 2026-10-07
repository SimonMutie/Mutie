import { AFRICA_SOURCES, PAN_AFRICAN, GLOBAL_AFRICA_DESK, INSTITUTION } from "../data/africaSources";
import { AFRICA_CENTROIDS, countryName, resolveCountryCode } from "./africaGeo";

/**
 * Where the outlets reporting on a subject are based, relative to the
 * countries the reporting is about: in those countries, elsewhere in
 * Africa, or outside it.
 *
 * An outlet's home is taken from the platform's own source list
 * (data/africaSources.ts), from a short list of well-known international
 * and pan-African outlets, or from a national web address (".ke", ".ng").
 * An outlet none of those identifies is counted as "not classified", never
 * guessed.
 */

export type OutletBase = { kind: "country"; code: string } | { kind: "panafrican" } | { kind: "international" } | null;

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

const LISTED = new Map<string, OutletBase>();
for (const s of AFRICA_SOURCES) {
  const base: OutletBase = s.country === PAN_AFRICAN ? { kind: "panafrican" } : s.country === GLOBAL_AFRICA_DESK || s.country === INSTITUTION ? { kind: "international" } : { kind: "country", code: s.country };
  LISTED.set(host(s.url), base);
}

const INTERNATIONAL = [
  "bbc.com", "bbc.co.uk", "reuters.com", "apnews.com", "afp.com", "aljazeera.com", "aljazeera.net", "dw.com", "france24.com", "rfi.fr", "voanews.com", "voaafrica.com", "theguardian.com", "nytimes.com",
  "washingtonpost.com", "ft.com", "bloomberg.com", "cnn.com", "economist.com", "lemonde.fr", "telegraph.co.uk", "independent.co.uk", "sky.com", "npr.org", "aa.com.tr", "tass.com", "xinhuanet.com",
  "news.cn", "scmp.com", "channelnewsasia.com", "timesofisrael.com", "middleeasteye.net", "arabnews.com", "thenationalnews.com", "un.org", "news.un.org", "reliefweb.int", "unhcr.org", "msf.org", "hrw.org",
  "amnesty.org", "crisisgroup.org", "icrc.org", "who.int", "wfp.org", "unocha.org", "foreignpolicy.com", "politico.eu", "euronews.com", "trtworld.com", "trtafrika.com", "africaintelligence.com",
];
const PAN = ["allafrica.com", "africanews.com", "theafricareport.com", "africa.cgtn.com", "africanarguments.org", "theeastafrican.co.ke", "apanews.net", "panapress.com", "africa-confidential.com", "semafor.com"];
// The source list files the Africa desks of world outlets (BBC, Reuters, AP …) under "pan-African", which is
// right for what they cover; here the question is where the outlet is based, so these are international.
for (const d of INTERNATIONAL) LISTED.set(d, { kind: "international" });
for (const d of PAN) LISTED.set(d, { kind: "panafrican" });
// Sudan-focused newsrooms the platform reads directly.
LISTED.set("dabangasudan.org", { kind: "country", code: "SD" });
LISTED.set("sudantribune.com", { kind: "country", code: "SD" });

/** National web addresses that are sold worldwide for their spelling and say nothing about where an outlet is. */
const UNRELIABLE_TLDS = new Set(["ly", "ml", "ga", "cf", "gq", "st", "sc", "sh", "ac"]);

export function outletBase(domain: string | null | undefined): OutletBase {
  if (!domain) return null;
  let d = domain.toLowerCase().replace(/^www\./, "");
  // Longest suffix first: "africa.cgtn.com" before "cgtn.com".
  for (;;) {
    const hit = LISTED.get(d);
    if (hit !== undefined) return hit;
    const dot = d.indexOf(".");
    if (dot < 0 || d.indexOf(".", dot + 1) < 0) break;
    d = d.slice(dot + 1);
  }
  const tld = domain.toLowerCase().split(".").pop() ?? "";
  if (tld.length === 2 && !UNRELIABLE_TLDS.has(tld) && AFRICA_CENTROIDS[tld.toUpperCase()]) return { kind: "country", code: tld.toUpperCase() };
  return null;
}

export interface SourceMix {
  /** The countries the reporting is mostly about, by name. */
  countries: string[];
  /** Items by where their outlet is based. */
  inCountry: number;
  elsewhereInAfrica: number;
  international: number;
  unclassified: number;
  /** Different outlets in all. */
  outlets: number;
  /** The single largest outlet and its share of the items, 0 … 1. */
  largest: { label: string; share: number } | null;
}

/** The country a place label ends in: "El Fasher, Sudan" -> SD. */
export function countryOfPlace(place: string | null | undefined): string | null {
  if (!place) return null;
  return resolveCountryCode(place.split(",").pop()!.trim());
}

export function sourceMix(items: { source: string | null; place: string | null }[]): SourceMix {
  const about = new Map<string, number>();
  let located = 0;
  for (const i of items) {
    const code = countryOfPlace(i.place);
    if (!code) continue;
    located++;
    about.set(code, (about.get(code) ?? 0) + 1);
  }
  // "About" a country when it has at least a sixth of the located items; at most three.
  const focus = [...about.entries()]
    .filter(([, n]) => n >= Math.max(1, located / 6))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code]) => code);
  const focusSet = new Set(focus);

  const mix: SourceMix = { countries: focus.map((c) => countryName(c)), inCountry: 0, elsewhereInAfrica: 0, international: 0, unclassified: 0, outlets: 0, largest: null };
  const perOutlet = new Map<string, number>();
  let counted = 0;
  for (const i of items) {
    if (!i.source) continue;
    counted++;
    perOutlet.set(i.source, (perOutlet.get(i.source) ?? 0) + 1);
    const base = outletBase(i.source);
    if (!base) mix.unclassified++;
    else if (base.kind === "international") mix.international++;
    else if (base.kind === "panafrican") mix.elsewhereInAfrica++;
    else if (focusSet.has(base.code)) mix.inCountry++;
    else mix.elsewhereInAfrica++;
  }
  mix.outlets = perOutlet.size;
  const top = [...perOutlet.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && counted > 0) mix.largest = { label: top[0], share: Number((top[1] / counted).toFixed(3)) };
  return mix;
}
