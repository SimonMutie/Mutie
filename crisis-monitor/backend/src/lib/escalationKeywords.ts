/**
 * Conflict vocabulary: named armed groups, state militaries and military
 * action terms as they appear in African conflict reporting.
 *
 * This file no longer DECIDES anything. Earlier versions used these lists as
 * the escalation gate itself (a keyword in a URL slug or a headline counted
 * as a confirmed escalation), which is what produced both the false
 * positives and the misses: a word match cannot tell where an event
 * happened, whether it happened at all, or whether the word was figurative.
 *
 * The decision is now made by reading the article (lib/escalationCoder.ts)
 * against the written codebook (lib/escalationCodebook.ts). These lists are
 * used for one thing only: a deliberately LOOSE, high-recall pre-filter that
 * picks which crawled items are worth reading at all (isCandidateText /
 * candidatePriority below). A match here means "read this", never "flag
 * this" — and a miss is cheap to fix by adding a term.
 */

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
 * sufficient on their own (see matchStateMilitaries
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
  { label: "putsch / overthrow", rx: /\b(?:putsch|overthr(?:ow|ew|own)|ous(?:t|ted|ting)\s+(?:the\s+)?(?:president|government|junta|leader))\b/i },
  { label: "ethnic / tribal violence", rx: /\b(?:ethnic|tribal|clan|intercommunal|inter-communal|communal)\s+(?:clash\w*|violence|attack\w*|fighting|killings?)\b/i },
  { label: "cattle raid", rx: /\bcattle\s+(?:raid\w*|rustl\w*)\b/i },
];

/**
 * Escalation action terms that ARE ambiguous in ordinary prose — each one
 * has a common non-military usage ("clash" of styles/schedules, a company
 * "under siege" from competitors, a team that "recaptured" first place, a
 * firm that "took control of" a rival, someone "shelling out" money, a
 * candidate's poll numbers "advancing" on a rival's). These now confirm an
 * escalation ONLY when a real armed actor — named non-state group or
 * official state military (see the lists above) — is also present in the
 * same text. This was the fix for
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

/** Named non-state armed groups/militias/insurgencies found in the text —
 *  specific enough as proper nouns to confirm an escalation on their own. */
export function matchNonStateArmedGroups(text: string): string[] {
  return runPatterns(text, NON_STATE_ARMED_GROUP_PATTERNS);
}

/** Official national militaries found in the text. */
export function matchStateMilitaries(text: string): string[] {
  return runPatterns(text, STATE_MILITARY_PATTERNS);
}

/** Action terms unambiguous enough to confirm a real military event on
 *  their own, with no actor required. */
export function matchStandaloneActionTerms(text: string): string[] {
  return runPatterns(text, STANDALONE_ACTION_PATTERNS);
}

/** Action terms that are ambiguous in ordinary prose. */
export function matchAmbiguousActionTerms(text: string): string[] {
  return runPatterns(text, AMBIGUOUS_ACTION_PATTERNS);
}

/** Union of every matched label. Used only to rank candidates for reading. */
export function matchEscalationKeywords(text: string): string[] {
  return [
    ...matchNonStateArmedGroups(text),
    ...matchStateMilitaries(text),
    ...matchStandaloneActionTerms(text),
    ...matchAmbiguousActionTerms(text),
  ];
}

/**
 * Broad multilingual conflict lexicon (English, French, Portuguese, Arabic)
 * — word stems, not phrases. Deliberately over-inclusive: it only decides
 * whether an item is worth the cost of fetching and reading. Roughly, any
 * item mentioning violence, armed actors or military activity passes.
 */
const CANDIDATE_LEXICON_RX = new RegExp(
  [
    // English
    "\\b(?:kill(?:ed|s|ing)?|dead\\b|deaths?|attack(?:ed|s|ers?)?|clash(?:es|ed)?|fighting|battle|troops?|soldiers?|army|military|militia|rebels?|insurgen|jihadis|gunmen|bandits?|bomb|blast|explosion|air\\s?strikes?|strikes?|drones?|shell(?:ed|ing)|artillery|offensive|seiz(?:ed|es|ure)|captur|siege|besieg|blockade|ceasefire|truce|coup|mutin|massacre|ambush|raid(?:ed|s)?|abduct|kidnap|displac|fighters|armed|gunfire|shooting|shot dead|terror|hostilit|paramilitar|warplanes?|incursion|overr[au]n|retak|recaptur)",
    // French
    "\\b(?:tu[ée]e?s?\\b|morts?\\b|attaqu|affrontement|combats?|arm[ée]e|soldats?|militaires?|milice|rebelles?|djihadis|terroris|bombe|frappes?|obus|si[èe]ge|blocus|cessez-le-feu|coup d['’ ][ée]tat|mutinerie|embuscade|enl[èe]vement|d[ée]plac[ée]s|assaillants?|hommes arm[ée]s|bombard|tirs)",
    // Portuguese
    "\\b(?:mortos?|ataques?|confrontos?|combates?|ex[ée]rcito|soldados?|militares|mil[íi]cia|rebeldes|insurgentes|bomba|explos[ãa]o|golpe de estado|emboscada|rapto|deslocados|tiroteio)",
    // Arabic (no word boundaries — \\b does not work on Arabic script)
    "(?:قتل|مقتل|قتلى|هجوم|اشتباك|معارك|معركة|الجيش|قوات|ميليشيا|مليشيا|مسلح|قصف|غارة|غارات|مسيرة|مسيّرة|انفجار|حصار|هدنة|انقلاب|مجزرة|نزوح|الدعم السريع|عسكري)",
  ].join("|"),
  "i"
);

/** True when a crawled item is worth reading in full. */
export function isCandidateText(text: string): boolean {
  if (!text) return false;
  return CANDIDATE_LEXICON_RX.test(text) || matchNonStateArmedGroups(text).length > 0 || matchStateMilitaries(text).length > 0;
}

/** Reading order within one tick's budget: items naming an armed actor or an
 *  unambiguous military action are read first. Higher is sooner. */
export function candidatePriority(text: string): number {
  return (
    matchStandaloneActionTerms(text).length * 3 +
    matchNonStateArmedGroups(text).length * 2 +
    matchStateMilitaries(text).length * 2 +
    Math.min(matchAmbiguousActionTerms(text).length, 3)
  );
}
