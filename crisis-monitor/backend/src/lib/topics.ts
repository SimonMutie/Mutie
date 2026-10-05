/**
 * What a set of items is talking about: the words and short phrases that
 * recur across their headlines and opening text.
 *
 * No model is involved. Each item contributes the runs of consecutive
 * meaningful words in its headline and opening (one to three words long);
 * a phrase is a topic when enough different items use it. Longer phrases
 * are preferred to the single words inside them ("rapid support forces"
 * rather than "rapid", "support" and "forces"), and a topic counts once per
 * item however often the item repeats it.
 *
 * A topic is always a phrase that appears, as written, in the items — so
 * clicking one can search for it — and never a category invented here.
 */

const STOPWORDS = new Set(
  (
    "a an the and or but if then than that this these those of in on at by for with from to into onto over under about after before between during against among within without across " +
    "is are was were be been being am do does did done doing has have had having will would shall should can could may might must not no nor so too very just also only own same such " +
    "i you he she it we they me him her us them my your his its our their who whom whose which what when where why how all any both each few more most other some as up out off down " +
    "says said say saying told tells according reported reports report news new latest update updates breaking live video photos watch read here there now today yesterday tomorrow " +
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december week weeks month months year years day days " +
    "one two three four five six seven eight nine ten first second third last next many much several amid via per mr mrs ms dr " +
    "people man men woman women officials official government state national country countries region area areas city town local residents sources group groups members time times part " +
    "make makes made take takes took get gets got give gives gave go goes went come comes came see sees seen call calls called show shows set put use used " +
    // Reporting verbs and filler that recur in headlines without naming a subject.
    "already still amid renewed fresh recent recently former current ongoing major key top big high low large small least nearly almost around early late fully including included following " +
    "due despite ahead back away further expressed express concern concerns concerned urges urged urge warns warned warn claims claimed claim meets met meet face faces faced facing carried carry " +
    "spent spend holds held hold seeks sought want wants need needs needed help helps helped work works working plan plans planned begin begins began start starts started end ends ended " +
    "continue continues continued remain remains remained become becomes became leave leaves left bring brings brought find finds found know known announce announces announced confirm confirms " +
    "confirmed deny denies denied reject rejects rejected accuse accuses accused blame blames blamed condemn condemns condemned killed kills kill killing injured wounded dead died dies " +
    "statement office spokesman spokesperson reportedly least amid while since until near total number numbers leaves left hit hits struck " +
    "le la les un une des du de d l et ou mais dans sur sous pour par avec sans entre vers chez au aux ce cet cette ces son sa ses leur leurs qui que quoi dont où est sont été être a ont avait " +
    "il elle ils elles nous vous je tu on ne pas plus très se sa si y en selon après avant pendant contre alors aussi comme tout tous toute toutes"
  ).split(/\s+/)
);

export interface TopicDoc {
  id: string;
  title: string | null;
  text: string | null;
  /** -1 … 1, used only to report each topic's average tone. */
  sentiment?: number;
}

export interface Topic {
  /** The phrase as most often written ("El Fasher", "Rapid Support Forces"). */
  label: string;
  /** The phrase lower-cased — what a search for this topic matches. */
  term: string;
  /** Items that use it. */
  count: number;
  /** Average tone of those items, -1 … 1. */
  tone: number;
}

const TOKEN_RX = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu;
const MAX_PHRASE_WORDS = 3;
const OPENING_CHARS = 280;

interface Candidate {
  docs: Set<string>;
  toneSum: number;
  surface: Map<string, number>;
  words: number;
}

