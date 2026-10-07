import { locateText, countryName, AFRICA_CENTROIDS } from "./africaGeo";
import { extractTopics, STOPWORDS, type TopicDoc } from "./topics";

/**
 * Two readings of what a set of items says, neither using a model:
 *
 *   - the NAMES most often written in them — people, organisations, armed
 *     groups — found by their capital letters in running text;
 *   - the terms that are RISING: used markedly more in the later half of
 *     the period than in the earlier half.
 *
 * Names are found by spelling, not by understanding. A run of capitalised
 * words in the middle of a sentence is very often a name, but not always,
 * and a name written in lower case is missed. Places are left out (they
 * have their own panel), as are nationalities, ranks and titles. The panel
 * that shows these says how they were found.
 */

export interface NameDoc extends TopicDoc {
  published_at: string;
}

export interface NamedEntry {
  /** As most often written ("Rapid Support Forces"). */
  label: string;
  /** Lower-cased: what a search for it matches. */
  term: string;
  /** Items that use it. */
  count: number;
  /** Of those, how many fall in the later and the earlier half of the period. */
  recent: number;
  earlier: number;
}

export interface RisingTerm extends NamedEntry {
  /** True when it does not appear in the earlier half at all. */
  fresh: boolean;
}

const TITLES = new Set(
  "president vice prime minister deputy governor senator general gen lt lieutenant col colonel maj major brig brigadier capt captain commander chief sheikh sheik imam bishop archbishop pastor rev reverend prof professor dr mr mrs ms sir lord king queen prince princess emir sultan chairman chairperson spokesman spokesperson spokeswoman ambassador envoy secretary judge justice commissioner director inspector mayor chancellor speaker hon honourable honorable field marshal".split(
    " "
  )
);
/** Capitalised words that are not a name by themselves. */
const GENERIC = new Set(
  "government army police military forces force troops soldiers rebels militia parliament senate cabinet ministry court council commission committee authority agency state states county province region district city town village capital border north south east west northern southern eastern western central upper lower africa african europe european asia asian arab arabs muslim muslims christian christians islam islamic western eastern international national federal republic union united world global reuters afp bbc cnn aljazeera jazeera xinhua tass anadolu bloomberg guardian twitter facebook telegram whatsapp youtube instagram tiktok monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december ramadan eid christmas easter covid internet english french arabic swahili amharic somali hausa god allah".split(
    " "
  )
);
const DEMONYMS = new Set(
  "sudanese congolese somali somalis malian nigerien chadian ethiopian eritrean kenyan ugandan tanzanian burundian rwandan egyptian libyan tunisian algerian moroccan senegalese ghanaian nigerian cameroonian ivorian burkinabe togolese beninese gambian guinean liberian angolan zambian zimbabwean malawian mozambican namibian batswana basotho swazi malagasy mauritanian djiboutian gabonese russian russians american americans british french chinese turkish emirati saudi israeli israelis iranian ukrainian ukrainians palestinian palestinians german italian indian pakistani qatari yemeni syrian iraqi lebanese jordanian canadian australian japanese korean brazilian dutch belgian spanish portuguese swedish norwegian".split(
    " "
  )
);
/** Ordinary words that open a sentence with a capital and are then followed by a real name
 *  ("Residents of El Fasher said …", "Fighters from the Rapid Support Forces …"). */
const OPENERS = new Set(
  "residents people officials fighters medics witnesses authorities mediators thousands hundreds dozens scores many several some most members leaders civilians doctors activists sources reports analysts observers diplomats families survivors villagers protesters gunmen militants insurgents aid health local heavy fresh renewed fighting clashes violence shelling talks sudan's".split(
    " "
  )
);
/** Small words that sit inside a name ("Bank of Uganda", "Abdel Fattah al-Burhan"). */
const INNER = new Set(["of", "for", "and", "the", "de", "du", "des", "la", "le", "al", "el", "bin", "ibn", "wa", "van", "von", "da", "dos"]);

const COUNTRY_WORDS = new Set(
  Object.keys(AFRICA_CENTROIDS)
    .map((code) => countryName(code).toLowerCase())
    .filter(Boolean)
);

