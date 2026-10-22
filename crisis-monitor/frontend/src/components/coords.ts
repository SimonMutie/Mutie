/** Coordinate formats for the map's readouts. Pure functions, so they are easy to check. */

/** Decimal degrees, five places (about 1 m). */
export function toDecimal(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** One value as degrees, minutes and seconds with a hemisphere letter, e.g. 4°03′04.5″N. */
export function toDmsPart(value: number, positive: string, negative: string): string {
  const hemi = value >= 0 ? positive : negative;
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let min = Math.floor((abs - deg) * 60);
  let sec = Math.round(((abs - deg) * 60 - min) * 60 * 10) / 10;
  if (sec >= 60) { sec = 0; min += 1; }
  if (min >= 60) { min = 0; deg += 1; }
  return `${deg}°${String(min).padStart(2, "0")}′${sec.toFixed(1).padStart(4, "0")}″${hemi}`;
}

export function toDms(lat: number, lng: number): string {
  return `${toDmsPart(lat, "N", "S")} ${toDmsPart(lng, "E", "W")}`;
}

/** Reads "lat, lng" in decimal degrees, as typed or pasted. Returns null when the text is not that. */
export function parseDecimal(text: string): { lat: number; lng: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Great-circle bearing from one point to another, in degrees clockwise from north. */
export function bearingDeg(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRad = Math.PI / 180;
  const φ1 = from.lat * toRad;
  const φ2 = to.lat * toRad;
  const Δλ = (to.lng - from.lng) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / toRad) + 360) % 360;
}
