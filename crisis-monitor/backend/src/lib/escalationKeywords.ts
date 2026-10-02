/**
 * Military-escalation confirmation logic — matched against real article
 * title/description text from Africa Wire's crawl
 * (durableObjects/africaWireActor.ts), GDELT's own live article search
 * (lib/gdeltArticleSearch.ts), and the URL slug of every GDELT bulk-
 * ingested event (connectors/gdeltBulk.ts has no raw article text, only a
 * CAMEO code and a source_url; see isConfirmedEscalationUrl below).
 *
 * This is used ONLY by the danger-escalation icon/summary pipeline
 * (countryEscalation.ts's scoring + evidence, and the two evidence sources
 * that feed its AI summary). Every other news surface — Africa Wire's own
 * general feed (AfricaWireActor's /snapshot route), the generic GDELT
 * points/conflict-events map layers, Social Listening — reads the raw
 * aggregated data directly and is NOT filtered through this file at all.
 * "Escalation" is a deliberately narrow, strict overlay on top of the
 * broader aggregation, not a replacement for it.
 *
 * Round-by-round history that shaped this design (see git log for the full
 * detail on each):
 *   1. Original: plain CAMEO-code membership + a couple of negative
 *      exclusion lists. Kept producing false positives under new disguises
 *      each round (a mining story, a helicopter crash, a mobile-data
 *      story, a migrant's court case) because an exclusion list can only
 *      ever catch a category of false positive it has already seen.
 *   2. Positive-confirmation gate: required a literal escalation-phrase
 *      match before anything could count — fixed the noise, but phrases
 *      like "clash", "siege", "advance on", "took control of" are
 *      themselves ambiguous in ordinary prose (a sports "clash", a company
 *      "taking control of" a rival, a team "retaking" first place), so
 *      this was still trusting a bare phrase match too readily.
 *   3. Broadened the named-armed-actor list (SAF, ENDF, TDF, Fano, etc.)
 *      and added a live-search corroboration rescue — fixed Tigray/
 *      Kordofan under-reporting.
 *   4. THIS round: Simon's direct ask — collect the real armed groups and
 *      militaries across Africa and require escalation phrases to be
 *      matched AGAINST them, rather than trusting either alone. A
 *      proper-noun NON-STATE armed group (Boko Haram, M23, RSF, JNIM...)
 *      is specific enough to confirm on its own — it essentially never
 *      appears in an unrelated story. A STATE MILITARY's name (SAF, ENDF,
 *      KDF, SANDF...) is NOT specific enough on its own — national armies
 *      get mentioned constantly in humanitarian, ceremonial, diplomatic,
 *      and sports-sponsorship contexts with zero conflict content — so a
 *      state-military mention only counts once paired with an actual
 *      escalation-action term in the same text. And a handful of
 *      genuinely unambiguous action terms (mass killing, massacre, drone
 *      strike, car bomb...) still confirm on their own, exactly as before,
 *      since they carry their own military meaning however phrased. The
 *      net effect: ambiguous generic phrases (bare "clash", "siege",
 *      "advance on", "shelling", "took control of", "recaptured"...) can
 *      no longer confirm an escalation purely on their own wording — they
 *      now need a real actor, named or official, actually present in the
 *      same text. That's the direct fix for "unnecessary things coded as
 *      escalation".
 */

import { AFRICA_COUNTRIES } from "../routes/globalStatus";

export interface EscalationKeywordMatch {
  label: string;
}

/** Builds a case-insensitive, word-boundary-safe RegExp for a plain-text
 *  term: escapes regex metacharacters, lets a literal space match any run
 *  of whitespace, and lets a literal hyphen optionally be a space/hyphen/
 *  nothing (so "al-Shabaab", "al Shabaab" and "alshabaab" all match the
 *  single term "al-shabaab"). This is what makes the long actor lists below
 *  plain readable strings instead of hand-written regexes each. */
function termToRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/ /g, "\\s+").replace(/-/g, "[\\s-]?");
  return new RegExp(`\\b${pattern}\\b`, "i");
}

function buildPatterns(terms: string[]): { label: string; rx: RegExp }[] {
  return terms.map((term) => ({ label: term, rx: termToRegex(term) }));
}

