/**
 * Name matching for screening: a query name against list names and their
 * aliases. Built for the cases that matter in due diligence: word order that
 * differs ("Hussein Ali Mohamed" / "Mohamed Hussein Ali"), transliteration
 * variants ("Mohammed" / "Muhammad"), missing or extra middle names, accents,
 * and company suffixes ("Ltd", "SARL"). Pure functions, covered by tests.
 *
 * A score is how closely the NAMES agree. It is never a statement that two
 * records are the same person or company: that needs an identifier (date of
 * birth, registration number) which the caller must check against the source.
 */

const COMPANY_SUFFIXES = new Set([
  "ltd", "limited", "llc", "inc", "incorporated", "plc", "corp", "corporation", "co", "company", "sa", "sarl", "sas", "gmbh", "ag", "nv", "bv", "srl", "spa",
  "pty", "ltda", "lda", "llp", "lp", "fze", "fzco", "fz", "jsc", "ooo", "oao", "zao", "pjsc", "ojsc", "kg", "ab", "as", "oy", "the", "of", "and", "et", "de", "du", "des", "la", "le", "el", "al",
]);

/** Common transliteration spellings folded to one form, so variants compare as equal. */
const VARIANTS: [RegExp, string][] = [
  [/\b(mohamm?ed|muhamm?ad|mohamad|muhamad|mehmet|mohd|md)\b/g, "mohammed"],
  [/\b(hussein|husain|hussain|husayn|hosein)\b/g, "hussein"],
  [/\b(abdul|abdel|abd el|abd al|abdal)\b/g, "abdul"],
  [/\b(ibrahim|ibraheem|brahim)\b/g, "ibrahim"],
  [/\b(yusuf|youssef|yousef|yusef|joseph)\b/g, "yusuf"],
  [/\b(omar|umar)\b/g, "omar"],
  [/\b(ahmed|ahmad)\b/g, "ahmed"],
  [/\b(aly|ali)\b/g, "ali"],
  [/\b(osman|othman|uthman|usman)\b/g, "osman"],
];

export function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Lower-case, accents and punctuation removed, "&" read as "and", spellings folded. Keeps non-Latin letters. */
export function normalizeName(s: string): string {
  let t = stripDiacritics(s).toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  for (const [re, to] of VARIANTS) t = t.replace(re, to);
  return t;
}

/** The words that identify a name: normalised, with company suffixes and filler removed for organisations. */
export function nameTokens(s: string, kind: "person" | "entity" | "any" = "any"): string[] {
  const all = normalizeName(s).split(" ").filter(Boolean);
  if (kind === "person") return all;
  const kept = all.filter((t) => !COMPANY_SUFFIXES.has(t));
  return kept.length ? kept : all;
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

const TOKEN_MATCH = 0.88;

/**
 * 0..1: how well the query's words are found among the candidate's words and
 * the other way round, allowing small spelling differences and any order.
 * Both directions count, so "Ali" never matches "Ali Hassan Mohamed Ibrahim" on one word.
 */
export function nameSimilarity(query: string, candidate: string, kind: "person" | "entity" | "any" = "any"): number {
  const q = nameTokens(query, kind);
  const c = nameTokens(candidate, kind);
  if (!q.length || !c.length) return 0;
  if (q.join(" ") === c.join(" ")) return 1;
  const directional = (from: string[], to: string[]): number => {
    const used = new Set<number>();
    let sum = 0;
    for (const tok of from) {
      let best = 0;
      let bestAt = -1;
      to.forEach((other, idx) => {
        if (used.has(idx)) return;
        const s = tok === other ? 1 : tok.length >= 3 && other.length >= 3 ? jaroWinkler(tok, other) : 0;
        if (s > best) {
          best = s;
          bestAt = idx;
        }
      });
      if (best >= TOKEN_MATCH) {
        sum += best;
        used.add(bestAt);
      }
    }
    return sum / from.length;
  };
  const forward = directional(q, c);
  const backward = directional(c, q);
  // The mean of both directions: a candidate with extra words around the query is a weaker match than an exact one.
  return Math.round(((forward + backward) / 2) * 1000) / 1000;
}

export type Strength = "strong" | "possible";
export const STRONG = 0.9;
export const POSSIBLE = 0.72;

export const strengthOf = (score: number): Strength | null => (score >= STRONG ? "strong" : score >= POSSIBLE ? "possible" : null);

/** First four letters of each token: a cheap way to find candidate list entries before scoring. */
export function prefixKeys(s: string, kind: "person" | "entity" | "any" = "any"): string[] {
  return [...new Set(nameTokens(s, kind).filter((t) => t.length >= 3).map((t) => t.slice(0, 4)))];
}
