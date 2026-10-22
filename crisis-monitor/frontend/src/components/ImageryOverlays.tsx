import type { CSSProperties } from "react";

/**
 * Night lights and burn scars from NASA's Worldview Snapshots service (GIBS). Both are daily images, so the overlay
 * asks for the day two days back, which is normally already processed. Free, with no key.
 */
export type ImageryKey = "none" | "night" | "burn";

function gibsDate(daysBack: number): string {
  return new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
}

export const IMAGERY_LABELS: Record<Exclude<ImageryKey, "none">, string> = {
  night: "Night lights",
  burn: "Burn scan",
};

/** Tile template for an overlay, or null when it is off. */
export function imageryTemplate(key: ImageryKey): { url: string; maxNativeZoom: number; attribution: string } | null {
  const date = gibsDate(2);
  if (key === "night") {
    return {
      url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_DayNightBand_ENCC/default/${date}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
      maxNativeZoom: 8,
      attribution: "Night lights: NASA GIBS, NOAA-20 VIIRS (about 01:30 local, not corrected for moon or cloud)",
    };
  }
  if (key === "burn") {
    return {
      url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_Bands721/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      maxNativeZoom: 9,
      attribution: "Burn scan: NASA GIBS, MODIS Terra bands 7-2-1 (burn scars show dark red-brown)",
    };
  }
  return null;
}

/** Off / Night lights / Burn scan, placed beside the map's left panel. */
export function ImageryControl({ value, onChange }: { value: ImageryKey; onChange: (k: ImageryKey) => void }) {
  const btn = (k: ImageryKey): CSSProperties => ({
    padding: "4px 9px",
    fontSize: 11,
    fontFamily: "inherit",
    cursor: "pointer",
    color: "#e6edf7",
    background: value === k ? "rgba(255,122,26,0.35)" : "rgba(8, 14, 24, 0.82)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: k === "none" ? "6px 0 0 6px" : k === "burn" ? "0 6px 6px 0" : 0,
    marginLeft: k === "none" ? 0 : -1,
  });
  return (
    <div role="group" aria-label="Satellite imagery overlay" style={{ position: "absolute", top: 10, left: "var(--lens-pad-left, 10px)", zIndex: 500, display: "flex" }}>
      {(["none", "night", "burn"] as ImageryKey[]).map((k) => (
        <button key={k} onClick={() => onChange(k)} aria-pressed={value === k} style={btn(k)}>
          {k === "none" ? "Imagery off" : IMAGERY_LABELS[k]}
        </button>
      ))}
    </div>
  );
}
