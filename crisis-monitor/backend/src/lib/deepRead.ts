import type { Env } from "../bindings";

/**
 * Per-article LLM reading — the direct answer to Simon's ask: "you have to
 * read these articles deeply to make the decision of escalation and use the
 * information to properly summarise the development with clear
 * interpretative and analytical framing." Everything in escalationKeywords.ts
 * is still the FIRST gate (cheap regex matching against a title/description/
 * URL slug) — that gate still decides which handful of candidates are even
 * worth spending an LLM call on, and still decides a country's alert level/
 * posture counts, for cost reasons spelled out below. This module is a
 * SECOND, more expensive pass applied only to the small number of items that
 * already passed the first gate for an ALREADY-flagged (elevated/critical)
 * country: it has an LLM actually read the real text and render a judgment —
 * is this really describing a military-escalation incident, who/what is
 * doing it, where specifically, and why does the text support that — rather
 * than trusting "a military name and an action word are both present" as
 * the final word.
 *
 * Why this isn't also the FIRST gate, replacing the regex entirely: GDELT's
 * bulk feed alone produces on the order of hundreds of candidate rows a
 * tick across 54 countries; an LLM call per candidate, every 5 minutes,
 * Africa-wide, is neither affordable nor fast enough to finish inside one
 * scheduled-event invocation. Scoping it to "already-flagged countries
 * only, a handful of their top items only, cached by URL so a repeat tick
 * costs nothing" keeps this bounded while still deep-reading literally
 * everything a person or the AI summary actually sees.
 *
 * Deliberately fails open: any error (fetch, LLM call, bad JSON) returns
 * null, and every caller treats null as "no deep-read verdict available,
 * keep the keyword-based decision as-is" — this is an enhancement layer
 * that can never make an evidence item disappear or a real alert fail to
 * fire just because the LLM step had a bad day. The only thing an explicit
 * verdict (not null) can do that the keyword gate alone couldn't is REJECT a
 * keyword-matched item the model, having actually read it, judges isn't a
 * real escalation — e.g. a retrospective/historical piece, an opinion
 * column, or a story using an armed group's name only in passing.
 */

export interface DeepReadResult {
  /** Whether a full LLM read judges this text to genuinely describe a
   *  current military-escalation incident for the given country, not just
   *  "contains the right keywords". */
  confirmed: boolean;
  confidence: "high" | "medium" | "low";
  /** The specific actor(s) the text names as actually involved — may differ
   *  from (or be more specific than) escalationKeywords.ts's own matched
   *  labels, since the model reads full sentences, not just pattern hits. */
  actors: string[];
  /** The most specific place name the text itself supports, when it names
   *  one — independent of conflictGazetteer.ts's own curated list, since the
   *  model can recognize a real place this app's hand-curated gazetteer
   *  simply doesn't have yet. Null when the text doesn't support any
   *  specific location beyond the country itself. */
  locationName: string | null;
  /** One or two sentences, grounded ONLY in the text actually given to the
   *  model (the prompt explicitly forbids adding outside facts) — this is
   *  the "list of information that have warranted the coding" Simon asked
   *  for: why THIS specific text does or doesn't support an escalation
   *  judgment for THIS specific country. */
  rationale: string;
}

interface CachedRow {
  confirmed: number;
  confidence: string;
  actors: string;
  location_name: string | null;
  rationale: string;
}

let tableReady = false;

/** Self-provisioned the same way countryEscalation.ts's own tables are
 *  (CREATE TABLE IF NOT EXISTS, no migration files — see that file's own
 *  doc comment on ensureTable for why). Keyed by a hash of the source URL,
 *  not the raw URL itself, since D1/SQLite indexes a long TEXT primary key
 *  no differently in practice but a fixed-width hash keeps row size and
 *  index behavior predictable regardless of how long a real article URL
 *  gets. Cached indefinitely (no TTL/expiry): a given article's own text
 *  doesn't change after publication, so a stale cache entry isn't a
 *  real-world failure mode the way a stale score or count would be. */
async function ensureDeepReadTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS escalation_deep_reads (
      url_hash TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      country_code TEXT NOT NULL,
      confirmed INTEGER NOT NULL,
      confidence TEXT NOT NULL,
      actors TEXT NOT NULL,
      location_name TEXT,
      rationale TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  ).run();
  tableReady = true;
}

async function hashUrl(url: string): Promise<string> {
  const data = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function rowToResult(row: CachedRow): DeepReadResult {
  let actors: string[] = [];
  try {
    actors = JSON.parse(row.actors);
  } catch {
    actors = [];
  }
  return {
    confirmed: row.confirmed === 1,
    confidence: (row.confidence as DeepReadResult["confidence"]) ?? "low",
    actors,
    locationName: row.location_name,
    rationale: row.rationale,
  };
}

async function getCached(env: Env, urlHash: string): Promise<DeepReadResult | null> {
  const row = await env.DB.prepare(
    `SELECT confirmed, confidence, actors, location_name, rationale FROM escalation_deep_reads WHERE url_hash = ?`
  )
    .bind(urlHash)
    .first<CachedRow>();
  return row ? rowToResult(row) : null;
}

async function writeCache(env: Env, urlHash: string, sourceUrl: string, countryCode: string, result: DeepReadResult): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO escalation_deep_reads
        (url_hash, source_url, country_code, confirmed, confidence, actors, location_name, rationale, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
      .bind(urlHash, sourceUrl, countryCode, result.confirmed ? 1 : 0, result.confidence, JSON.stringify(result.actors), result.locationName, result.rationale, new Date().toISOString())
      .run();
  } catch (err) {
    console.error("[deep-read] cache write failed", err);
  }
}