/**
 * Non-state armed groups, militias, insurgencies and separatist/rebel
 * movements active in Africa's current or recent conflicts, organized by
 * region for maintainability. Each one is specific enough as a proper noun
 * to confirm an escalation ON ITS OWN (see matchNonStateArmedGroups) — not
 * an exhaustive global catalogue of every faction that has ever existed,
 * but the actors who actually appear in current African conflict
 * reporting. Add to this list (rather than the action-term list) whenever
 * a real, named conflict actor is confirmed missing — that was the direct
 * cause of the Tigray/Kordofan under-reporting two rounds ago.
 */
const NON_STATE_ARMED_GROUPS: string[] = [
  // Sahel / West Africa — jihadist & separatist
  "boko haram", "jas", "iswap", "islamic state west africa province",
  "jnim", "jama'at nasr al-islam", "isgs", "islamic state sahel province",
  "ansaroul islam", "ansar dine", "al-qaeda in the islamic maghreb", "aqim",
  "al-mourabitoun", "lakurawa",
  "ambazonia defence forces", "amba boys", "socadef", "ambazonia restoration forces",
  "ipob", "eastern security network", "esn",
  "mend", "niger delta avengers",
  // Horn of Africa / East Africa
  "al-shabaab", "al-shabab", "al-ittihad al-islamiya",
  "onlf", "ogaden national liberation front",
  "tplf", "tigray people's liberation front",
  "tigray defence forces", "tigray defense forces", "tdf",
  "fano",
  "oromo liberation army", "ola", "oromo liberation front", "olf-shane",
  "al-shabaab mozambique", "ansar al-sunna", "iscap", "islamic state central africa province",
  "ndc-r",
  // Sudan / South Sudan
  "rapid support forces", "rsf", "janjaweed",
  "splm-n", "sudan people's liberation movement-north",
  "jem", "justice and equality movement",
  "sudan liberation movement", "sudan liberation army", "sla-minawi", "sla-abdul wahid",
  "spla-io", "spla in opposition",
  "national salvation front", "nas",
  // Great Lakes / DRC
  "m23", "march 23 movement",
  "fdlr", "forces democratiques de liberation du rwanda",
  "allied democratic forces", "adf-nalu",
  "codeco",
  "mai-mai", "mayi-mayi",
  "wazalendo",
  // Mali / Sahel political-military movements
  "coordination des mouvements de l'azawad", "cma",
  "gatia",
  // Libya
  "libyan national army", "lna",
  // Central African Republic
  "seleka", "ex-seleka", "anti-balaka", "cpc coalition",
  // Mozambique
  "renamo",
  // Nigeria / Lake Chad
  "lakurawa",
  // Egypt / Sinai
  "sinai province", "wilayat sinai",
  // Mercenary / foreign fighter groups operating in Africa
  "wagner group", "africa corps", "pmc wagner", "wagner pmc",
  // Generic Islamic State references (group-name usage, not the Sinai/West-Africa affiliates above)
  "al-qaeda", "isis", "isil", "daesh",
  // Verified name variations / other-language renderings of groups already
  // listed above — same actors, the names actually used in French-language
  // and wire-service reporting on them, added per Simon's direct ask to
  // match "different name variations and languages", not new actors.
  "gsim", // JNIM's French-press name (Groupe de Soutien a l'Islam et aux Musulmans)
  "eigs", // ISGS's French-press name (Etat Islamique au Grand Sahara)
  "hemedti", // RSF commander's name, used constantly in press as metonymy for the RSF itself
];

/**
 * Official national armed forces across Africa — names and the acronyms
 * actually used in conflict reporting. Deliberately NOT treated as
 * sufficient on their own (see matchStateMilitaries / isConfirmedEscalationText
 * below): a national army is mentioned constantly in non-conflict contexts
 * (training exercises, ceremonial parades, disaster relief, peacekeeping
 * deployments, sports sponsorships), so a bare mention here only confirms
 * an escalation once paired with an actual action term in the same text.
 * Short/common-word-shaped acronyms some countries use (Chad's "ANT",
 * Niger's "FAN", Ghana's "GAF") are deliberately left out in favor of full
 * names, since those exact letter sequences are ordinary English words and
 * would false-match constantly even gated behind an action term.
 */
