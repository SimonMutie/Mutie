/**
 * The tone of a piece of text, estimated from its wording.
 *
 * This is a word list, not a model: it costs nothing and runs on every item,
 * but it only knows that "killed", "attack" and "famine" are negative words
 * and "ceasefire", "released" and "agreement" positive ones. It does not
 * understand a sentence — "no deaths were reported" still contains "deaths".
 * It is good enough to show which way coverage of a subject leans and how
 * that changes from day to day; it is not a judgement on any single item,
 * and the interface labels it as an estimate.
 *
 * Scores run from -1 (negative) to 1 (positive), on the same scale and with
 * the same cut-offs (below -0.2 negative, above 0.2 positive) the rest of
 * the platform already uses for the events table's `sentiment` column.
 */

const NEGATIVE_STRONG = [
  "kill", "killed", "kills", "killing", "killings", "dead", "death", "deaths", "die", "died", "dies", "massacre", "massacred", "slaughter", "slaughtered", "murder", "murdered", "assassinated",
  "assassination", "bomb", "bombed", "bombing", "bombings", "explosion", "blast", "airstrike", "airstrikes", "shelling", "shelled", "gunmen", "ambush", "ambushed", "abducted", "abduction",
  "kidnapped", "kidnapping", "kidnap", "hostage", "hostages", "rape", "raped", "torture", "tortured", "beheaded", "genocide", "atrocity", "atrocities", "famine", "starvation", "starving",
  "terror", "terrorist", "terrorists", "terrorism", "coup", "war", "massacres", "executed", "execution", "lynched", "wounded", "casualties", "fatalities",
  "tué", "tués", "tuée", "tuées", "morts", "mort", "massacre", "attentat", "enlevés", "enlèvement", "viol", "guerre", "blessés", "famine", "otages",
];
const NEGATIVE = [
  "attack", "attacks", "attacked", "attacking", "strike", "strikes", "struck", "clash", "clashes", "clashed", "fighting", "fight", "fights", "battle", "battles", "violence", "violent", "conflict",
  "unrest", "riot", "riots", "crisis", "crises", "threat", "threats", "threaten", "threatens", "threatened", "warn", "warns", "warned", "warning", "condemn", "condemns", "condemned", "arrest",
  "arrested", "arrests", "detained", "detention", "jailed", "siege", "besieged", "blockade", "injured", "injuries", "destroyed", "destroy", "destruction", "burned", "burnt", "looted", "looting",
  "displaced", "displacement", "flee", "fled", "fleeing", "refugees", "hunger", "malnutrition", "cholera", "outbreak", "epidemic", "flood", "floods", "flooding", "drought", "collapse", "collapsed",
  "collapses", "tension", "tensions", "hostilities", "hostile", "sanctions", "sanctioned", "corruption", "fraud", "crackdown", "repression", "abuse", "abuses", "violation", "violations", "fear",
  "fears", "accuse", "accused", "accuses", "fail", "failed", "fails", "failure", "shortage", "shortages", "blackout", "insurgents", "insurgency", "militants", "bandits", "rebels", "jihadists",
  "extremists", "raid", "raids", "raided", "offensive", "invasion", "invaded", "seized", "captured", "disaster", "emergency", "worsening", "worsens", "deteriorating", "escalation", "escalates",
  "escalating", "deadly", "brutal", "illegal", "smuggling", "trafficking", "protest", "protests", "protesters", "expelled", "deported", "suspended", "banned", "denied", "rejects",
  "rejected", "crash", "crashed", "poverty", "inflation", "debt", "losses", "loss", "victims", "suffering", "trauma", "missing",
  "attaque", "attaques", "combats", "affrontements", "violences", "crise", "menace", "arrêtés", "déplacés", "inondations", "sécheresse", "tensions", "insécurité", "pénurie", "grève", "condamne",
];
const POSITIVE_STRONG = [
  "peace", "ceasefire", "truce", "reconciliation", "liberated", "freed", "rescued", "rescue", "released", "release", "reunited", "breakthrough", "victory", "celebrate", "celebrates", "celebration",
  "paix", "cessez-le-feu", "trêve", "réconciliation", "libérés", "libération", "accord",
];
// Deliberately without words that are positive in ordinary use but not in this
// kind of news: "support" (Rapid Support Forces), "aid" (aid convoy attacked),
// "launch" (launches offensive), "opens" (opens fire), "secure", "won".
const POSITIVE = [
  "agreement", "agree", "agreed", "agrees", "deal", "accord", "signed", "signs", "talks", "dialogue", "negotiations", "mediation", "cooperation", "partnership", "donates", "donated", "donation", "funding", "invest", "investment", "invests", "growth", "recovery", "recover", "recovers", "rebuild", "rebuilding", "reconstruction",
  "reopen", "reopens", "reopened", "restored", "restore", "restores", "resumes", "resumed", "stability", "stable", "calm", "safety", "progress", "improve", "improved",
  "improves", "improvement", "success", "successful", "award", "awarded", "inaugurated", "inaugurates", "boost",
  "boosts", "strengthen", "strengthens", "welcome", "welcomes", "welcomed", "praise", "praises", "praised", "hope", "hopes", "returnees", "vaccination", "vaccinated", "graduates",
  "graduation", "approves", "approved", "pledges", "pledged", "commits", "commitment", "protects", "protected", "prevented", "foiled", "disarmament", "dialogue", "négociations", "coopération", "croissance", "reprise", "succès", "inauguré", "espoir", "stabilité",
];

