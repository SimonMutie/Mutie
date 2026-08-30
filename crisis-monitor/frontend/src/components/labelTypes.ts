/** The categories a placed globe label can represent — each gets its own
 *  distinct symbol and default color so they're visually distinguishable at
 *  a glance, the same design principle as the tactic icons on the 2D
 *  incidents map. Deliberately its own file, separate from GlobeWidget.tsx:
 *  that file imports Three.js and react-globe.gl at the top, both lazy-
 *  loaded specifically so a dashboard without any globe widget never pays
 *  for that weight. A static import of this metadata from GlobeWidget.tsx
 *  directly would drag that whole dependency chain into the main bundle
 *  regardless, defeating the lazy-load entirely — this file has none of
 *  those dependencies, so it's safe to import anywhere. */
export type LabelType =
  | "checkpoint"
  | "chokepoint"
  | "port"
  | "airport"
  | "military"
  | "school"
  | "health"
  | "government"
  | "town"
  | "dam"
  | "investment"
  | "border_point"
  | "other";

export const LABEL_TYPE_META: Record<LabelType, { symbol: string; color: string; name: string }> = {
  checkpoint: { symbol: "🚧", color: "#d97706", name: "Checkpoint" },
  chokepoint: { symbol: "⚠", color: "#dc2626", name: "Chokepoint" },
  port: { symbol: "⚓", color: "#0891b2", name: "Port" },
  airport: { symbol: "✈", color: "#2563eb", name: "Airport" },
  military: { symbol: "★", color: "#7c2d12", name: "Military site" },
  school: { symbol: "🎓", color: "#7c3aed", name: "School" },
  health: { symbol: "✚", color: "#dc2626", name: "Health facility" },
  government: { symbol: "🏛", color: "#4338ca", name: "Government" },
  town: { symbol: "●", color: "#059669", name: "Town" },
  dam: { symbol: "▬", color: "#0e7490", name: "Dam" },
  investment: { symbol: "$", color: "#16a34a", name: "Investment" },
  border_point: { symbol: "◆", color: "#ea580c", name: "Border point" },
  other: { symbol: "•", color: "#6b7280", name: "Other" },
};
export const LABEL_TYPES = Object.keys(LABEL_TYPE_META) as LabelType[];
