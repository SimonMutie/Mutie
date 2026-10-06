import type { CSSProperties } from "react";

/**
 * A dashboard's look.
 *
 * A theme does two things. It re-points the site's own colour variables on
 * the dashboard's container, so every widget on it — the older ones
 * included — takes the new surface, text and border colours. And it gives
 * the visuals in components/viz their series colours as plain values (not
 * CSS variables), so a downloaded image comes out the same as the screen.
 *
 * The series colours are fixed, ordered sets checked for colour-blind
 * separation and for contrast against the theme's panel colour
 * (dataviz/validate_palette). Where a hue is light against the surface the
 * visuals carry labels and a table view.
 */
export interface DashTheme {
  key: string;
  name: string;
  /** One line, shown in the picker. */
  blurb: string;
  dark: boolean;
  /** Overrides for the site's CSS variables; empty for the default look. */
  vars: Record<string, string>;
  /** The page behind the panels, and the panels themselves. */
  page: string;
  surface: string;
  ink: string;
  muted: string;
  faint: string;
  grid: string;
  accent: string;
  /** Series colours, in the order they are handed out. */
  palette: string[];
  /** "Everything else", and marks that carry no series of their own. */
  neutral: string;
  /** The deep end of the single-hue ramp used for shading by value. */
  ramp: string;
  good: string;
  bad: string;
}

const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

export const THEMES: DashTheme[] = [
  {
    key: "classic",
    name: "Classic",
    blurb: "The look the site has now.",
    dark: false,
    vars: {},
    page: "#f4f6f9",
    surface: "#ffffff",
    ink: "#131722",
    muted: "#5b6577",
    faint: "#8892a3",
    grid: "#e6eaf1",
    accent: "#0d9488",
    palette: LIGHT,
    neutral: "#a9b1bf",
    ramp: "#1c5cab",
    good: "#17924f",
    bad: "#d1352b",
  },
  {
    key: "situation",
    name: "Situation room",
    blurb: "Dark, for a wall screen or a late briefing. Echoes Live Intel.",
    dark: true,
    vars: {
      "--base": "#0a121d",
      "--panel": "#101c2b",
      "--panel-raised": "#172638",
      "--panel-hover": "#1e3147",
      "--border": "#2a3f57",
      "--border-soft": "#1f3146",
      "--text-primary": "#e9eff6",
      "--text-muted": "#a3b3c6",
      "--text-faint": "#74879c",
      "--signal": "#d4af37",
      "--signal-dim": "#3a3215",
      "--info": "#6ea8ff",
      "--critical": "#ff7b72",
      "--positive": "#4fc98a",
      "--elevated": "#e3a548",
    },
    page: "#0a121d",
    surface: "#101c2b",
    ink: "#e9eff6",
    muted: "#a3b3c6",
    faint: "#74879c",
    grid: "#1f3146",
    accent: "#d4af37",
    palette: DARK,
    neutral: "#5d6f84",
    ramp: "#6fb0ff",
    good: "#4fc98a",
    bad: "#ff7b72",
  },
  {
    key: "report",
    name: "Report",
    blurb: "White and flat, made to be pasted into a written brief.",
    dark: false,
    vars: {
      "--base": "#ffffff",
      "--panel": "#ffffff",
      "--panel-raised": "#f3f5f8",
      "--panel-hover": "#e9edf2",
      "--border": "#c9d1dc",
      "--border-soft": "#d9dfe8",
      "--text-primary": "#0f1620",
      "--text-muted": "#4a5567",
      "--text-faint": "#7a8597",
    },
    page: "#ffffff",
    surface: "#ffffff",
    ink: "#0f1620",
    muted: "#4a5567",
    faint: "#7a8597",
    grid: "#e3e8ef",
    accent: "#0b6b63",
    palette: LIGHT,
    neutral: "#a9b1bf",
    ramp: "#0b6b63",
    good: "#17924f",
    bad: "#c62f26",
  },
  {
    key: "atlas",
    name: "Atlas",
    blurb: "Map-room colours: river blue, clay, forest and ochre on pale paper.",
    dark: false,
    vars: {
      "--base": "#e9eeea",
      "--panel": "#fbfcfa",
      "--panel-raised": "#eef2ee",
      "--panel-hover": "#e2e9e3",
      "--border": "#cfd9d1",
      "--border-soft": "#dde5de",
      "--text-primary": "#1b2a22",
      "--text-muted": "#51625a",
      "--text-faint": "#7f8f87",
      "--signal": "#2c6e51",
      "--signal-dim": "#d5e8dd",
    },
    page: "#e9eeea",
    surface: "#fbfcfa",
    ink: "#1b2a22",
    muted: "#51625a",
    faint: "#7f8f87",
    grid: "#dde5de",
    accent: "#2c6e51",
    palette: ["#2f7fb8", "#c8642c", "#2f9a6a", "#c99700", "#b85c8e", "#5d7f1e", "#6957b5", "#cf4f4a"],
    neutral: "#a3b0a8",
    ramp: "#1f5f8f",
    good: "#2c7a4f",
    bad: "#b8403b",
  },
];

export const themeFor = (key: string | null | undefined): DashTheme => THEMES.find((t) => t.key === key) ?? THEMES[0];

/** The inline style that applies a theme to a dashboard's container. */
export function themeStyle(theme: DashTheme): CSSProperties {
  return {
    ...(theme.vars as CSSProperties),
    background: theme.vars["--base"] ? theme.page : undefined,
    color: theme.vars["--text-primary"] ? theme.ink : undefined,
    colorScheme: theme.dark ? "dark" : undefined,
  };
}

/** The colour of series number i; past the end of the set, the neutral. */
export const seriesColor = (theme: DashTheme, i: number) => (i < theme.palette.length ? theme.palette[i] : theme.neutral);
