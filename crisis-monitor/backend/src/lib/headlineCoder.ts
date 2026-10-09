import { countryName, locateText, regionNamedIn, type TextLocation } from "./africaGeo";
import { matchNonStateArmedGroups, matchStateMilitaries } from "./escalationKeywords";
import type { IndicatorId } from "./escalationCodebook";
import type { RawCodedEvent, RawCoding } from "./escalationCoder";

/**
 * The headline tier: a first, rule-based reading of a report from its
 * headline and feed summary alone.
 *
 * Why it exists. Reading every article in full needs a language model, and
 * on the free AI allowance the platform can afford roughly 25-30 full
 * readings a day against several hundred conflict reports. This tier costs
 * nothing, so it looks at all of them, and is what makes a danger marker
 * appear within minutes of several outlets reporting the same thing.
 *
 * What it is not. It does not understand an article; it recognises a
 * limited set of explicit, past-tense event statements ("gunmen killed 12",
 * "drone strike hit", "clashes erupted", "captured the town of") next to a
 * named place. It therefore:
 *
 *   - codes every report at LOW confidence. Under the codebook's level
 *     rules a single low-confidence report flags nothing unless it states
 *     five or more deaths: a marker otherwise needs a second independent
 *     outlet reporting an armed event at the same place. A toll of
 *     twenty-five or more makes it Critical only with a second outlet or a
 *     full reading;
 *   - never asserts the critical-tier judgements that need understanding
 *     (interstate hostilities, a ceasefire's collapse, a major town's fall)
 *     — only what a headline states outright;
 *   - codes a report OF an event, not a piece ABOUT one. A headline whose
 *     subject is a reaction or statement ("condemns", "urges restraint",
 *     "claims victory"), the consequences of fighting (hunger, displaced
 *     families), an analysis, rights report or round-up, or a long-running
 *     situation presented as such ("18-year insurgency") is left alone;
 *     and wording that describes a standing state ("under siege since
 *     May", "has repeatedly attacked") is not taken as something that
 *     happened;
 *   - checks the date: the day the text gives for the event ("on Sunday",
 *     "yesterday", "3 October") becomes its event date, and a report whose
 *     own wording puts the event more than a day before publication ("last
 *     week", "on Friday" in a Monday report) is left alone — only the last
 *     24 hours are flagged;
 *   - requires a place below country level, named in the text, and prefers
 *     the place in the same sentence as the event;
 *   - passes through the same verification as a model's coding
 *     (escalationCoder.verifyCoding): every indicator carries a verbatim
 *     quote from the text, the place must be in the text, the country must
 *     resolve to an African country.
 *
 * Whenever the AI allowance permits, the articles behind headline-tier
 * reports are the first to be read in full, and that reading replaces this
 * one — including removing the report if the article turns out not to be
 * what its headline suggested.
 */

/** Marks articles coded by this tier in escalation_articles.model. */
export const HEADLINE_CODER = "headline-rules";
export const HEADLINE_TEXT_BASIS = "headline";

/** How much of a feed summary is considered: the headline and the opening
 *  of the summary state the event; further down, feed text drifts into
 *  background and other stories. */
const SUMMARY_CHARS = 600;

export interface HeadlineItem {
  title: string | null;
  feedText: string | null;
  publishedAt: string | null;
}

// ── What is not an event report, on its face ─────────────────────────────

const NOT_NEWS_RX =
  /\b(opinion|analysis|explainer|explained|editorial|commentary|interview|podcast|fact[- ]?check|profile|review|q ?& ?a|timeline|in pictures|photos?:|video:|watch:|listen:|live updates?|what to know|five things|newsletter)\b/i;
const NOT_SECURITY_RX =
  /\b(football|soccer|league|cup final|striker|goalkeeper|afcon|olympics?|boxing|rugby|cricket|basketball|tennis|marathon|film|movie|album|concert|novel|box office|stock market|premier league|champions league|world cup|netflix|festival|fashion|recipe)\b/i;
const LEGAL_RX = /\b(court|trial|verdict|sentenced|jailed|convicted|acquitted|charged with|pleads?|tribunal|icc|prosecutors?|lawsuit|indicted|extradit\w+|inquest|inquiry into)\b/i;
const RETROSPECTIVE_RX = /\b(anniversary|years? (ago|on|after|since)|decades? (ago|on|after|since)|remember(s|ing|ed)|commemorat\w+|memorial|looking back|history of)\b/i;

// A report OF an event, or a piece ABOUT one? Only the first is coded. A
// reaction, a statement, a humanitarian or analytical piece, or a recap of
// a long-running situation mentions fighting without reporting a new event
// — and three such pieces about last week's fighting must not add up to
// "three outlets report clashes today".

