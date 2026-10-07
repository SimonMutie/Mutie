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
  /** The face for the small print on charts, and the one for big figures and headings. */
  font: string;
  display: string;
}

export const FONT = "Inter, system-ui, sans-serif";
export const DISPLAY = '"Space Grotesk", Inter, system-ui, sans-serif';

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
    font: FONT,
    display: DISPLAY,
  },
  {
    key: "situation",
    name: "Situation room",
    blurb: "Dark, for a wall screen or a late briefing. Echoes Live OSINT.",
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
    font: FONT,
    display: DISPLAY,
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
    font: FONT,
    display: DISPLAY,
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
    font: FONT,
    display: DISPLAY,
  },
  {
    key: "blueprint",
    name: "Blueprint",
    blurb: "Engineering-drawing blue, fine lines and a typewriter face.",
    dark: true,
    vars: {
      "--base": "#0a1d33",
      "--panel": "#0f2742",
      "--panel-raised": "#163353",
      "--panel-hover": "#1d4068",
      "--border": "#3a628e",
      "--border-soft": "#274a72",
      "--text-primary": "#eaf3fb",
      "--text-muted": "#a9c3dc",
      "--text-faint": "#7a9abb",
      "--signal": "#7fd4ff",
      "--signal-dim": "#173f5f",
      "--info": "#8ec5ff",
      "--critical": "#ff8a80",
      "--positive": "#62d6a0",
      "--elevated": "#f0b458",
    },
    page: "#0a1d33",
    surface: "#0f2742",
    ink: "#eaf3fb",
    muted: "#a9c3dc",
    faint: "#7a9abb",
    grid: "#274a72",
    accent: "#7fd4ff",
    palette: DARK,
    neutral: "#6583a3",
    ramp: "#8fd3ff",
    good: "#62d6a0",
    bad: "#ff8a80",
    font: '"JetBrains Mono", ui-monospace, monospace',
    display: '"JetBrains Mono", ui-monospace, monospace',
  },
  {
    key: "editorial",
    name: "Editorial",
    blurb: "A magazine page: serif headlines, a red accent, no boxes.",
    dark: false,
    vars: {
      "--base": "#fbfbfa",
      "--panel": "#fbfbfa",
      "--panel-raised": "#f0f0ee",
      "--panel-hover": "#e6e6e3",
      "--border": "#cfcfca",
      "--border-soft": "#dededa",
      "--text-primary": "#141414",
      "--text-muted": "#4d4d4a",
      "--text-faint": "#83837e",
      "--signal": "#c8102e",
      "--signal-dim": "#fbe3e7",
    },
    page: "#fbfbfa",
    surface: "#fbfbfa",
    ink: "#141414",
    muted: "#4d4d4a",
    faint: "#83837e",
    grid: "#e2e2de",
    accent: "#c8102e",
    palette: ["#c8102e", "#1f6fb5", "#e08a00", "#17937a", "#7a52b3", "#d4577f", "#4f7d1c", "#2aa7c9"],
    neutral: "#a8a8a2",
    ramp: "#a50d26",
    good: "#17804f",
    bad: "#c8102e",
    font: FONT,
    display: '"Source Serif 4", Georgia, "Times New Roman", serif',
  },
  {
    key: "dusk",
    name: "Dusk",
    blurb: "Deep plum with a warm glow. Dark, but softer than Situation room.",
    dark: true,
    vars: {
      "--base": "#16111f",
      "--panel": "#231b30",
      "--panel-raised": "#2e2440",
      "--panel-hover": "#3a2e50",
      "--border": "#4a3d63",
      "--border-soft": "#372c4c",
      "--text-primary": "#f3eef8",
      "--text-muted": "#bcb0cf",
      "--text-faint": "#8d80a3",
      "--signal": "#ff9e7a",
      "--signal-dim": "#4a2a2a",
      "--info": "#9db8ff",
      "--critical": "#ff7f8e",
      "--positive": "#5fd3a2",
      "--elevated": "#f2b866",
    },
    page: "#16111f",
    surface: "#231b30",
    ink: "#f3eef8",
    muted: "#bcb0cf",
    faint: "#8d80a3",
    grid: "#372c4c",
    accent: "#ff9e7a",
    palette: DARK,
    neutral: "#75698c",
    ramp: "#ffab8a",
    good: "#5fd3a2",
    bad: "#ff7f8e",
    font: FONT,
    display: DISPLAY,
  },
  {
    key: "projector",
    name: "Projector",
    blurb: "Maximum contrast: black on white, strong outlines, deeper colours. For a bright room or a poor screen.",
    dark: false,
    vars: {
      "--base": "#ffffff",
      "--panel": "#ffffff",
      "--panel-raised": "#f0f0f0",
      "--panel-hover": "#e2e2e2",
      "--border": "#111111",
      "--border-soft": "#111111",
      "--text-primary": "#000000",
      "--text-muted": "#262626",
      "--text-faint": "#555555",
      "--signal": "#0b5c56",
      "--signal-dim": "#d7efec",
    },
    page: "#ffffff",
    surface: "#ffffff",
    ink: "#000000",
    muted: "#262626",
    faint: "#555555",
    grid: "#cfcfcf",
    accent: "#0b5c56",
    palette: ["#1f5fbf", "#c8501a", "#0e8a5f", "#a67400", "#c2477f", "#2e7d00", "#4a3aa7", "#c9302c"],
    neutral: "#8a8a8a",
    ramp: "#0b3f8a",
    good: "#0e7a3f",
    bad: "#b3261e",
    font: FONT,
    display: DISPLAY,
  },
  {
    key: "soft",
    name: "Soft",
    blurb: "Rounded cards on a lavender wash. Friendly, for a public audience.",
    dark: false,
    vars: {
      "--base": "#f1eefb",
      "--panel": "#ffffff",
      "--panel-raised": "#f4f1fc",
      "--panel-hover": "#e9e4f8",
      "--border": "#dcd5f0",
      "--border-soft": "#e8e3f6",
      "--text-primary": "#231f33",
      "--text-muted": "#5f5975",
      "--text-faint": "#8f89a6",
      "--signal": "#6b4fd8",
      "--signal-dim": "#e6dffb",
    },
    page: "#f1eefb",
    surface: "#ffffff",
    ink: "#231f33",
    muted: "#5f5975",
    faint: "#8f89a6",
    grid: "#ebe7f6",
    accent: "#6b4fd8",
    palette: LIGHT,
    neutral: "#aaa5bd",
    ramp: "#5239b8",
    good: "#17924f",
    bad: "#d1352b",
    font: FONT,
    display: DISPLAY,
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
