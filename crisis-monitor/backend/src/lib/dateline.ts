import { locateText } from "./africaGeo";

/**
 * Datelines: the place a wire story was FILED from, written before its first
 * sentence — "DUBAI, Oct 12 (Reuters) - Saudi air defences intercepted
 * drones over Riyadh…". Reuters files most Gulf stories from Dubai, AP many
 * from Dubai or Beirut, the Saudi Press Agency from Riyadh, whatever they
 * are about. The dateline is where the reporter sat, not where anything
 * happened, so it must never be read as the location of an event.
 *
 * Read naively it is also the FIRST place the text names, which is exactly
 * what a "first mention wins" location rule picks. That is how a strike on
 * Riyadh was put in Dubai.
 *
 * Forms handled, each only at the start of a text or a paragraph:
 *   DUBAI, Oct 12 (Reuters) -          DUBAI/RIYADH, Oct 12 (Reuters) -
 *   RIYADH (AP) —                      Dubai, United Arab Emirates (AP) —
 *   KHARTOUM, Sudan, Oct. 12 (Xinhua) --
 *   Riyadh, October 12, 2026, SPA --   RIYADH: …   BEIRUT —   (Reuters) - …
 * A bare "CITY:" or "CITY —" is taken as a dateline only when CITY is a
 * place the gazetteer knows, so "UN: …" or "BREAKING — …" are left alone.
 */

const MONTH = String.raw`(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?`;
const DATE = String.raw`(?:${MONTH}\s+\d{1,2}|\d{1,2}\s+${MONTH})(?:,?\s+\d{4})?`;
const AGENCY = String.raw`\((?:[A-Z][A-Za-z.&'’ -]{1,30}|[A-Z]{2,8})\)`;
const CAPS_NAME = String.raw`[A-Z][A-Z'’.-]+(?:[ -][A-Z][A-Z'’.-]+){0,3}`;
const CAPS_CITY = String.raw`${CAPS_NAME}(?:\s*\/\s*${CAPS_NAME})*`;
const TITLE_CITY = String.raw`[A-Z][a-z'’.-]+(?:[ -](?:al-|el-)?[A-Z][a-z'’.-]+){0,3}`;
/** ", Saudi Arabia" / ", Sudan": a country or state after the city. Letters only, so it never swallows a date. */
const AREA = String.raw`(?:,\s*[A-Z][A-Za-z'’.]+(?: [A-Z][A-Za-z'’.]+){0,3})?`;
const SEP = String.raw`\s*(?:[-–—]{1,3}|:)\s+`;

const CAPS_RX = new RegExp(String.raw`^\s*(${CAPS_CITY})${AREA}(?:,\s*(${DATE}))?(?:,?\s*(${AGENCY}|[A-Z]{2,6}(?=\s*[-–—])))?${SEP}`);
const TITLE_RX = new RegExp(String.raw`^\s*(${TITLE_CITY})(${AREA})(?:,\s*(${DATE}))?(?:,?\s*(${AGENCY}|[A-Z]{2,6}(?=\s*[-–—])))?\s*([-–—]{1,3}|\|)\s+`);
const AGENCY_ONLY_RX = new RegExp(String.raw`^\s*${AGENCY}\s*[-–—]{1,3}\s+`);

/** A town or region the gazetteer knows (a bare country name followed by a dash is a heading, not a dateline). */
const known = (name: string) =>
  name.split("/").every((n) => {
    const hit = locateText(n.trim());
    return !!hit && hit.precision !== "country";
  });

/** The dateline at the very start of `text`, if there is one, and the text after it. */
export function splitDateline(text: string): { dateline: string | null; rest: string } {
  if (!text) return { dateline: null, rest: text };
  const agencyOnly = AGENCY_ONLY_RX.exec(text);
  if (agencyOnly) return { dateline: null, rest: text.slice(agencyOnly[0].length) };

  const caps = CAPS_RX.exec(text);
  if (caps) {
    const [whole, city, date, agency] = caps;
    // With an agency or a date it is a dateline whatever the city; on its own ("RIYADH:") only if the city is a known place.
    if (agency || date || known(city)) return { dateline: city, rest: text.slice(whole.length) };
  }

  const title = TITLE_RX.exec(text);
  if (title) {
    const [whole, city, area, date, agency, sep] = title;
    // "Riyadh said on Monday…" never matches (no separator straight after the name). "Riyadh — …" is a
    // dateline only with something else that marks one, or when the city is a known place and the dash is a long one.
    if ((agency || date || area) || (sep !== "-" && known(city))) return { dateline: city, rest: text.slice(whole.length) };
  }
  return { dateline: null, rest: text };
}

/** `text` without a dateline at its start or at the start of any paragraph. */
export function stripDatelines(text: string): string {
  if (!text) return text;
  return text
    .split(/(\n\s*)/)
    .map((part) => (/^\n/.test(part) ? part : splitDateline(part).rest))
    .join("");
}

/** The places a text's dateline names ("DUBAI/RIYADH" names two), resolved through the gazetteer. Empty when there is no dateline. */
export function datelinePlaces(text: string): { label: string; countryCode: string }[] {
  const { dateline } = splitDateline(text);
  if (!dateline) return [];
  return dateline
    .split("/")
    .map((n) => locateText(n.trim()))
    .filter((hit): hit is NonNullable<typeof hit> => !!hit)
    .map((hit) => ({ label: hit.label, countryCode: hit.countryCode }));
}
