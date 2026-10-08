/** The Live OSINT look (dark glass, gold accents), shared by the Map Studio panel and toolbar. */
export const HUD = {
  bgPanel: "rgba(8, 10, 20, 0.92)",
  border: "rgba(212, 175, 55, 0.15)",
  borderStrong: "rgba(212, 175, 55, 0.35)",
  gold: "#D4AF37",
  goldLight: "#F0D060",
  cyan: "#00E5FF",
  text: "#E8E6E0",
  textSecondary: "#9B978E",
  textMuted: "#5C5A54",
  red: "#FF3D3D",
  green: "#00E676",
} as const;

export const glass = (extra?: React.CSSProperties): React.CSSProperties => ({
  background: HUD.bgPanel,
  backdropFilter: "blur(24px) saturate(1.3)",
  WebkitBackdropFilter: "blur(24px) saturate(1.3)",
  border: `1px solid ${HUD.border}`,
  borderRadius: 14,
  boxShadow: "0 4px 30px rgba(0,0,0,0.5), 0 1px 0 rgba(212,175,55,0.06) inset",
  ...extra,
});

export const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontSize: 12,
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid rgba(212,175,55,0.2)",
  background: "rgba(0,0,0,0.3)",
  color: HUD.text,
  fontFamily: "inherit",
};

export const SWATCHES = ["#38BDF8", "#22C55E", "#EAB308", "#F97316", "#EF4444", "#EC4899", "#A855F7", "#6366F1", "#14B8A6", "#94A3B8", "#F8FAFC", "#0B1B2B"];
export const DASHES: { label: string; value: string | null }[] = [
  { label: "Solid", value: null },
  { label: "Dashed", value: "10 7" },
  { label: "Dotted", value: "2 6" },
  { label: "Dash-dot", value: "12 6 2 6" },
];
