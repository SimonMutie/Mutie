/** A small plane silhouette pointing north, for aircraft markers on both maps. Rotate it by the aircraft's heading. */
export const PLANE_PATH = "M12 1.5c.7 0 1.1.6 1.1 1.4v6l8.4 4.9v2.1l-8.4-2.6v5.3l2.6 1.9v1.8L12 21.3l-3.7 1v-1.8l2.6-1.9v-5.3l-8.4 2.6v-2.1l8.4-4.9v-6c0-.8.4-1.4 1.1-1.4z";

export function planeSvg(color: string, size = 16): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${PLANE_PATH}" fill="${color}" stroke="rgba(0,0,0,0.7)" stroke-width="1"/></svg>`;
}

/** Layer keys whose points are aircraft. */
export const AIRCRAFT_LAYER_KEYS = new Set(["Commercial Flights", "Private Aircraft", "Private Jets", "Military Aircraft"]);