const WORD_RX = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu;
// Capital letters are tested a character at a time: these run on every word of every item, where a
// Unicode-class regular expression costs several times as much.
const upperAt = (w: string, i: number) => {
  const ch = w[i];
  return ch !== undefined && ch !== ch.toLowerCase() && ch === ch.toUpperCase();
};
const letterAt = (w: string, i: number) => {
  const ch = w[i];
  return ch !== undefined && (ch.toLowerCase() !== ch.toUpperCase() || ch === "'" || ch === "’" || ch === "-");
};
function capitalised(w: string, from: number): boolean {
  if (w.length - from < 2 || !upperAt(w, from)) return false;
  let lower = false;
  for (let i = from + 1; i < w.length; i++) {
    if (!letterAt(w, i)) return false;
    if (!upperAt(w, i) && w[i] !== "-" && w[i] !== "'" && w[i] !== "’") lower = true;
  }
  return lower; // all capitals is an acronym, not a capitalised word
}
/** "Burhan", "Al-Shabaab", and the Arabic article written small before a capital ("al-Burhan"). */
const isCap = (w: string) => capitalised(w, 0) || ((w.startsWith("al-") || w.startsWith("el-")) && capitalised(w, 3));
/** "UN", "RSF", "G20": two to six capitals or digits, starting with a capital. */
function isAcronym(w: string): boolean {
  if (w.length < 2 || w.length > 6 || !upperAt(w, 0)) return false;
  for (let i = 1; i < w.length; i++) if (!upperAt(w, i) && !(w[i] >= "0" && w[i] <= "9")) return false;
  return true;
}

/** True when most of a headline's longer words are capitalised — Title Case, where capitals say nothing. */
function titleCase(text: string): boolean {
  const words = (text.match(WORD_RX) ?? []).filter((w) => w.length >= 4 && /\p{L}/u.test(w));
  if (words.length < 3) return true;
  return words.filter((w) => /^\p{Lu}/u.test(w)).length / words.length > 0.6;
}