/** The headline's subject is someone reacting to, or talking about, an event. */
const REACTION_RX =
  /\b(condemn\w*|denounc\w+|deplor\w+|decr(?:y|ies|ied)|urg(?:e|es|ed|ing)|call(?:s|ed|ing)? (?:for|on)|appeal(?:s|ed)? (?:for|to)|express(?:es|ed)? (?:\w+ )?(?:concern|outrage|condolences?|sympathy|alarm|shock|solidarity)|concern(?:ed|s)? (?:over|about|at)|alarm(?:ed)? (?:over|at|by)|mourns?|condolences?|reacts?|reactions?|respond(?:s|ed)? to|blam(?:es|ed)|accus(?:es|ed)|den(?:y|ies|ied)|rejects?|dismiss(?:es|ed)|statement (?:by|on|from|of)|press (?:release|statement|briefing|conference)|communiqu[ée]|remarks|speech|claims? victory|prais(?:es|ed)|hails?|welcomes?|commends?|salutes?|pays? tribute|honou?rs?|visits?|meets?|discuss(?:es|ed)?|briefs?|briefing|condamne|d[ée]nonce|d[ée]plore|exhorte|appelle [àa]|r[ée]agit|s['’]inqui[èe]te|d[ée]ment|accuse|rend hommage|d[ée]claration d[eu])\b/i;
/** The headline is about the consequences of fighting, not a new event in it. */
const IMPACT_RX =
  /\b(impact (?:of|on)|aftermath|in the wake of|humanitarian (?:crisis|situation|needs|emergency|catastrophe|disaster|response)|hunger|famine|malnutrition|aid (?:needs|appeal|agencies warn)|(?:families|children|women|civilians|residents|refugees|displaced \w+) (?:face|struggle|need|bear|suffer|await|still)|survivors (?:recount|recall|await|still|struggle|tell)|recounts?|recalls?|testimon\w+|crisis (?:deepens|worsens|grows|mounts)|worsening|deepen(?:s|ing)|toll of|cost of|legacy|lessons?|trauma|recovery|rebuild\w*|reconstruction|crise humanitaire)\b/i;
/** The headline is an analytical or summarising piece. */
const ANALYSIS_RX =
  /^(?:[\p{L}' -]{2,25}: )?(?:how|why|what|who|where|when|inside|behind|explain\w*|the (?:story|rise|fall|roots|making|return) of|comment|pourquoi)\b|\b(report (?:finds|says|reveals|documents|details|shows|warns|accuses)|new report|study|investigation|researchers?|analysts?|experts?|amnesty|human rights watch|hrw|rights groups?|data shows?|figures show|statistics|weekly|monthly|round-?up|recap|updates?|in numbers|key (?:facts|moments|events)|redraws?|reshap\w+|what next|outlook)\b/iu;
/** The headline frames the piece as part of a long-running situation. */
const LONG_RUNNING_RX =
  /\b(\d+[- ]year (?:war|conflict|insurgency|siege|crisis|rebellion|civil war)|(?:decades?|years?|months?)[- ]long|long[- ]running|protracted|(?:years|decades|months) of (?:war|conflict|fighting|violence|insurgency|unrest|bloodshed)|since (?:19|20)\d\d)\b/i;
/** A clause that describes a standing situation, not something that just
 *  happened: "which has been under siege since May 2024", "has repeatedly
 *  attacked army bases", "the two-year war". */
const BACKGROUND_RX =
  /\b(since (?:(?:19|20)\d\d|january|february|march|april|may|june|july|august|september|october|november|december)|for (?:more than |over |nearly |almost |about )?(?:\w+ )?(?:months|years|decades)|(?:has|have|had) (?:long )?been (?:fighting|battling|waging|under siege|at war|locked in|besieged|blockaded|clashing)|long[- ]running|protracted|(?:decades?|years?|months?)[- ]long|\d+[- ]year (?:war|conflict|insurgency|siege|rebellion)|(?:two|three|four|five|six|seven|eight|nine|ten)[- ]year (?:war|conflict|insurgency|siege|rebellion)|(?:years|months|decades) of (?:fighting|war|conflict|violence|clashes|insurgency|unrest)|(?:began|started|broke out|erupted) in (?:(?:19|20)\d\d|january|february|march|april|may|june|july|august|september|october|november|december)|war-torn|repeatedly|regularly|frequently|routinely|often|in recent (?:years|months)|depuis (?:(?:19|20)\d\d|des (?:mois|ann[ée]es)))\b/i;
const CLAUSE_BREAK_RX = /[,;]|\s(?:which|where|while|amid|after|as|que|qui|où)\s/gi;

/** The clause of a sentence that contains position `at`. */
function clauseAt(sentence: string, at: number): string {
  let start = 0;
  let end = sentence.length;
  CLAUSE_BREAK_RX.lastIndex = 0;
  for (let m = CLAUSE_BREAK_RX.exec(sentence); m; m = CLAUSE_BREAK_RX.exec(sentence)) {
    if (m.index + m[0].length <= at) start = m.index + m[0].length;
    else if (m.index > at) {
      end = m.index;
      break;
    }
  }
  return sentence.slice(start, end);
}

/** Countries and territories outside Africa and the Middle East where the reported event would
 *  actually be. A headline that names one is not coded here even if an
 *  African place is also mentioned ("Kenyan killed in Ukraine strike"). */
const ELSEWHERE_RX =
  /\b(ukraine|pakistan|india|kashmir|afghanistan|myanmar|bangladesh|taiwan|north korea|philippines|haiti|colombia|venezuela|mexico|ecuador|texas|california|florida|new york|kosovo|armenia|azerbaijan)\b/i;
/** Something that has not happened: a warning, a threat, a fear, a plan, a drill. */
const HYPOTHETICAL_RX =
  /\b(warn(?:s|ed|ing)? (?:of|that|against)|threat(?:en)?(?:s|ed|ing)? (?:to|of)|fears? (?:of|that|grow)|risk of|could|might|plans? to|vows? to|pledges? to|ready to|set to|prepar(?:es|ing) (?:to|for)|drills?|military exercises?|training exercise|simulat\w+|menace de|risque de|pourrait)\b/i;
/** "Attack" that is not an armed one. */
const NOT_ARMED_ATTACK_RX = /\b(heart|lion|hippo|crocodile|elephant|snake|bees?|shark|dog|hyena|buffalo|leopard|cyber|asthma|acid|panic)[- ]attack/i;

// ── Indicators a headline can state outright ─────────────────────────────

const ARMED_ACTORS = "gunmen|bandits?|militants?|jihadists?|insurgents?|rebels?|armed men|armed group|attackers?|terrorists?|militia(?:men|s)?|fighters|herdsmen|assailants?|extremists?|hommes arm[ée]s|djihadistes?|terroristes?|assaillants?|rebelles?|miliciens?";
const VIOLENT_ACTS = "kill(?:ed|s)?|attack(?:ed|s)?|raid(?:ed|s)?|abduct(?:ed|s)?|kidnap(?:ped|s)?|massacre[ds]?|shot dead|slaughter(?:ed|s)?|storm(?:ed|s)?|ambush(?:ed|es)?|behead(?:ed|s)?|tu[ée]e?s?|tuent|attaqu[ée]e?s?|attaquent|enlev[ée]e?s?|enl[èe]vent|massacr[ée]e?s?";
const SECURITY_FORCES = "soldiers?|troops|policemen|police officers?|peacekeepers?|gendarmes?|army (?:base|post|convoy|camp|patrol)|military (?:base|post|convoy|camp|patrol)|security forces|soldats?|militaires|casques bleus";

interface IndicatorRule {
  id: IndicatorId;
  /** Any one of these stating the event is enough. */
  rx: RegExp[];
  /** A match in a sentence that also matches this is not this indicator. */
  unless?: RegExp;
}

const CIVIL_UNREST_RX = /\b(protest\w*|demonstrat\w+|students?|fans|supporters|vendors|traders|riot\w*|strike action|manifestants?|manifestation)\b/i;

const TOWN_WORDS = "town|city|village|villages|base|airport|camp|district|locality|capital|garrison|headquarters|border (?:post|crossing|town)|positions?|stronghold|barracks";

const RULES: IndicatorRule[] = [
  {
    id: "air_or_drone_strike",
    rx: [
      /\b(air ?strikes?|drone (?:strikes?|attacks?)|aerial bombardment|(?:warplanes?|jets?|drones?) (?:bombed|struck|hit|bomb|strike|strikes)|bombed by (?:a |an )?(?:drone|jet|warplane)s?|frappes? a[ée]riennes?|frappes? de drones?|attaques? de drones?|bombardements? a[ée]riens?)\b/i,
    ],
  },
  {
    id: "heavy_weapons",
    rx: [
      /\b(shell(?:ing|ed)|artillery (?:fire|barrage|strikes?|attack|shelling)|mortar (?:fire|attack|shells?|rounds?)|rocket (?:fire|attack|barrage)|rockets? (?:fired|hit|struck)|tirs? d['’ ]artillerie|pilonn(?:age|[ée]e?s?|ent)|tirs? de (?:mortier|roquettes?)|obus)\b/i,
    ],
  },
  {
    id: "armed_clash",
    rx: [
      /\b(clash(?:es|ed)|(?:heavy|fierce|intense|renewed|fresh|new|deadly) (?:fighting|battles?|combat|gunfire)|(?:fighting|combat|gunfire|hostilities) (?:erupt\w*|broke out|breaks out|rag\w+|resum\w+|continu\w+|intensif\w+|flar\w+|renewed|between)|gun ?battles?|firefights?|exchange of (?:gun)?fire|battles? (?:rag\w+|erupt\w*|renewed|resum\w+|between)|affrontements?|accrochages?|combats? (?:violents?|intenses?|entre|ont|font|opposent))\b/i,
    ],
    unless: CIVIL_UNREST_RX,
  },
  {
    id: "offensive_or_advance",
    rx: [
      /\b(launch(?:ed|es) (?:a |an |new |major |fresh |large-scale )*(?:offensive|assault)|(?:offensive|assault) (?:on|against)|advanc(?:ed|es|ing) (?:on|toward|towards|into)|march(?:ed|ing) on|lanc(?:e|[ée]|ent) une offensive|offensive (?:sur|contre))\b/i,
    ],
  },
  {
    id: "territorial_change",
    rx: [
      /\b(?:took|takes|taken|seiz(?:ed|es|ing)|regain(?:ed|s)|gain(?:ed|s)|claim(?:ed|s)) (?:full |complete |total )?control of\b/i,
      new RegExp(`\\b(?:captur(?:ed|es|ing)|seiz(?:ed|es|ing)|overr[au]n|overruns|recaptur(?:ed|es|ing)|retak(?:es|en|ing)|retook)\\s+(?:the |a |an |several |two |three |key |strategic |main |major |another )*(?:[\\w'-]+ ){0,3}?(?:${TOWN_WORDS})\\b`, "i"),
      /\b(?:fell|falls|fallen) to\b[^.!?]{0,30}\b(?:rebels?|militants?|jihadists?|forces|fighters|army|insurgents?|rsf|m23|jnim)\b/i,
      /\b(?:pris|prend|prennent|repris|reprend|reprennent) le contr[ôo]le d[e'’u]|(?:s['’]empar(?:e|ent)|se sont empar[ée]s) d[e'’u]/i,
    ],
  },
  {
    id: "siege_or_blockade",
    // The act of laying one — not the standing state ("the besieged city", "under siege since May").
    rx: [/\b(la(?:y|ys|id) siege to|besieg(?:es|ing)|(?:have|has|had) besieged|(?:begin|begins|began|begun) (?:a |the |its )?(?:siege|blockade)|impos(?:ed|es|ing) (?:a |an |the )?(?:\w+ )?(?:siege|blockade)|encircl(?:es|ed)|surround(?:s|ed) the (?:town|city|base|garrison)|assi[èe]gent|impos(?:e|ent) un (?:si[èe]ge|blocus))\b/i],
    unless: BACKGROUND_RX,
  },
  {
    id: "ceasefire_violation",
    rx: [/\b((?:ceasefire|truce) (?:collaps\w+|breaks? down|broken|violat\w+|breach\w*)|(?:violat\w+|breach\w*) (?:of )?(?:the |a )?(?:ceasefire|truce)|violation du cessez-le-feu)\b/i],
  },
  {
    id: "coup_or_mutiny",
    rx: [/\b(attempted coup|coup attempt|foiled coup|coup (?:is )?under ?way|(?:military|army|soldiers?) (?:coup|takeover|take over|takes? over|seiz\w+ power)|soldiers (?:announce|declare|seize)\w*|putsch|mutin(?:y|ied|eers?)|seiz(?:ed|es) power|overthr(?:ew|own|ows)|ous?ted (?:by|in)|toppled|tentative de coup|coup d['’ ][ée]tat|mutinerie|renvers[ée])\b/i],
    unless: /\b(since|after|following|post-coup|coup leaders?|plotters?|accused|suspects?|arrest\w*)\b/i,
  },
  {
    id: "armed_opposition",
    rx: [
      /\b(?:rebels?|armed opposition|opposition (?:forces|fighters|troops|gunmen)|SPLA-?IO|SPLM-?IO|white army|insurgents?|separatists?|breakaway (?:faction|forces?)|m23|rebel (?:group|forces|fighters)|forces loyal to|rebelles?)\b[^.!?]{0,70}\b(?:attack\w*|ambush\w*|clash\w*|fight\w*|battle\w*|captur\w+|seiz\w+|raid\w*|storm\w*|overr[au]n\w*|launch\w*|shell\w*|kill\w*|defect\w*|offensive|attaqu\w+|affront\w+)\b/i,
      /\b(?:attack\w*|ambush\w*|clash\w*|fight\w*|captur\w+|offensive|attaqu\w+)\b[^.!?]{0,40}\b(?:by|between|with|against|contre|par)\b[^.!?]{0,40}\b(?:rebels?|armed opposition|opposition forces|SPLA-?IO|SPLM-?IO|white army|insurgents?|m23|rebelles?)\b/i,
    ],
    unless: new RegExp(`${BACKGROUND_RX.source}|\\b(talks|negotiat\\w+|peace deal|dialogue|trial|court|arrest\\w*|accus\\w+)\\b`, "i"),
  },
  {
    id: "major_terror_attack",
    rx: [
      /\b(?:boko haram|iswap|islamic state|isis|isil|daesh|al-?shabaa?b|jnim|aqim|al-?qaeda|ansar\w*|adf|allied democratic forces|jihadists?|terrorists?|extremists?|islamists?|djihadistes?|terroristes?)\b[^.!?]{0,70}\b(?:attack\w*|assault\w*|bomb\w*|massacre\w*|storm\w*|raid\w*|kidnap\w*|abduct\w*|hostages?|kill\w*|blast|suicide|overr[au]n\w*|attaqu\w+|enl[èe]v\w+)\b/i,
      /\b(?:suicide|car) (?:bomb\w*|attack\w*)\b[^.!?]{0,60}\b(?:claimed|blamed)\b/i,
    ],
    unless: new RegExp(`${BACKGROUND_RX.source}|\\b(trial|court|convicted|sentenced|arrest\\w*|surrender\\w*|deradicali[sz]\\w*)\\b`, "i"),
  },
  {
    id: "ied_or_bombing",
    rx: [
      /\b(suicide (?:bomb\w*|attack\w*)|car bomb\w*|roadside bomb\w*|ied\b|improvised explosive|land ?mine\w*|bomb (?:blast|attack|explod\w+|kill\w+|rips?|went off)|bombing (?:kill\w+|hit\w*|rock\w+|in|at)|attentat[- ]suicide|attentat [àa] la bombe|kamikaze|engin explosif)\b/i,
    ],
  },
  {
    id: "intercommunal_violence",
    rx: [
      /\b(inter-?communal|communal|ethnic|tribal|herders? and farmers?|farmers? and herders?|farmer-?herder|cattle raid\w*|revenge attacks?|intercommunautaires?)\b[^.!?]{0,80}\b(clash\w*|violence|fighting|attacks?|kill\w*|affrontements?|morts?)\b/i,
    ],
  },
  {
    id: "attack_on_security_forces",
    rx: [
      new RegExp(`\\b(?:${SECURITY_FORCES})\\b[^.!?]{0,40}\\b(?:were |was |have been |has been |are )?(?:killed|ambushed|wounded|tu[ée]s?) (?:in|by|when|after|during|dans|par|lors)\\b`, "i"),
      new RegExp(`\\b(?:ambush(?:ed|es)?|attack(?:ed|s)?(?: on| against)?|raid(?:ed|s)?(?: on)?|attaque contre|embuscade contre)\\b[^.!?]{0,50}\\b(?:${SECURITY_FORCES}|army|military|police|convoy|barracks)\\b`, "i"),
    ],
    unless: NOT_ARMED_ATTACK_RX,
  },
  {
    id: "attack_on_civilians",
    rx: [
      new RegExp(`\\b(?:${ARMED_ACTORS})\\b[^.!?]{0,80}\\b(?:${VIOLENT_ACTS})\\b`, "i"),
      new RegExp(`\\b(?:${VIOLENT_ACTS})\\b[^.!?]{0,80}\\b(?:by|par)\\b[^.!?]{0,30}\\b(?:${ARMED_ACTORS})\\b`, "i"),
      // No attacker named, but an attack with deaths stated: "20 killed in attack on village", "attack leaves 12 dead".
      /\b(?:killed|dead|slain|morts?|tu[ée]e?s?)\b[^.!?]{0,40}\b(?:in|after|during|dans|lors d[e'’u])\b[^.!?]{0,25}\b(?:attack|raid|ambush|massacre|assault|attaque|embuscade)s?\b/i,
      /\b(?:attack|raid|ambush|assault|attaque|embuscade)s?\b[^.!?]{0,40}\b(?:kills?|killed|killing|leaves?|left|claims?|fait|tue)\b/i,
      /\b(?:massacre|mass killing)\b/i,
    ],
    unless: NOT_ARMED_ATTACK_RX,
  },
  {
    id: "emergency_measures",
    rx: [
      /\b((?:state of emergency|curfew) (?:declared|imposed|extended)|declar(?:es|ed) (?:a |the )?(?:state of emergency|curfew)|impos(?:es|ed) (?:a |an |the )?(?:\w+ )?curfew|couvre-feu (?:instaur[ée]|d[ée]cr[ée]t[ée])|[ée]tat d['’ ]urgence (?:d[ée]cr[ée]t[ée]|instaur[ée]|d[ée]clar[ée]))\b/i,
    ],
  },
];

const DISPLACEMENT_RX = /\b(thousands|tens of thousands|\d{1,3}(?:,\d{3})+|\d+ ?000|des milliers)\b[^.!?]{0,50}\b(flee|fled|fleeing|displaced|forced to flee|uprooted|fuient|d[ée]plac[ée]s)\b/i;
const CIVILIANS_RX = /\b(civilians?|villagers?|worshippers?|farmers?|residents?|women|children|mourners|displaced|passengers|traders|civils?|villageois|fid[èe]les)\b/i;

// ── Death tolls ──────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  "a dozen": 12, dozen: 12, dozens: 24, scores: 40,
  deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, quinze: 15, vingt: 20, trente: 30,
};
const NUM = `(\\d{1,3}(?:,\\d{3})+|\\d{1,4}|${Object.keys(NUMBER_WORDS).join("|")})`;
const NOT_A_COUNT = `(?!\\s?(?:%|percent|years?|year-old|days?|hours?|months?|weeks?|km|kilomet\\w+|miles?|million|billion|ans|jours)\\b)`;
const KILL_WORDS = "killed|dead|die[ds]?|massacred|shot dead|slain|perished|slaughtered|morts?|tu[ée]e?s?|d[ée]c[èe]s";
const APPROX = "(?:at least |about |around |some |nearly |almost |over |more than |up to |as many as |another |au moins |plus de |environ )?";
const TOLL_PATTERNS = [
  // "kills 12", "killed at least 15 farmers", "leaves 20 dead", "claims 9 lives" — the number directly after the verb.
  new RegExp(`\\b(?:kill(?:s|ed|ing)?|massacre[ds]?|slaughter(?:ed|s)?|gun(?:s|ned)? down|shot dead|leav(?:es|ing)|left|claim(?:s|ed)|fait|tue|tuent|tu[ée])\\s+${APPROX}${NUM}\\b${NOT_A_COUNT}`, "i"),
  // "12 villagers killed", "28 people have been killed", "40 dead" — the number, what was counted, then the verb.
  new RegExp(`\\b${NUM}\\b${NOT_A_COUNT}([^.!?\\d,;:]{0,40}?)\\b(?:${KILL_WORDS})\\b`, "i"),
  new RegExp(`\\b(?:death toll|bilan)\\b[^.!?\\d]{0,45}?\\b${NUM}\\b${NOT_A_COUNT}`, "i"),
];
/** A running total for a whole war, a year or several days is not one event's death toll. */
const CUMULATIVE_RX =
  /\b(since|so far|over the past|in the past (?:year|month|decade|week)|this (?:year|month)|last (?:year|month|week)|total of|overall|(?:during|over|in|after|for) (?:several|many|\w+) (?:days|weeks|months) of|days of|weeks of|months of|in (?:late|early|mid)[- ](?:january|february|march|april|may|june|july|august|september|october|november|december)|depuis)\b/i;
/** A number of people something else happened to — not a death toll, and a
 *  sign the sentence is counting more than one thing. */
const OTHER_COUNT_RX = /\b(wound\w*|injur\w+|hurt|abduct\w*|kidnap\w*|arrest\w*|detain\w*|missing|displac\w+|rescu\w+|freed|surviv\w+|hospitali[sz]ed|feared|bless[ée]e?s?|enlev[ée]e?s?)\b/i;

function parseCount(raw: string): number | null {
  const word = raw.toLowerCase();
  if (word in NUMBER_WORDS) return NUMBER_WORDS[word];
  const n = Number(word.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1900 && n <= 2100) return null; // a year, not a count
  if (n > 1000) return null; // beyond any single event a headline tier should assert
  return n;
}

/** The death toll a sentence states for the event, if it states one
 *  unambiguously. Deliberately narrow: a missed toll costs little (the
 *  report is still coded), a wrong one could flag a marker. */
function deathToll(sentences: string[]): { count: number; quote: string } | null {
  // A stated figure anywhere in the text is preferred to "dozens" or
  // "scores", which are read as the least they can mean (24 and 40).
  return tollIn(sentences, false) ?? tollIn(sentences, true);
}

const VAGUE_COUNT_RX = /^(?:dozens|scores)$/i;

function tollIn(sentences: string[], vague: boolean): { count: number; quote: string } | null {
  for (const s of sentences) {
    if (CUMULATIVE_RX.test(s) || HYPOTHETICAL_RX.test(s)) continue;
    for (const rx of TOLL_PATTERNS) {
      const m = rx.exec(s);
      if (!m || VAGUE_COUNT_RX.test(m[1]) !== vague) continue;
      const count = parseCount(m[1]);
      if (!count) continue;
      // "wounds 12", "12 injured, one killed": the number belongs to something else.
      const before = s.slice(Math.max(0, m.index - 30), m.index + m[0].indexOf(m[1]));
      const between = m[2] ?? "";
      if (OTHER_COUNT_RX.test(between) || (rx === TOLL_PATTERNS[1] && OTHER_COUNT_RX.test(before.split(/[,;]/).pop() ?? ""))) continue;
      return { count, quote: clip(s, m.index) };
    }
  }
  return null;
}

// ── When it happened ─────────────────────────────────────────────────────

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MONTH_ALT = [...MONTHS, ...MONTHS_FR, "fevrier", "aout", "decembre", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sept", "sep", "oct", "nov", "dec"].join("|");
const monthIndex = (name: string): number => {
  const n = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const plain = (list: string[]) => list.map((m) => m.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  const full = Math.max(plain(MONTHS).indexOf(n), plain(MONTHS_FR).indexOf(n));
  return full >= 0 ? full : MONTHS.findIndex((m) => m.startsWith(n.slice(0, 3)));
};

/** Wording that puts an event more than a day in the past, whatever the day. */
const LONG_AGO_RX =
  /\b(last (?:week|month|year|weekend)|(?:two|three|four|five|six|seven|several|many|\d+) (?:days|weeks|months|years) (?:ago|earlier|before)|a (?:week|month|year) ago|(?:days|weeks|months) ago|earlier this (?:week|month|year)|in recent (?:days|weeks|months)|(?:over|in|during) the (?:past|last) (?:few |several |\w+ )?(?:days|weeks|week|months|month)|(?:several|many) days of|la semaine derni[èe]re|le mois dernier|il y a (?:deux|trois|quatre|plusieurs|quelques|\d+) (?:jours|semaines|mois))\b/gi;
const TODAY_RX = /\b(today|this (?:morning|afternoon|evening)|tonight|overnight|aujourd['’]hui|ce matin|cette nuit)\b/gi;
const WEEKEND_RX = /\b((?:this|the|this past|over the|at the|last) weekend|ce week-?end)\b/gi;
/** Wording that attaches a date to something other than the event itself:
 *  "...despite a curfew imposed on September 21", "...days after a truce
 *  signed on Friday". A date on the far side of one of these is not read. */
const OTHER_EVENT_RX = /\b(despite|after|following|since|amid|ahead of|before|until|imposed|declared|signed|began|started|launched in|broke out|malgr[ée]|apr[èe]s|depuis|avant)\b/i;
const YESTERDAY_RX = /\b(yesterday|last night|hier)\b/gi;
const WEEKDAY_RX = new RegExp(`\\b(last |next )?(${[...WEEKDAYS, ...WEEKDAYS_FR].join("|")})\\b(?! (?:times|mail|telegraph|independent|standard|nation|vision|monitor|punch|sun|world)\\b)`, "gi");
const DAY_MONTH_RX = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|er)? (${MONTH_ALT})\\b\\.?`, "gi");
const MONTH_DAY_RX = new RegExp(`\\b(${MONTH_ALT})\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b(?! (?:movement|mouvement))`, "gi");
const IN_MONTH_RX = new RegExp(`\\b(?:in|since|during|en|depuis|fin|d[ée]but)[ -](?:late[ -]|early[ -]|mid[ -]?)?(${[...MONTHS, ...MONTHS_FR].join("|")})\\b(?! \\d)`, "gi");

const DAY_MS = 86_400_000;
type DateCue = { daysBack: number } | "stale";

/**
 * What a sentence says about when its event happened, relative to the day
 * the report was published: how many days before (0 or 1), or "stale" —
 * more than a day before. Null when it gives no date. `at`..`end` is where
 * the sentence states the event. A date reached only across wording that
 * introduces something else ("...despite a curfew imposed on September
 * 21") is not taken as the date of the event. The day something was *said*
 * counts: what was said on Friday had happened by Friday.
 */
function dateCue(sentence: string, at: number, end: number, published: Date): DateCue | null {
  const pubDay = Date.UTC(published.getUTCFullYear(), published.getUTCMonth(), published.getUTCDate());
  const pubDow = new Date(pubDay).getUTCDay();
  const cues: { at: number; cue: DateCue }[] = [];
  const scan = (rx: RegExp, read: (m: RegExpExecArray) => DateCue | null) => {
    rx.lastIndex = 0;
    for (let m = rx.exec(sentence); m; m = rx.exec(sentence)) {
      const between = m.index >= end ? sentence.slice(end, m.index) : m.index < at ? sentence.slice(m.index + m[0].length, at) : "";
      if (OTHER_EVENT_RX.test(between)) continue;
      const cue = read(m);
      if (cue) cues.push({ at: m.index, cue });
    }
  };
  const fromDate = (month: number, day: number): DateCue | null => {
    if (month < 0 || day < 1 || day > 31) return null;
    let when = Date.UTC(published.getUTCFullYear(), month, day);
    if (when > pubDay + 2 * DAY_MS) when = Date.UTC(published.getUTCFullYear() - 1, month, day);
    const back = Math.round((pubDay - when) / DAY_MS);
    return back <= 1 ? { daysBack: Math.max(0, back) } : "stale";
  };
  scan(LONG_AGO_RX, () => "stale");
  scan(TODAY_RX, () => ({ daysBack: 0 }));
  scan(YESTERDAY_RX, () => ({ daysBack: 1 }));
  // "At the weekend": today on a Saturday or Sunday, yesterday on a Monday, older after that.
  scan(WEEKEND_RX, (m) => (/^last/i.test(m[0]) && pubDow !== 1 ? "stale" : pubDow === 0 || pubDow === 6 ? { daysBack: 0 } : pubDow === 1 ? { daysBack: 1 } : "stale"));
  scan(WEEKDAY_RX, (m) => {
    if ((m[1] ?? "").toLowerCase().startsWith("next")) return null;
    const name = m[2].toLowerCase();
    const dow = Math.max(WEEKDAYS.indexOf(name), WEEKDAYS_FR.indexOf(name));
    let back = (pubDow - dow + 7) % 7;
    if (m[1] && back === 0) back = 7; // "last Monday", published on a Monday
    return back <= 1 ? { daysBack: back } : "stale";
  });
  scan(DAY_MONTH_RX, (m) => fromDate(monthIndex(m[2]), Number(m[1])));
  scan(MONTH_DAY_RX, (m) => fromDate(monthIndex(m[1]), Number(m[2])));
  scan(IN_MONTH_RX, (m) => (monthIndex(m[1]) !== published.getUTCMonth() ? "stale" : null));
  if (cues.length === 0) return null;
  // The date nearest the event wording is the event's.
  return cues.sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0].cue;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s+[-–—|]\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

/** A sentence as the supporting quote — the whole sentence when it is short
 *  enough, otherwise a window around the match. Always a verbatim piece of
 *  the text, because verification will look for it there. */
function clip(sentence: string, at: number): string {
  if (sentence.length <= 300) return sentence;
  const start = Math.max(0, sentence.lastIndexOf(" ", Math.max(0, at - 120)) + 1);
  const end = sentence.indexOf(" ", Math.min(sentence.length - 1, at + 170));
  return sentence.slice(start, end === -1 ? sentence.length : end);
}

const reject = (reason: string, note: string): RawCoding => ({ is_event_report: false, rejection_reason: reason, rejection_note: note });

/** The text this tier reads for an item: its headline, then the opening of its feed summary. */
export function headlineText(item: HeadlineItem): string {
  const title = (item.title ?? "").trim();
  const summary = (item.feedText ?? "").replace(/\s+/g, " ").trim();
  const opening = summary.length > SUMMARY_CHARS ? summary.slice(0, summary.lastIndexOf(" ", SUMMARY_CHARS)) : summary;
  // A feed summary very often begins by repeating the headline.
  const rest = title && opening.toLowerCase().startsWith(title.toLowerCase()) ? opening.slice(title.length).replace(/^[\s.:–—-]+/, "") : opening;
  return [title, rest].filter(Boolean).join(". ").replace(/\.\.+/g, ".");
}

/**
 * Codes one item from its headline and summary. The result has the same
 * shape as a model's coding and must go through verifyCoding() like one.
 */
export function codeHeadline(item: HeadlineItem, now = new Date()): RawCoding {
  const title = (item.title ?? "").trim();
  const text = headlineText(item);
  if (text.length < 25) return reject("unreadable", "No headline or summary long enough to code.");

  if (NOT_SECURITY_RX.test(title)) return reject("not_security_related", "Headline is about sport, culture or business.");
  const oldYear = [...title.matchAll(/\b(19|20)\d\d\b/g)].some((m) => Number(m[0]) < now.getUTCFullYear());
  if (RETROSPECTIVE_RX.test(title) || oldYear) return reject("retrospective", "Headline refers to past events.");
  if (LONG_RUNNING_RX.test(title)) return reject("retrospective", "Headline frames this as part of a long-running situation rather than a new event.");
  if (NOT_NEWS_RX.test(title) || ANALYSIS_RX.test(title)) return reject("commentary_or_analysis", "Headline marks this as commentary, analysis, a report or a round-up, not a report of a new event.");
  if (LEGAL_RX.test(title)) return reject("legal_or_court", "Headline is about legal proceedings.");
  if (REACTION_RX.test(title)) return reject("diplomatic_or_political_only", "Headline is a reaction to, or a statement about, an event — not a report of the event.");
  if (IMPACT_RX.test(title)) return reject("humanitarian_only", "Headline is about the consequences of fighting, not a new armed event.");
  if (ELSEWHERE_RX.test(title)) return reject("outside_africa", "Headline names a place outside Africa and the Middle East.");

  // The headline's own sentences, then the summary's.
  const summarySentences = splitSentences(title && text.startsWith(title) ? text.slice(title.length).replace(/^[\s.]+/, "") : text);
  const sentences = [...(title && text.startsWith(title) ? splitSentences(title) : []), ...summarySentences];
  const publishedMs = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
  const published = Number.isFinite(publishedMs) ? new Date(publishedMs) : now;
  const found: { id: IndicatorId; quote: string; sentence: string; daysBack: number | null }[] = [];
  let staleOnly = 0;
  // The sentence after the headline is the story's opening; when the wording
  // that states an event carries no date of its own, the opening's date is
  // the story's ("...came under attack on Saturday").
  const opening = title && text.startsWith(title) ? (summarySentences[0] ?? null) : null;
  const openingCue = opening ? dateCue(opening, 0, 0, published) : null;
  /** Every place the text states this event, with the date each gives. The
   *  event is kept if any of them dates it to the publication day or the
   *  day before, or nothing dates it at all; it is dropped if the only
   *  dates given put it earlier ("...last week", "...on September 21"). */
  const keep = (id: IndicatorId, matches: { sentence: string; at: number; end: number }[]) => {
    if (matches.length === 0) return;
    let cues = matches.map((m) => dateCue(m.sentence, m.at, m.end, published));
    if (cues.every((c) => c === null) && !matches.some((m) => m.sentence === opening)) cues = [openingCue];
    const fresh = cues.find((c): c is { daysBack: number } => !!c && c !== "stale");
    if (!fresh && cues.includes("stale")) {
      staleOnly++;
      return;
    }
    found.push({ id, quote: clip(matches[0].sentence, matches[0].at), sentence: matches[0].sentence, daysBack: fresh ? fresh.daysBack : null });
  };
  for (const rule of RULES) {
    const matches: { sentence: string; at: number; end: number }[] = [];
    for (const s of sentences) {
      const m = rule.rx.map((rx) => rx.exec(s)).find(Boolean);
      if (!m) continue;
      if (HYPOTHETICAL_RX.test(s) || (rule.unless && rule.unless.test(s))) continue;
      // The wording must state something that happened, not describe a standing situation.
      if (BACKGROUND_RX.test(clauseAt(s, m.index))) continue;
      matches.push({ sentence: s, at: m.index, end: m.index + m[0].length });
    }
    keep(rule.id, matches);
  }
  // A named armed group and a violent act in one sentence ("JNIM fighters
  // kill 12 in Mopti") is an attack even without a generic word like "gunmen".
  if (!found.some((f) => f.id === "attack_on_civilians" || f.id === "attack_on_security_forces")) {
    const actRx = new RegExp(`\\b(?:${VIOLENT_ACTS})\\b`, "i");
    const matches = sentences.filter((x) => actRx.test(x) && matchNonStateArmedGroups(x).length > 0 && !HYPOTHETICAL_RX.test(x) && !NOT_ARMED_ATTACK_RX.test(x) && !BACKGROUND_RX.test(x)).map((x) => ({ sentence: x, at: 0, end: x.length }));
    keep("attack_on_civilians", matches);
  }
  if (found.length === 0) {
    return staleOnly > 0
      ? reject("retrospective", "The headline or summary dates the event more than a day before publication.")
      : reject("threat_or_warning_only", "No explicit, completed armed event is stated in the headline or summary.");
  }

  // Where: the place named with the event itself, then the headline, then anywhere in the text.
  const eventSentences = [...new Set(found.map((f) => f.sentence))];
  const usable = (loc: TextLocation | null) => (loc && loc.precision !== "country" ? loc : null);
  const location = eventSentences.map((s) => usable(locateText(s))).find(Boolean) ?? usable(locateText(title)) ?? usable(locateText(text));
  if (!location) {
    const countryOnly = locateText(text);
    return countryOnly
      ? reject("unverified", `Names ${countryName(countryOnly.countryCode)} but no town or region; left for a full reading.`)
      : reject("outside_africa", "Names no place in Africa or the Middle East.");
  }

  const toll = deathToll([...eventSentences, ...sentences.filter((s) => !eventSentences.includes(s))]);
  const indicators = found.map((f) => ({ id: f.id as string, quote: f.quote }));
  const ids = new Set(found.map((f) => f.id));
  // Ten or more civilians killed in one attack is the codebook's mass-atrocity threshold.
  if (toll && toll.count >= 10 && ids.has("attack_on_civilians") && CIVILIANS_RX.test(toll.quote)) indicators.push({ id: "mass_atrocity", quote: toll.quote });
  // Displacement counts only as a consequence of an armed event reported alongside it.
  const displaced = sentences.find((s) => DISPLACEMENT_RX.test(s) && !HYPOTHETICAL_RX.test(s) && dateCue(s, 0, s.length, published) !== "stale");
  if (displaced) indicators.push({ id: "mass_displacement", quote: clip(displaced, 0) });

  const stated = found.map((f) => f.daysBack).filter((d): d is number => d !== null);
  const eventDay = stated.length ? new Date(Date.UTC(published.getUTCFullYear(), published.getUTCMonth(), published.getUTCDate()) - Math.min(...stated) * DAY_MS).toISOString().slice(0, 10) : null;

  const event: RawCodedEvent = {
    country: countryName(location.countryCode),
    country_iso2: location.countryCode,
    place: location.precision === "place" ? location.label : null,
    place_in_text: location.precision === "place" ? location.matchedName : null,
    // For a town, the region is taken only if the text names it too.
    admin1: location.precision === "region" ? location.label : regionNamedIn(text, location.countryCode),
    lat: location.lat,
    lon: location.lon,
    // The day the text gives ("on Sunday", "yesterday"), else null: the publication date is then used.
    event_date: eventDay,
    novelty: "new",
    actors: [...new Set([...matchNonStateArmedGroups(text), ...matchStateMilitaries(text)])].slice(0, 6),
    indicators,
    fatalities: toll?.count ?? null,
    fatalities_quote: toll?.quote ?? null,
    trajectory: "unclear",
    trajectory_reason: null,
    what_happened: title.length >= 20 ? title : text.slice(0, 280),
    significance: null,
    confidence: "low",
  };
  return { is_event_report: true, events: [event] };
}
