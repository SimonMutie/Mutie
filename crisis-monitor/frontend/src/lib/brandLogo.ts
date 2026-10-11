import { THEMES } from "./reportTheme";
import type { RptTheme } from "../api";

/**
 * The Lens mark as a standalone SVG string (the same geometry as
 * components/Logo.tsx), for files that cannot read the app's CSS.
 */
export function logoSvg(signal = "#0d9488", info = "#2f66f0", tile = "#f4f6f9"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">
<rect x="0" y="0" width="40" height="40" rx="9" fill="${tile}"/>
<path d="M3 20 Q11 5.5 20 5.5 Q29 5.5 37 20 Q29 34.5 20 34.5 Q11 34.5 3 20 Z" stroke="${signal}" stroke-width="2.3" stroke-linejoin="round"/>
<circle cx="20" cy="20" r="8.6" stroke="${info}" stroke-width="1.4"/>
<ellipse cx="20" cy="20" rx="3.5" ry="8.6" stroke="${info}" stroke-width="1" opacity="0.6"/>
<path d="M11.4 20H28.6" stroke="${info}" stroke-width="1" opacity="0.6"/>
<path d="M12.7 15.2C15.3 17 24.7 17 27.3 15.2" stroke="${info}" stroke-width="0.85" opacity="0.42"/>
<path d="M12.7 24.8C15.3 23 24.7 23 27.3 24.8" stroke="${info}" stroke-width="0.85" opacity="0.42"/>
<circle cx="20" cy="20" r="3.4" fill="${signal}"/>
<circle cx="18.5" cy="18.5" r="1.05" fill="white" opacity="0.9"/>
</svg>`;
}

/** The mark as a PNG data URL at a given pixel size, for Word and PowerPoint. */
export function logoPng(theme: RptTheme, px = 240): Promise<string> {
  const p = THEMES[theme];
  const svg = logoSvg(p.accent, p.accent2);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = px;
      c.height = px;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("No canvas"));
      ctx.drawImage(img, 0, 0, px, px);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Could not draw the logo"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
