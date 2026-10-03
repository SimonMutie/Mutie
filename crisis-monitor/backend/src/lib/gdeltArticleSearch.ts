import { matchEscalationKeywords, isConfirmedEscalationText, isLikelyWrongCountryText } from "./escalationKeywords";

/**
 * Real GDELT article search — the direct fix for "GDELT's structured feed
 * has no raw article text" (see countryEscalation.ts's MILITARY_POSTURE_
 * EVENT_CODES doc comment and connectors/gdeltBulk.ts's own comment on the
 * same limitation): the bulk/GKG export this app ingests on a 15-minute
 * cron is CAMEO-structured-fields-only by GDELT's own export design, no
 * article titles — that's not something this app chose, it's the shape of
 * that particular GDELT product. GDELT separately runs a live, keyless
 * full-text search over the actual news articles it has aggregated — the
 * DOC 2.0 API (already used elsewhere in this app: liveLayers.ts's generic
 * GDELT points layer and Social Listening's "Top articles" list) — which
 * DOES return a real headline + URL per hit. This queries that API
 * directly with Simon's own escalation phrases AND'd against the country
 * name, so "pulled from news aggregated... by GDELT to flag only when such
 * terms appear" is now literally true against GDELT's own aggregation, not
 * only Africa Wire's 260-source crawl.
 *
 * Deliberately NOT folded into the scheduled scoring cron
 * (scoreCountryEscalations runs Africa-wide every 5 minutes) — DOC 2.0 is
 * a shared, rate-limited free API (see liveLayers.ts's own 429-handling
 * comment on fetchGdeltPoints), so hitting it once per African country
 * every 5 minutes would be a real risk of exhausting that shared quota for
 * every other feature using it. This is called on demand, per country,
 * only from the evidence drill-down a person actually opens — the same
 * cost shape Social Listening already pays per saved query — and a match
 * here is additional real-article evidence only; it never changes a
 * country's alert level, which stays entirely the CAMEO/GDELT-bulk-driven
 * scoring in countryEscalation.ts.
 */

const GDELT_DOC_TIMEOUT_MS = 10000;

// The same phrases lib/escalationKeywords.ts matches against Africa Wire
// text, written as GDELT DOC 2.0 query terms (its parser wants plain
// quoted phrases, not regexes) — OR'd together. Kept to the highest-signal
// subset rather than every single label: DOC 2.0's query length is
// practically bounded and a huge OR clause degrades relevance ranking more
// than it helps recall.
const GDELT_ESCALATION_QUERY_TERMS = [
  '"drone strike"', '"air strike"', "airstrike", '"military clash"', '"armed confrontation"',
  '"military mobilization"', '"military mobilisation"', '"military reinforcement"',
  '"heavy weapons"', '"military offensive"', "shelling", '"artillery fire"',
  '"ceasefire violation"', "blockade", "siege", '"took control of"', '"seized control"',
  "recaptured", "massacre", '"mass killing"', '"ethnic cleansing"', "coup", "mutiny",
];

export interface GdeltArticleHit {
  title: string;
  url: string;
  /** GDELT's own ISO-ish seen-date (YYYYMMDDTHHMMSSZ) converted to a
   *  real ISO 8601 string — see parseGdeltSeenDate — null if GDELT omitted
   *  it or it didn't parse, never a guessed/fabricated time. */
  seenAt: string | null;
  sourceCountry: string | null;
  /** Which of Simon's escalation keywords matched this article's own
   *  title — this, not GDELT's relevance ranking, is what makes a hit
   *  count as real evidence (see the filter in searchGdeltEscalationArticles). */
  matchedKeywords: string[];
}

function isRateLimited(err: unknown): boolean {
  return err instanceof Error && /\b429\b/.test(err.message);
}

interface DocApiResponse {
  articles?: Array<{ title?: string; url?: string; seendate?: string; sourcecountry?: string }>;
}

async function fetchOnce(url: string): Promise<DocApiResponse> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(GDELT_DOC_TIMEOUT_MS),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; TheLensBot/1.0)" },
  });
  if (!res.ok) throw new Error(`GDELT DOC 2.0 returned ${res.status}`);
  return res.json();
}

/** GDELT's DOC 2.0 "seendate" (e.g. "20260930T154500Z") turned into a real
 *  ISO 8601 timestamp the rest of this app already expects (see
 *  countryEscalation.ts's dateAdded field) — returns null rather than a
 *  fabricated time when the format doesn't match what GDELT documents. */
export function parseGdeltSeenDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${se}Z`;
}

/** Real article titles for one country's current escalation window, each
 *  one re-checked against the same keyword list Africa Wire evidence uses
 *  (matchEscalationKeywords) — a result is never kept just because GDELT's
 *  own relevance ranking surfaced it for the query; the literal keyword
 *  match on its actual title is still what counts. This is what gives
 *  GDELT's own aggregation the real text to match against, which its bulk
 *  feed structurally lacks. Never throws — a failed or rate-limited call
 *  just means no GDELT-article evidence this time, the same best-effort
 *  posture as the AI summary call in countryEscalation.ts. */
export async function searchGdeltEscalationArticles(countryName: string, windowHours: number, maxRecords = 20): Promise<GdeltArticleHit[]> {
  const query = `"${countryName}" (${GDELT_ESCALATION_QUERY_TERMS.join(" OR ")})`;
  // DOC 2.0's timespan param wants a single unit, not raw hours beyond a
  // day — same shorthand already used by liveLayers.ts's fetchGdeltPointsOnce.
  const timespan = windowHours <= 24 ? `${windowHours}h` : `${Math.ceil(windowHours / 24)}d`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${maxRecords}&sort=hybridrel&timespan=${timespan}`;

  let data: DocApiResponse;
  try {
    data = await fetchOnce(url);
  } catch (err) {
    if (!isRateLimited(err)) return [];
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      data = await fetchOnce(url);
    } catch {
      return [];
    }
  }

  const hits: GdeltArticleHit[] = [];
  for (const a of data.articles ?? []) {
    if (!a.title || !a.url) continue;
    // isConfirmedEscalationText, not a bare matchEscalationKeywords().length
    // check — see escalationKeywords.ts's own doc comment: a named non-state
    // armed group or an unambiguous action term confirms a title alone, but
    // an ambiguous phrase (clash, siege, advance on...) only counts once a
    // real armed actor is also named in the same title. matchEscalationKeywords
    // is still used below for the display labels once confirmed.
    // isLikelyWrongCountryText first — this is what GDELT's bulk/URL-slug
    // path already had (isConfirmedEscalationUrl) but this live-article-
    // search path, matching on the TITLE instead of a URL slug, never ran
    // at all: a Yemen/Taiz story datelined "RIYADH" (a wire bureau line,
    // not where the event happened) could otherwise confirm for an African
    // country purely because its title also happened to satisfy one of
    // isConfirmedEscalationText's tiers.
    if (isLikelyWrongCountryText(a.title, countryName)) continue;
    if (!isConfirmedEscalationText(a.title, countryName)) continue;
    const matchedKeywords = matchEscalationKeywords(a.title);
    hits.push({ title: a.title, url: a.url, seenAt: parseGdeltSeenDate(a.seendate), sourceCountry: a.sourcecountry ?? null, matchedKeywords });
  }
  return hits;
}
