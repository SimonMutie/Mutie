import type { CSSProperties } from "react";

/**
 * One look for every right-rail panel of the live map (Live Alerts, Telegram, Events, AfrIntel and the rest): text
 * colours, filter chips, buttons, inputs, cards and section headings. The accent is the rail's own gold, so an
 * active chip in any panel reads the same as the active tool on the rail.
 */
export const text = "#e6edf7";
export const muted = "#93a1b8";
export const accent = "#D4AF37";
export const line = "1px solid rgba(124,156,255,0.25)";
export const hairline = "1px solid rgba(124,156,255,0.12)";

/** A filter or tab chip. */
export const chip = (on: boolean): CSSProperties => ({
  padding: "4px 10px",
  fontSize: 11,
  fontFamily: "inherit",
  cursor: "pointer",
  color: on ? "#0b1220" : text,
  background: on ? accent : "transparent",
  border: `1px solid ${on ? accent : "rgba(124,156,255,0.25)"}`,
  borderRadius: 6,
  fontWeight: on ? 700 : 400,
});

/** A small coloured label (severity, source bloc, stage). */
export const tag = (c: string): CSSProperties => ({ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", color: c, border: `1px solid ${c}66`, borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap" });

/** The main action. */
export const btn: CSSProperties = { padding: "6px 12px", fontSize: 12, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", color: "#0b1220", background: accent, border: "none", borderRadius: 6 };

/** A secondary action. */
export const ghost: CSSProperties = { padding: "4px 9px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", color: muted, background: "transparent", border: line, borderRadius: 6 };

/** A compact secondary action (Refresh, Locate, Open). */
export const small: CSSProperties = { padding: "2px 7px", fontSize: 10.5, fontFamily: "inherit", cursor: "pointer", color: "#9db4ff", background: "transparent", border: line, borderRadius: 5 };

export const input: CSSProperties = { width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 12, padding: "6px 9px", background: "#0b1422", color: text, border: line, borderRadius: 6 };

export const select: CSSProperties = { fontFamily: "inherit", fontSize: 11, padding: "4px 6px", background: "#0b1422", color: text, border: line, borderRadius: 6 };

export const card: CSSProperties = { border: "1px solid rgba(124,156,255,0.18)", borderRadius: 8, padding: "9px 10px", background: "rgba(11,20,34,0.6)" };

/** A section heading inside a panel. */
export const heading: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: muted, margin: "2px 0 6px" };

/** The note at the foot of a panel (sources, caveats). */
export const footnote: CSSProperties = { color: muted, fontSize: 10.5, lineHeight: 1.45 };
