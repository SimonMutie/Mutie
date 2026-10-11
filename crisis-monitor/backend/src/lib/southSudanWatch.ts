import type { Coding, Watch } from "./electionWatch";

/**
 * South Sudan Watch: the live half for the transition and the conflict.
 *
 * The same engine as the Kenya watch reads the platform's feeds every 15
 * minutes, codes each headline by written rules, places it in a state and
 * groups it with other reports of the same event. What is stored is the
 * headline, a short summary and the link. Reports start unverified, and an
 * analyst verifies or rejects them.
 *
 * Coding covers the conflict (clashes, attacks on civilians, sexual violence,
 * abductions, displacement), the agreement (ceasefire violations, breaches
 * of the Revitalised Agreement, political detention) and the calendar. Leads
 * for the election product (a decree, an NEC notice, an RJMEC or UN report,
 * a court step in the Machar trial) go to a queue and are never written into
 * the government timeline or the benchmarks automatically.
 */

export const SS_CATEGORIES = [
  "armed_clash",
  "civilian_harm",
  "sexual_violence",
  "abduction",
  "displacement",
  "ceasefire_violation",
  "agreement_breach",
  "political_detention",
  "aid_obstruction",
  "aid_looted",
  "aid_worker_abducted",
  "aid_worker_killed",
  "aid_worker_injured",
  "health_attack",
  "school_attack",
  "utility_attack",
  "coverage",
] as const;

export const SS_LABELS: Record<string, string> = {
  armed_clash: "Armed clashes",
  civilian_harm: "Attacks on civilians",
  sexual_violence: "Sexual violence",
  abduction: "Abductions",
  displacement: "Displacement",
  ceasefire_violation: "Ceasefire violations",
  agreement_breach: "Peace agreement breaches",
  political_detention: "Political detention",
  aid_obstruction: "Aid work obstructed or restricted",
  aid_looted: "Aid facilities looted",
  aid_worker_abducted: "Aid workers abducted",
  aid_worker_killed: "Aid workers killed",
  aid_worker_injured: "Aid workers injured",
  health_attack: "Attacks on health care",
  school_attack: "Attacks on schools",
  utility_attack: "Attacks on water and power",
  coverage: "Transition coverage",
};

/* ── places ───────────────────────────────────────────────── */

export const SS_STATES: [string, string][] = [
  ["CE", "Central Equatoria"], ["EE", "Eastern Equatoria"], ["JG", "Jonglei"],
  ["LK", "Lakes"], ["NBG", "Northern Bahr el Ghazal"], ["UN", "Unity"],
  ["UP", "Upper Nile"], ["WR", "Warrap"], ["WBG", "Western Bahr el Ghazal"],
  ["WE", "Western Equatoria"], ["AB", "Abyei Area"],
];

