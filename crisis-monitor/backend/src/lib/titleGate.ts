import { candidatePriority, isCandidateText } from "./escalationKeywords";
import { aiSettingsNow } from "./aiSettings";

/**
 * The headline gate: an article is read (and costs an AI call) only when its headline is about conflict, security,
 * crime, intercommunal violence or killing. Everything else is passed over unread.
 *
 * Deliberately over-inclusive: a headline that is not about violence but uses one of these words ("Mob of fans
 * greets team", "Strike by teachers") costs one short reading and is then rejected by the coder, whereas a missed
 * incident is lost. So the lists below are word stems, in every language the Lens reads, and include the vague
 * words headlines often use for violence ("tension", "unrest", "incident", "chaos", "residents flee").
 *
 * A headline passes when it matches:
 *   1. the escalation pipeline's own lexicons: its conflict terms, armed groups and militaries by name, and its
 *      English, French, Portuguese, Arabic, Amharic, Tigrinya, Oromo, Somali and Swahili word lists
 *      (escalationKeywords.ts);
 *   2. the stems below, by category and language;
 *   3. any extra words an admin adds in Settings → AI reading.
 */

/** Latin-script stems. Each is matched at the start of a word ("kill" matches killed, killings, killers). */
const STEMS: Record<string, string[]> = {
  // Conflict and military activity.
  conflict: [
    "war$", "wars$", "warfare", "warring", "warlord", "conflict", "fight", "clash", "battl", "combat", "offensive", "counteroffensive", "counter-offensive",
    "hostilit", "frontline", "front line", "front-line", "airstrike", "air strike", "air raid", "strike", "struck", "drone", "missile", "rocket", "mortar",
    "shell", "bomb", "bombard", "artiller", "grenade", "sniper", "gunship", "warplane", "jet fighter", "fighter jet", "militia", "militant", "milit",
    "rebel", "insurg", "jihad", "islamist", "extremis", "terror", "armed", "gunm", "fighters", "combatant", "paramilitar", "mercenar", "troop", "soldier",
    "army", "armies", "defence force", "defense force", "peacekeep", "ceasefire", "cease-fire", "truce", "siege", "besieg", "blockade", "incursion",
    "invasion", "invad", "occupation", "occupied", "annex", "seize", "seizure", "seized", "captur", "recaptur", "retake", "retook", "overrun", "overran",
    "withdraw", "retreat", "assault", "onslaught", "escalat", "flare", "erupt", "coup$", "coups$", "putsch", "mutin", "junta", "uprising", "revolt",
    "secession", "separatis", "standoff", "stand-off", "skirmish", "firefight", "gunfight", "crossfire", "cross-fire", "hostage", "landmine", "mine blast",
    "unexploded", "ied", "explosive", "explosion", "explod", "blast", "detonat", "suicide bomb",
  ],
  // Security and unrest.
  security: [
    "security", "insecur", "attack", "ambush", "raid", "assail", "intruder", "kidnap", "abduct", "hostage", "ransom", "curfew",
    "state of emergency", "emergency rule", "martial law", "unrest", "tension", "turmoil", "chaos", "violen", "riot", "protest", "demonstrat",
    "crackdown", "clampdown", "teargas", "tear gas", "tear-gas", "live bullets", "live rounds", "gunshot", "gunfire", "shooting", "shoot", "shot",
    "police", "gendarm", "checkpoint", "roadblock", "manhunt", "arrest", "detain", "detention", "disappear", "missing", "abuse", "atrocit", "torture",
    "rape$", "raped$", "rapes$", "rapist", "sexual violence", "displac", "flee$", "flees$", "fled$", "fleeing", "evacuat", "refugee", "idp$", "idps$", "incident", "threat", "alert", "lockdown",
    "jailbreak", "prison break", "escape", "infiltrat", "spy", "espionage", "sabotag", "arson", "torch", "burn$", "burns$", "burned$", "burnt$", "burning$", "razed", "destroy", "vandal",
  ],
  // Crime.
  crime: [
    "crime", "criminal", "murder", "homicid", "manslaughter", "robber", "rob$", "robs$", "robbed$", "robbing$", "armed robbery", "heist", "burglar", "theft", "thief", "thieves", "loot",
    "bandit", "gang", "cartel", "mafia", "rustl", "cattle raid", "livestock theft", "carjack", "hijack", "pirat", "smuggl", "traffick", "poach",
    "extort", "racketeer", "stab$", "stabbed", "stabbing", "machete", "hack$", "hacked to death", "lynch", "mob$", "mobs$", "vigilant", "kangaroo court", "jungle justice", "mob justice", "extrajudicial",
    "assassin", "hitm", "contract kill", "femicide", "gbv", "gender-based violence", "domestic violence", "child abuse", "defilement",
  ],
  // Intercommunal and identity violence.
  intercommunal: [
    "intercommunal", "inter-communal", "communal", "intercommunity", "inter-community", "interethnic", "inter-ethnic", "ethnic", "tribal", "tribe",
    "clan", "sectarian", "religious violence", "herder", "pastoralist", "farmers and herders", "farmer-herder", "nomad", "grazing", "land dispute", "land conflict", "border dispute",
    "boundary dispute", "water dispute", "resource conflict", "revenge", "reprisal", "retaliat", "vendetta", "feud", "cycle of violence", "pogrom",
    "ethnic cleansing", "genocid", "hate speech", "xenophob",
  ],
  // Killing, death and harm.
  killing: [
    "kill", "dead$", "deadly", "death", "die$", "died$", "dies$", "dying$", "toll$", "fatal", "fatalit", "casualt", "massacr", "slaughter", "slay", "slain", "executed$", "execution", "executes$",
    "behead", "decapitat", "murder", "bodies", "body$", "corpse", "human remains", "mass grave", "lives lost", "lost lives", "lose lives", "perish", "wound",
    "injur", "maim", "hurt", "victim", "survivor", "bloodshed", "bloody", "bloodbath", "carnage", "funeral", "mourn",
  ],
  french: [
    "attaqu", "assaut", "tué", "tués$", "tuerie", "mort$", "morts$", "mortel", "décès", "blessé", "victime", "massacr", "assassin", "meurtr", "égorg", "decapit", "décapit",
    "affront", "heurt", "combat", "guerre", "conflit", "violen", "insécurit", "sécurit", "armée", "militaire", "soldat", "gendarm", "police$", "policier", "policiers$", "rebelle",
    "milice", "milicien", "djihad", "jihad", "terroris", "islamist", "extrémist", "enlèvement", "enlev", "kidnapp", "otage", "rançon", "frappe", "drone",
    "bombard", "obus", "explos", "engin explosif", "mine$", "mines antipersonnel", "embuscade", "incursion", "braquag", "bandit", "coupeurs de route", "pillag", "vol de bétail",
    "incendi", "brûl", "couvre-feu", "déplac", "fuient", "fuite", "réfugi", "intercommunautaire", "communautaire", "ethnique", "éleveur",
    "représaill", "vengeance", "coup d'état", "coup d’état", "putsch", "mutin", "manifest", "émeute", "répression", "tension", "crise sécuritaire",
    "fusillade", "tirs", "coups de feu", "arrestation", "arrêté", "disparu", "viol", "charnier", "corps sans vie", "cadavre", "carnage", "drame$",
  ],
  portuguese: [
    "ataque", "atac", "morto$", "mortos$", "morta$", "mortas$", "morte$", "mortes$", "morre", "assassin", "ferid", "vítima", "massacr", "chacina", "guerra", "conflito", "confronto", "combate", "violên", "insegur",
    "segurança", "exército", "militar", "soldado", "polícia", "insurgen", "terroris", "jihad", "extremis", "rapto", "rapt", "sequestr", "refém", "reféns",
    "emboscada", "explos", "bomba", "tiroteio", "disparo", "baleado", "bandid", "assalto", "roubo", "saque", "incêndi", "queimad", "deslocad", "refugiad",
    "fuga$", "fogem", "étnic", "tribal", "golpe", "motim", "manifesta", "tumulto", "repressão", "tensão", "detid", "preso", "desaparecid", "violação",
  ],
  swahili: [
    "vita$", "mapigano", "pigana", "shambulio", "shambulizi", "mashambulizi", "shambulia", "ghasia", "vurugu", "fujo", "machafuko", "mzozo", "mgogoro",
    "uhasama", "mauaji", "kuua", "uawa", "wauawa", "majeruhi", "jeruhi", "wafu", "maiti", "miili", "wanamgambo", "magaidi", "ugaidi", "waasi",
    "jeshi", "wanajeshi", "askari", "polisi", "majambazi", "ujambazi", "wezi", "wizi", "utekaji", "teka$", "tekwa", "mateka", "risasi", "mlipuko", "bomu",
    "usalama", "ukosefu wa usalama", "maandamano", "wakimbizi", "kukimbia", "ukabila", "kikabila", "uvamizi", "vamia", "wavamizi", "wizi wa mifugo",
  ],
  hausa: [
    "hari$", "kai hari", "kashe", "an kashe", "kisan", "yan bindiga", "'yan bindiga", "’yan bindiga", "yan ta'adda", "'yan ta'adda", "ta'addanci",
    "garkuwa", "sace", "sacewa", "rikici", "fadan", "tsaro", "rashin tsaro", "sojoji", "yan sanda", "'yan sanda", "barayi", "mutuwa",
    "ya rasu", "jikkata", "boko haram", "makiyaya", "gudun hijira",
  ],
  somali: [
    "dagaal", "weerar", "dilay", "dileen", "la dilay", "dhimash", "dhaawac", "qarax", "ciidam", "duqeyn", "xasuuq", "colaad", "amni", "nabadgelyo", "argagixis",
    "burcad", "afduub", "barakac", "isku dhac", "shabaab", "maleeshiyaad",
  ],
  oromo: ["lola$", "waraana", "haleel", "ajjeef", "ajjeech", "loltoota", "buqqa", "nageenya", "miidhaa", "lubbuu", "hidhame", "ukkaamf", "shanee"],
  kinyarwanda_kirundi: ["intambara", "abishwe", "yishwe", "bishwe", "kwica", "umutekano", "abarwanyi", "ibitero", "igitero", "impunzi", "inyeshyamba"],
  lingala: ["bitumba", "etumba", "babomi", "koboma", "basoda", "mobulu", "bayibi", "banyokoli", "kobunda"],
};

