/**
 * The regions of Regional Spotlight. A fixed list, in the order the menu
 * shows them — the same world breakdown conflict-data publishers use
 * (Africa, Asia-Pacific, Europe & Central Asia, Latin America & the
 * Caribbean, Middle East, United States & Canada).
 *
 * `slug` is what is stored on each entry and never changes; `name` is only
 * a label and can be reworded freely. The frontend keeps its own copy
 * (frontend/src/spotlightRegions.ts) — keep the slugs identical.
 */
export const SPOTLIGHT_REGIONS = [
  { slug: "africa", name: "Africa" },
  { slug: "asia-pacific", name: "Asia-Pacific" },
  { slug: "europe-central-asia", name: "Europe & Central Asia" },
  { slug: "latin-america-caribbean", name: "Latin America & the Caribbean" },
  { slug: "middle-east", name: "Middle East" },
  { slug: "us-canada", name: "United States & Canada" },
] as const;

export type SpotlightRegionSlug = (typeof SPOTLIGHT_REGIONS)[number]["slug"];

export const SPOTLIGHT_REGION_SLUGS = SPOTLIGHT_REGIONS.map((r) => r.slug) as [SpotlightRegionSlug, ...SpotlightRegionSlug[]];