/** Counties (ADM2) and the state each sits in, from the boundary file, plus towns named in reporting. */
export const SS_COUNTY_STATE: [string, string][] = [
  ["Abiemnhom", "UN"], ["Akobo", "JG"], ["Aweil Centre", "NBG"], ["Aweil East", "NBG"],
  ["Aweil North", "NBG"], ["Aweil South", "NBG"], ["Aweil West", "NBG"], ["Awerial", "LK"],
  ["Ayod", "JG"], ["Baliet", "UP"], ["Bor South", "JG"], ["Budi", "EE"],
  ["Canal", "JG"], ["Cueibet", "LK"], ["Duk", "JG"], ["Ezo", "WE"],
  ["Fangak", "JG"], ["Fashoda", "UP"], ["Gogrial East", "WR"], ["Gogrial West", "WR"],
  ["Guit", "UN"], ["Ibba", "WE"], ["Ikotos", "EE"], ["Juba", "CE"],
  ["Jur River", "WBG"], ["Kajo-keji", "CE"], ["Kapoeta East", "EE"], ["Kapoeta North", "EE"],
  ["Kapoeta South", "EE"], ["Koch", "UN"], ["Lafon", "EE"], ["Lainya", "CE"],
  ["Leer", "UN"], ["Longochuk", "UP"], ["Luakpiny", "UP"], ["Maban", "UP"],
  ["Magwi", "EE"], ["Maiwut", "UP"], ["Malakal", "UP"], ["Manyo", "UP"],
  ["Maridi", "WE"], ["Mayendit", "UN"], ["Mayom", "UN"], ["Melut", "UP"],
  ["Morobo", "CE"], ["Mundri East", "WE"], ["Mundri West", "WE"], ["Mvolo", "WE"],
  ["Nagero", "WE"], ["Nasir", "UP"], ["Nyirol", "JG"], ["Nzara", "WE"],
  ["Panyijiar", "UN"], ["Panyikang", "UP"], ["Pariang", "UN"], ["Pibor", "JG"],
  ["Pigi", "JG"], ["Pochalla", "JG"], ["Raga", "WBG"], ["Renk", "UP"],
  ["Rubkona", "UN"], ["Rumbek Centre", "LK"], ["Rumbek East", "LK"], ["Rumbek North", "LK"],
  ["Tambura", "WE"], ["Terekeka", "CE"], ["Tonj East", "WR"], ["Tonj North", "WR"],
  ["Tonj South", "WR"], ["Torit", "EE"], ["Twic", "WR"], ["Twic East", "JG"],
  ["Ulang", "UP"], ["Uror", "JG"], ["Wau", "WBG"], ["Wulu", "LK"],
  ["Yambio", "WE"], ["Yei", "CE"], ["Yirol East", "LK"], ["Yirol West", "LK"],
];

/** Short county names that are also ordinary words or surnames; they are not matched on their own. */
const AMBIGUOUS = new Set(["Raga", "Koch", "Duk", "Ezo", "Guit", "Uror", "Budi", "Ibba", "Twic", "Melut", "Wulu", "Lafon"]);
const TOWNS: [string, string][] = [["Bentiu", "UN"], ["Kuajok", "WR"], ["Aweil", "NBG"], ["Rumbek", "LK"], ["Abyei", "AB"], ["Nasir", "UP"], ["Malakal", "UP"], ["Bor", "JG"], ["Yambio", "WE"], ["Torit", "EE"]];

const norm = (s: string) => s.toLowerCase().replace(/[-'’/]/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const PLACES: [string, string][] = (() => {
  const m: [string, string][] = [];
  for (const [name, code] of SS_COUNTY_STATE) if (!AMBIGUOUS.has(name) && name.length >= 3) m.push([norm(name), code]);
  for (const [code, name] of SS_STATES) {
    // "Unity" and "Lakes" are everyday words: only the "state" form names the place.
    if (code !== "UN" && code !== "LK") m.push([norm(name), code]);
    m.push([`${norm(name)} state`, code]);
  }
  for (const [name, code] of TOWNS) m.push([norm(name), code]);
  return m.sort((a, b) => b[0].length - a[0].length);
})();

/** The state a text names, preferring one in the headline. "Unity" and "Lakes" alone are too common, so they need "state". */
export function findState(title: string, text: string): string | null {
  const find = (s: string) => {
    const hay = ` ${norm(s)} `;
    let best: { at: number; code: string } | null = null;
    for (const [name, code] of PLACES) {
      const at = hay.indexOf(` ${name} `);
      if (at >= 0 && (!best || at < best.at)) best = { at, code };
    }
    return best?.code ?? null;
  };
  return find(title) ?? find(text);
}

const SS_NAMES = new Map<string, string>(SS_STATES);
export const stateName = (code: string | null | undefined) => (code ? SS_NAMES.get(code) ?? null : null);

/* ── coding ───────────────────────────────────────────────── */

