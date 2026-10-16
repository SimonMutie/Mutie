import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection } from "geojson";
import type { ActiveCountry, ConflictCountry } from "../api";
import { ID_TO_ISO2 } from "../data/countryIso";
import { ACTIVE_INTENSITY_STYLE, INTENSITY_STYLE, intensityTooltip } from "./conflictIntensity";

/**
 * Whole-country shading for the conflict map, the way a conflict tracker codes countries: every country is drawn,
 * the ones with an escalation in the last 48 hours take their intensity colour, and the rest stay neutral.
 * Intensity 0 means no escalation.
 */

/** 0 neither; 1-4 an alert escalation (intensity 1-4); 5-8 active conflict from UCDP (level 1-4, stored as 4 more).
 *  Where a country has both, the alert value is used. */
export type CountryIntensity = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

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

/** Alert shading: joins the outlines to the backend's escalation codes; countries not in the list are neutral. */
export function countryFeatures(world: FeatureCollection, flagged: ConflictCountry[]): FeatureCollection {
  const byCode = new Map(flagged.map((c) => [c.code, c]));
  return {
    type: "FeatureCollection",
    features: world.features.map((f) => {
      const iso2 = ID_TO_ISO2[String(f.id)] ?? "";
      const name = String(f.properties?.name ?? iso2);
      const c = byCode.get(iso2);
      const props: CountryFeatureProps = c
        ? { iso2, name: c.name || name, intensity: c.intensity, label: intensityTooltip({ name: c.name || name, intensity: c.intensity, counts: c.counts, trend: c.trend }) }
        : { iso2, name, intensity: 0, label: `${name}: no escalation in the last 48 hours` };
      return { type: "Feature", id: f.id, geometry: f.geometry, properties: props as unknown as Record<string, unknown> };
    }),
  };
}

/** Active-conflict shading (UCDP, 90 days), graded 5-8. Only countries with no alert are included: an alert
 *  takes precedence, so the two layers never overlap. Countries not active are left out entirely. */
export function activeCountryFeatures(world: FeatureCollection, active: ActiveCountry[], alertCodes: Set<string>): FeatureCollection {
  const byCode = new Map(active.map((a) => [a.code, a]));
  const features: FeatureCollection["features"] = [];
  for (const f of world.features) {
    const iso2 = ID_TO_ISO2[String(f.id)] ?? "";
    const a = byCode.get(iso2);
    if (!a || alertCodes.has(iso2)) continue;
    const name = String(f.properties?.name ?? iso2);
    const props: CountryFeatureProps = {
      iso2,
      name: name,
      intensity: (4 + a.intensity) as CountryIntensity,
      label: `${name}: active conflict, ${a.intensityLabel.toLowerCase()} (${a.events} UCDP events, ${a.fatalities} killed in the last 90 days)`,
    };
    features.push({ type: "Feature", id: f.id, geometry: f.geometry, properties: props as unknown as Record<string, unknown> });
  }
  return { type: "FeatureCollection", features };
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
  if (intensity >= 5) {
    const s = ACTIVE_INTENSITY_STYLE[(intensity - 4) as 1 | 2 | 3 | 4];
    return { color: s.line, weight: 1.2, opacity: s.lineOpacity, fillColor: s.fill, fillOpacity: s.opacity };
  }
  const s = INTENSITY_STYLE[intensity as 1 | 2 | 3 | 4];
  return { color: s.line, weight: intensity >= 3 ? 1.8 : 1.2, opacity: s.lineOpacity, fillColor: s.fill, fillOpacity: s.opacity };
}
