/**
 * GDELT connector — real, live mainstream-media source.
 *
 * GDELT (gdeltproject.org) is a free, public database of global news
 * monitored across print, broadcast, and web sources in 100+ languages,
 * updated every 15 minutes. Its DOC 2.0 API needs no API key and no
 * account, which makes it the natural first "real" source to wire up
 * before tackling sources that need paid access (social platform APIs)
 * or licensed access (dark web threat intel).
 *
 * Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 *
 * Design: rather than translating our internal Boolean syntax into GDELT's
 * own query language, we ask GDELT broadly for anything touching the
 * *positive* terms across all active monitoring queries (cheap recall),
 * then run every returned article back through our own Boolean engine
 * (`matchAndBroadcast`) for precise, per-query matching/alerting — the
 * same two-stage "broad recall, precise filter" pattern a production
 * pipeline would use with any upstream search API.
 *
 * Runs from the Worker's `scheduled()` handler on a Cron Trigger
 * (every 5 minutes — see wrangler.toml — matching GDELT's own 15-minute
 * index refresh rate, so polling faster just wastes requests).
 */
import { all, run, nowIso } from "../db";
import { newId } from "../ids";
import type { Env } from "../bindings";
import type { EventRecord } from "../types";

const GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";

// Rough centroids for GDELT's `sourcecountry` field, used only so articles have
// *something* plottable on the map. This is a coarse stand-in for real geocoding —
// a production pipeline should extract location from article text/NLP instead.
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  Kenya: [-1.2864, 36.8172],
  Nigeria: [9.082, 8.6753],
  Philippines: [12.8797, 121.774],
  Indonesia: [-0.7893, 113.9213],
  Bangladesh: [23.685, 90.3563],
  Haiti: [18.9712, -72.2852],
  Ukraine: [48.3794, 31.1656],
  Lebanon: [33.8547, 35.8623],
  Pakistan: [30.3753, 69.3451],
  Mexico: [23.6345, -102.5528],
  "South Africa": [-30.5595, 22.9375],
  Brazil: [-14.235, -51.9253],
  India: [20.5937, 78.9629],
  Egypt: [26.8206, 30.8025],
  Thailand: [15.87, 100.9925],
  "United States": [37.0902, -95.7129],
  "United Kingdom": [55.3781, -3.436],
  France: [46.2276, 2.2137],
  Germany: [51.1657, 10.4515],
  China: [35.8617, 104.1954],
  Japan: [36.2048, 138.2529],
  Israel: [31.0461, 34.8516],
  "Saudi Arabia": [23.8859, 45.0792],
  Turkey: [38.9637, 35.2433],
  Russia: [61.524, 105.3188],
  Ethiopia: [9.145, 40.4897],
  Sudan: [12.8628, 30.2176],
  Somalia: [5.1521, 46.1996],
  Myanmar: [21.9139, 95.9562],
  "Sri Lanka": [7.8731, 80.7718],
  Colombia: [4.5709, -74.2973],
  Venezuela: [6.4238, -66.5897],
  Yemen: [15.5527, 48.5164],
  Syria: [34.8021, 38.9968],
  Iraq: [33.2232, 43.6793],
  Afghanistan: [33.9391, 67.71],
};

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string; // e.g. "20260807T121500Z"
  domain: string;
  language: string;
  sourcecountry: string;
}

function parseGdeltDate(seendate: string): Date {
  const m = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return new Date();
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

/** Builds a GDELT-compatible OR-query from a flat list of terms pulled from active
 *  monitoring queries. GDELT treats bare space-separated words as AND, so we
 *  explicitly OR them and quote multi-word phrases. Kept fairly small (10, not
 *  20) — GDELT's DOC API rejects overly long/complex queries (returning an
 *  HTML error page instead of JSON) once a query grows too many OR clauses
 *  or phrase terms, which happens fast with a real-world topic query. */
export function buildQueryFromTerms(terms: string[], maxTerms = 10): string {
  const unique = Array.from(new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, maxTerms);
  if (unique.length === 0) return "crisis OR emergency OR disaster"; // sane fallback if no queries are active yet
  return unique.map((t) => (t.includes(" ") ? `"${t}"` : t)).join(" OR ");
}

export async function fetchGdeltArticles(searchTerms: string, maxRecords = 75): Promise<GdeltArticle[]> {
  const params = new URLSearchParams({
    query: searchTerms,
    mode: "artlist",
    maxrecords: String(maxRecords),
    format: "json",
    sort: "datedesc",
    timespan: "1h",
  });

  const res = await fetch(`${GDELT_ENDPOINT}?${params.toString()}`, {
    headers: { "User-Agent": "SentinelCrisisMonitor/1.0 (+https://github.com/SimonMutie/Mutie)" },
  });
  if (!res.ok) {
    throw new Error(`GDELT request failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  if (!text.trim()) return []; // GDELT returns an empty body (not valid JSON) when nothing matches

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    // GDELT returns a non-JSON error page (HTML/plain text) when a query is
    // malformed or too complex for it to parse — log enough of the raw
    // response to diagnose which, instead of just "unexpected token".
    console.error(`[gdelt] non-JSON response for query="${searchTerms}" (first 300 chars): ${text.slice(0, 300)}`);
    throw err;
  }
  const articles = (data as { articles?: unknown })?.articles;
  return Array.isArray(articles) ? (articles as GdeltArticle[]) : [];
}

async function getOrCreateGdeltSourceId(env: Env): Promise<string | null> {
  const existing = await all<{ id: string }>(env.DB, "SELECT id FROM sources WHERE name = ?", ["GDELT News Wire"]);
  if (existing[0]) return existing[0].id;
  const id = newId();
  await run(env.DB, `INSERT INTO sources (id, name, type, config, created_at) VALUES (?, 'GDELT News Wire', 'news', ?, ?)`, [
    id,
    JSON.stringify({ connector: "gdelt" }),
    nowIso(),
  ]);
  return id;
}

/** Fetches and inserts new GDELT articles (deduped by URL via the events table's
 *  partial unique index), returning the inserted rows. */
export async function pollGdelt(env: Env, searchTerms: string): Promise<EventRecord[]> {
  const sourceId = await getOrCreateGdeltSourceId(env);
  const articles = await fetchGdeltArticles(searchTerms);
  const inserted: EventRecord[] = [];

  for (const article of articles) {
    if (!article.url || !article.title) continue;
    const centroid = COUNTRY_CENTROIDS[article.sourcecountry] ?? null;
    const id = newId();
    const now = nowIso();
    const publishedAt = parseGdeltDate(article.seendate).toISOString();
    const rawMetadata = JSON.stringify({ connector: "gdelt", sourcecountry: article.sourcecountry, domain: article.domain });

    const rows = await all<Record<string, unknown>>(
      env.DB,
      `INSERT OR IGNORE INTO events
        (id, source_id, source_type, external_id, author, content, url, lang, published_at, ingested_at, geo_lat, geo_lng, geo_label, raw_metadata)
       VALUES (?, ?, 'news', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        id,
        sourceId,
        article.url,
        article.domain ?? null,
        article.title,
        article.url,
        (article.language ?? "en").toLowerCase(),
        publishedAt,
        now,
        centroid ? centroid[0] : null,
        centroid ? centroid[1] : null,
        article.sourcecountry ?? null,
        rawMetadata,
      ]
    );

    if (rows[0]) {
      inserted.push({
        ...(rows[0] as unknown as EventRecord),
        raw_metadata: JSON.parse(String(rows[0].raw_metadata ?? "{}")),
      });
    }
  }

  return inserted;
}
