/**
 * Plain-language military-escalation keyword list — matched directly
 * against real article title/description text from Africa Wire's crawl
 * (durableObjects/africaWireActor.ts, ~260 African country/pan-African/
 * institutional sources). This is the piece GDELT's own bulk/GKG feed can't
 * do: that pipeline carries only structured CAMEO event codes, no raw
 * article text (see connectors/gdeltBulk.ts's own doc comment), so
 * countryEscalation.ts translates Simon's escalation vocabulary into CAMEO
 * codes (MILITARY_POSTURE_EVENT_CODES) instead of literal phrase matching.
 * Africa Wire's crawled items DO have real text, so here the match is
 * literal — "to flag only when such terms appear", per Simon's own request.
 *
 * Deliberately scoped to the same real military/armed-conflict posture
 * MILITARY_POSTURE_EVENT_CODES covers (drone/airstrikes, clashes/
 * confrontations, mobilization/reinforcement, heavy weapons, blockades,
 * ceasefire violations, territory capture, mass-violence) — not generic
 * crime/unrest/political-crackdown vocabulary, matching the "avoid
 * reflecting conflict-unrelated incidents as escalation... use the
 * criteria strictly" direction that also drove MILITARY_POSTURE_EVENT_CODES
 * being narrowed. An article matching one of these patterns is evidence
 * FOR a country's escalation evidence list; it never by itself raises or
 * changes a country's alert level, which stays entirely GDELT/CAMEO-driven
 * (see scoreCountryEscalations) — this is corroborating real-article
 * evidence, not a second, looser scoring path.
 */

export interface EscalationKeywordMatch {
  label: string;
}

const ESCALATION_KEYWORD_PATTERNS: { label: string; rx: RegExp }[] = [
  // drone / air power
  { label: "drone strike", rx: /\bdrone\s+strikes?\b/i },
  { label: "airstrike", rx: /\bair[\s-]?strikes?\b/i },
  { label: "aerial bombardment", rx: /\baerial\s+bombard\w+\b/i },
  { label: "jet strikes", rx: /\b(?:fighter\s+)?jets?\s+(?:strikes?|bombed|bombing)\b/i },
  // clashes / confrontations
  { label: "military clash", rx: /\bmilitary\s+clash(?:es)?\b/i },
  { label: "armed confrontation", rx: /\barmed\s+(?:confrontations?|clash(?:es)?)\b/i },
  { label: "gun battle", rx: /\bgun\s*(?:battle|fight)s?\b/i },
  { label: "firefight", rx: /\bfirefights?\b/i },
  { label: "ambush", rx: /\bambush(?:ed|es|ing)?\b/i },
  { label: "militia clash", rx: /\bmilitia\s+clash(?:es)?\b/i },
  { label: "insurgent attack", rx: /\binsurgents?\s+(?:attack|strike|ambush)\w*\b/i },
  // mobilization / posture
  { label: "military mobilisation", rx: /\bmilitary\s+mobili[sz]ation\b/i },
  { label: "troop mobilisation", rx: /\btroops?\s+mobili[sz](?:ed|ing|ation)\b/i },
  { label: "military reinforcement", rx: /\b(?:military|troop)\s+reinforcements?\b/i },
  { label: "increased military movement", rx: /\b(?:military|troop)\s+(?:movements?|build-?up|deployment)\b/i },
  { label: "military offensive", rx: /\bmilitary\s+offensive\b/i },
  { label: "advance on", rx: /\b(?:rebels?|militants?|troops?|forces?|fighters?)\s+advanc\w+\s+(?:on|towards?|into)\b/i },
  // heavy weapons / shelling
  { label: "heavy weapons", rx: /\bheavy\s+weapons?\b/i },
  { label: "shelling", rx: /\bshell(?:ing|ed)\b/i },
  { label: "artillery fire", rx: /\bartillery\s+(?:fire|barrage|strikes?|shelling)\b/i },
  // ceasefire / blockade
  { label: "ceasefire violation", rx: /\bceasefire\s+(?:violat\w+|broken|collapsed?)\b/i },
  { label: "blockade", rx: /\bblockad(?:e|ed|ing)\b/i },
  { label: "siege", rx: /\bsiege[ds]?\b/i },
  // territory change — "captured" / "took control of" per Simon's own phrasing
  { label: "territory captured", rx: /\bcaptur(?:ed|es|ing)\s+(?:the\s+)?(?:town|city|village|base|territory|district|region)\b/i },
  { label: "took control of", rx: /\btook\s+control\s+of\b/i },
  { label: "seized control", rx: /\bseiz(?:ed|es|ing)\s+control\b/i },
  { label: "overran", rx: /\boverr(?:an|un|unning)\b/i },
  { label: "recaptured", rx: /\brecaptur(?:ed|es|ing)\b/i },
  { label: "retook", rx: /\bretook\b/i },
  // coup / mutiny
  { label: "coup", rx: /\b(?:military\s+)?coup\b/i },
  { label: "mutiny", rx: /\bmutin(?:y|ies|ous|ied)\b/i },
  // mass-violence tier
  { label: "mass killing", rx: /\bmass\s+killings?\b/i },
  { label: "massacre", rx: /\bmassacres?\b/i },
  { label: "ethnic cleansing", rx: /\bethnic\s+cleansing\b/i },
  { label: "security deterioration", rx: /\bsecurity\s+(?:situation\s+)?(?:deteriorat\w+|worsen\w+|collapsed?)\b/i },
];

/** Returns the distinct matched keyword labels for a piece of text — an
 *  empty array means no match, so the caller should treat the article as
 *  irrelevant rather than borderline. */
export function matchEscalationKeywords(text: string): string[] {
  const matched: string[] = [];
  for (const { label, rx } of ESCALATION_KEYWORD_PATTERNS) {
    if (rx.test(text)) matched.push(label);
  }
  return matched;
}
