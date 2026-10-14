import type { FeatureCollection } from "geojson";
import type { ConflictWave } from "../api";

/** Pulse size in pixels at rest, by the level of the escalation. */
export const WAVE_RADIUS: Record<ConflictWave["level"], number> = { critical: 14, elevated: 10, watch: 7 };

/** Waves as points, for the 3D map. */
export function waveFeatures(waves: ConflictWave[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: waves.map((w) => ({
      type: "Feature",
      id: w.id,
      properties: { r: WAVE_RADIUS[w.level], level: w.level },
      geometry: { type: "Point", coordinates: [w.lon, w.lat] },
    })),
  };
}
