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

/**
 * Cross-check for GDELT CAMEO miscoding — the concrete answer to "how is
 * [a mining-investment story] increased posture?". GDELT's bulk event
 * feed has no article text to literally keyword-match (see
 * countryEscalation.ts's own doc comment), only a structured event code
 * assigned by GDELT's own shallow verb-phrase parser (TABARI/PETRARCH-
 * style, not real semantic understanding). That parser demonstrably
 * mis-codes economic/resource/diplomatic stories into a 15x/19x
 * "posture" bucket when they use phrasing that superficially resembles
 * military verbs — "directed [agencies] to strengthen... sources" /
 * "national-security concern" / "dispute... revoked... licence" read, to
 * a shallow parser, similarly enough to real mobilization/coercion verbs
 * to get miscoded, even though the actual story (e.g. a critical-minerals
 * mining consortium, a trade dispute, an investment tribunal ruling) has
 * no military content at all.
 *
 * GDELT's bulk export does carry one piece of real signal per event: its
 * source_url. Most news CMSs embed the headline's own words in the URL
 * slug (e.g. ".../australian-consortium-mrima-hill-minerals"), so reading
 * that slug is a real (if partial) look at the actual article — without
 * an extra network fetch per event. This is used to EXCLUDE a posture-
 * coded event only when its slug confidently reads as an unrelated
 * economic/trade/diplomatic/sports/etc. story AND carries none of the
 * actual escalation keywords itself — never to confirm a true positive on
 * its own (a slug with no clear signal either way is left alone, matching
 * this app's general "when genuinely unsure, don't overclaim" posture).
 */
const NON_MILITARY_URL_SIGNALS = [
  "mining", "minerals", "mineral", "consortium", "tender", "licence", "license",
  "trade", "investment", "investor", "ipo", "shares", "stock-market", "markets",
  "economy", "economic", "finance", "financial", "budget", "taxation",
  "agriculture", "tourism", "education", "health", "hospital", "election", "referendum",
  "football", "cricket", "rugby", "olympics", "business", "banking", "currency",
  "inflation", "gdp", "export", "import", "supply-chain", "rare-earth", "niobium",
  "royalty", "royalties", "resources", "exploration",
];

function slugWords(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname} ${u.search}`.replace(/[-_/?=&.]+/g, " ").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** True when this GDELT bulk event's own article URL confidently reads as
 *  an unrelated economic/trade/diplomatic story rather than a real
 *  military-posture report — see the doc comment above. Used to drop a
 *  CAMEO-coded "posture" event from both scoring and evidence when GDELT's
 *  own coder most likely miscoded it. */
export function isLikelyNonMilitaryUrl(url: string): boolean {
  if (!url) return false;
  const text = slugWords(url);
  if (matchEscalationKeywords(text).length > 0) return false; // the slug itself carries real escalation signal — keep it
  return NON_MILITARY_URL_SIGNALS.some((term) => text.includes(term));
}
