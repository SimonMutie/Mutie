import type { RptStyle, RptTheme } from "../api";

/**
 * Afrilens report themes. Each one is a complete palette, so a page, its PDF,
 * its Word file and its slide read as one design. The tokens are applied as CSS
 * variables on the report and read by the exporters as plain hex values.
 */
export interface Palette {
  name: string;
  blurb: string;
  paper: string;
  ink: string;
  muted: string;
  faint: string;
  rule: string;
  card: string;
  /** Header and footer band. */
  band: string;
  bandInk: string;
  accent: string;
  accent2: string;
  accent3: string;
}

export const THEMES: Record<RptTheme, Palette> = {
  lens: {
    name: "Lens",
    blurb: "Paper and navy, teal and blue from the mark",
    paper: "#fbfbf8",
    ink: "#0f1b2d",
    muted: "#4b5565",
    faint: "#6f7a8c",
    rule: "#d9dee7",
    card: "#f1f4f7",
    band: "#0f1b2d",
    bandInk: "#f4f6f9",
    accent: "#0d9488",
    accent2: "#2f66f0",
    accent3: "#e07a1f",
  },
  dusk: {
    name: "Dusk",
    blurb: "Night-mode briefing, for screens and rooms",
    paper: "#0b1622",
    ink: "#e8eef6",
    muted: "#a7b4c4",
    faint: "#7a8a9e",
    rule: "#23364d",
    card: "#11243a",
    band: "#06101a",
    bandInk: "#e8eef6",
    accent: "#2dd4bf",
    accent2: "#60a5fa",
    accent3: "#f0abfc",
  },
  sand: {
    name: "Sand",
    blurb: "Warm paper for printed field notes",
    paper: "#f7f1e6",
    ink: "#2b2118",
    muted: "#6b5a48",
    faint: "#8f7f6c",
    rule: "#e0d3bd",
    card: "#efe6d4",
    band: "#2b2118",
    bandInk: "#f7f1e6",
    accent: "#b45309",
    accent2: "#0f766e",
    accent3: "#7c3aed",
  },
};

export const THEME_ORDER: RptTheme[] = ["lens", "dusk", "sand"];

/** The palette as CSS variables, for the page's inline style. */
export function themeVars(t: RptTheme): Record<string, string> {
  const p = THEMES[t];
  return {
    "--rp-paper": p.paper,
    "--rp-ink": p.ink,
    "--rp-muted": p.muted,
    "--rp-faint": p.faint,
    "--rp-rule": p.rule,
    "--rp-card": p.card,
    "--rp-band": p.band,
    "--rp-band-ink": p.bandInk,
    "--rp-accent": p.accent,
    "--rp-accent2": p.accent2,
    "--rp-accent3": p.accent3,
    // The app's own tokens follow the page, so charts and cards inside it read in the chosen theme.
    "--text-primary": p.ink,
    "--text-muted": p.muted,
    "--text-faint": p.faint,
    "--panel": p.paper,
    "--panel-raised": p.card,
    "--border": p.rule,
    "--bg": p.card,
  };
}

export const FONT_CSS = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: "Arial, Helvetica, sans-serif",
  mono: "'Courier New', Courier, monospace",
} as const;

/** The same faces by name, for Word and PowerPoint. */
export const FONT_FILE = { serif: "Georgia", sans: "Arial", mono: "Courier New" } as const;

/** Size steps: multiplier for the page, and points for the files. */
export const SIZE_SCALE = { s: 0.9, m: 1, l: 1.12, xl: 1.28 } as const;
export const SIZE_PT = { s: 10.5, m: 12, l: 13.5, xl: 16 } as const;
export const SIZE_PPT = { s: 14, m: 16, l: 19, xl: 22 } as const;

/** Resolved style for a section, with defaults applied. */
export function resolveStyle(s?: RptStyle) {
  return {
    font: (s?.font ?? "sans") as keyof typeof FONT_CSS,
    size: (s?.size ?? "m") as keyof typeof SIZE_SCALE,
    align: (s?.align ?? "left") as "left" | "center" | "right" | "justify",
  };
}
