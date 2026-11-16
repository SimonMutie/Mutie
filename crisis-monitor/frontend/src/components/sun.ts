/**
 * Where the sun is, for reading shadows in imagery and footage. Pure functions.
 * The formulas are the standard low-precision solar position ones (good to about a third of a degree),
 * which is far finer than a shadow can be measured on a photo.
 */
const RAD = Math.PI / 180;
const OBLIQUITY = 23.4397 * RAD;

export interface SunPosition {
  /** Degrees clockwise from north to the sun. */
  azimuth: number;
  /** Degrees above the horizon. Negative at night. */
  elevation: number;
}

export function sunPosition(when: Date, lat: number, lng: number): SunPosition {
  const d = when.getTime() / 86_400_000 - 0.5 + 2440588 - 2451545;
  const m = RAD * (357.5291 + 0.98560028 * d);
  const c = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const l = m + c + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(l) * Math.sin(OBLIQUITY));
  const ra = Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY), Math.cos(l));
  const phi = lat * RAD;
  const h = RAD * (280.16 + 360.9856235 * d) + lng * RAD - ra;
  const fromSouth = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h));
  return { azimuth: (((fromSouth / RAD + 180) % 360) + 360) % 360, elevation: elevation / RAD };
}

export interface ShadowReading extends SunPosition {
  /** Degrees clockwise from north that a shadow points. Null when the sun is down. */
  shadowBearing: number | null;
  /** Shadow length for each unit of height. Null when the sun is down. */
  shadowPerHeight: number | null;
}

export function shadowReading(when: Date, lat: number, lng: number): ShadowReading {
  const sun = sunPosition(when, lat, lng);
  if (sun.elevation <= 0.5) return { ...sun, shadowBearing: null, shadowPerHeight: null };
  return { ...sun, shadowBearing: (sun.azimuth + 180) % 360, shadowPerHeight: 1 / Math.tan(sun.elevation * RAD) };
}

/** Whole-hour offset from UTC that mean solar time gives at a longitude (East Africa: +3). */
export function solarUtcOffset(lng: number): number {
  return Math.round(lng / 15);
}

/** The instant for a calendar day and a clock time at a whole-hour UTC offset. */
export function instantAt(day: string, time: string, utcOffsetHours: number): Date {
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.parse(`${day}T00:00:00Z`) + ((hh || 0) * 60 + (mm || 0) - utcOffsetHours * 60) * 60_000);
}

/** A point a given distance and bearing from another, on a sphere. */
export function destination(lat: number, lng: number, bearingDeg: number, metres: number): { lat: number; lng: number } {
  const delta = metres / 6_371_008.8;
  const theta = bearingDeg * RAD;
  const phi1 = lat * RAD;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lam2 = lng * RAD + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return { lat: phi2 / RAD, lng: ((lam2 / RAD + 540) % 360) - 180 };
}
