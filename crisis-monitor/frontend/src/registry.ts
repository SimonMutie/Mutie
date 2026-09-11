import type { GeoHierarchyEntry, GeoLevel } from "./types";

/** The geography registry: every country with real drill-down boundary
 *  data available, keyed by canonical name. Replaces the earlier
 *  COUNTRY_ADMIN_DATA object - same underlying data, generalized shape
 *  (a levels[] array instead of hardcoded adm1Url/adm2Url fields) so a
 *  country with three or four administrative levels fits the same
 *  structure as one with only one, and so does a future country that
 *  isn't the US or South Sudan.
 *
 *  Each entry's data source and any preprocessing it needed is recorded
 *  in that entry's own comment - both existing entries came from
 *  different pipelines (South Sudan needed simplification and a
 *  computed parent-state join; the US used an already-simplified,
 *  already-parent-scoped package directly) and future entries may need
 *  either approach depending on what's available for that country. */
export const GEO_REGISTRY: Record<string, GeoHierarchyEntry> = {
  "South Sudan": {
    canonicalName: "South Sudan",
    iso3: "SSD",
    // world-atlas (Natural Earth) abbreviates this for map-label space -
    // confirmed directly against the actual topology data, not assumed.
    aliases: ["S. Sudan"],
    levels: [
      {
        level: 1,
        label: "State",
        boundaryUrl: "/geo/SSD-adm1.json",
        // Sourced from geoBoundaries (via a non-LFS derivative repo,
        // since the canonical repo stores its data via Git LFS which
        // wasn't reachable), simplified with mapshaper at a conservative
        // setting (35%) after an aggressive setting produced real,
        // confirmed topology errors on a different country's data.
        namePropertyKey: "shapeName",
      },
      {
        level: 2,
        label: "County",
        boundaryUrl: "/geo/SSD-adm2.json",
        namePropertyKey: "shapeName",
        // geoBoundaries' own ADM2 data has no parent-state reference per
        // county - "parentState" was computed once, offline, via a
        // spatial join (each county's centroid tested against every
        // state polygon; 77 of 78 matched by strict containment, 1
        // border case resolved by nearest-distance fallback) and baked
        // into this file's own properties. Not derived at request time.
        parentNamePropertyKey: "parentState",
      },
    ],
  },
  "United States": {
    canonicalName: "United States",
    iso3: "USA",
    aliases: ["United States of America", "USA", "US"],
    levels: [
      {
        level: 1,
        label: "State",
        // us-atlas (U.S. Census Bureau data via the same maintainers as
        // world-atlas) - already appropriately simplified, no
        // preprocessing needed. Includes DC and five US territories
        // alongside the 50 states (56 entities total).
        boundaryUrl: "/geo/us-states.json",
        namePropertyKey: "name",
        // No parentNamePropertyKey - this file already contains only US
        // states/territories, nothing else to filter out.
      },
      // No level-2 (county) entry yet - us-atlas does have a
      // counties-10m.json, but it isn't wired up. A country being listed
      // here with fewer levels than it could eventually have is
      // expected, not a gap to paper over.
    ],
  },
};

/** Case/whitespace-normalized lookup across each entry's canonical name
 *  and its aliases. Needed because a dataset's own spelling of a country
 *  and the world map's own topology label for the same country don't
 *  always agree (confirmed pattern: world-atlas labels South Sudan
 *  "S. Sudan", not "South Sudan" - an exact-match lookup against the
 *  full name would silently match nothing hovered on the actual map). */
export function findGeoHierarchy(name: string | undefined): GeoHierarchyEntry | undefined {
  if (!name) return undefined;
  const key = name.trim().toLowerCase();
  for (const entry of Object.values(GEO_REGISTRY)) {
    if (entry.canonicalName.trim().toLowerCase() === key) return entry;
    if (entry.aliases?.some((a) => a.trim().toLowerCase() === key)) return entry;
  }
  return undefined;
}

/** The GeoLevel for a specific numbered level within an entry, or
 *  undefined if that country's registry entry doesn't have data that
 *  deep - the generic replacement for checking "does drillData have an
 *  adm2Url" that scales past two hardcoded levels. */
export function getGeoLevel(entry: GeoHierarchyEntry, level: number): GeoLevel | undefined {
  return entry.levels.find((l) => l.level === level);
}

/** The deepest level number this country's registry entry actually has
 *  boundary data for (0 if none - country-level only). */
export function maxGeoLevel(entry: GeoHierarchyEntry): number {
  return entry.levels.reduce((max, l) => Math.max(max, l.level), 0);
}
