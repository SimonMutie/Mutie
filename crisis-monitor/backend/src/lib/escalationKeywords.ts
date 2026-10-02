/**
 * Plain-language military-escalation keyword list — matched directly
 * against real article title/description text from Africa Wire's crawl
 * (durableObjects/africaWireActor.ts), GDELT's own live article search
 * (lib/gdeltArticleSearch.ts), and — as of this round — the URL slug of
 * every GDELT bulk-ingested event (connectors/gdeltBulk.ts has no raw
 * article text, only a CAMEO code and a source_url; see
 * isConfirmedEscalationUrl below).
 *
 * Tightened per Simon's explicit direction after a second noise pass
 * (Zimbabwe flagged over a helicopter crash, South Africa over a mobile-
 * data pricing story, Kenya over a migrant-residency court case — none of
 * them conflict-related at all): "strict instructions to look at key
 * escalation terms... so that nothing is flagged as escalation if it's
 * not". The structural fix is isConfirmedEscalationUrl's AND/OR gate below
 * — a GDELT bulk event now needs BOTH a qualifying CAMEO code AND a
 * literal keyword hit in its own article URL before it can count toward a
 * country's score or evidence at all. Before this round, only a
 * CAMEO-code membership check plus a couple of negative exclusion lists
 * decided it — exclusion lists can only ever catch categories already
 * seen going wrong, which is why the noise kept recurring under new
 * disguises each round. A positive requirement instead means nothing
 * reaches the score without a term from this list actually present,
 * matching Simon's own framing exactly: it's now boolean AND, not boolean
 * NOT.
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
  // clashes / confrontations — bare "clash(es)" is a real risk word in
  // ordinary journalism ("clash of styles") but is overwhelmingly used
  // literally (armed groups clashing) in actual African conflict
  // reporting headlines, which is the only text this is ever matched
  // against (a URL slug or a real article's own title/description) —
  // kept, unlike "battle" or "fighting" below, which were dropped after
  // "court battle" (the Kenya migrant-case false positive) showed how
  // easily those two collide with ordinary non-military usage.
  { label: "clash", rx: /\bclash(?:es|ed)?\b/i },
  { label: "gun battle", rx: /\bgun\s*(?:battle|fight)s?\b/i },
  { label: "firefight", rx: /\bfirefights?\b/i },
  { label: "ambush", rx: /\bambush(?:ed|es|ing)?\b/i },
  { label: "insurgent attack", rx: /\b(?:insurgents?|militants?|rebels?|jihadists?|gunmen)\s+(?:attack|strike|ambush|kill)\w*\b/i },
  { label: "attack on troops/forces", rx: /\battack(?:ed|s|ing)?\s+(?:on\s+)?(?:troops?|soldiers?|security\s+forces?|army|military\s+base|police\s+station)\b/i },
  // mobilization / posture
  { label: "military mobilisation", rx: /\bmilitary\s+mobili[sz]ation\b/i },
  { label: "troop mobilisation", rx: /\btroops?\s+mobili[sz](?:ed|ing|ation)\b/i },
  { label: "military reinforcement", rx: /\b(?:military|troop)\s+reinforcements?\b/i },
  { label: "increased military movement", rx: /\b(?:military|troop)\s+(?:movements?|build-?up|deployment)\b/i },
  { label: "rebel/militant offensive", rx: /\b(?:rebel|militant|insurgent|junta)\s+offensive\b/i },
  { label: "advance on", rx: /\b(?:rebels?|militants?|troops?|forces?|fighters?)\s+advanc\w+\s+(?:on|towards?|into)\b/i },
  // heavy weapons / shelling / bombing
  { label: "heavy weapons", rx: /\bheavy\s+weapons?\b/i },
  { label: "shelling", rx: /\bshell(?:ing|ed)\b/i },
  { label: "artillery fire", rx: /\bartillery\s+(?:fire|barrage|strikes?|shelling)\b/i },
  { label: "mortar attack", rx: /\bmortar\s+(?:fire|attack|shelling)\b/i },
  { label: "rocket attack", rx: /\brocket\s+(?:fire|attack)\b/i },
  { label: "car bomb", rx: /\b(?:car|suicide|roadside)\s+bomb(?:ing)?\b/i },
  { label: "ied blast", rx: /\bied\s+(?:blast|attack|explosion)\b/i },
  { label: "landmine", rx: /\blandmines?\b/i },
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
  // coup / mutiny / junta
  { label: "coup", rx: /\b(?:military\s+)?coup\b/i },
  { label: "mutiny", rx: /\bmutin(?:y|ies|ous|ied)\b/i },
  { label: "junta", rx: /\bjunta\b/i },
  // mass-violence tier
  { label: "mass killing", rx: /\bmass\s+killings?\b/i },
  { label: "massacre", rx: /\bmassacres?\b/i },
  { label: "ethnic cleansing", rx: /\bethnic\s+cleansing\b/i },
  { label: "security deterioration", rx: /\bsecurity\s+(?:situation\s+)?(?:deteriorat\w+|worsen\w+|collapsed?)\b/i },
  // Named armed actors — the highest-confidence anchors this list has:
  // a proper-noun armed-group name essentially never appears in an
  // unrelated economic/sports/court story, so these alone are enough to
  // confirm a real conflict report, which is exactly what lets the real
  // hotspots (Sudan, eastern DRC, the Sahel, Somalia, Mozambique) surface
  // reliably without reopening the door to generic keyword noise.
  { label: "named armed group", rx: /\b(?:al[\s-]?shabaab|boko\s*haram|iswap|m23|rsf\b|rapid\s+support\s+forces|janjaweed|tplf|spla\b|splm\b|jnim|isgs|al[\s-]?qaeda|isis|isil|daesh|fardc|wagner\s+group)\b/i },
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

function slugWords(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname} ${u.search}`.replace(/[-_/?=&.]+/g, " ").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Cross-check for GDELT geocoding misattribution — a real military event
 * can still land on the WRONG country's bucket. Confirmed case: a Yemen
 * (Taiz/Bab-al-Mandab) battle between Houthis and government forces
 * geocoded onto Sudan's Red Sea coast purely from maritime/strait-
 * reference ambiguity, with "Sudan" never once named in the actual story.
 * If the slug clearly names a DIFFERENT country/conflict and never
 * mentions the target country at all, the attribution is almost certainly
 * a geocoding artifact. This app only scores African countries, so a
 * non-African event is simply dropped — there's no "correct" bucket to
 * move it to.
 */
