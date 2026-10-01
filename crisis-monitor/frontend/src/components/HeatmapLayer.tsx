import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import * as L from "leaflet";
import "leaflet.heat";

/** A preset gradient (stop -> color) handed to leaflet.heat, plus a label for
 *  the picker UI. leaflet.heat's own default gradient already runs
 *  blue→cyan→lime→yellow→red as intensity rises, so "Classic" below just
 *  names that default rather than reinventing it; the others give real,
 *  distinctly different looks while every one of them still ends on red at
 *  the top of the scale, per Simon's "red where intensity is more" ask. */
export const HEATMAP_GRADIENTS: Record<string, { label: string; stops: Record<number, string> }> = {
  // Pale pink at the thin edges → deep red at the core. Paired with a low
  // `fade` (minOpacity) so low-intensity areas actually fade out to
  // transparent rather than painting a solid tint over the basemap.
  redFade: { label: "Red fade (pale → deep red)", stops: { 0.0: "#fee2e2", 0.25: "#fca5a5", 0.5: "#f87171", 0.7: "#ef4444", 0.85: "#dc2626", 1.0: "#7f1d1d" } },
  classic: { label: "Classic (blue → red)", stops: { 0.4: "#2563eb", 0.6: "#22d3ee", 0.75: "#a3e635", 0.9: "#f59e0b", 1.0: "#dc2626" } },
  redOnly: { label: "Amber → Red (subtle low end)", stops: { 0.2: "#fde68a", 0.5: "#f59e0b", 0.75: "#ef4444", 1.0: "#991b1b" } },
  mono: { label: "Monochrome red", stops: { 0.2: "#fecaca", 0.5: "#f87171", 0.75: "#dc2626", 1.0: "#7f1d1d" } },
  violet: { label: "Violet → Red", stops: { 0.3: "#a78bfa", 0.6: "#ec4899", 0.85: "#f97316", 1.0: "#dc2626" } },
};
export type HeatmapGradientKey = keyof typeof HEATMAP_GRADIENTS;

export interface HeatmapStyle {
  /** Px radius of each point's heat contribution — bigger blends points
   *  together into broader hotspots; smaller keeps clusters tighter. */
  radius: number;
  /** Edge softness of each point — higher blurs hotspot boundaries. */
  blur: number;
  /** leaflet.heat normalizes displayed intensity against this value (not
   *  literally the highest point in the data) — lower it to make hotspots
   *  redden faster/with fewer points stacked; raise it to require more
   *  density before red appears. This is the actual "color intensity" dial:
   *  it changes how much counts as "high", not just a cosmetic opacity. */
  max: number;
  gradient: HeatmapGradientKey;
  /** Minimum opacity of any heat at all — low values let sparse/low-casualty
   *  areas fade out to transparent; high values give every point a solid
   *  floor of color. */
  fade: number;
  /** What each incident contributes: "count" = every incident equal (pure
   *  density); "casualties" = fatalities and injuries, weighted below. */
  weighting: "count" | "casualties";
  /** Multiplier on each fatality vs. each injury in "casualties" mode. */
  deathWeight: number;
  injuryWeight: number;
  /** 0–1: how much a no-casualty incident still contributes in "casualties"
   *  mode. 0 = only incidents with fatalities/injuries show at all. */
  baseline: number;
}
export const DEFAULT_HEATMAP_STYLE: HeatmapStyle = {
  radius: 25,
  blur: 20,
  max: 1.5,
  gradient: "redFade",
  fade: 0.05,
  weighting: "casualties",
  deathWeight: 3,
  injuryWeight: 1,
  baseline: 0.15,
};

/** Numeric value from a raw spreadsheet cell — numbers, "12", " 3 " all count. */
function rawNumber(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Minimal shape the casualty helpers need — kept structural so this file
 *  doesn't import IncidentItem from api.ts (DashboardWidgetCard pulls this
 *  file into its own chunk; see the HeatmapLayer comment below). */
export interface HeatIncident {
  latitude?: number | null;
  longitude?: number | null;
  civilian_death_child?: number | null;
  civilian_death_female?: number | null;
  civilian_death_male?: number | null;
  civilian_death_unknown?: number | null;
  civilian_injury_female?: number | null;
  civilian_injury_male?: number | null;
  civilian_injury_unknown?: number | null;
  raw_row?: Record<string, unknown> | null;
}

/** Highest value among raw-row columns whose header matches `pattern` but
 *  isn't one of the civilian breakdown columns — picks up a total
 *  "Fatalities"/"Killed"/"Injuries"/"Wounded" column if the uploaded
 *  spreadsheet had one (combatant + civilian), which the structured
 *  civilian_* columns alone can't represent. */