const STATE_MILITARIES: string[] = [
  "sudanese armed forces", "saf",
  "ethiopian national defense force", "ethiopian national defence force", "endf",
  "eritrean defence forces", "eritrean defense forces",
  "south sudan people's defence forces", "sspdf", "spla", "sudan people's liberation army",
  "forces armees de la republique democratique du congo", "fardc",
  "rwanda defence force", "rdf", "force rwandaise de defense",
  "uganda people's defence force", "updf",
  "kenya defence forces", "kdf",
  "somali national army", "sna",
  "nigerian army", "armed forces of nigeria",
  "forces armees maliennes", "fama",
  "forces armees centrafricaines", "faca",
  "bataillon d'intervention rapide", "bir",
  "south african national defence force", "sandf",
  "zimbabwe national army", "zna",
  "forcas armadas de defesa de mocambique", "fadm",
  "armee nationale populaire",
  "forcas armadas angolanas",
  "forces armees de cote d'ivoire", "faci",
  "burkinabe armed forces", "forces de defense et de securite du burkina faso",
  "chadian national army", "chadian armed forces",
  "niger armed forces",
  "ghana armed forces",
  "senegalese armed forces",
  "egyptian armed forces",
  "libyan national army",
  "government of national unity forces",
  // French/Portuguese native-language names — the same armies as above, but
  // as they're actually named in Francophone/Lusophone reporting rather than
  // only the English rendering, since this app aggregates sources in their
  // original language before any translation step runs.
  "forces de defense nationale", // generic FDN used by several Francophone states (Burundi, Niger...)
  "forces armees nigeriennes", "fan niger",
  "forces armees du burkina faso",
  "forces armees tchadiennes",
  "forcas armadas da guine-bissau",
  "forcas armadas de cabo verde",
  "forcas armadas de sao tome e principe",
];

/**
 * Escalation action terms that are specific enough to confirm a real
 * military event ON THEIR OWN, without needing a named actor alongside
 * them — these essentially never carry a non-military meaning, however
 * phrased: "drone strike", "massacre" and "car bomb" don't have a
 * metaphorical everyday usage the way "clash", "siege" or "took control
 * of" do (see AMBIGUOUS_ACTION_TERMS below for those).
 */
const STANDALONE_ACTION_PATTERNS: { label: string; rx: RegExp }[] = [
  { label: "drone strike", rx: /\bdrone\s+strikes?\b/i },
  { label: "airstrike", rx: /\bair[\s-]?strikes?\b/i },
  { label: "aerial bombardment", rx: /\baerial\s+bombard\w+\b/i },
  { label: "jet strikes", rx: /\b(?:fighter\s+)?jets?\s+(?:strikes?|bombed|bombing)\b/i },
  { label: "artillery fire", rx: /\bartillery\s+(?:fire|barrage|strikes?|shelling)\b/i },
  { label: "mortar attack", rx: /\bmortar\s+(?:fire|attack|shelling)\b/i },
  { label: "rocket attack", rx: /\brocket\s+(?:fire|attack)\b/i },
  { label: "car bomb", rx: /\b(?:car|suicide|roadside)\s+bomb(?:ing)?\b/i },
  { label: "ied blast", rx: /\bied\s+(?:blast|attack|explosion)\b/i },
  { label: "landmine", rx: /\blandmines?\b/i },
  { label: "ceasefire violation", rx: /\bceasefire\s+(?:violat\w+|broken|collapsed?)\b/i },
  { label: "mass killing", rx: /\bmass\s+killings?\b/i },
  { label: "massacre", rx: /\bmassacres?\b/i },
  { label: "ethnic cleansing", rx: /\bethnic\s+cleansing\b/i },
  { label: "coup", rx: /\b(?:military\s+)?coup\b/i },
  { label: "mutiny", rx: /\bmutin(?:y|ies|ous|ied)\b/i },
];

