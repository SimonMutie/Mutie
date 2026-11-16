import type { CSSProperties } from "react";

/**
 * Daily satellite imagery from NASA GIBS (free, no key): true colour, shortwave infrared, burn scan and night lights.
 * Every layer is a daily image, so it can be shown for the day on the fire timeline, for a chosen day, and through a
 * before/after lens that compares two days.
 *
 * These are 250 to 500 m images. They show smoke plumes, burn scars, floods and lights going out, not buildings.
 */
export type ImageryKey = "none" | "true" | "swir" | "burn" | "night";
export const IMAGERY_KEYS: ImageryKey[] = ["none", "true", "swir", "burn", "night"];

export const IMAGERY_LABELS: Record<ImageryKey, string> = {
  none: "Imagery off",
  true: "True colour",
  swir: "SWIR",
  burn: "Burn scan",
  night: "Night lights",
};

/** The day the current fighting is dated from; the day before is the "before" picture. */
export const FIGHTING_START = "2026-09-22";
export const BEFORE_FIGHTING = "2026-09-21";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The newest day that is normally fully processed: yesterday (UTC). */
export function latestImageryDay(now: number = Date.now()): string {
  return iso(now - DAY);
}

/** Keeps a requested day inside what GIBS can serve. */
export function clampImageryDay(day: string | null | undefined, now: number = Date.now()): string {
  const latest = latestImageryDay(now);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return latest;
  return day > latest ? latest : day;
}

export function sameDayLastYear(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return iso(d.getTime());
}

export interface ImageryTemplate {
  url: string;
  maxNativeZoom: number;
  attribution: string;
  /** What to look for, shown under the control. */
  hint: string;
}

/** Tile template for an overlay on a given day, or null when it is off. */
export function imageryTemplate(key: ImageryKey, day?: string | null): ImageryTemplate | null {
  const date = clampImageryDay(day);
  const base = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
  if (key === "true") {
    return {
      url: `${base}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      maxNativeZoom: 9,
      attribution: "True colour: NASA GIBS, NOAA-20 VIIRS",
      hint: "As the eye would see it, about 13:30 local. Smoke is grey-blue, cloud is white.",
    };
  }
  if (key === "swir") {
    return {
      url: `${base}/VIIRS_NOAA20_CorrectedReflectance_BandsM11-I2-I1/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      maxNativeZoom: 9,
      attribution: "SWIR: NASA GIBS, NOAA-20 VIIRS bands M11-I2-I1",
      hint: "Shortwave infrared sees through thin smoke. Active fire is bright red-orange, fresh burn is dark red-brown, plants are green.",
    };
  }
  if (key === "burn") {
    return {
      url: `${base}/MODIS_Terra_CorrectedReflectance_Bands721/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      maxNativeZoom: 9,
      attribution: "Burn scan: NASA GIBS, MODIS Terra bands 7-2-1",
      hint: "Burn scars show dark red-brown, about 10:30 local.",
    };
  }
  if (key === "night") {
    return {
      url: `${base}/VIIRS_NOAA20_DayNightBand_ENCC/default/${date}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
      maxNativeZoom: 8,
      attribution: "Night lights: NASA GIBS, NOAA-20 VIIRS",
      hint: "About 01:30 local. Not corrected for moonlight or cloud, so compare several nights before reading a blackout.",
    };
  }
  return null;
}

export type CompareMode = "before" | "lastYear" | "chosen";
export const LENS_RADII_KM = [5, 10, 15, 25, 50, 100];

/** The day the before/after lens shows, for a comparison mode. */
export function compareDay(mode: CompareMode, mainDay: string, chosen: string): string {
  if (mode === "before") return BEFORE_FIGHTING;
  if (mode === "lastYear") return sameDayLastYear(mainDay);
  return clampImageryDay(chosen);
}

const cell: CSSProperties = {
  padding: "4px 9px",
  fontSize: 11,
  fontFamily: "inherit",
  cursor: "pointer",
  color: "#e6edf7",
  border: "1px solid rgba(255,255,255,0.12)",
  whiteSpace: "nowrap",
};
const on = "rgba(255,122,26,0.35)";
const off = "rgba(8, 14, 24, 0.82)";
const field: CSSProperties = { ...cell, background: off, borderRadius: 6, cursor: "auto", colorScheme: "dark" };

