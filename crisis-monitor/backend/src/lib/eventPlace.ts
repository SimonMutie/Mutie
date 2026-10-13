import { countryName, namedLocations, normalizeName } from "./africaGeo";
import { stripDatelines } from "./dateline";

/**
 * The last word on WHERE a coded event happened: the place the event's own
 * description names.
 *
 * A coding carries a place (the model's, or the headline rules') and a
 * description of the event with the quotes behind it. When the two disagree
 * the description is the better witness, because the place can come from
 * anywhere in the article — most often from the dateline ("DUBAI, Oct 12
 * (Reuters) - … drones over Riyadh"), sometimes from a city mentioned in
 * passing. So:
 *
 *   - a place the description (or its quotes) names is kept;
 *   - a site inside the coded town that the description names is taken as
 *     the more exact place (Dammam → King Fahd International Airport);
 *   - a place it does not name is replaced when the description names
 *     exactly one town or region — that one — but only when the place is the
 *     story's dateline, or appears nowhere else in the story. A town the
 *     story itself reports on (an airport hit in Dammam, in a story led by
 *     Riyadh) is a second event site, not a mistake;
 *   - a place that is only the story's dateline is dropped when the
 *     description names no town at all, leaving the event at the country
 *     the description names (or the country already coded).
 *
 * When the description names several towns ("Houthis in Sanaa fired at
 * Riyadh") nothing is changed: picking one would be a guess.
 */

export interface EventPlaceInput {
  countryCode: string;
  place: string | null;
  admin1: string | null;
  /** The model's description of the event, and the quotes it rests on. */
  evidence: string[];
  /** The places the story's dateline names, if any (see dateline.ts). */
  filedFrom: { label: string; countryCode: string }[];
  /** The story's text. A coded place it names (outside the dateline) is never moved for not being in the description. */
  articleText?: string;
}

export interface EventPlaceFix {
  countryCode: string;
  place: string | null;
  admin1: string | null;
  note: string;
}

const same = (a: string, b: string) => normalizeName(a) === normalizeName(b);

export function placeFromEvidence(input: EventPlaceInput): EventPlaceFix | null {
  const evidence = stripDatelines(input.evidence.filter(Boolean).join(". "));
  if (!evidence.trim()) return null;
  const normEvidence = ` ${normalizeName(evidence)} `;
  const named = (name: string | null) => !!name && normalizeName(name).length >= 3 && normEvidence.includes(` ${normalizeName(name)} `);

  const mentions = namedLocations(evidence);
  const specific = mentions.filter((m) => m.precision !== "country");
  // One reading per distinct place: "Riyadh … Riyadh" is one place.
  const distinct = specific.filter((m, i) => specific.findIndex((x) => x.label === m.label && x.countryCode === m.countryCode) === i);
  const countries = [...new Set(mentions.map((m) => m.countryCode))];

  const current = input.place ?? input.admin1;
  const isFiledFrom = !!current && input.filedFrom.some((d) => same(d.label, current));

  // A site inside the coded town that the description names is the more exact place.
  const sites = current ? distinct.filter((m) => m.within && same(m.within, current) && m.countryCode === input.countryCode) : [];
  if (current && sites.length === 1) {
    const to = sites[0];
    return { countryCode: to.countryCode, place: to.label, admin1: null, note: `Located at ${to.label}, ${to.within}, the site in ${current} that the event's own description names.` };
  }

  // The coded place is named where the event is described: it stands.
  if (current && named(current)) return null;

  // A place the story reports on in its own text (not just its dateline) is kept: it may be a second site of the attack.
  const inStory = !!current && !!input.articleText && ` ${normalizeName(stripDatelines(input.articleText))} `.includes(` ${normalizeName(current)} `);
  if (current && !isFiledFrom && (inStory || !input.articleText)) return null;

  if (current && distinct.length === 1) {
    const to = distinct[0];
    if (same(to.label, current) && to.countryCode === input.countryCode) return null;
    return {
      countryCode: to.countryCode,
      place: to.precision === "place" ? to.label : null,
      admin1: to.precision === "region" ? to.label : null,
      note: `Located at ${to.label}, ${countryName(to.countryCode)}, the place the event's own description names${isFiledFrom ? `; ${current} is only the story's dateline (where it was filed from)` : `, not ${current}`}.`,
    };
  }

  if (isFiledFrom && distinct.length === 0) {
    const country = countries.length === 1 ? countries[0] : input.countryCode;
    return {
      countryCode: country,
      place: null,
      admin1: null,
      note: `${current} is only the story's dateline (where it was filed from), and the event's description names no town; located to ${countryName(country)} only.`,
    };
  }

  // No place coded, but the country came from the dateline and the description names one town elsewhere ("DUBAI (Reuters) - … over Riyadh").
  if (!current && distinct.length === 1 && distinct[0].countryCode !== input.countryCode && input.filedFrom.some((d) => d.countryCode === input.countryCode)) {
    const to = distinct[0];
    return {
      countryCode: to.countryCode,
      place: to.precision === "place" ? to.label : null,
      admin1: to.precision === "region" ? to.label : null,
      note: `Located at ${to.label}, ${countryName(to.countryCode)}, the place the event's own description names; ${countryName(input.countryCode)} came only from the story's dateline.`,
    };
  }
  return null;
}