function rawTotal(raw: Record<string, unknown> | null | undefined, pattern: RegExp): number {
  if (!raw) return 0;
  let best = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (pattern.test(key) && !/civilian/i.test(key)) best = Math.max(best, rawNumber(value));
  }
  return best;
}

export function incidentFatalities(i: HeatIncident): number {
  const civilian = (i.civilian_death_child ?? 0) + (i.civilian_death_female ?? 0) + (i.civilian_death_male ?? 0) + (i.civilian_death_unknown ?? 0);
  return Math.max(civilian, rawTotal(i.raw_row, /fatalit|death|killed/i));
}

export function incidentInjuries(i: HeatIncident): number {
  const civilian = (i.civilian_injury_female ?? 0) + (i.civilian_injury_male ?? 0) + (i.civilian_injury_unknown ?? 0);
  return Math.max(civilian, rawTotal(i.raw_row, /injur|wounded/i));
}

/** Turns incidents into leaflet.heat [lat, lng, weight] points per the
 *  style's weighting. In "casualties" mode each incident's score
 *  (fatalities × deathWeight + injuries × injuryWeight) is log-scaled
 *  against the largest score in the set, so a single mass-casualty event
 *  doesn't wash every other hotspot out to pale pink — overlapping
 *  incidents still stack, so clusters of severe incidents go deepest red. */
export function incidentHeatPoints(incidents: HeatIncident[], style: HeatmapStyle): [number, number, number][] {
  const located = incidents.filter((i) => i.latitude != null && i.longitude != null);
  if (style.weighting === "count") return located.map((i) => [i.latitude!, i.longitude!, 1]);
  const scores = located.map((i) => incidentFatalities(i) * style.deathWeight + incidentInjuries(i) * style.injuryWeight);
  const maxScore = Math.max(0, ...scores);
  const denom = Math.log1p(maxScore) || 1;
  const out: [number, number, number][] = [];
  located.forEach((i, idx) => {
    const w = style.baseline + (1 - style.baseline) * (Math.log1p(scores[idx]) / denom);
    if (w > 0) out.push([i.latitude!, i.longitude!, w]);
  });
  return out;
}

/** Canvas-based heat-density layer, an alternative to plotting individual pins
 *  — useful once there are enough incidents that markers start overlapping and
 *  density becomes the more readable signal. `weighted` (passed in via the
 *  caller's own point weights) uses each incident's total casualties as
 *  intensity (so severe clusters stand out more); off, every incident counts
 *  equally (pure geographic density). `style` exposes the knobs Simon asked
 *  for — adjustable color intensity (via `max`), plus radius/blur/gradient —
 *  rather than the previous fixed radius/blur with no way to change how
 *  quickly a hotspot reads as red.
 *
 *  Deliberately its own file, not part of IncidentsMap.tsx — DashboardWidgetCard.tsx
 *  imports only this one component (for the dashboard's own "map" widget type),
 *  and importing it from IncidentsMap.tsx directly would pull in that file's
 *  entire set of top-level imports (leaflet-draw, shpjs, xlsx, html2canvas,
 *  react-leaflet-cluster) into DashboardWidgetCard's own bundle chunk — code
 *  the dashboard never actually uses, and exactly the kind of unnecessary
 *  shared-chunk bloat the app's route-level code-splitting was built to avoid. */
export function HeatmapLayer({ points, style }: { points: [number, number, number][]; style?: Partial<HeatmapStyle> }) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);
  const resolved: HeatmapStyle = { ...DEFAULT_HEATMAP_STYLE, ...style };

  useEffect(() => {
    const layer = L.heatLayer(points, {
      radius: resolved.radius,
      blur: resolved.blur,
      // leaflet.heat divides every point's weight by 2^(maxZoom − zoom) —
      // with the old maxZoom of 12, at a typical country view (zoom ~6) each
      // incident counted 1/64, so heat stayed pale and the intensity dial
      // barely registered. 0 turns that damping off: a point's heat is its
      // own weight at every zoom, so the intensity/weight controls mean the
      // same thing however far in or out the map is.
      maxZoom: 0,
      minOpacity: resolved.fade,
      max: resolved.max,
      gradient: HEATMAP_GRADIENTS[resolved.gradient].stops,
    });
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, resolved.radius, resolved.blur, resolved.max, resolved.gradient, resolved.fade]);

  useEffect(() => {
    layerRef.current?.setLatLngs(points);
  }, [points]);

  return null;
}