const FETCH_TIMEOUT_MS = 6000;
const MAX_FETCHED_CHARS = 6000;

/** Best-effort plain-text extraction from a live article URL — used only
 *  when no title/description text was already available for the item
 *  (GDELT's bulk feed carries a source_url and nothing else — see
 *  connectors/gdeltBulk.ts's own doc comment on that limitation). Strips
 *  script/style blocks and all remaining tags with regexes rather than a
 *  real DOM/HTML parser (none is available in this Worker runtime without
 *  a much heavier dependency), decodes the handful of HTML entities that
 *  actually show up in running prose, and caps the result — this only needs
 *  to be good enough for an LLM to read the gist of the article, not a
 *  faithful rendering. Returns null on any failure (timeout, non-200,
 *  blocked, binary content) rather than throwing — a page this can't fetch
 *  or parse just means no deep-read verdict for that item, never a crash. */
async function extractArticleText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TheLensBot/1.0)" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) return null;
    const html = await res.text();
    const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
    const text = withoutScripts
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 60) return null; // too little recovered to be worth reading
    return text.slice(0, MAX_FETCHED_CHARS);
  } catch {
    return null;
  }
}

// Same model choice as countryEscalation.ts's own generateAnalyticalSummary
// (fast + cheap) — this runs per candidate EVIDENCE ITEM, not once per
// country, so it's a higher-volume workload than that summary call and an
// even stronger reason to stay on the cheap tier rather than a flagship model.
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_TIMEOUT_MS = 10000;
const WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const WORKERS_AI_TIMEOUT_MS = 9000;

function buildPrompt(text: string, countryName: string): string {
  return (
    `You are a conflict analyst reviewing ONE news article as a candidate military-escalation report for ${countryName}. ` +
    `Read the article text below and decide, from the text ALONE (never add outside facts, never assume anything not stated), ` +
    `whether it genuinely describes a current or very recent military-escalation incident actually happening in or directly ` +
    `involving ${countryName} — real fighting, an attack, a strike, a military mobilization/deployment tied to active conflict, ` +
    `a seizure of territory, a massacre, a coup, etc. — as opposed to: a retrospective/historical piece, an opinion or analysis ` +
    `column with no new incident, a regional roundup that only mentions ${countryName} in passing alongside other countries, a ` +
    `diplomatic/ceremonial/humanitarian/sports story that merely names a military or armed group, or an incident that is real but ` +
    `is actually happening in a DIFFERENT country than ${countryName} (say so if so).\n\n` +
    `Respond with ONLY a single JSON object, no other text, matching exactly this shape:\n` +
    `{"confirmed": boolean, "confidence": "high"|"medium"|"low", "actors": string[], "location": string|null, "rationale": string}\n\n` +
    `"actors": the specific armed group(s)/military unit(s)/forces the text names as actually involved (empty array if none named).\n` +
    `"location": the most specific place name (city/town/region) the text itself supports, or null if it names no place more ` +
    `specific than the country itself.\n` +
    `"rationale": one or two sentences, grounded only in this text, explaining your "confirmed" judgment — if true, what in the ` +
    `text supports it; if false, what's missing or what the text is actually about instead.\n\n` +
    `Article text:\n"""\n${text}\n"""`
  );
}

interface ParsedLLMJson {
  confirmed?: unknown;
  confidence?: unknown;
  actors?: unknown;
  location?: unknown;
  rationale?: unknown;
}

/** Pulls the first {...} block out of a model response (models sometimes
 *  wrap JSON in a sentence or code fence despite instructions) and validates
 *  it loosely into a DeepReadResult — any shape mismatch returns null so the
 *  caller falls back to the keyword-based decision rather than trusting a
 *  malformed/hallucinated field. */
// Exported (otherwise this module's only non-network, fully unit-testable
// piece of logic) so a change to the parsing/validation contract — what
// malformed model output fails safe on, in particular — gets a real test
// rather than only being exercised via a live LLM call.
export function parseLLMResponse(raw: string): DeepReadResult | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: ParsedLLMJson;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof parsed.confirmed !== "boolean") return null;
  if (typeof parsed.rationale !== "string" || !parsed.rationale.trim()) return null;
  const confidence: DeepReadResult["confidence"] = parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low" ? parsed.confidence : "low";
  const actors = Array.isArray(parsed.actors) ? parsed.actors.filter((a): a is string => typeof a === "string") : [];
  const locationName = typeof parsed.location === "string" && parsed.location.trim() ? parsed.location.trim() : null;
  return { confirmed: parsed.confirmed, confidence, actors, locationName, rationale: parsed.rationale.trim() };
}