/** Scripts without word boundaries: matched anywhere in the headline. */
const NON_LATIN = [
  // Arabic
  "قتل", "قتلى", "قتيل", "مقتل", "اغتيال", "إعدام", "هجوم", "هجمات", "اشتباك", "اقتتال", "مواجهات", "معارك", "معركة", "قصف", "غارة", "غارات", "مسيرة",
  "مسيّرة", "صاروخ", "انفجار", "تفجير", "عبوة", "اختطاف", "خطف", "رهائن", "إرهاب", "ارهاب", "مليشيا", "ميليشيا", "متمرد", "مسلح", "الجنجويد", "الدعم السريع",
  "الجيش", "عسكري", "قوات", "أمن", "امن", "أمني", "توتر", "عنف", "احتجاج", "مظاهرات", "شغب", "قبلي", "قبلية", "طائفي", "نهب", "سرقة", "عصابة", "جريمة",
  "مجزرة", "إبادة", "نزوح", "نازحين", "لاجئين", "جرحى", "مصاب", "ضحايا", "جثث", "حصار", "هدنة", "انقلاب", "اعتقال", "اختفاء", "اغتصاب", "حريق", "إحراق",
  // Amharic and Tigrinya (Ge'ez script)
  "ጦርነት", "ውጊያ", "ጥቃት", "ግጭት", "ተገደ", "ተገድ", "ግድያ", "ሞቱ", "ሞት", "ቆሰሉ", "ቁስለኛ", "ታጣቂ", "ሽፍታ", "ዘረፋ", "ወንጀል", "ጸጥታ", "ፀጥታ", "ሁከት", "ብጥብጥ",
  "ታገቱ", "እገታ", "ፍንዳታ", "ድሮን", "ሰራዊት", "ሠራዊት", "መከላከያ", "ተፈናቀ", "መፈናቀ", "ፋኖ", "ሸኔ", "ውግእ", "መጥቃዕቲ", "ተቐቲ", "ዕጥቀ",
];

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[ -]/g, "[\\s-]*").replace(/['’]/g, "['’]?");
const ALL = [...new Set(Object.values(STEMS).flat().map((s) => s.toLowerCase()))].sort((a, b) => b.length - a.length);
/** A stem at the start of a word, the rest of the word free ("kill" → killed, killings); a word ending in "$" is
 *  matched only whole, where its stem would catch unrelated words ("rob" → Robert, "die" → diesel, "mort" →
 *  mortgage). */
const STEM_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${ALL.map((w) => (w.endsWith("$") ? `${escape(w.slice(0, -1))}(?![\\p{L}\\p{N}])` : escape(w))).join("|")})`,
  "iu"
);

let extraFor = "";
let extraRe: RegExp | null = null;
/** The admin's own extra words (Settings → AI reading), one per line or comma-separated; each matched as a stem. */
function extraWords(): RegExp | null {
  const raw = aiSettingsNow().extraKeywords ?? "";
  if (raw === extraFor) return extraRe;
  extraFor = raw;
  const words = raw
    .split(/[\n,;]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 2)
    .slice(0, 500);
  extraRe = words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escape).join("|")})|${words.filter((w) => !/[a-z]/i.test(w)).map(escape).join("|") || "(?!)"}`, "iu") : null;
  return extraRe;
}

export function titleIsRelevant(title: string | null | undefined): boolean {
  const t = (title ?? "").trim();
  if (!t) return false;
  return STEM_RE.test(t) || NON_LATIN.some((w) => t.includes(w)) || isCandidateText(t) || candidatePriority(t) > 0 || !!extraWords()?.test(t);
}

/** What a Telegram post or other untitled item is judged by: its own title, else the start of its text. */
export function gateText(c: { title?: string | null; feedText?: string | null }): string {
  return (c.title || (c.feedText ?? "").slice(0, 280)).trim();
}