/** The runs of consecutive meaningful words in a text, as [lowercase, as-written] pairs. */
function runsOf(text: string): [string, string][][] {
  const runs: [string, string][][] = [];
  // Anything that ends a phrase: punctuation between words, or a stopword.
  for (const clause of text.split(/[.,;:!?()[\]{}"“”«»|/\\–—\n]+|\s-\s/)) {
    let run: [string, string][] = [];
    for (const m of clause.matchAll(TOKEN_RX)) {
      const written = m[0].replace(/['’]s$/i, "").replace(/^['’.-]+|['’.-]+$/g, "");
      const lower = written.toLowerCase();
      // "UN", "US", "RSF": an acronym is a word in its own right, even where its letters spell a stopword.
      const acronym = /^\p{Lu}{2,6}$/u.test(written);
      // "El Fasher", "Al Jazeera": a capitalised two-letter particle belongs to the name that follows.
      const particle = written.length === 2 && /^\p{Lu}\p{Ll}$/u.test(written) && !STOPWORDS.has(lower);
      const meaningful = (acronym || particle || (lower.length >= 3 && !STOPWORDS.has(lower))) && !/^\d+$/.test(lower) && !/^https?/.test(lower) && !/\.(com|org|net|co|info)\b/.test(lower);
      if (meaningful) run.push([lower, written]);
      else {
        if (run.length) runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
  }
  return runs;
}

/**
 * The topics of `docs`, most widely used first.
 *
 * `exclude` is the wording of the query that collected these items: its own
 * words would otherwise top every list, and say nothing about what the
 * items add.
 */
export function extractTopics(docs: TopicDoc[], opts: { limit?: number; exclude?: string[] } = {}): Topic[] {
  const limit = opts.limit ?? 30;
  const excluded = new Set((opts.exclude ?? []).map((w) => w.toLowerCase().trim()).filter(Boolean));
  const candidates = new Map<string, Candidate>();

  for (const doc of docs) {
    const title = (doc.title ?? "").trim();
    let body = (doc.text ?? "").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
    if (title && body.toLowerCase().startsWith(title.toLowerCase())) body = body.slice(title.length);
    const text = `${title}. ${body.slice(0, OPENING_CHARS)}`;
    const seen = new Set<string>();
    for (const run of runsOf(text)) {
      for (let n = 1; n <= MAX_PHRASE_WORDS; n++) {
        for (let i = 0; i + n <= run.length; i++) {
          const slice = run.slice(i, i + n);
          const term = slice.map((w) => w[0]).join(" ");
          // A particle is never a topic by itself, nor the end of one.
          if (term.length > 40 || seen.has(term) || (slice[n - 1][1].length === 2 && /^\p{Lu}\p{Ll}$/u.test(slice[n - 1][1]))) continue;
          seen.add(term);
          let c = candidates.get(term);
          if (!c) candidates.set(term, (c = { docs: new Set(), toneSum: 0, surface: new Map(), words: n }));
          c.docs.add(doc.id);
          c.toneSum += doc.sentiment ?? 0;
          const written = slice.map((w) => w[1]).join(" ");
          c.surface.set(written, (c.surface.get(written) ?? 0) + 1);
        }
      }
    }
  }

  // A topic must be shared: by at least two items, and by at least 1.5% of a large set.
  const floor = Math.max(2, Math.ceil(docs.length * 0.015));
  const shared = [...candidates.entries()]
    .filter(([term, c]) => c.docs.size >= floor && !(c.words === 1 && excluded.has(term)))
    .map(([term, c]) => ({ term, ...c, count: c.docs.size }));

  // Longer phrases first, so that the words inside a chosen phrase can be set
  // aside when the phrase accounts for most of their use.
  shared.sort((a, b) => b.words - a.words || b.count - a.count);
  const chosen: typeof shared = [];
  for (const c of shared) {
    const covering = chosen.find((longer) => longer.words > c.words && ` ${longer.term} `.includes(` ${c.term} `) && longer.count >= c.count * 0.6);
    if (covering) continue;
    // A phrase must earn its extra words: used nearly as often as its rarest part would allow.
    if (c.words > 1 && c.count < floor + 1 && docs.length > 40) continue;
    chosen.push(c);
  }

  // Width of use decides the order; a phrase gets a little credit for being specific.
  const score = (c: (typeof chosen)[number]) => c.count * (1 + 0.25 * (c.words - 1));
  return chosen
    .sort((a, b) => score(b) - score(a) || a.term.localeCompare(b.term))
    .slice(0, limit)
    .map((c) => {
      const label = [...c.surface.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return { label: tidyLabel(label), term: c.term, count: c.count, tone: Number((c.toneSum / c.count).toFixed(3)) };
    });
}

/** An all-lowercase label reads as a search term; give it a capital. */
function tidyLabel(label: string): string {
  return label === label.toLowerCase() ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

/** The plain words of a boolean query — what `exclude` wants. */
export function queryWords(booleanQuery: string | null | undefined): string[] {
  return ((booleanQuery ?? "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).filter((w) => !["and", "or", "not", "near"].includes(w));
}
