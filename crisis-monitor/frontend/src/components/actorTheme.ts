/** The incident actor colour theme, shared by every map (Live OSINT flat map and globe, Trends & Patterns,
 *  incident search, dashboard map widgets). Kept free of heavy imports so a dashboard widget can use it
 *  without pulling in the whole map code. */
export type ActorShape = "aog" | "criminal" | "security" | "terrorist" | "militia" | "intercommunal" | "other";
export interface ActorCategory {
  color: string;
  label: string;
  shape: ActorShape;
}
// Colour theme fixed per Mutua's spec: AOG = red, Criminal = blue,
// Security Forces = dark green, Tribal = yellow. Order matters — first
// matching pattern wins, so more specific patterns (tribal/intercommunal)
// are checked before the generic militia/terrorist catch-alls they could
// otherwise overlap with (e.g. "ethnic militia").
export const ACTOR_THEME = { aog: "#dc2626", crime: "#2563eb", security: "#166534", tribal: "#eab308" } as const;
export const ACTOR_CATEGORIES: { pattern: RegExp; color: string; label: string; shape: ActorShape }[] = [
  // Named armed-opposition groups and insurgents first: "SPLA-IO" must not fall to the state army ("SPLA") below.
  { pattern: /\b(aog|armed opposition|non-?state armed|nsag|spla-?\s?io|splm-?\s?io|sspdf-?\s?io|white army|nas\b|national salvation front|rebels?|insurgen\w*|separatists?|m23|rsf|rapid support|adf|allied democratic|lra|fdlr|ambazonia\w*|amba boys|ipob|esn|polisario|tplf|fano|olf|ola|shifta|opposition (?:forces?|fighters?|group))\b/i, color: ACTOR_THEME.aog, label: "AOG (Armed Opposition Group)", shape: "aog" },
  { pattern: /\b(al-?shabaa?b|boko haram|iswap|jnim|isis|isil|daesh|islamic state|aqim|al-?qaeda|ansar\w*|jihadis\w*|terroris\w*|extremis\w*|islamists?)\b/i, color: ACTOR_THEME.aog, label: "Terrorism / Extremist", shape: "terrorist" },
  { pattern: /\b(tribal|tribe|tribes|clan|clans|clan-?based|intercommunal|inter-?communal|communal|inter-?ethnic|ethnic\w*|farmer-?herder|pastoralist.?(farmer)?|cattle (?:rustl\w*|rais\w*|keepers?|camps?)|armed youth|youth groups?|community (?:members?|youth)|murle|nuer|dinka|mundari|toposa|jie|lou nuer|bor dinka|fulani|herders?|misseriya|rizeigat|pokot|turkana|borana|samburu|nyangatom)\b/i, color: ACTOR_THEME.tribal, label: "Tribal", shape: "intercommunal" },
  { pattern: /\b(criminal\w*|crime|gang\w*|organi[sz]ed crime|bandit\w*|robber\w*|thie(?:f|ves)|highway|carjack\w*|kidnap\w*|smuggl\w*|traffick\w*|unknown gunmen|armed men|gunmen)\b/i, color: ACTOR_THEME.crime, label: "Criminal", shape: "criminal" },
  { pattern: /\b(security forces?|police|military|army|state forces?|law enforcement|sspdf|splm?-?a\b|spla|nss|national security|nps|npssf|ssnps|upd?f|kdf|fardc|saf|sudan armed forces|nigerian army|soldiers?|troops?|gendarmerie|presidential guard|amisom|atmis|monusco|minusca|unmiss|peacekeep\w*|wildlife rangers?|rangers?|government forces?|joint (?:task )?force|gok)\b/i, color: ACTOR_THEME.security, label: "Security Forces", shape: "security" },
  { pattern: /\b(militia|self-?defen[cs]e|community defense|vigilante|civil defen[cs]e|home guards?)\b/i, color: "#7c3aed", label: "Militia", shape: "militia" },
];
export const OTHER_CATEGORY: ActorCategory = { color: "#64748b", label: "Other / Unspecified", shape: "other" };

/** Classifies an incident row: the Actor column first, then the other columns that name who was involved
 *  (interest group, sector, operation, target), so a row with a blank or unusual Actor still gets its colour. */
export function classifyIncident(r: { actor?: string | null; interest_group?: string | null; sector?: string | null; operation?: string | null; target?: string | null } | null | undefined): ActorCategory {
  if (!r) return OTHER_CATEGORY;
  for (const v of [r.actor, r.interest_group, r.sector, r.operation, r.target]) {
    const c = classifyActor(v);
    if (c !== OTHER_CATEGORY) return c;
  }
  return OTHER_CATEGORY;
}

export function classifyActor(actor: string | null | undefined): ActorCategory {
  const value = (actor ?? "").trim();
  if (!value) return OTHER_CATEGORY;
  for (const cat of ACTOR_CATEGORIES) {
    if (cat.pattern.test(value)) return cat;
  }
  return OTHER_CATEGORY;
}


/** The teardrop pin used for incidents on every map: a coloured drop with a white ring and, by default, a white dot in
 *  its head. `glyphD` (a path in a 0-24 box) replaces the dot with a small symbol. The tip is at the bottom centre. */
export function pinSvg(color: string, width = 24, opts: { glyphD?: string | null; opacity?: number } = {}): string {
  const h = Math.round(width * (32 / 24));
  const head = opts.glyphD
    ? `<g transform="translate(6 5.2) scale(${12 / 24})"><path d="${opts.glyphD}" fill="#fff"/></g>`
    : `<circle cx="12" cy="11.4" r="4.6" fill="#fff"/>`;
  const d = "M12 1.4C6.2 1.4 1.8 5.8 1.8 11.4 1.8 19.1 12 30.6 12 30.6s10.2-11.5 10.2-19.2C22.2 5.8 17.8 1.4 12 1.4z";
  // Sharp at any size: the outlines keep their pixel width whatever the pin's scale (non-scaling-stroke), a fine dark
  // edge under a white rim separates the pin from light and dark maps alike, and nothing is blurred (no CSS shadow).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 24 32" shape-rendering="geometricPrecision" style="opacity:${opts.opacity ?? 1};overflow:visible;display:block"><path d="${d}" fill="none" stroke="rgba(8,12,22,0.85)" stroke-width="3.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><path d="${d}" fill="${color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${head}</svg>`;
}
