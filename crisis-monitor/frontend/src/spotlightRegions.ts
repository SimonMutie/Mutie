/** The regions of Regional Spotlight, in menu order. Slugs must match
 *  backend/src/lib/spotlightRegions.ts; names are labels only. */
export const SPOTLIGHT_REGIONS = [
  { slug: "africa", name: "Africa" },
  { slug: "asia-pacific", name: "Asia-Pacific" },
  { slug: "europe-central-asia", name: "Europe & Central Asia" },
  { slug: "latin-america-caribbean", name: "Latin America & the Caribbean" },
  { slug: "middle-east", name: "Middle East" },
  { slug: "us-canada", name: "United States & Canada" },
] as const;

export type SpotlightRegionSlug = (typeof SPOTLIGHT_REGIONS)[number]["slug"];
/** A region, or every region together. */
export type SpotlightScope = SpotlightRegionSlug | "all";

export function spotlightRegionName(slug: string): string {
  return SPOTLIGHT_REGIONS.find((r) => r.slug === slug)?.name ?? slug;
}

/** Offered as suggestions in the editor; any other label can be typed. */
export const SPOTLIGHT_PRODUCT_TYPES = ["Analysis", "Situation Update", "Regional Overview", "Special Report", "Briefing Note", "Forecast", "Infographic", "Data Brief", "Alert"];
