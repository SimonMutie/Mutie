/**
 * Maritime security around Africa and the Red Sea, from the authorities shipping itself uses:
 *  - JMIC (Joint Maritime Information Center, run by the Combined Maritime Forces and published through UKMTO):
 *    threat levels by sea area, on its five-step scale. JMIC names the areas but publishes no outlines, so the
 *    outlines here are drawn by the Lens to the named waters and are approximate.
 *  - The Joint War Committee of the Lloyd's market (JWC): the "Listed Areas" for hull war, piracy, terrorism and
 *    related perils, with their limits exactly as defined in the circular.
 *  - The Internationally Recommended Transit Corridor (IRTC) in the Gulf of Aden, the core of the Maritime Security
 *    Transit Corridor (MSTC), at its published waypoints.
 * Update AS_OF and the levels when a new JMIC advisory or JWC circular changes them.
 */

export type ThreatLevel = "low" | "moderate" | "substantial" | "severe" | "critical";

/** JMIC's scale, in its own words, with the colours the Lens uses for it. */
export const THREAT_SCALE: { level: ThreatLevel; label: string; color: string; meaning: string }[] = [
  { level: "low", label: "Low", color: "#22c55e", meaning: "An attack is unlikely" },
  { level: "moderate", label: "Moderate", color: "#ffd23f", meaning: "An attack is possible but not likely" },
  { level: "substantial", label: "Substantial", color: "#ff9500", meaning: "An attack is a strong possibility" },
  { level: "severe", label: "Severe", color: "#ff3d3d", meaning: "An attack is highly likely" },
  { level: "critical", label: "Critical", color: "#b4127d", meaning: "The highest level on the scale" },
];
export const threatColor = (l: ThreatLevel) => THREAT_SCALE.find((s) => s.level === l)!.color;
export const threatLabel = (l: ThreatLevel) => THREAT_SCALE.find((s) => s.level === l)!.label;

export interface MaritimeSource { id: string; name: string; date: string; url: string }
export const SOURCES: Record<string, MaritimeSource> = {
  jmic: { id: "jmic", name: "JMIC Advisory Update 113 (CMF / UKMTO)", date: "12 Nov 2026", url: "https://www.ukmto.org/-/media/ukmto/products/jmic_advisory_update_113_12-nov.pdf" },
  jwc: { id: "jwc", name: "Joint War Committee Listed Areas, JWLA-035 (LMA / IUA)", date: "16 Sep 2026", url: "https://lmalloyds.com/wp-content/uploads/2026/09/JWLA-035-Black-Sea.pdf" },
  irtc: { id: "irtc", name: "IRTC waypoints (MSCIO; IMO SN.1/Circ.281)", date: "in force since Feb 2009", url: "https://www.mscio.eu/useful-information/irtc-details/" },
};
/** The date the layers were last brought into line with the sources. */
export const AS_OF = "24 Nov 2026";

export type RiskLayer = "redsea" | "piracy";

export interface RiskArea {
  id: string;
  layer: RiskLayer[];
  name: string;
  level: ThreatLevel;
  /** JMIC's reason, summarised. */
  reason: string;
  source: string;
  ring: [number, number][]; // [lng, lat]
}

/** JMIC threat areas. Outlines drawn by the Lens to the named waters (approximate). */
export const RISK_AREAS: RiskArea[] = [
  {
    id: "srs-bam",
    layer: ["redsea"],
    name: "Southern Red Sea and Bab el-Mandeb",
    level: "substantial",
    reason: "Houthi (Ansar Allah) attacks on vessels and on infrastructure near maritime interests, and Houthi territorial gains along Yemen's Red Sea coast; further attacks are a strong possibility. The Houthis state a selective embargo and say non-Saudi commercial shipping may pass.",
    source: "jmic",
    ring: [[38.55, 18.0], [41.55, 18.0], [42.3, 17.0], [42.75, 15.6], [42.95, 14.6], [43.25, 13.3], [43.45, 12.65], [43.35, 12.45], [43.1, 12.7], [42.7, 13.0], [41.7, 13.9], [40.4, 14.9], [39.6, 15.5], [39.1, 16.4], [38.6, 17.4], [38.55, 18.0]],
  },
  {
    id: "goa",
    layer: ["redsea", "piracy"],
    name: "Gulf of Aden",
    level: "substantial",
    reason: "Piracy-related events and Houthi rhetoric and attacks; an incident is a strong possibility. Small-craft groups keep close-approach capability; more small-boat approaches are likely in the western Gulf and the IRTC.",
    source: "jmic",
    ring: [[43.45, 12.65], [45.0, 12.75], [47.0, 13.5], [49.1, 14.45], [50.6, 15.0], [52.22, 15.62], [51.27, 11.83], [49.2, 11.3], [47.0, 11.1], [45.0, 10.5], [44.0, 10.6], [43.25, 11.5], [43.45, 12.65]],
  },
  {
    id: "nrs-suez",
    layer: ["redsea"],
    name: "Northern Red Sea and Suez Canal",
    level: "moderate",
    reason: "Suez Canal working normally; periodic electromagnetic (GNSS) interference possible.",
    source: "jmic",
    ring: [[32.55, 29.95], [33.6, 28.3], [34.25, 27.73], [35.0, 26.2], [36.4, 24.6], [37.6, 23.4], [38.6, 21.9], [39.4, 20.6], [40.4, 19.2], [41.55, 18.0], [38.55, 18.0], [37.3, 19.6], [37.2, 21.0], [35.7, 23.0], [35.0, 24.0], [33.9, 26.6], [33.0, 28.0], [32.55, 29.95]],
  },
  {
    id: "somali",
    layer: ["piracy"],
    name: "Somali coast and Somali Basin",
    level: "moderate",
    reason: "Pirate action groups can board and divert merchant ships along the Somali coast, the IRTC approaches and the Gulf of Aden lanes, and may range across the northern Somali Basin. The southwest monsoon ended on 15 October, so skiffs can work offshore again.",
    source: "jmic",
    // East and south edges follow the war-risk listed-area limit.
    ring: [[51.3, 11.9], [54.6, 12.6], [60.25, 10.8], [48.75, -6.75], [41.567, -1.667], [42.5, -0.4], [44.0, 1.5], [46.0, 2.8], [48.0, 5.0], [49.5, 7.5], [50.8, 9.6], [51.3, 11.9]],
  },
];

