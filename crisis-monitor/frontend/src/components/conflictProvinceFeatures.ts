import type { FeatureCollection } from "geojson";
import type { ConflictProvince } from "../api";
import { intensityTooltip } from "./conflictIntensity";

/**
 * Provinces with an escalation, as outlines drawn over the country shading. The API gives rings as [lat, lon];
 * GeoJSON wants [lon, lat].
 */
export function provinceFeatures(provinces: ConflictProvince[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: provinces.map((p) => ({
      type: "Feature",
      id: p.id,
      properties: { intensity: p.intensity, label: intensityTooltip(p) },
      geometry: { type: "MultiPolygon", coordinates: p.rings.map((r) => [r.map(([lat, lon]) => [lon, lat])]) },
    })),
  };
}

/** Stable key that changes whenever the province shading does. */
export function provinceShadingKey(fc: FeatureCollection): string {
  return fc.features.map((f) => `${f.id}${(f.properties as { intensity?: number })?.intensity ?? 0}`).join("|");
}