const SS_CTX = /\b(south sudan|south sudanese|juba|sspdf|spla-?io|white army|machar|kiir|r-arcss|revitali[sz]ed agreement|unified forces|national elections commission|rjmec|jmec)\b|\.ss$/i;
const SEXUAL = /\b(rape[ds]?|gang[- ]rape|sexual (?:violence|assault|abuse|exploitation)|sexually (?:assaulted|abused)|sexual violence)\b/i;
const ABDUCT = /\b(abduct\w*|kidnap\w*|disappear\w*|forcibly (?:taken|recruited))\b/i;
const CEASEFIRE = /\b(ceasefire|cease-fire|cessation of hostilities|truce)\b/i;
const BREACH = /\b(violat\w*|breach\w*|broke|broken|despite|flout\w*|undermin\w*|attack\w*|clash\w*|fighting)\b/i;
const AGREEMENT = /\b(r-arcss|revitali[sz]ed agreement|peace (?:deal|agreement)|unified forces|transitional (?:period|government|constitution)|permanent constitution|cantonment|rjmec)\b/i;
const AGREEMENT_FAIL = /\b(violat\w*|breach\w*|fail\w*|stall\w*|delay\w*|reneg\w*|flout\w*|ignor\w*|undermin\w*|collapse\w*|sidelin\w*|remov\w*)\b/i;
const DETAIN = /\b(arrest\w*|detain\w*|detention|jailed|imprison\w*|charged|treason|custody|sentenced|house arrest)\b/i;
const POLITICAL = /\b(opposition|spla-?io|machar|official|minister|governor|lawmaker|mps?|journalists?|activists?|politicians?|party|cabinet|commissioner)\b/i;
const ARMED = /\b(clash\w*|fighting|fought|battle\w*|attack\w*|ambush\w*|raid\w*|airstrikes?|air strikes?|bombard\w*|barrel bombs?|offensive|captured|seized|overran|shelling|gunfire|killed|shot dead|artillery|militias?|troops|soldiers|sspdf|spla-?io|white army)\b/i;
const CIVILIAN = /\b(civilians?|villages?|villagers?|women|children|cattle raid\w*|looted|looting|burn(?:ed|t)|torched|razed|massacre\w*|aid workers?|humanitarian|hospital|market)\b/i;
const DISPLACE = /\b(displac\w*|fled|flee\w*|refugees?|idps?|exodus|uprooted)\b/i;
const ELECTION = /\b(election|elections|electoral|nec|voter|voters|registration|census|constitution|campaign|candidates?|transition\w*|peace)\b/i;
const EXPLAINER = /^(?:how|why|what|opinion|analysis|editorial|explainer|explained|comment|letters?)\b|\b(?:opinion|analysis|editorial|explainer):/i;
/* Humanitarian work and critical infrastructure. Acronyms are matched in capitals only, so "who" is not "WHO". */
const HUMAN_WORDS = /\b(aid workers?|aid staff|aid personnel|humanitarian (?:workers?|staff|personnel|agenc(?:y|ies)|convoys?|compounds?|premises|organi[sz]ations?|operations?|partners?|access)|UN staff|Doctors Without Borders|Médecins Sans Frontières|Medecins Sans Frontieres|Red Cross|Red Crescent)\b/i;
const HUMAN_ACRO = /\b(WFP|UNICEF|OCHA|MSF|ICRC|IRC|NRC|WHO|NGOs?|UNHCR|IOM)\b/;
const AID_SITE = /\b(warehouses?|aid (?:stores?|warehouses?|depots?|compounds?|premises|facilit(?:y|ies)|convoys?|supplies|trucks?)|humanitarian (?:compounds?|premises|warehouses?|facilit(?:y|ies)|convoys?|supplies|hubs?)|relief (?:supplies|stores?|warehouses?|items)|food (?:stores?|stocks?|warehouses?))\b/i;
const LOOT = /\b(loots?|looted|looting|ransacked|plundered|pillaged|stripped|stole|stolen)\b/i;
const ACCESS_DENY = /\b(denied (?:access|entry)|access (?:was |has been |remained |continues? to be )?(?:denied|restricted|blocked|obstructed|impeded|suspended)|restrict\w* (?:access|movement|aid)|block(?:ed|ing)? (?:aid|humanitarian|access|convoys?|deliveries)|obstruct\w* (?:aid|humanitarian|access|deliveries|operations)|impeded (?:aid|access)|suspend\w* (?:aid|humanitarian|operations|programmes?))\b/i;
const KILLED = /\b(killed|dead|died|murdered|lynched|slain|shot dead|fatal\w*)\b/i;
const INJURED = /\b(injur\w*|wounded)\b/i;
const ATTACK = /\b(attack\w*|shell\w*|bomb\w*|air ?strikes?|struck|strikes?|raid\w*|burn\w*|torch\w*|destroy\w*|ransack\w*|targeted|targeting|fired|shot|seized|occupied|looted|looting)\b/i;
const HEALTH = /\b(hospitals?|clinics?|health (?:centres?|centers?|facilit(?:y|ies)|posts?|workers?|staff|care)|healthcare (?:workers?|facilit(?:y|ies)|staff|centres?)|medical (?:staff|workers?|facilit(?:y|ies)|centres?|personnel|supplies)|ambulances?|maternity|nurses?|midwives?|doctors?)\b/i;
const SCHOOL = /\b(schools?|classrooms?|universit(?:y|ies)|teachers?|pupils?|students?)\b/i;
const UTILITY = /\b(water (?:points?|pumps?|stations?|supply|systems?|facilit(?:y|ies)|treatment|plants?|sources?)|boreholes?|power (?:stations?|plants?|lines?|grid|supply|infrastructure)|electricity|substations?|solar (?:plants?|panels?|farms?)|transmission (?:lines?|towers?)|telecoms?|mobile (?:towers?|networks?)|telecom masts?)\b/i;

