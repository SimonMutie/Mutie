import { geoCentroid } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldTopology from "world-atlas/countries-50m.json?url";

/**
 * Country shapes and country names for the map visuals.
 *
 * The shapes are Natural Earth's (the same file the older choropleth widget
 * uses). Data rarely spells a country the way a map file does, so a name is
 * matched after tidying (case, accents, "the", punctuation) and through a
 * table of the spellings and codes people actually use. A name that still
 * matches nothing is reported on the visual, never silently dropped.
 */

export interface Country {
  /** The map file's own name ("Dem. Rep. Congo"). */
  name: string;
  /** The name to show ("DR Congo"). */
  label: string;
  key: string;
  africa: boolean;
  feature: Feature<Geometry>;
  centroid: [number, number];
}

/** A name reduced to what matching compares: lower case, no accents, no punctuation, no leading "the". */
export function tidyName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the /, "")
    .trim();
}

interface AfricaEntry {
  iso3: string;
  iso2: string;
  /** The map file's name. */
  name: string;
  label: string;
  /** Column and row on the tile map. */
  tile: [number, number];
  also?: string[];
}

/** Africa's countries (and Western Sahara), with their place on the tile map: a grid that keeps neighbours roughly neighbours. */
export const AFRICA: AfricaEntry[] = [
  { iso3: "MAR", iso2: "MA", name: "Morocco", label: "Morocco", tile: [3, 0] },
  { iso3: "DZA", iso2: "DZ", name: "Algeria", label: "Algeria", tile: [4, 0] },
  { iso3: "TUN", iso2: "TN", name: "Tunisia", label: "Tunisia", tile: [5, 0] },
  { iso3: "LBY", iso2: "LY", name: "Libya", label: "Libya", tile: [6, 0], also: ["libyan arab jamahiriya"] },
  { iso3: "EGY", iso2: "EG", name: "Egypt", label: "Egypt", tile: [7, 0], also: ["arab republic of egypt"] },
  { iso3: "ESH", iso2: "EH", name: "W. Sahara", label: "Western Sahara", tile: [2, 1], also: ["western sahara", "sahrawi arab democratic republic"] },
  { iso3: "MRT", iso2: "MR", name: "Mauritania", label: "Mauritania", tile: [3, 1] },
  { iso3: "MLI", iso2: "ML", name: "Mali", label: "Mali", tile: [4, 1] },
  { iso3: "NER", iso2: "NE", name: "Niger", label: "Niger", tile: [5, 1] },
  { iso3: "TCD", iso2: "TD", name: "Chad", label: "Chad", tile: [6, 1], also: ["tchad"] },
  { iso3: "SDN", iso2: "SD", name: "Sudan", label: "Sudan", tile: [7, 1], also: ["republic of sudan", "republic of the sudan"] },
  { iso3: "ERI", iso2: "ER", name: "Eritrea", label: "Eritrea", tile: [9, 1] },
  { iso3: "DJI", iso2: "DJ", name: "Djibouti", label: "Djibouti", tile: [10, 1] },
  { iso3: "CPV", iso2: "CV", name: "Cabo Verde", label: "Cabo Verde", tile: [0, 2], also: ["cape verde"] },
  { iso3: "SEN", iso2: "SN", name: "Senegal", label: "Senegal", tile: [1, 2] },
  { iso3: "GMB", iso2: "GM", name: "Gambia", label: "Gambia", tile: [2, 2], also: ["gambia the"] },
  { iso3: "BFA", iso2: "BF", name: "Burkina Faso", label: "Burkina Faso", tile: [3, 2], also: ["burkina"] },
  { iso3: "TGO", iso2: "TG", name: "Togo", label: "Togo", tile: [4, 2] },
  { iso3: "BEN", iso2: "BJ", name: "Benin", label: "Benin", tile: [5, 2] },
  { iso3: "NGA", iso2: "NG", name: "Nigeria", label: "Nigeria", tile: [6, 2] },
  { iso3: "CAF", iso2: "CF", name: "Central African Rep.", label: "Central African Republic", tile: [7, 2], also: ["central african republic", "car", "centrafrique"] },
  { iso3: "SSD", iso2: "SS", name: "S. Sudan", label: "South Sudan", tile: [8, 2], also: ["south sudan", "republic of south sudan"] },
  { iso3: "ETH", iso2: "ET", name: "Ethiopia", label: "Ethiopia", tile: [9, 2] },
  { iso3: "SOM", iso2: "SO", name: "Somalia", label: "Somalia", tile: [10, 2], also: ["federal republic of somalia"] },
  { iso3: "GNB", iso2: "GW", name: "Guinea-Bissau", label: "Guinea-Bissau", tile: [1, 3], also: ["guinea bissau"] },
  { iso3: "GIN", iso2: "GN", name: "Guinea", label: "Guinea", tile: [2, 3], also: ["guinea conakry"] },
  { iso3: "CIV", iso2: "CI", name: "Côte d'Ivoire", label: "Côte d’Ivoire", tile: [3, 3], also: ["ivory coast", "cote d ivoire", "cote divoire"] },
  { iso3: "GHA", iso2: "GH", name: "Ghana", label: "Ghana", tile: [4, 3] },
  { iso3: "CMR", iso2: "CM", name: "Cameroon", label: "Cameroon", tile: [6, 3], also: ["cameroun"] },
  { iso3: "COG", iso2: "CG", name: "Congo", label: "Congo", tile: [7, 3], also: ["republic of the congo", "republic of congo", "congo brazzaville", "congo rep", "congo republic"] },
  { iso3: "UGA", iso2: "UG", name: "Uganda", label: "Uganda", tile: [8, 3] },
  { iso3: "KEN", iso2: "KE", name: "Kenya", label: "Kenya", tile: [9, 3] },
  { iso3: "SYC", iso2: "SC", name: "Seychelles", label: "Seychelles", tile: [11, 3] },
  { iso3: "SLE", iso2: "SL", name: "Sierra Leone", label: "Sierra Leone", tile: [1, 4] },
  { iso3: "LBR", iso2: "LR", name: "Liberia", label: "Liberia", tile: [2, 4] },
  { iso3: "STP", iso2: "ST", name: "São Tomé and Principe", label: "São Tomé and Príncipe", tile: [5, 4], also: ["sao tome and principe", "sao tome"] },
  { iso3: "GNQ", iso2: "GQ", name: "Eq. Guinea", label: "Equatorial Guinea", tile: [6, 4], also: ["equatorial guinea"] },
  { iso3: "GAB", iso2: "GA", name: "Gabon", label: "Gabon", tile: [7, 4] },
  {
    iso3: "COD",
    iso2: "CD",
    name: "Dem. Rep. Congo",
    label: "DR Congo",
    tile: [8, 4],
    also: ["democratic republic of the congo", "democratic republic of congo", "dr congo", "drc", "congo kinshasa", "congo dem rep", "congo democratic republic", "congo drc", "zaire"],
  },
  { iso3: "RWA", iso2: "RW", name: "Rwanda", label: "Rwanda", tile: [9, 4] },
  { iso3: "TZA", iso2: "TZ", name: "Tanzania", label: "Tanzania", tile: [10, 4], also: ["united republic of tanzania", "tanzania united republic of"] },
  { iso3: "AGO", iso2: "AO", name: "Angola", label: "Angola", tile: [7, 5] },
  { iso3: "ZMB", iso2: "ZM", name: "Zambia", label: "Zambia", tile: [8, 5] },
  { iso3: "BDI", iso2: "BI", name: "Burundi", label: "Burundi", tile: [9, 5] },
  { iso3: "MWI", iso2: "MW", name: "Malawi", label: "Malawi", tile: [10, 5] },
  { iso3: "COM", iso2: "KM", name: "Comoros", label: "Comoros", tile: [11, 5] },
  { iso3: "NAM", iso2: "NA", name: "Namibia", label: "Namibia", tile: [7, 6] },
  { iso3: "BWA", iso2: "BW", name: "Botswana", label: "Botswana", tile: [8, 6] },
  { iso3: "ZWE", iso2: "ZW", name: "Zimbabwe", label: "Zimbabwe", tile: [9, 6] },
  { iso3: "MOZ", iso2: "MZ", name: "Mozambique", label: "Mozambique", tile: [10, 6] },
  { iso3: "MDG", iso2: "MG", name: "Madagascar", label: "Madagascar", tile: [11, 6] },
  { iso3: "MUS", iso2: "MU", name: "Mauritius", label: "Mauritius", tile: [12, 6] },
  { iso3: "ZAF", iso2: "ZA", name: "South Africa", label: "South Africa", tile: [8, 7], also: ["rsa", "republic of south africa"] },
  { iso3: "LSO", iso2: "LS", name: "Lesotho", label: "Lesotho", tile: [9, 7] },
  { iso3: "SWZ", iso2: "SZ", name: "eSwatini", label: "Eswatini", tile: [10, 7], also: ["swaziland", "kingdom of eswatini"] },
];

