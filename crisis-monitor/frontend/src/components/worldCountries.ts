import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection } from "geojson";
import type { ConflictCountry } from "../api";
import { ID_TO_ISO2 } from "../data/countryIso";
import { INTENSITY_STYLE, intensityTooltip } from "./conflictIntensity";

/**
 * Whole-country shading for the conflict map, the way a conflict tracker codes countries: every country is drawn,
 * the ones with an escalation in the last 48 hours take their intensity colour, and the rest stay neutral.
 * Intensity 0 means no escalation.
 */

export type CountryIntensity = 0 | 1 | 2 | 3 | 4;

export interface CountryFeatureProps {
  iso2: string;
  name: string;
  intensity: CountryIntensity;
  label: string;
}

/** Neutral country style, used for countries with no escalation. */
export const NEUTRAL_COUNTRY = { fill: "#7d8aa0", fillOpacity: 0.07, line: "#9aa8bd", lineOpacity: 0.4, lineWidth: 0.5 } as const;

let worldPromise: Promise<FeatureCollection> | null = null;

/** The country outlines, loaded once on first use (about 750 KB, so it is split out of the main bundle). */
export function loadWorldCountries(): Promise<FeatureCollection> {
  if (!worldPromise) {
    worldPromise = import("world-atlas/countries-50m.json").then((m) => {
      const topo = m.default as unknown as Topology;
      const countries = topo.objects.countries as unknown as GeometryCollection;
      return feature(topo, countries) as unknown as FeatureCollection;
    });
  }
  return worldPromise;
}

/** Joins the outlines to the backend's country codes; countries not in the list are neutral. */
export function countryFeatures(world: FeatureCollection, flagged: ConflictCountry[]): FeatureCollection {
  const byCode = new Map(flagged.map((c) => [c.code, c]));
  return {
    type: "FeatureCollection",
    features: world.features.map((f) => {
      const iso2 = ID_TO_ISO2[String(f.id)] ?? "";
      const name = String(f.properties?.name ?? iso2);
      const c = byCode.get(iso2);
      const props: CountryFeatureProps = c
        ? { iso2, name: c.name || name, intensity: c.intensity, label: intensityTooltip({ name: c.name || name, intensity: c.intensity, counts: c.counts }) }
        : { iso2, name, intensity: 0, label: `${name}: no escalation in the last 48 hours` };
      return { type: "Feature", id: f.id, geometry: f.geometry, properties: props as unknown as Record<string, unknown> };
    }),
  };
}

/** Stable key that changes whenever the shading does, so renderers that cannot diff data can redraw. */
export function countryShadingKey(fc: FeatureCollection): string {
  return fc.features
    .filter((f) => ((f.properties as unknown as CountryFeatureProps).intensity ?? 0) > 0)
    .map((f) => `${(f.properties as unknown as CountryFeatureProps).iso2}${(f.properties as unknown as CountryFeatureProps).intensity}`)
    .join("|");
}

/** Leaflet path style for a country. */
export function countryPathStyle(intensity: CountryIntensity) {
  if (intensity === 0) {
    return { color: NEUTRAL_COUNTRY.line, weight: NEUTRAL_COUNTRY.lineWidth, opacity: NEUTRAL_COUNTRY.lineOpacity, fillColor: NEUTRAL_COUNTRY.fill, fillOpacity: NEUTRAL_COUNTRY.fillOpacity };
  }
  const s = INTENSITY_STYLE[intensity];
  return { color: s.line, weight: intensity >= 3 ? 1.8 : 1.2, opacity: s.lineOpacity, fillColor: s.fill, fillOpacity: s.opacity };
}
