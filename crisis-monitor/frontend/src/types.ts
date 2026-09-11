/** Generic geographic domain types.
 *
 *  Replaces the earlier hardcoded "country -> province -> county" shape
 *  (two fixed levels, two hardcoded countries) with a numbered ADM0-ADMn
 *  hierarchy. Administrative terminology genuinely varies by country -
 *  Kenya's ADM1 is a "County", the US's ADM1 is a "State", Ethiopia's
 *  ADM2 is a "Zone" - so levels are numbered internally and only labeled
 *  for display, never assumed to share a name across countries.
 */

/** A single administrative level within one country's hierarchy.
 *  Level 0 (the country itself) is implicit - the world map's own
 *  country shapes - and is not represented by a GeoLevel entry; this
 *  type describes level 1 and deeper. */
export interface GeoLevel {
  /** 1 = first subdivision below the country, 2 = second, etc. Matches
   *  the conventional ADM1/ADM2/ADM3 numbering, but the specific number
   *  carries no meaning beyond ordering - it is not assumed to line up
   *  with the same level number in a different country. */
  level: number;
  /** Human-readable label for this specific level in this specific
   *  country - "State" for the US, "County" for South Sudan's ADM1,
   *  "Province" for a country that uses that term. Never a single global
   *  term applied to every country. */
  label: string;
  /** URL to this level's boundary TopoJSON/GeoJSON file. */
  boundaryUrl: string;
  /** Property key within that boundary file's feature properties holding
   *  each entity's display name. Varies by data source - world-atlas
   *  uses "name", geoBoundaries-derived files use "shapeName" - so this
   *  is recorded per level rather than assumed globally. */
  namePropertyKey: string;
  /** Property key holding a reference to the parent entity's name,
   *  needed only when this level's boundary file contains every entity
   *  for the whole country in one file (e.g. South Sudan's ADM2 file has
   *  all counties across all ten states together) and so needs filtering
   *  down to just the selected parent's children. Undefined when the
   *  boundary file is already scoped to one parent on its own (e.g. a
   *  country's own ADM1 file naturally contains only that country's
   *  provinces, nothing to filter out). */
  parentNamePropertyKey?: string;
}

/** One country's full available hierarchy below the country level, plus
 *  the name-matching aliases needed to resolve how other data sources
 *  (the world map's own topology, a user's dataset) refer to this
 *  country against this registry's canonical spelling of it. */
export interface GeoHierarchyEntry {
  /** Canonical, human-readable name - what's shown in breadcrumbs and
   *  pickers, and the name a dataset is expected to use unless it
   *  matches one of the aliases below instead. */
  canonicalName: string;
  /** ISO 3166-1 alpha-3 code, where known. Not yet used for matching -
   *  recorded now so a future geography source keyed by ISO code (GADM,
   *  geoBoundaries' own API) can cross-reference against this registry
   *  without a separate lookup table. */
  iso3?: string;
  /** Alternate names this country might be called by a different data
   *  source or a dataset's own spelling - e.g. the world map's own
   *  topology (Natural Earth, via world-atlas) abbreviates many country
   *  names for map-label space ("S. Sudan", "Dem. Rep. Congo") in ways
   *  that differ from how a person would normally type the name. */
  aliases?: string[];
  /** Ordered list of levels below the country itself (starting at
   *  level 1) that this registry actually has real boundary data for.
   *  An empty array means this country is known (has a canonical name
   *  entry, useful for name matching) but has no drill-down data yet. */
  levels: GeoLevel[];
}

/** A resolved node in the current drill path - which level, and which
 *  specific entity at that level, is currently selected. Path[0] is
 *  always the country (level 0); deeper entries correspond to GeoLevel.level
 *  values in the country's own hierarchy. Generic length (not hardcoded
 *  to "country + one province level") so a country with ADM1-ADM3 data
 *  can be drilled three levels deep the same way a country with only
 *  ADM1 can be drilled one. */
export interface GeoDrillPathEntry {
  level: number;
  /** The entity's name as selected - matches GeoLevel.namePropertyKey's
   *  value from the boundary file for this level (or the country's own
   *  canonical/alias name, for level 0). */
  name: string;
}