/** Spellings from the rest of the world that differ from the map file's. */
const WORLD_ALSO: Record<string, string> = {
  "united states": "United States of America",
  usa: "United States of America",
  us: "United States of America",
  "u s": "United States of America",
  uk: "United Kingdom",
  "great britain": "United Kingdom",
  britain: "United Kingdom",
  "russian federation": "Russia",
  "korea republic of": "South Korea",
  "republic of korea": "South Korea",
  "korea north": "North Korea",
  "syrian arab republic": "Syria",
  "iran islamic republic of": "Iran",
  turkiye: "Turkey",
  "viet nam": "Vietnam",
  "lao pdr": "Laos",
  "czech republic": "Czechia",
  "bosnia and herzegovina": "Bosnia and Herz.",
  "dominican republic": "Dominican Rep.",
  burma: "Myanmar",
  "north macedonia": "Macedonia",
  "east timor": "Timor-Leste",
  "state of palestine": "Palestine",
  "palestinian territories": "Palestine",
  uae: "United Arab Emirates",
  ksa: "Saudi Arabia",
  "peoples republic of china": "China",
  prc: "China",
};

const AFRICA_BY_NAME = new Map(AFRICA.map((a) => [a.name, a]));

/** Every spelling or code → the map file's name, tidied. Two-letter codes are matched only in upper case (see placeKey). */
const ALIASES = new Map<string, string>();
for (const a of AFRICA) {
  const target = tidyName(a.name);
  for (const spelling of [a.label, a.iso3, ...(a.also ?? [])]) ALIASES.set(tidyName(spelling), target);
}
for (const [spelling, name] of Object.entries(WORLD_ALSO)) ALIASES.set(spelling, tidyName(name));
const ISO2 = new Map(AFRICA.map((a) => [a.iso2, tidyName(a.name)]));