export interface RiskLine {
  id: string;
  layer: RiskLayer[];
  kind: "jwc" | "irtc";
  name: string;
  detail: string;
  source: string;
  /** Closed rings are drawn as outlined areas; open lines as limits. */
  closed?: boolean;
  coords: [number, number][]; // [lng, lat]
}

export const RISK_LINES: RiskLine[] = [
  {
    id: "jwc-redsea-north",
    layer: ["redsea", "piracy"],
    kind: "jwc",
    name: "JWC listed area: northern limit in the Red Sea (25.5°N)",
    detail: "The listed area for hull war, piracy, terrorism and related perils covers the Red Sea south of 25.5°N (not Egyptian territorial waters), the Gulf of Aden, the Indian Ocean to these limits, the Gulf of Oman and the Gulf. Ships in it need war-risk cover agreed with underwriters.",
    source: "jwc",
    coords: [[34.62, 25.5], [37.12, 25.5]],
  },
  {
    id: "jwc-indian-ocean",
    layer: ["redsea", "piracy"],
    kind: "jwc",
    name: "JWC listed area: Indian Ocean limit",
    detail: "From the Pakistan coast at 25°19′15″N 65°E, south along 65°E to 10°48′N, west to 10°48′N 60°15′E, then to 6°45′S 48°45′E, and back to the Somalia border at 1°40′S 41°34′E. The waters inside this line, the Gulf of Aden and the southern Red Sea are listed.",
    source: "jwc",
    coords: [[65.0, 25.32], [65.0, 10.8], [60.25, 10.8], [48.75, -6.75], [41.567, -1.667]],
  },
  {
    id: "jwc-gulf-of-guinea",
    layer: ["piracy"],
    kind: "jwc",
    name: "JWC listed area: Gulf of Guinea",
    detail: "Waters east of a line from the Togo coast (6°06′45″N 1°12′E) to 0°40′S 3°E, and north of 0°40′S to Cape Lopez, Gabon (8°42′E). Togo, Benin and Nigeria are also listed in full.",
    source: "jwc",
    coords: [[1.2, 6.1125], [3.0, -0.6667], [8.7, -0.6667]],
  },
  {
    id: "jwc-cabo-delgado",
    layer: ["piracy"],
    kind: "jwc",
    name: "JWC listed area: Cabo Delgado waters",
    detail: "The territorial sea of Mozambique and Tanzania between Mnazi Bay (10°19.6′S) and Baía do Lúrio (13°30′S), for the insurgency on the coast.",
    source: "jwc",
    closed: true,
    coords: [[40.315, -10.327], [40.574, -10.172], [40.828, -13.5], [40.527, -13.5], [40.315, -10.327]],
  },
  {
    id: "irtc-westbound",
    layer: ["redsea", "piracy"],
    kind: "irtc",
    name: "IRTC westbound lane",
    detail: "Westbound lane of the Internationally Recommended Transit Corridor, 5 NM wide, course 252°. Naval forces concentrate their presence on this corridor; JMIC expects small-boat approaches in and near it.",
    source: "irtc",
    closed: true,
    coords: [[45.0, 12.0], [53.0, 14.5], [53.0, 14.4167], [45.0, 11.9167], [45.0, 12.0]],
  },
  {
    id: "irtc-eastbound",
    layer: ["redsea", "piracy"],
    kind: "irtc",
    name: "IRTC eastbound lane",
    detail: "Eastbound lane of the Internationally Recommended Transit Corridor, 5 NM wide, course 072°, separated from the westbound lane by a 2 NM buffer.",
    source: "irtc",
    closed: true,
    coords: [[45.0, 11.8833], [53.0, 14.3833], [53.0, 14.3], [45.0, 11.8], [45.0, 11.8833]],
  },
];

export interface RiskPoint { id: string; layer: RiskLayer[]; name: string; detail: string; source: string; lat: number; lng: number; approx: boolean }

/** Standing events JMIC still lists. */
export const RISK_POINTS: RiskPoint[] = [
  {
    id: "asana",
    layer: ["piracy"],
    name: "MT ASANA: hijacked, still held",
    detail: "Tanzanian-flagged product/chemical tanker carrying oil products, hijacked on 17 July 2026 about 65 NM southwest of Mukalla, Yemen. JMIC lists it under the Somali coast. Position is approximate (from the distance and bearing given).",
    source: "jmic",
    lat: 13.75,
    lng: 48.35,
    approx: true,
  },
];

export const LINE_STYLE: Record<RiskLine["kind"], { color: string; dash: [number, number] | null; label: string }> = {
  jwc: { color: "#e879f9", dash: [4, 3], label: "JWC war-risk listed area (limit)" },
  irtc: { color: "#38bdf8", dash: null, label: "IRTC transit lanes (Gulf of Aden)" },
};
