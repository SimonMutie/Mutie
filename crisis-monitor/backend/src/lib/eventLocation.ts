import { countryName, locateText } from "./africaGeo";
import { findCoords } from "./osintFeed";

/**
 * Where a monitoring-query event (a news article matched by a saved query)
 * is, judged from its own headline and text.
 *
 * News events used to be pinned to the centroid of the PUBLISHER's country
 * (GDELT's `sourcecountry`), so a Kenyan paper's report on fighting in
 * Sudan was drawn in Kenya — on the query dashboards' map and anywhere else
 * those coordinates were used. An event is now placed where its text says
 * it happened, and an event whose text names nowhere has no coordinates at
 * all: it is listed and counted, never drawn in a guessed position.
 */

export type EventLocationPrecision = "place" | "region" | "country";

export interface EventLocation {
  lat: number;
  lon: number;
  /** "Mekelle, Ethiopia" / "Tigray, Ethiopia" / "Ethiopia". */
  place: string;
  precision: EventLocationPrecision;
}

/** Anchors in osintFeed's keyword table that are not a country. */
const GENERIC_ANCHORS = new Set(["africa", "europe", "middle east"]);

function fromAfrica(text: string | null | undefined): EventLocation | null {
  const hit = locateText(text);
  if (!hit) return null;
  const place = hit.precision === "country" ? hit.label : `${hit.label}, ${countryName(hit.countryCode)}`;
  return { lat: hit.lat, lon: hit.lon, place, precision: hit.precision };
}

function fromWorld(text: string | null | undefined): EventLocation | null {
  const hit = text ? findCoords(text) : null;
  if (!hit || GENERIC_ANCHORS.has(hit.anchor)) return null;
  return { lat: hit.coords[0], lon: hit.coords[1], place: hit.anchor.replace(/\b\w/g, (ch) => ch.toUpperCase()), precision: "country" };
}

/** Headline first, then the opening of the body. African places resolve
 *  through the gazetteer (town, region or country); anything else falls back
 *  to a country-level match from the world keyword table. Null when the text
 *  names nowhere. */
export function locateEventText(title: string | null | undefined, body: string | null | undefined): EventLocation | null {
  const opening = (body ?? "").slice(0, 800);
  return fromAfrica(title) ?? fromWorld(title) ?? fromAfrica(opening) ?? fromWorld(opening);
}

/** Marker written into a news event's raw_metadata when its coordinates
 *  came from its text (see connectors/gdelt.ts). Rows without it predate
 *  this and still carry publisher-country coordinates. */
export const TEXT_LOCATED = "text";

/** Applies text-derived location to an event row on the way out. Rows
 *  ingested before text location existed are re-located here, so old
 *  matches stop appearing at their publisher's country too. Only news
 *  events from the GDELT connector are touched; anything else (uploaded or
 *  simulated events with their own coordinates) is returned as stored. */
export function withTextLocation<T extends Record<string, unknown>>(row: T): T {
  let meta: { connector?: string; geo?: string } = {};
  try {
    meta = typeof row.raw_metadata === "string" ? JSON.parse(row.raw_metadata) : ((row.raw_metadata as typeof meta) ?? {});
  } catch {
    meta = {};
  }
  if (meta.connector !== "gdelt" || meta.geo === TEXT_LOCATED) return row;
  const title = typeof row.title === "string" ? row.title : null;
  // Stored content is "title url body"; drop the URL so its slug words are
  // not mistaken for the article's text.
  const content = typeof row.content === "string" ? row.content.replace(/https?:\/\/\S+/g, " ") : "";
  const loc = locateEventText(title, content);
  return { ...row, geo_lat: loc?.lat ?? null, geo_lng: loc?.lon ?? null, geo_label: loc?.place ?? null };
}
