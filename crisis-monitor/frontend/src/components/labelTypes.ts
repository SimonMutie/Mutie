/** The categories a placed globe label can represent — each gets its own
 *  distinct icon and default color so they're visually distinguishable at a
 *  glance, the same design principle as the tactic icons on the 2D
 *  incidents map. Deliberately its own file, separate from GlobeWidget.tsx:
 *  that file imports Three.js and react-globe.gl at the top, both lazy-
 *  loaded specifically so a dashboard without any globe widget never pays
 *  for that weight. A static import of this metadata from GlobeWidget.tsx
 *  directly would drag that whole dependency chain into the main bundle
 *  regardless, defeating the lazy-load entirely — this file has none of
 *  those dependencies, so it's safe to import anywhere.
 *
 *  Icons are raw SVG markup strings (not emoji) rendered via
 *  react-globe.gl's htmlElementsData, which places real DOM/SVG elements at
 *  geographic coordinates instead of relying on Three.js's own text
 *  rendering. That distinction matters: Three.js's text renderer doesn't
 *  reliably support emoji glyphs — many fonts used there only cover basic
 *  Latin characters — which is exactly why the earlier emoji-based version
 *  showed up as boxes/question marks instead of the intended symbol. Each
 *  icon here is a simple, bold geometric shape (circles, polygons, basic
 *  paths) rather than a detailed illustration, kept deliberately simple
 *  since there's no way to visually preview a Three.js scene in this
 *  environment before shipping it — a plain SVG can at least be reasoned
 *  about precisely by its coordinates, unlike a 3D scene. */
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
  | "threat_risk"
  | "other";

interface LabelTypeMeta {
  color: string;
  name: string;
  /** Inner SVG markup (no outer <svg> tag) — a 24x24 viewBox, drawn in
   *  white so it reads clearly against the colored circular badge it's
   *  placed on top of. */
  iconInner: string;
}

export const LABEL_TYPE_META: Record<LabelType, LabelTypeMeta> = {
  checkpoint: {
    color: "#d97706",
    name: "Checkpoint",
    iconInner: '<polygon points="7,2 17,2 22,7 22,17 17,22 7,22 2,17 2,7" fill="white" />',
  },
  chokepoint: {
    color: "#dc2626",
    name: "Chokepoint",
    iconInner: '<polygon points="3,4 21,4 12,12" fill="white" /><polygon points="3,20 21,20 12,12" fill="white" />',
  },
  port: {
    color: "#0891b2",
    name: "Port",
    iconInner:
      '<circle cx="12" cy="5" r="2.5" fill="none" stroke="white" stroke-width="2" /><line x1="12" y1="7.5" x2="12" y2="19" stroke="white" stroke-width="2" /><line x1="7" y1="11" x2="17" y2="11" stroke="white" stroke-width="2" /><path d="M6,14 L6,16 A6,6 0 0,0 18,16 L18,14" fill="none" stroke="white" stroke-width="2" />',
  },
  airport: {
    color: "#2563eb",
    name: "Airport",
    iconInner: '<polygon points="12,2 15,10 22,13 15,14 12,22 9,14 2,13 9,10" fill="white" />',
  },
  military: {
    color: "#7c2d12",
    name: "Military site",
    iconInner: '<polygon points="12,2 14.9,9.1 22,9.1 16.5,13.9 18.5,21 12,16.8 5.5,21 7.5,13.9 2,9.1 9.1,9.1" fill="white" />',
  },
  school: {
    color: "#7c3aed",
    name: "School",
    iconInner: '<rect x="4" y="5" width="16" height="14" rx="1" fill="none" stroke="white" stroke-width="2" /><line x1="12" y1="5" x2="12" y2="19" stroke="white" stroke-width="2" />',
  },
  health: {
    color: "#dc2626",
    name: "Health facility",
    iconInner: '<rect x="9" y="3" width="6" height="18" fill="white" /><rect x="3" y="9" width="18" height="6" fill="white" />',
  },
  government: {
    color: "#4338ca",
    name: "Government",
    iconInner:
      '<polygon points="12,2 22,9 2,9" fill="white" /><rect x="2" y="9" width="20" height="2" fill="white" /><rect x="4" y="12" width="2" height="7" fill="white" /><rect x="11" y="12" width="2" height="7" fill="white" /><rect x="18" y="12" width="2" height="7" fill="white" /><rect x="2" y="20" width="20" height="2" fill="white" />',
  },
  town: {
    color: "#059669",
    name: "Town",
    iconInner: '<polygon points="12,3 21,11 21,21 3,21 3,11" fill="white" />',
  },
  dam: {
    color: "#0e7490",
    name: "Dam",
    iconInner:
      '<rect x="2" y="4" width="20" height="6" fill="white" /><path d="M2,15 Q6,12 10,15 T18,15 T22,15" fill="none" stroke="white" stroke-width="2" /><path d="M2,19 Q6,16 10,19 T18,19 T22,19" fill="none" stroke="white" stroke-width="2" />',
  },
  investment: {
    color: "#16a34a",
    name: "Investment",
    iconInner: '<polyline points="3,17 9,11 13,15 21,5" fill="none" stroke="white" stroke-width="2.5" /><polyline points="15,5 21,5 21,11" fill="none" stroke="white" stroke-width="2.5" />',
  },
  border_point: {
    color: "#ea580c",
    name: "Border point",
    iconInner: '<polygon points="12,2 22,12 12,22 2,12" fill="white" />',
  },
  threat_risk: {
    color: "#b91c1c",
    name: "Threat / Risk",
    iconInner:
      '<polygon points="12,2 22,20 2,20" fill="none" stroke="white" stroke-width="2" /><line x1="12" y1="9" x2="12" y2="14" stroke="white" stroke-width="2" /><circle cx="12" cy="17" r="1.2" fill="white" />',
  },
  other: {
    color: "#6b7280",
    name: "Other",
    iconInner: '<circle cx="12" cy="12" r="7" fill="white" />',
  },
};
export const LABEL_TYPES = Object.keys(LABEL_TYPE_META) as LabelType[];

/** Builds the full standalone SVG markup for a type's icon — a colored
 *  circular badge with the type's icon inside, white-on-color for
 *  legibility against any globe terrain underneath. Shared by the globe's
 *  own label rendering and the drawing/editor previews, so both always
 *  show the exact same mark. */
export function labelIconSvg(type: LabelType, size: number, explicitColor?: string): string {
  const meta = LABEL_TYPE_META[type];
  const color = explicitColor || meta.color;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="${color}" stroke="white" stroke-width="1" />${meta.iconInner}</svg>`;
}