/** The key a place name in the data is looked up by. */
export function placeKey(value: string): string {
  const raw = value.trim();
  // "NA", "TD", "CI"… are codes only when written as codes; "na" is more likely a blank.
  if (/^[A-Z]{2}$/.test(raw) && ISO2.has(raw)) return ISO2.get(raw)!;
  const tidy = tidyName(raw);
  return ALIASES.get(tidy) ?? tidy;
}

/** The map file's own spelling of a place named in the data, where it is known; otherwise the name as given. */
const MAP_NAME = new Map<string, string>([...AFRICA.map((a) => [tidyName(a.name), a.name] as [string, string]), ...Object.values(WORLD_ALSO).map((n) => [tidyName(n), n] as [string, string])]);
export const mapNameFor = (value: string) => MAP_NAME.get(placeKey(value)) ?? value.trim();

let loading: Promise<Country[]> | null = null;

/** The world's countries, fetched once (about 750 KB) the first time a map is drawn. */
export function loadWorld(): Promise<Country[]> {
  if (!loading) {
    loading = fetch(worldTopology)
      .then((r) => {
        if (!r.ok) throw new Error("The map could not be loaded.");
        return r.json() as Promise<Topology>;
      })
      .then((topology) => {
        const collection = feature(topology, topology.objects.countries as GeometryCollection<{ name: string }>);
        return collection.features
          .filter((f) => f.properties?.name && f.properties.name !== "Antarctica")
          .map((f): Country => {
            const name = f.properties!.name;
            const africa = AFRICA_BY_NAME.get(name);
            return {
              name,
              label: africa?.label ?? name,
              key: tidyName(name),
              africa: !!africa || name === "Somaliland",
              feature: f as Feature<Geometry>,
              centroid: geoCentroid(f) as [number, number],
            };
          });
      })
      .catch((err) => {
        loading = null; // let the next visual try again
        throw err;
      });
  }
  return loading;
}

export const africaEntry = (key: string) => AFRICA.find((a) => tidyName(a.name) === key);