export interface ImageryState {
  key: ImageryKey;
  /** null follows the day on the fire timeline (or the latest day when there is none). */
  day: string | null;
  lensKm: number | null;
  compare: CompareMode;
  compareChosen: string;
}

export const DEFAULT_IMAGERY: ImageryState = { key: "none", day: null, lensKm: null, compare: "before", compareChosen: BEFORE_FIGHTING };

/** Layer buttons, the day shown, and the before/after lens settings. */
export function ImageryControl({ value, onChange, shownDay }: { value: ImageryState; onChange: (s: ImageryState) => void; shownDay: string }) {
  const set = (patch: Partial<ImageryState>) => onChange({ ...value, ...patch });
  const template = imageryTemplate(value.key, shownDay);
  const lensDay = compareDay(value.compare, shownDay, value.compareChosen);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <div role="group" aria-label="Satellite imagery overlay" style={{ display: "flex" }}>
        {IMAGERY_KEYS.map((k, i) => (
          <button
            key={k}
            onClick={() => set({ key: k })}
            aria-pressed={value.key === k}
            style={{ ...cell, background: value.key === k ? on : off, borderRadius: i === 0 ? "6px 0 0 6px" : i === IMAGERY_KEYS.length - 1 ? "0 6px 6px 0" : 0, marginLeft: i === 0 ? 0 : -1 }}
          >
            {IMAGERY_LABELS[k]}
          </button>
        ))}
      </div>
      {template && (
        <>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ ...field, display: "flex", gap: 6, alignItems: "center" }}>
              Image day
              <input
                type="date"
                value={shownDay}
                max={latestImageryDay()}
                min="2018-01-05"
                onChange={(e) => set({ day: e.target.value || null })}
                style={{ background: "transparent", color: "inherit", border: 0, fontFamily: "inherit", fontSize: 11, colorScheme: "dark" }}
              />
            </label>
            {value.day !== null && (
              <button onClick={() => set({ day: null })} style={{ ...cell, background: off, borderRadius: 6 }} title="Go back to the day selected on the fire timeline">
                Follow timeline
              </button>
            )}
            <label style={{ ...field, display: "flex", gap: 6, alignItems: "center" }}>
              Before/after lens
              <select
                value={value.lensKm ?? ""}
                onChange={(e) => set({ lensKm: e.target.value ? Number(e.target.value) : null })}
                style={{ background: "#0b1422", color: "inherit", border: 0, fontFamily: "inherit", fontSize: 11 }}
              >
                <option value="">Off</option>
                {LENS_RADII_KM.map((km) => (
                  <option key={km} value={km}>{km} km</option>
                ))}
              </select>
            </label>
            {value.lensKm !== null && (
              <>
                <label style={{ ...field, display: "flex", gap: 6, alignItems: "center" }}>
                  Lens shows
                  <select
                    value={value.compare}
                    onChange={(e) => set({ compare: e.target.value as CompareMode })}
                    style={{ background: "#0b1422", color: "inherit", border: 0, fontFamily: "inherit", fontSize: 11 }}
                  >
                    <option value="before">Before the fighting (21 Sept)</option>
                    <option value="lastYear">Same day last year</option>
                    <option value="chosen">A date I choose</option>
                  </select>
                </label>
                {value.compare === "chosen" && (
                  <input
                    type="date"
                    aria-label="Lens date"
                    value={value.compareChosen}
                    max={latestImageryDay()}
                    min="2018-01-05"
                    onChange={(e) => set({ compareChosen: e.target.value || BEFORE_FIGHTING })}
                    style={{ ...field, colorScheme: "dark" }}
                  />
                )}
              </>
            )}
          </div>
          <div style={{ ...field, cursor: "default", whiteSpace: "normal", maxWidth: 460, lineHeight: 1.45, fontSize: 10.5, opacity: 0.92 }}>
            {template.hint}
            {value.lensKm !== null && <> Inside the circle: {lensDay}. Outside: {shownDay}.</>}
            {value.lensKm !== null && value.lensKm < 15 && <> At this size the lens covers only a few dozen image pixels: good for a burn scar or a 100 m smoke column, not for a building.</>}
          </div>
        </>
      )}
    </div>
  );
}
