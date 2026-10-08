/** The incident actor colour theme, shared by every map (Live OSINT flat map and globe, Trends & Patterns,
 *  incident search, dashboard map widgets). Kept free of heavy imports so a dashboard widget can use it
 *  without pulling in the whole map code. */
export type ActorShape = "aog" | "criminal" | "security" | "terrorist" | "militia" | "intercommunal" | "other";
export interface ActorCategory {
  color: string;
  label: string;
  shape: ActorShape;
}
// Colour theme fixed per Mutua's spec: AOG = dark red, Crime = blue,
// Security Forces = dark green, Tribal = dark pink. Order matters — first
// matching pattern wins, so more specific patterns (tribal/intercommunal)
// are checked before the generic militia/terrorist catch-alls they could
// otherwise overlap with (e.g. "ethnic militia").
export const ACTOR_THEME = { aog: "#991b1b", crime: "#2563eb", security: "#166534", tribal: "#9d174d" } as const;
export const ACTOR_CATEGORIES: { pattern: RegExp; color: string; label: string; shape: ActorShape }[] = [
  { pattern: /\b(aog|armed opposition|non-?state armed|nsag)\b/i, color: ACTOR_THEME.aog, label: "AOG (Armed Opposition Group)", shape: "aog" },
  { pattern: /\b(tribal|tribe|tribes|clan|clans|clan-?based|intercommunal|inter-?communal|communal violence|inter-?ethnic|ethnic clash\w*|farmer-?herder|pastoralist.?(farmer)?|cattle rustl\w*)\b/i, color: ACTOR_THEME.tribal, label: "Tribal", shape: "intercommunal" },
  { pattern: /\b(criminal|crime|gang|organi[sz]ed crime|bandit\w*)\b/i, color: ACTOR_THEME.crime, label: "Crime", shape: "criminal" },
  { pattern: /\b(security forces?|police|military|army|state forces?|law enforcement)\b/i, color: ACTOR_THEME.security, label: "Security Forces", shape: "security" },
  { pattern: /\b(terroris\w*|extremis\w*)\b/i, color: "#ea580c", label: "Terrorist / Extremist", shape: "terrorist" },
  { pattern: /\b(militia|self-?defen[cs]e|community defense|vigilante)\b/i, color: "#7c3aed", label: "Militia", shape: "militia" },
];
export const OTHER_CATEGORY: ActorCategory = { color: "#64748b", label: "Other / Unspecified", shape: "other" };

export function classifyActor(actor: string | null | undefined): ActorCategory {
  const value = (actor ?? "").trim();
  if (!value) return OTHER_CATEGORY;
  for (const cat of ACTOR_CATEGORIES) {
    if (cat.pattern.test(value)) return cat;
  }
  return OTHER_CATEGORY;
}