const NON_AFRICAN_CONFLICT_TERMS = [
  "yemen", "houthi", "houthis", "taiz", "sanaa", "sana'a", "aden", "hodeidah", "marib",
  "saudi-arabia", "saudi", "riyadh",
  "israel", "israeli", "gaza", "palestine", "palestinian", "west-bank", "hamas", "hezbollah",
  "syria", "syrian", "damascus", "aleppo",
  "iraq", "iraqi", "baghdad", "iran", "iranian", "tehran",
  "lebanon", "lebanese", "beirut", "jordan", "amman",
  "oman", "qatar", "kuwait", "bahrain", "emirates", "dubai", "abu-dhabi",
  "turkey", "turkish", "ankara",
  "ukraine", "ukrainian", "kyiv", "russia", "russian", "moscow",
  "afghanistan", "afghan", "kabul", "pakistan", "pakistani", "india", "indian",
  "china", "chinese", "myanmar",
];

/** True when this event's own article URL slug clearly names a different,
 *  non-African conflict/country and never mentions `targetCountryName` at
 *  all — see the doc comment above. */
export function isLikelyWrongCountryUrl(url: string, targetCountryName: string): boolean {
  if (!url || !targetCountryName) return false;
  const text = slugWords(url);
  if (text.includes(targetCountryName.toLowerCase())) return false; // slug itself names the target — trust the attribution
  return NON_AFRICAN_CONFLICT_TERMS.some((term) => text.includes(term));
}

/**
 * THE gate: a GDELT bulk event counts toward a country's posture score or
 * evidence only when BOTH of these hold —
 *   1. its own article URL slug literally matches one of the escalation
 *      keywords/named armed groups above (matchEscalationKeywords), and
 *   2. the slug doesn't clearly point at a different, non-African country
 *      (isLikelyWrongCountryUrl) — the Yemen-off-Sudan's-coast case.
 *
 * This replaces the two-separate-denylists approach from the previous
 * round (isLikelyNonMilitaryUrl/isLikelyWrongCountryUrl run as pure
 * exclusion filters on top of plain CAMEO-code membership). A denylist can
 * only ever catch a category of false positive it has already seen — which
 * is exactly why "entire Africa", then a mining story, then a helicopter
 * crash, a mobile-data story and a court case kept recurring as new
 * disguises of the same underlying problem each round. Requiring a real,
 * positive keyword match before anything can count is a strictly stronger
 * guarantee: an event with no corroborating text signal simply never
 * reaches the score, no matter what CAMEO code GDELT assigned it or how
 * the growth math would otherwise have scored it.
 *
 * A direct, deliberate consequence: this app will now under-report rather
 * than over-report — a real but under-reported story whose URL slug
 * happens not to carry one of these terms won't count either. That
 * tradeoff is explicit and intended ("I would be ok if for now I am
 * seeing exclamation marks in Tigray, Sudan, Red Sea, Eastern DRC... but
 * not the entire Africa").
 */
export function isConfirmedEscalationUrl(url: string, targetCountryName: string): boolean {
  if (!url) return false;
  if (isLikelyWrongCountryUrl(url, targetCountryName)) return false;
  return matchEscalationKeywords(slugWords(url)).length > 0;
}