/**
 * Escalation action terms that ARE ambiguous in ordinary prose — each one
 * has a common non-military usage ("clash" of styles/schedules, a company
 * "under siege" from competitors, a team that "recaptured" first place, a
 * firm that "took control of" a rival, someone "shelling out" money, a
 * candidate's poll numbers "advancing" on a rival's). These now confirm an
 * escalation ONLY when a real armed actor — named non-state group or
 * official state military (see the lists above) — is also present in the
 * same text; see isConfirmedEscalationText. This is the direct fix for
 * "unnecessary things coded as escalation": a bare ambiguous phrase with
 * no actor in sight no longer counts.
 */
const AMBIGUOUS_ACTION_PATTERNS: { label: string; rx: RegExp }[] = [
  { label: "clash", rx: /\bclash(?:es|ed)?\b/i },
  { label: "gun battle", rx: /\bgun\s*(?:battle|fight)s?\b/i },
  { label: "firefight", rx: /\bfirefights?\b/i },
  { label: "ambush", rx: /\bambush(?:ed|es|ing)?\b/i },
  { label: "insurgent attack", rx: /\b(?:insurgents?|militants?|rebels?|jihadists?|gunmen)\s+(?:attack|strike|ambush|kill)\w*\b/i },
  { label: "attack on troops/forces", rx: /\battack(?:ed|s|ing)?\s+(?:on\s+)?(?:troops?|soldiers?|security\s+forces?|army|military\s+base|police\s+station)\b/i },
  { label: "military mobilisation", rx: /\b(?:military|troops?)\s+mobili[sz](?:ed|ing|ation)\b/i },
  { label: "military reinforcement", rx: /\b(?:military|troop)\s+reinforcements?\b/i },
  { label: "combat deployment", rx: /\b(?:military|troop)\s+(?:movements?|build-?up)\b/i },
  { label: "offensive", rx: /\b(?:rebel|militant|insurgent|military)\s+offensive\b/i },
  { label: "advance on/toward", rx: /\badvanc(?:ed|es|ing)\s+(?:on|towards?|into|deeper\s+into)\b/i },
  { label: "heavy weapons", rx: /\bheavy\s+weapons?\b/i },
  { label: "shelling", rx: /\bshell(?:ing|ed)\b/i },
  { label: "blockade", rx: /\bblockad(?:e|ed|ing)\b/i },
  { label: "siege", rx: /\bsiege[ds]?\b/i },
  { label: "territory captured", rx: /\bcaptur(?:ed|es|ing)\s+(?:the\s+)?(?:town|city|village|base|territory|district|region)\b/i },
  { label: "took control of", rx: /\btook\s+control\s+of\b/i },
  { label: "seized control", rx: /\bseiz(?:ed|es|ing)\s+control\b/i },
  { label: "seized town/area", rx: /\bseiz(?:ed|es|ing)\s+(?:the\s+)?(?:town|city|village|base|territory|district|region|capital|airport|state)\b/i },
  { label: "falls/fell to", rx: /\b(?:falls?|fell|falling)\s+to\s+(?:the\s+)?(?:rebels?|militants?|forces?|troops?|fighters?|militia|army)\b/i },
  { label: "city/town falls", rx: /\b(?:town|city|village|base|capital|airport|state)\s+(?:falls?|fell|falling)\b/i },
  { label: "overran", rx: /\boverr(?:an|un|unning)\b/i },
  { label: "recaptured", rx: /\brecaptur(?:ed|es|ing)\b/i },
  { label: "retook", rx: /\bretook\b/i },
  { label: "security deterioration", rx: /\bsecurity\s+(?:situation\s+)?(?:deteriorat\w+|worsen\w+|collapsed?)\b/i },
];
// Round 5 (this round) dropped three patterns that were themselves a
// leftover false-positive source, independent of the Kenya/country-pairing
// fix above — each one matches constantly in ordinary, non-conflict
// reporting with no actor-proximity requirement at all:
//   - bare "fighting"/"fight" (fighting corruption/poverty/crime, a boxer's
//     "fight", "fighting for his life") — removed outright, no replacement;
//     the genuinely military sense is already covered by "gun battle",
//     "firefight", "clash", "insurgent attack" and "attack on troops/forces"
//     above.
//   - bare "mobilization"/"mobili[sz]e" with no military/troop qualifier
//     (mobilizing voters, funds, resources, volunteers, support) — removed;
//     "military mobilisation" above already requires the military/troop
//     qualifier immediately present, which is the only form that actually
//     signals an armed mobilization.
//   - bare "junta" — removed; it names a TYPE OF GOVERNMENT, not an action
//     (a junta's cabinet reshuffle, budget, diplomacy, or anniversary are
//     all routine non-conflict news), so pairing it with any state-military
//     mention elsewhere in the same article produced false positives with no
//     real escalation content at all (e.g. a governance story mentioning
//     both "the junta" and the national army by name). "military coup" and
//     "mutiny" (STANDALONE_ACTION_PATTERNS above) already cover the actual
//     seizure-of-power event; "rebel/militant/insurgent/military offensive"
//     above still catches a junta's own offensive once it's described as one.
//   - "increased military movement" narrowed to "combat deployment" and
//     dropped "deployment" from its own wording — a bare "military/troop
//     deployment" is the standard, constant phrasing for routine peacekeeping
//     (AU/UN missions), disaster-relief, and training deployments with zero
//     combat content, which was the second, more specific mechanism behind
//     the Kenya/KDF false positive (KDF's Somalia AMISOM/ATMIS deployment is
//     reported as exactly that word). "movements"/"build-up" still require
//     the military/troop qualifier and don't carry that routine-deployment
//     reading.