/** The names written in one text. */
export function namesIn(text: string): string[] {
  const found: string[] = [];
  for (const sentence of text.split(/[.!?…]\s+|[\n;:()[\]"“”«»|]+/)) {
    const words = sentence.match(WORD_RX) ?? [];
    let i = 0;
    while (i < words.length) {
      if (!isCap(words[i]) && !isAcronym(words[i])) {
        i++;
        continue;
      }
      // Take the run of capitalised words, allowing a small word between two of them.
      let j = i;
      const run: string[] = [];
      while (j < words.length && run.length < 5) {
        const w = words[j];
        if (isCap(w) || isAcronym(w)) run.push(w);
        else if (run.length && INNER.has(w.toLowerCase()) && j + 1 < words.length && (isCap(words[j + 1]) || isAcronym(words[j + 1]))) run.push(w);
        else break;
        j++;
      }
      const start = i;
      i = Math.max(j, i + 1);
      // Ranks and titles in front are not part of the name.
      let name = run.map((w) => w.replace(/['’]s$/i, ""));
      // Nor is the ordinary word a sentence opens with: "Residents of El Fasher" is about El Fasher.
      let opensSentence = start === 0;
      while (opensSentence && name.length > 1 && OPENERS.has(name[0].toLowerCase())) {
        name = name.slice(1);
        opensSentence = false; // what is left no longer opens the sentence
      }
      while (name.length && (TITLES.has(name[0].toLowerCase().replace(/\.$/, "")) || INNER.has(name[0].toLowerCase()))) name = name.slice(1);
      while (name.length && INNER.has(name[name.length - 1].toLowerCase())) name = name.slice(0, -1);
      if (!name.length) continue;
      const lower = name.map((w) => w.toLowerCase());
      if (name.length === 1) {
        const w = lower[0];
        // One capitalised word opening a sentence is just the start of the sentence.
        if (opensSentence && !isAcronym(name[0])) continue;
        if (w.length < 3 && !isAcronym(name[0])) continue;
        // "UN" and "US" are names though their letters spell small words.
        if ((!isAcronym(name[0]) && STOPWORDS.has(w)) || GENERIC.has(w) || DEMONYMS.has(w) || TITLES.has(w) || COUNTRY_WORDS.has(w)) continue;
      } else if (lower.every((w) => GENERIC.has(w) || DEMONYMS.has(w) || STOPWORDS.has(w) || INNER.has(w) || COUNTRY_WORDS.has(w))) continue;
      found.push(name.join(" "));
    }
  }
  return found;
}

const isPlace = (name: string) => {
  const hit = locateText(name);
  if (!hit) return false;
  // The gazetteer finds a place inside a longer name too ("Bank of Uganda"); only a name that IS the place is dropped.
  const label = hit.label.toLowerCase();
  const n = name.toLowerCase();
  return n === label || n === countryName(hit.countryCode).toLowerCase() || (n.split(" ").length <= 2 && label.includes(n));
};

/** The text of a document a name or term is looked for in: the headline unless it is in Title Case, and the opening of the body. */
function runningText(doc: TopicDoc): string {
  const title = (doc.title ?? "").trim();
  let body = (doc.text ?? "").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  if (title && body.toLowerCase().startsWith(title.toLowerCase())) body = body.slice(title.length);
  return `${title && !titleCase(title) ? `${title}. ` : ""}${body.slice(0, 400)}`;
}

/** The moment that splits a set of documents into an earlier and a later half of their own span. */
function midpoint(docs: NameDoc[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const d of docs) {
    const t = Date.parse(d.published_at);
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return (min + max) / 2;
}

export function extractNames(docs: NameDoc[], opts: { limit?: number; exclude?: string[]; splitAt?: number } = {}): NamedEntry[] {
  const limit = opts.limit ?? 20;
  const excluded = new Set((opts.exclude ?? []).map((w) => w.toLowerCase()));
  const split = opts.splitAt ?? midpoint(docs);
  const tally = new Map<string, { count: number; recent: number; earlier: number; surface: Map<string, number> }>();
  for (const doc of docs) {
    const later = Date.parse(doc.published_at) >= split;
    const seen = new Set<string>();
    for (const name of namesIn(runningText(doc))) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let t = tally.get(key);
      if (!t) tally.set(key, (t = { count: 0, recent: 0, earlier: 0, surface: new Map() }));
      t.count++;
      if (later) t.recent++;
      else t.earlier++;
      t.surface.set(name, (t.surface.get(name) ?? 0) + 1);
    }
  }
  const floor = Math.max(2, Math.ceil(docs.length * 0.01));
  const shared = [...tally.entries()]
    .filter(([key, t]) => t.count >= floor && !(key.split(" ").length === 1 && excluded.has(key)))
    .map(([key, t]) => ({ key, words: key.split(" ").length, ...t }))
    .sort((a, b) => b.words - a.words || b.count - a.count);
  // A short name inside a longer one that accounts for most of its use is the same name ("Burhan" within "Abdel Fattah al-Burhan").
  const chosen: typeof shared = [];
  for (const c of shared) {
    if (chosen.some((longer) => longer.words > c.words && ` ${longer.key.replace(/-/g, " ")} `.includes(` ${c.key} `) && longer.count >= c.count * 0.6)) continue;
    chosen.push(c);
  }
  // Places have their own panel. Checked only as far down the list as is needed to fill it.
  const kept: typeof chosen = [];
  for (const c of chosen.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))) {
    if (kept.length >= limit) break;
    if (!isPlace(c.key)) kept.push(c);
  }
  return kept
    .map((c) => ({
      label: [...c.surface.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      term: c.key,
      count: c.count,
      recent: c.recent,
      earlier: c.earlier,
    }));
}

/**
 * The terms used markedly more in the later half of the documents' span
 * than in the earlier half. A term must be in at least three later items,
 * and at least twice as common there (allowing for the halves holding
 * different numbers of items). Empty when the earlier half is too thin to
 * compare against.
 */
export function risingTerms(docs: NameDoc[], opts: { limit?: number; exclude?: string[]; splitAt?: number } = {}): RisingTerm[] {
  const split = opts.splitAt ?? midpoint(docs);
  const later = docs.filter((d) => Date.parse(d.published_at) >= split);
  const earlier = docs.filter((d) => Date.parse(d.published_at) < split);
  if (later.length < 5 || earlier.length < 5) return [];
  const candidates = extractTopics(later, { limit: 60, exclude: opts.exclude });
  // The earlier items as plain runs of words, cut the same way topics are, so that "dawn." and "dawn" are one word.
  const haystack = earlier.map((d) => ` ${(`${d.title ?? ""}. ${(d.text ?? "").slice(0, 280)}`.toLowerCase().match(WORD_RX) ?? []).map((w) => w.replace(/['’]s$/, "").replace(/^['’.-]+|['’.-]+$/g, "")).join(" ")} `);
  const scale = later.length / earlier.length;
  const out: (RisingTerm & { lift: number })[] = [];
  for (const c of candidates) {
    const needle = ` ${c.term} `;
    let before = 0;
    for (const h of haystack) if (h.includes(needle)) before++;
    if (c.count < 3) continue;
    const lift = (c.count + 1) / (before * scale + 1);
    // A single common word ("fighting") rises and falls with the volume; it must stand out much more than a phrase does.
    if (lift < (c.term.includes(" ") ? 2 : 4)) continue;
    out.push({ label: c.label, term: c.term, count: c.count + before, recent: c.count, earlier: before, fresh: before === 0, lift });
  }
  // Overlapping pieces of one headline ("mass graves", "suggest mass graves", "images suggest mass") are one finding:
  // the strongest is kept, and a later term sharing a word with one already kept is passed over.
  const kept: typeof out = [];
  const usedWords = new Set<string>();
  for (const c of out.sort((a, b) => b.lift - a.lift || b.recent - a.recent || a.term.split(" ").length - b.term.split(" ").length)) {
    if (kept.length >= (opts.limit ?? 10)) break;
    const words = c.term.split(" ").filter((w) => w.length > 2);
    if (words.some((w) => usedWords.has(w))) continue;
    kept.push(c);
    for (const w of words) usedWords.add(w);
  }
  return kept.map(({ lift: _lift, ...rest }) => rest);
}
