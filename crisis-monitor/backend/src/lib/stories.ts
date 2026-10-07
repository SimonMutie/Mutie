import { STOPWORDS } from "./topics";

/**
 * Top stories: news items about the same event, grouped, and ranked by how
 * many different outlets carried them — so that one event reported thirty
 * times reads as one line with "30 outlets" beside it.
 *
 * No model is involved. Two headlines belong together when they share most
 * of their meaningful words and were published within a few days of each
 * other. Items are taken oldest first and each joins the story it most
 * resembles, or starts a new one.
 *
 * This is a grouping of headlines, not a reading of the articles: two
 * reports of one event under very different headlines stay apart, and two
 * different events under near-identical headlines can be joined. The panel
 * says so.
 */

export interface StoryDoc {
  id: string;
  title: string;
  url: string | null;
  /** The outlet (its address). */
  source: string | null;
  published_at: string;
  sentiment: number;
  place: string | null;
}

export interface Story {
  id: string;
  /** The headline of the earliest report. */
  title: string;
  url: string | null;
  /** Different outlets that carried it. */
  outlets: number;
  /** Reports in all. */
  items: number;
  firstAt: string;
  lastAt: string;
  /** The outlets with the most reports, at most five. */
  sources: string[];
  /** The place most of its reports name. */
  place: string | null;
  /** Average tone of its reports, -1 … 1. */
  tone: number;
  members: { id: string; title: string; url: string | null; source: string | null; published_at: string }[];
}

const WORD_RX = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
/** A report joins a story only within this long of the story's latest report … */
const GAP_MS = 2 * 86_400_000;
/** … and this long of its first. Without the second limit, a headline that recurs day after day
 *  ("Shelling hits market in El Fasher") would chain weeks of separate events into one story. */
const SPAN_MS = 5 * 86_400_000;
const MEMBERS_SHOWN = 8;

/** The meaningful words of a headline. */
export function headlineWords(title: string): string[] {
  const out = new Set<string>();
  for (const m of title.toLowerCase().matchAll(WORD_RX)) {
    const w = m[0].replace(/['’]s$/, "");
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
    else if (/^\d+$/.test(w)) out.add(w); // "9 killed" and "12 killed" are different reports
  }
  return [...out];
}

/** A place below the level of a country: "El Fasher, Sudan", not "Sudan". */
const specific = (place: string | null): place is string => !!place && place.includes(",");

interface Cluster {
  first: number;
  last: number;
  /** The town or region its reports name, once one has ("El Fasher, Sudan"). A report naming a different one is a different event. */
  place: string | null;
  /** word -> how many members use it */
  words: Map<string, number>;
  docs: StoryDoc[];
}

/** How alike a headline is to a story: the share of the smaller word set that the two have in common, with a floor on the overlap. */
function likeness(words: string[], c: Cluster): number {
  // A story is described by the words at least half its reports use.
  const need = c.docs.length / 2;
  let core = 0;
  let shared = 0;
  for (const [w, n] of c.words) {
    if (n < need) continue;
    core++;
    if (words.includes(w)) shared++;
  }
  if (shared < 3) return 0;
  const union = core + words.length - shared;
  const jaccard = shared / union;
  const contained = shared / Math.min(core, words.length);
  return Math.max(jaccard, shared >= 4 ? contained * 0.75 : 0);
}

export function groupStories(docs: StoryDoc[], limit = 12): Story[] {
  const ordered = docs.filter((d) => d.title.trim().length > 0).sort((a, b) => a.published_at.localeCompare(b.published_at));
  const clusters: Cluster[] = [];
  const byWord = new Map<string, Set<number>>();

  for (const doc of ordered) {
    const words = headlineWords(doc.title);
    const at = Date.parse(doc.published_at);
    let best = -1;
    let bestScore = 0;
    if (words.length >= 3) {
      // Only stories sharing at least three words are worth comparing.
      const seen = new Map<number, number>();
      for (const w of words) for (const ci of byWord.get(w) ?? []) seen.set(ci, (seen.get(ci) ?? 0) + 1);
      for (const [ci, n] of seen) {
        if (n < 3) continue;
        const c = clusters[ci];
        if (at - c.last > GAP_MS || at - c.first > SPAN_MS) continue;
        // The same headline about another town is another event. A report that names only the country fits either.
        if (specific(doc.place) && c.place && doc.place !== c.place) continue;
        const score = likeness(words, c);
        if (score > bestScore) {
          bestScore = score;
          best = ci;
        }
      }
    }
    if (best < 0 || bestScore < 0.5) {
      best = clusters.length;
      clusters.push({ first: at, last: at, place: null, words: new Map(), docs: [] });
    }
    const c = clusters[best];
    c.docs.push(doc);
    if (!c.place && specific(doc.place)) c.place = doc.place;
    c.last = Math.max(c.last, at);
    for (const w of words) {
      c.words.set(w, (c.words.get(w) ?? 0) + 1);
      let set = byWord.get(w);
      if (!set) byWord.set(w, (set = new Set()));
      set.add(best);
    }
  }

  const stories = clusters.map((c, i): Story => {
    const perSource = new Map<string, number>();
    const perPlace = new Map<string, number>();
    let tone = 0;
    for (const d of c.docs) {
      if (d.source) perSource.set(d.source, (perSource.get(d.source) ?? 0) + 1);
      if (d.place) perPlace.set(d.place, (perPlace.get(d.place) ?? 0) + 1);
      tone += d.sentiment;
    }
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const lead = c.docs[0];
    return {
      id: `s${i}`,
      title: lead.title,
      url: lead.url,
      outlets: Math.max(1, perSource.size),
      items: c.docs.length,
      firstAt: new Date(c.first).toISOString(),
      lastAt: new Date(c.last).toISOString(),
      sources: top(perSource)
        .slice(0, 5)
        .map(([s]) => s),
      place: top(perPlace)[0]?.[0] ?? null,
      tone: Number((tone / c.docs.length).toFixed(3)),
      members: c.docs.slice(0, MEMBERS_SHOWN).map((d) => ({ id: d.id, title: d.title, url: d.url, source: d.source, published_at: d.published_at })),
    };
  });

  // Carried by the most outlets first; then the most reports; then the most recent.
  return stories.sort((a, b) => b.outlets - a.outlets || b.items - a.items || b.lastAt.localeCompare(a.lastAt)).slice(0, limit);
}