const DISPLACED_N = /(\d{1,3}(?:[ ,]\d{3})+|\d{4,7})\s+(?:\w+\s+){0,4}?(?:displaced|fled|uprooted)/i;

const NUM = "(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|hundreds?)";
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, dozens: 24, hundred: 100, hundreds: 200 };
const DEATHS_A = new RegExp(`\\b${NUM}\\s+(?:\\w+\\s+){0,2}?(?:were\\s+|have\\s+been\\s+)?(?:killed|dead|died|murdered|lynched)\\b`, "i");
const DEATHS_B = new RegExp(`\\b(?:killing|killed|kills|kill|death toll(?: rises to| of)?|deaths? of)\\s+(?:at least\\s+|over\\s+|more than\\s+|about\\s+)?${NUM}\\b`, "i");

/** How many people a text says were killed. A bare "killed" counts as one; null when none is stated. */
export function southSudanDeaths(text: string): number | null {
  for (const re of [DEATHS_A, DEATHS_B]) {
    const m = re.exec(text);
    if (m) {
      const raw = m[1].toLowerCase();
      const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw] ?? null;
      if (n !== null && n > 0 && n < 5000) return n;
    }
  }
  return /\b(shot dead|killed|murdered|lynched|died)\b/i.test(text) ? 1 : null;
}

/** How many people a text says were displaced, or null. */
export function displacedStated(text: string): number | null {
  const m = DISPLACED_N.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/[ ,]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? n : null;
}

const SS_DEATH_CATEGORIES = ["armed_clash", "civilian_harm", "abduction", "aid_worker_abducted", "aid_worker_killed", "health_attack", "school_attack", "utility_attack"];

