import { candidatePriority } from "./escalationKeywords";

/**
 * The headline gate: an article is read (and costs an AI call) only when its headline is about conflict, security,
 * crime, intercommunal violence or killing. Everything else is passed over unread.
 *
 * A headline passes when it names any of the escalation pipeline's own conflict terms, armed groups or militaries,
 * or its words in Amharic, Oromo, Somali and the other local languages (escalationKeywords.ts), or any of the terms
 * below, in English, French, Portuguese and Arabic.
 */

const LATIN: Record<string, string[]> = {
  conflict: ["war", "wars", "warfare", "conflict", "fighting", "fight", "clash", "clashes", "battle", "offensive", "airstrike", "airstrikes", "air strike", "strike", "strikes", "struck", "drone strike", "drone attack", "shelling", "shelled", "bombing", "bombed", "bombard", "artillery", "militia", "militias", "rebel", "rebels", "insurgent", "insurgency", "jihadist", "militant", "armed group", "gunmen", "gunman", "troops", "soldiers", "army", "military", "ceasefire", "truce", "siege", "front line", "frontline", "coup", "mutiny", "paramilitary"],
  security: ["security", "insecurity", "attack", "attacks", "attacked", "attacker", "ambush", "raid", "raided", "explosion", "blast", "ied", "landmine", "suicide bomber", "kidnap", "kidnapped", "kidnapping", "abduct", "abducted", "abduction", "hostage", "hostages", "curfew", "state of emergency", "terror", "terrorist", "terrorism", "extremist", "police", "checkpoint", "displaced", "fled"],
  crime: ["crime", "criminal", "robbery", "robbers", "bandit", "bandits", "banditry", "gang", "gangs", "rustling", "rustlers", "piracy", "pirates", "smuggling", "trafficking", "shooting", "shot", "gunfire", "arson", "looting", "looted", "lynching", "lynched", "mob"],
  intercommunal: ["intercommunal", "inter-communal", "communal", "ethnic violence", "ethnic clashes", "tribal", "herders", "herder", "farmers", "clan", "sectarian", "revenge attack", "reprisal", "land dispute"],
  killing: ["kill", "kills", "killed", "killing", "killings", "dead", "death toll", "deaths", "died", "massacre", "murder", "murdered", "slain", "slaughter", "executed", "execution", "beheaded", "casualties", "wounded", "injured", "bodies"],
  french: ["attaque", "attaques", "tués", "tue", "morts", "mort", "conflit", "affrontements", "combats", "violences", "violence", "armée", "rebelles", "djihadistes", "jihadistes", "enlèvement", "enlevés", "otages", "insécurité", "frappe", "frappes", "assassinat", "assassiné", "bandits", "embuscade", "explosion", "massacre", "milice", "terroristes", "coup d'état"],
  portuguese: ["ataque", "ataques", "mortos", "morto", "conflito", "violência", "insurgentes", "rapto", "raptados", "tiroteio", "massacre", "terroristas", "militares"],
};

const ARABIC = ["قتل", "قتلى", "مقتل", "هجوم", "اشتباك", "اشتباكات", "قصف", "مسلح", "مسلحين", "انفجار", "غارة", "معارك", "اختطاف", "إرهاب", "مجزرة", "جرحى", "الدعم السريع", "الجيش", "نزاع", "عنف"];

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s-]+");
const LATIN_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...new Set(Object.values(LATIN).flat())].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\p{L}\\p{N}])`, "iu");

export function titleIsRelevant(title: string | null | undefined): boolean {
  const t = (title ?? "").trim();
  if (!t) return false;
  return LATIN_RE.test(t) || ARABIC.some((w) => t.includes(w)) || candidatePriority(t) > 0;
}

/** What a Telegram post or other untitled item is judged by: its own title, else the start of its text. */
export function gateText(c: { title?: string | null; feedText?: string | null }): string {
  return (c.title || (c.feedText ?? "").slice(0, 280)).trim();
}