const WEIGHTS = new Map<string, number>();
for (const w of NEGATIVE) WEIGHTS.set(w, -1);
for (const w of NEGATIVE_STRONG) WEIGHTS.set(w, -2);
for (const w of POSITIVE) WEIGHTS.set(w, 1);
for (const w of POSITIVE_STRONG) WEIGHTS.set(w, 2);

/** A positive word right after one of these is not positive ("no agreement", "talks collapse" is handled by "collapse" itself). */
const NEGATORS = new Set(["no", "not", "without", "never", "fails", "failed", "rejects", "rejected", "refuses", "refused", "breaks", "broken", "violates", "violated", "pas", "sans", "aucun", "aucune"]);

export type Tone = "negative" | "neutral" | "positive";

/** -1 … 1. Zero for text with no tone words. */
export function scoreSentiment(text: string | null | undefined): number {
  if (!text) return 0;
  const words = text.toLowerCase().replace(/https?:\/\/\S+/g, " ").match(/[\p{L}][\p{L}'’-]*/gu) ?? [];
  let positive = 0;
  let negative = 0;
  for (let i = 0; i < words.length && i < 400; i++) {
    const w = words[i].replace(/['’]s$/, "");
    const weight = WEIGHTS.get(w);
    if (!weight) continue;
    if (weight > 0 && i > 0 && NEGATORS.has(words[i - 1])) negative += weight;
    else if (weight > 0) positive += weight;
    else negative -= weight;
  }
  if (positive + negative === 0) return 0;
  // The +1.5 keeps a single mild word from reading as fully one-sided.
  return Number(((positive - negative) / (positive + negative + 1.5)).toFixed(3));
}

export function toneOf(score: number | null | undefined): Tone {
  if (score == null) return "neutral";
  return score < -0.2 ? "negative" : score > 0.2 ? "positive" : "neutral";
}

/** The tone to show for a stored item: its recorded score where it has one
 *  (for example from a source that supplies its own), otherwise the
 *  word-based estimate from its headline and text. */
export function sentimentFor(stored: number | null | undefined, title: string | null | undefined, text: string | null | undefined): number {
  if (typeof stored === "number" && Number.isFinite(stored)) return Math.max(-1, Math.min(1, stored));
  return scoreSentiment(`${title ?? ""}. ${text ?? ""}`);
}