export function codeSouthSudan(title: string, summary: string, domain: string): Coding | null {
  const text = `${title}. ${summary}`.replace(/\s+/g, " ");
  const stateCode = findState(title, summary);
  if (!(SS_CTX.test(text) || stateCode !== null || /\.ss$/.test(domain))) return null;
  const explainer = EXPLAINER.test(title.trim());

  let category: string | null = null;
  if (!explainer) {
    const humanitarian = HUMAN_WORDS.test(text) || HUMAN_ACRO.test(text);
    if (SEXUAL.test(text)) category = "sexual_violence";
    else if (humanitarian && ABDUCT.test(text)) category = "aid_worker_abducted";
    else if (humanitarian && KILLED.test(text)) category = "aid_worker_killed";
    else if (humanitarian && INJURED.test(text)) category = "aid_worker_injured";
    else if (AID_SITE.test(text) && LOOT.test(text)) category = "aid_looted";
    else if ((humanitarian && (DETAIN.test(text) || ACCESS_DENY.test(text))) || (AID_SITE.test(text) && ACCESS_DENY.test(text))) category = "aid_obstruction";
    else if (ABDUCT.test(text)) category = "abduction";
    else if (HEALTH.test(text) && ATTACK.test(text)) category = "health_attack";
    else if (SCHOOL.test(text) && ATTACK.test(text)) category = "school_attack";
    else if (UTILITY.test(text) && ATTACK.test(text)) category = "utility_attack";
    else if (CEASEFIRE.test(text) && BREACH.test(text)) category = "ceasefire_violation";
    else if (AGREEMENT.test(text) && AGREEMENT_FAIL.test(text)) category = "agreement_breach";
    else if (DETAIN.test(text) && POLITICAL.test(text)) category = "political_detention";
    else if (DISPLACE.test(text) && displacedStated(text) !== null) category = "displacement"; // a stated number of displaced people leads
    else if (ARMED.test(text) && CIVILIAN.test(text)) category = "civilian_harm";
    else if (ARMED.test(text)) category = "armed_clash";
    else if (DISPLACE.test(text)) category = "displacement";
  }
  if (!category) {
    // Calendar and decree items are kept as coverage so that the lead queue sees them.
    if (!ELECTION.test(text) && southSudanLeadKind(title, summary) === null) return null;
    return { category: "coverage", severity: 1, fatalities: null, countyCode: stateCode };
  }
  const deaths = SS_DEATH_CATEGORIES.includes(category) ? southSudanDeaths(text) : null;
  const displaced = category === "displacement" ? displacedStated(text) : null;
  let severity: 1 | 2 | 3 = 1;
  if (deaths || (displaced && displaced >= 10_000)) severity = 3;
  else if (/\b(injur\w+|wounded|abduct\w*|kidnap\w*|sexual|rape\w*|arrest\w*|detain\w*|charged|displac\w*|ceasefire|breach\w*)\b/i.test(text)) severity = 2;
  return { category, severity, fatalities: deaths, countyCode: stateCode };
}

/** What kind of lead, if any, a report is for the election product. */
export function southSudanLeadKind(title: string, summary: string): string | null {
  const t = `${title}. ${summary}`;
  if (/\b(decree|dismiss\w*|sacks?|sacked|reshuffle|reinstat\w*|reappoint\w*|appointed|relieved|fired)\b/i.test(t) && /\b(minister|governor|vice[- ]president|director|inspector|ambassador|envoy|commissioner|secretary|chairman|police|security)\b/i.test(t)) return "decree";
  if (/\b(NEC|national elections commission|election date|electoral (?:calendar|timetable)|voter registration|civic education|postpone\w*|election (?:funding|law|bill)|elections? (?:act|law))\b/i.test(t)) return "calendar";
  if (/\b(RJMEC|JMEC|R-ARCSS|revitali[sz]ed agreement|unified forces|transitional period|permanent constitution|census|NCRD|CTRH|hybrid court)\b/i.test(t) && /\b(report|status|deadline|extend\w*|statement|benchmark|milestone|implement\w*|briefing)\b/i.test(t)) return "benchmark";
  if (/\b(machar|special court)\b/i.test(t) && /\b(trial|verdict|adjourn\w*|charge\w*|sentenc\w*|bail)\b/i.test(t)) return "court";
  return null;
}

export const SS_WATCH: Watch = {
  key: "ss",
  csvName: "south-sudan-watch",
  t: { items: "ss_items", leads: "ss_leads", content: "ss_content", state: "ss_state" },
  categories: SS_CATEGORIES,
  labels: SS_LABELS,
  placeRe: /^(CE|EE|JG|LK|NBG|UN|UP|WR|WBG|WE|AB)$/,
  query: '("South Sudan" OR "South Sudanese" OR Juba OR SSPDF OR "SPLA-IO" OR "White Army" OR Machar OR Kiir OR "R-ARCSS" OR "Revitalised Agreement" OR "Revitalized Agreement" OR "National Elections Commission" OR RJMEC OR Jonglei OR "Upper Nile" OR Nasir OR Malakal OR Bentiu OR Akobo OR Pibor OR Yei OR Torit OR Wau OR Rumbek OR Aweil)',
  code: codeSouthSudan,
  leadKind: southSudanLeadKind,
  leadKinds: ["decree", "calendar", "benchmark", "court"],
  contentKinds: ["office", "benchmark", "milestone", "candidate"],
  deathCategories: SS_DEATH_CATEGORIES,
  places: SS_NAMES,
};