const NON_STATE_ARMED_GROUP_PATTERNS = buildPatterns(NON_STATE_ARMED_GROUPS);
const STATE_MILITARY_PATTERNS = buildPatterns(STATE_MILITARIES);

function runPatterns(text: string, patterns: { label: string; rx: RegExp }[]): string[] {
  const matched: string[] = [];
  for (const { label, rx } of patterns) {
    if (rx.test(text)) matched.push(label);
  }
  return matched;
}

/** All character offsets in `text` where any pattern in the list matches —
 *  used only by proximityPairExists below. Each pattern's own regex is
 *  re-run with a forced global flag so exec() can walk every occurrence
 *  rather than stopping at the first. */
function matchOffsets(text: string, patterns: { label: string; rx: RegExp }[]): number[] {
  const offsets: number[] = [];
  for (const { rx } of patterns) {
    const g = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : `${rx.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) {
      offsets.push(m.index);
      if (m[0].length === 0) g.lastIndex++; // guard against zero-width infinite loop
    }
  }
  return offsets;
}

/** How close (in characters) a state-military mention and an ambiguous
 *  action term need to be, in the SAME text, to count as actually
 *  describing the same event — roughly a sentence or two of a short
 *  wire-style article/title. Tuned loosely rather than exactly: too small a
 *  window starts missing real single-sentence reports that happen to be
 *  long (a named military plus a qualifying clause plus the action verb);
 *  too large a window is exactly the bug this exists to fix — a long
 *  article that mentions a state military in one paragraph and an unrelated
 *  ambiguous word (a sports "clash", a "security deterioration" in consumer
 *  confidence, routine troop "movements" for a training exercise) in a
 *  completely different paragraph. */
const PROXIMITY_WINDOW_CHARS = 220;

/** True when some match of `patternsA` and some match of `patternsB` occur
 *  within PROXIMITY_WINDOW_CHARS characters of each other anywhere in
 *  `text` — not just "both patterns appear somewhere in this text", which
 *  is what a plain `matchX(text).length>0 && matchY(text).length>0` check
 *  allows and is a real source of false positives on longer article bodies
 *  (Africa Wire's crawl includes each item's description, not just its
 *  headline): a state military named in one sentence and an unrelated
 *  ambiguous word used elsewhere in the same piece no longer confirms an
 *  escalation just because both strings happen to occur somewhere in the
 *  same block of text. */
function proximityPairExists(text: string, patternsA: { label: string; rx: RegExp }[], patternsB: { label: string; rx: RegExp }[], windowChars: number): boolean {
  const offsetsA = matchOffsets(text, patternsA);
  if (offsetsA.length === 0) return false;
  const offsetsB = matchOffsets(text, patternsB);
  if (offsetsB.length === 0) return false;
  for (const a of offsetsA) {
    for (const b of offsetsB) {
      if (Math.abs(a - b) <= windowChars) return true;
    }
  }
  return false;
}

/** Named non-state armed groups/militias/insurgencies found in the text —
 *  specific enough as proper nouns to confirm an escalation on their own. */
export function matchNonStateArmedGroups(text: string): string[] {
  return runPatterns(text, NON_STATE_ARMED_GROUP_PATTERNS);
}

/** Official national militaries found in the text — NOT sufficient alone,
 *  only counts once paired with an action term (see isConfirmedEscalationText). */
export function matchStateMilitaries(text: string): string[] {
  return runPatterns(text, STATE_MILITARY_PATTERNS);
}

/** Action terms unambiguous enough to confirm a real military event on
 *  their own, with no actor required. */
export function matchStandaloneActionTerms(text: string): string[] {
  return runPatterns(text, STANDALONE_ACTION_PATTERNS);
}

/** Action terms that ARE ambiguous in ordinary prose — only meaningful once
 *  paired with a real actor (see isConfirmedEscalationText). */
export function matchAmbiguousActionTerms(text: string): string[] {
  return runPatterns(text, AMBIGUOUS_ACTION_PATTERNS);
}

/** Union of every matched label — kept for display purposes (the
 *  "matchedKeywords" badges shown on an evidence item) ONLY. This is NOT
 *  the confirmation decision — a bare ambiguous-tier match with no actor
 *  present still shows up here for transparency on an item that DID
 *  confirm via some other combination, but never by itself makes
 *  isConfirmedEscalationText/isConfirmedEscalationUrl return true. See
 *  those functions for the actual gate. */
export function matchEscalationKeywords(text: string): string[] {
  return [
    ...matchNonStateArmedGroups(text),
    ...matchStateMilitaries(text),
    ...matchStandaloneActionTerms(text),
    ...matchAmbiguousActionTerms(text),
  ];
}

/**
 * THE confirmation decision, independent of any URL/geocoding concerns —
 * usable directly against real article title/description text (Africa
 * Wire's crawl, GDELT's own live article search). True when:
 *   1. a named NON-STATE armed group is present (sufficient alone — a
 *      proper-noun insurgent/militant/rebel/separatist group essentially
 *      never appears in an unrelated story), OR
 *   2. an unambiguous action term is present (sufficient alone — "drone
 *      strike", "massacre", "car bomb" etc. carry their own military
 *      meaning with no everyday alternate usage), OR
 *   3. an official STATE MILITARY is named AND an action term (ambiguous
 *      or unambiguous) is also present — a bare military mention alone is
 *      not enough (national armies show up constantly in non-conflict
 *      news), but paired with real escalation language it is.
 * An ambiguous action term with NO actor present at all — the old
 * behavior this round specifically fixes — no longer confirms anything on
 * its own: "the court battle", "the firm took control of its rival", "the
 * president's poll numbers advanced on his rival's" would all have
 * nothing to anchor them to a real conflict and are correctly rejected.
 *
 * `targetCountryName`, when passed, adds one more rejection specifically to
 * tier 3 (state military + ambiguous action term): a state military's own
 * name is NOT rejected just for appearing, but if the SAME text also names
 * a DIFFERENT African country, that combination no longer confirms an
 * escalation for the target country. This is the fix for Kenya showing a
 * military-posture flag with nothing actually happening in Kenya — Kenya's
 * KDF serves in Somalia under ATMIS/AMISOM peacekeeping, so "KDF" + "clash"/
 * "ambush"/"attack on troops" in the same article is routinely a real
 * escalation story about fighting in SOMALIA, not Kenya; without this check
 * that story would still confirm for Kenya purely because "KDF" is on the
 * state-military list. A named NON-STATE armed group or an unambiguous
 * standalone action term still confirm regardless of what other country is
 * named — those tiers are already specific enough on their own that this
 * extra check isn't needed (and, unlike a state military, a group like
 * Boko Haram or al-Shabaab is inherently tied to the country it actually
 * operates in, not a visiting peacekeeping contingent's home country).
 *
 * Tier 3 also requires the military name and the action term to be near
 * each other in the text (proximityPairExists, PROXIMITY_WINDOW_CHARS) —
 * not just both present somewhere in it. A short headline/slug is one
 * sentence anyway so this changes nothing there, but Africa Wire's crawl
 * text includes each item's description too, and a longer piece can
 * legitimately name a state military in one sentence and use an unrelated
 * ambiguous word (a sports "clash", routine training "movements", a
 * "security deterioration" in business confidence) somewhere else in the
 * same piece — that combination used to confirm just from co-occurring
 * anywhere in the text; now it doesn't.
 */
export function isConfirmedEscalationText(text: string, targetCountryName?: string): boolean {
  if (matchNonStateArmedGroups(text).length > 0) return true;
  if (matchStandaloneActionTerms(text).length > 0) return true;
  if (proximityPairExists(text, STATE_MILITARY_PATTERNS, AMBIGUOUS_ACTION_PATTERNS, PROXIMITY_WINDOW_CHARS)) {
    if (targetCountryName && textNamesOtherAfricanCountry(text, targetCountryName)) return false;
    return true;
  }
  return false;
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
 * can still land on the WRONG country's bucket. Confirmed cases so far:
 *   1. A Yemen (Taiz/Bab-al-Mandab) battle between Houthis and government
 *      forces geocoded onto Sudan's Red Sea coast purely from maritime/
 *      strait-reference ambiguity, with "Sudan" never once named in the
 *      actual story.
 *   2. A non-conflict Ghana story geocoded onto South Africa's bucket —
 *      caught here only once this list stopped being non-African-only (see
 *      below): the original version of this check (NON_AFRICAN_CONFLICT_TERMS)
 *      only ever listed non-African countries/conflicts, on the assumption
 *      a misattribution would always cross an Africa/non-Africa boundary.
 *      That assumption was wrong — GDELT's gazetteer resolution can just as
 *      easily confuse two African countries with each other, and nothing
 *      in the old list would ever catch a Ghana-geocoded-as-South-Africa
 *      case, since "ghana" was never a term this function checked for at
 *      all.
 * If the slug clearly names a DIFFERENT country (African or not) and never
 * mentions the target country at all, the attribution is almost certainly
 * a geocoding artifact.
 */
const NON_AFRICAN_CONFLICT_TERMS = [
  "yemen", "houthi", "houthis", "taiz", "sanaa", "sana'a", "aden", "hodeidah", "marib",
  "saudi arabia", "saudi", "riyadh",
  "israel", "israeli", "gaza", "palestine", "palestinian", "west bank", "hamas", "hezbollah",
  "syria", "syrian", "damascus", "aleppo",
  "iraq", "iraqi", "baghdad", "iran", "iranian", "tehran",
  "lebanon", "lebanese", "beirut", "jordan", "amman",
  "oman", "qatar", "kuwait", "bahrain", "emirates", "dubai", "abu dhabi",
  "turkey", "turkish", "ankara",
  "ukraine", "ukrainian", "kyiv", "russia", "russian", "moscow",
  "afghanistan", "afghan", "kabul", "pakistan", "pakistani", "india", "indian",
  "china", "chinese", "myanmar",
];

/** Strips diacritics, drops a trailing parenthetical qualifier ("Congo
 *  (Rep.)" -> "Congo"), turns apostrophes into spaces ("Côte d'Ivoire" ->
 *  "Cote d Ivoire", matching how that name actually appears, space-
 *  separated, in a URL slug) and collapses whitespace — so a country name
 *  as stored in AFRICA_COUNTRIES can be matched word-for-word against
 *  plain-ASCII slug text. */
function cleanCountryName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/['’]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const NON_AFRICAN_CONFLICT_PATTERNS = NON_AFRICAN_CONFLICT_TERMS.map((term) => termToRegex(term));

/** Every African country's own name (deduped — "Congo (Rep.)" and "Congo
 *  (DRC)" both clean to plain "Congo", which is fine here: either one
 *  present is still "a different African country than the target", which
 *  is all this check needs to know), as a word-boundary-safe matcher. This
 *  is what lets isLikelyWrongCountryUrl catch an African-to-African
 *  misattribution (Ghana geocoded onto South Africa) the same way it
 *  already caught a non-African one (Yemen onto Sudan) — see the doc
 *  comment above. */
const AFRICAN_COUNTRY_NAME_PATTERNS: { name: string; rx: RegExp }[] = Array.from(
  new Set(Object.values(AFRICA_COUNTRIES).map(cleanCountryName))
).map((name) => ({ name, rx: termToRegex(name) }));

/** True when `text` names an African country OTHER than `targetCountryName`
 *  — reuses the same AFRICAN_COUNTRY_NAME_PATTERNS built for
 *  isLikelyWrongCountryUrl, but for a different purpose: not "is this whole
 *  article about somewhere else" (isLikelyWrongCountryUrl bails out early
 *  once the target's own name is present at all), but "does this text ALSO
 *  name a different country alongside the target" — the case a state
 *  military's home-country name and the foreign country it's actually
 *  deployed to can both legitimately appear in the same story (see
 *  isConfirmedEscalationText's doc comment for the Kenya/KDF/Somalia case
 *  this exists for). Deliberately simple (any other African country name
 *  present at all) rather than trying to determine which one the event
 *  actually happened in from text alone — the point is just to stop a bare
 *  state-military mention from confirming the military's OWN country when
 *  the text is ambiguous about where the action actually took place. */
function textNamesOtherAfricanCountry(text: string, targetCountryName: string): boolean {
  const targetClean = cleanCountryName(targetCountryName);
  return AFRICAN_COUNTRY_NAME_PATTERNS.some(({ name, rx }) => name !== targetClean && rx.test(text));
}

/** True when this event's own article URL slug clearly names a different
 *  country — African or not — and never mentions `targetCountryName` at
 *  all — see the doc comment above. Word-boundary matching throughout
 *  (not a plain substring check) so, for example, a slug naming "Nigeria"
 *  doesn't get misread as mentioning "Niger", and "South Sudan" doesn't
 *  get misread as mentioning plain "Sudan" — those are a second, distinct
 *  class of cross-country confusion this same function would otherwise be
 *  exposed to once it started checking against every African country name. */
export function isLikelyWrongCountryUrl(url: string, targetCountryName: string): boolean {
  if (!url || !targetCountryName) return false;
  const text = slugWords(url);
  const targetClean = cleanCountryName(targetCountryName);
  const targetRx = termToRegex(targetClean);

  // A country whose own name CONTAINS the target's name as a sub-phrase
  // ("South Sudan" contains "Sudan"; "Guinea-Bissau" and "Equatorial
  // Guinea" both contain "Guinea") would otherwise let the plain
  // target-name check below wrongly "trust" a slug that's actually naming
  // that OTHER, more specific country — "sudan" is a perfectly real,
  // word-boundary-matched word inside "south sudan", so a naive check
  // can't tell those two apart by word-boundary matching alone. Checked
  // first and wins outright: if the slug names one of these more-specific
  // containing countries, it's that country's story, not the shorter
  // target's.
  for (const other of AFRICAN_COUNTRY_NAME_PATTERNS) {
    if (other.name !== targetClean && targetRx.test(other.name) && other.rx.test(text)) return true;
  }

  if (targetRx.test(text)) return false; // slug itself names the target — trust the attribution
  if (NON_AFRICAN_CONFLICT_PATTERNS.some((rx) => rx.test(text))) return true;
  return AFRICAN_COUNTRY_NAME_PATTERNS.some(({ name, rx }) => name !== targetClean && rx.test(text));
}

/**
 * THE gate for GDELT bulk events: a GDELT bulk event counts toward a
 * country's posture score or evidence only when BOTH of these hold —
 *   1. its own article URL slug passes isConfirmedEscalationText (a named
 *      non-state armed group, an unambiguous action term, or a state
 *      military name combined with an action term), and
 *   2. the slug doesn't clearly point at a different, non-African country
 *      (isLikelyWrongCountryUrl) — the Yemen-off-Sudan's-coast case.
 *
 * A direct, deliberate consequence: this app will under-report rather than
 * over-report — a real but under-reported story whose URL slug happens not
 * to carry any of these signals won't count either. That tradeoff is
 * explicit and intended, and is specifically offset by the live-
 * corroboration rescue in countryEscalation.ts for cases where real CAMEO
 * signal exists but the slug itself carries no usable text at all.
 */
export function isConfirmedEscalationUrl(url: string, targetCountryName: string): boolean {
  if (!url) return false;
  if (isLikelyWrongCountryUrl(url, targetCountryName)) return false;
  return isConfirmedEscalationText(slugWords(url), targetCountryName);
}