/** Anthropic first (same model/pattern as countryEscalation.ts's own
 *  generateAnalyticalSummary), Workers AI fallback — see that function's
 *  doc comment for why the fallback exists (an unset ANTHROPIC_API_KEY
 *  secret should degrade, not silently disable this feature forever).
 *  Returns null (never throws) on any failure at either step. */
async function classifyWithLLM(env: Env, text: string, countryName: string): Promise<DeepReadResult | null> {
  const prompt = buildPrompt(text, countryName);

  if (env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
      });
      if (res.ok) {
        const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
        const raw = data.content?.find((b) => b.type === "text")?.text;
        if (raw) {
          const parsed = parseLLMResponse(raw);
          if (parsed) return parsed;
        }
      } else {
        console.error(`[deep-read] Anthropic request failed: ${res.status}`);
      }
    } catch (err) {
      console.error("[deep-read] Anthropic request errored", err);
    }
  }

  try {
    const result = await Promise.race([
      env.AI.run(WORKERS_AI_MODEL, { messages: [{ role: "user", content: prompt }], max_tokens: 400 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("workers-ai deep-read timeout")), WORKERS_AI_TIMEOUT_MS)),
    ]);
    const raw = (result as { response?: string })?.response;
    return raw ? parseLLMResponse(raw) : null;
  } catch (err) {
    console.error("[deep-read] Workers AI request errored", err);
    return null;
  }
}

/** The orchestration entry point every caller uses. `text`, when given, is
 *  already-available title/description text (Africa Wire's crawl, GDELT's
 *  live article search) — no extra fetch needed. When omitted (GDELT bulk
 *  events, which carry no article text at all), this falls back to fetching
 *  `sourceUrl` itself. Cache-first: a URL already deep-read (by anyone, any
 *  country context — the classification question is "is this an escalation
 *  for countryName", so the same URL IS re-read per distinct country it's
 *  evaluated against, which is correct: the same article can be genuine
 *  evidence for one country and a false lead for another) short-circuits
 *  straight to the cached verdict, no new LLM call. */
export async function deepReadEvidence(
  env: Env,
  params: { sourceUrl: string; text?: string | null; countryCode: string; countryName: string }
): Promise<DeepReadResult | null> {
  if (!params.sourceUrl) return null;
  await ensureDeepReadTable(env);
  const cacheKey = await hashUrl(`${params.countryCode.toUpperCase()}:${params.sourceUrl}`);
  const cached = await getCached(env, cacheKey);
  if (cached) return cached;

  const text = params.text && params.text.trim().length >= 40 ? params.text.trim() : await extractArticleText(params.sourceUrl);
  if (!text) return null;

  const result = await classifyWithLLM(env, text.slice(0, MAX_FETCHED_CHARS), params.countryName);
  if (!result) return null;
  await writeCache(env, cacheKey, params.sourceUrl, params.countryCode.toUpperCase(), result);
  return result;
}

/** Cache-only lookup — no fetch, no LLM call — used from the 5-minute
 *  scoring cron (countryEscalation.ts's scoreCountryEscalations) so that hot
 *  loop never pays deep-read latency/cost itself; it only benefits from
 *  verdicts the on-demand drill-down (getCountryEscalationEvidence et al.,
 *  called per-country when a person or the map actually opens one) has
 *  already produced and cached. See deepRead.ts's own top-of-file doc
 *  comment for the full cost reasoning. */
export async function getCachedDeepRead(env: Env, sourceUrl: string, countryCode: string): Promise<DeepReadResult | null> {
  if (!sourceUrl) return null;
  await ensureDeepReadTable(env);
  const cacheKey = await hashUrl(`${countryCode.toUpperCase()}:${sourceUrl}`);
  return getCached(env, cacheKey);
}

/** Runs deepReadEvidence over a bounded number of candidates concurrently,
 *  filters out ones the model explicitly rejected, and returns the survivors
 *  paired with their verdict (undefined when no verdict was available at
 *  all — fetch/LLM failure — in which case the item is KEPT, not dropped:
 *  "no verdict" must never read as "rejected", only an explicit
 *  `confirmed: false` does). `maxToRead` bounds the LLM-call volume per
 *  call site; items beyond that bound are kept as-is with no verdict. */
export async function deepReadBatch<T extends { sourceUrl: string; title?: string }>(
  env: Env,
  items: T[],
  countryCode: string,
  countryName: string,
  maxToRead: number
): Promise<Array<{ item: T; deepRead: DeepReadResult | null }>> {
  const toRead = items.slice(0, maxToRead);
  const rest = items.slice(maxToRead);
  const read = await Promise.all(
    toRead.map(async (item) => ({
      item,
      deepRead: await deepReadEvidence(env, { sourceUrl: item.sourceUrl, text: item.title, countryCode, countryName }).catch(() => null),
    }))
  );
  return [...read, ...rest.map((item) => ({ item, deepRead: null as DeepReadResult | null }))].filter(
    ({ deepRead }) => deepRead === null || deepRead.confirmed !== false
  );
}
