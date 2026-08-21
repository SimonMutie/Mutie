diff --git a/crisis-monitor/backend/src/connectors/gdelt.ts b/crisis-monitor/backend/src/connectors/gdelt.ts
index 8556e2b..3c5f2ec 100644
--- a/crisis-monitor/backend/src/connectors/gdelt.ts
+++ b/crisis-monitor/backend/src/connectors/gdelt.ts
@@ -87,28 +87,46 @@ function parseGdeltDate(seendate: string): Date {
   return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
 }
 
-/** Builds a GDELT-compatible OR-query from a flat list of terms pulled from active
- *  monitoring queries. GDELT treats bare space-separated words as AND, so we
- *  explicitly OR them and quote multi-word phrases — and GDELT's DOC API
- *  requires any OR'd term list to be wrapped in parentheses, rejecting a bare
- *  "a OR b OR c" with a plain-text error ("Queries containing OR'd terms must
- *  be surrounded by ()") instead of JSON. Kept fairly small (10, not 20) to
- *  stay well under whatever length/complexity limit GDELT enforces. */
-export function buildQueryFromTerms(terms: string[], maxTerms = 10): string {
-  const unique = Array.from(new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, maxTerms);
-  if (unique.length === 0) return "(crisis OR emergency OR disaster)"; // sane fallback if no queries are active yet
-  const quoted = unique.map((t) => (t.includes(" ") ? `"${t}"` : t));
-  return quoted.length > 1 ? `(${quoted.join(" OR ")})` : quoted[0];
+const GDELT_CHUNK_SIZE = 10; // terms per OR-group — stays well under GDELT's per-request length/complexity limit
+const GDELT_CHUNK_STAGGER_MS = 1000; // pause between a query's own chunk requests — be a good citizen of GDELT's free API
+
+/** Splits a flat list of terms pulled from an active monitoring query into one
+ *  or more GDELT-compatible OR-queries. GDELT treats bare space-separated words
+ *  as AND, so we explicitly OR them and quote multi-word phrases — and GDELT's
+ *  DOC API requires any OR'd term list to be wrapped in parentheses, rejecting a
+ *  bare "a OR b OR c" with a plain-text error ("Queries containing OR'd terms
+ *  must be surrounded by ()") instead of JSON.
+ *
+ *  Previously this hard-capped at 10 terms and silently dropped the rest, which
+ *  meant a real-world topic query with lots of synonyms/place names would just
+ *  never search on most of its terms. Chunking instead means a query can have
+ *  any number of terms — each chunk becomes its own GDELT request, and
+ *  `pollGdelt` merges + dedupes the results — at the cost of one extra HTTP
+ *  call per chunk beyond the first. */
+export function buildQueryChunks(terms: string[], chunkSize = GDELT_CHUNK_SIZE): string[] {
+  const unique = Array.from(new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean)));
+  if (unique.length === 0) return ["(crisis OR emergency OR disaster)"]; // sane fallback if no queries are active yet
+
+  const chunks: string[] = [];
+  for (let i = 0; i < unique.length; i += chunkSize) {
+    const quoted = unique.slice(i, i + chunkSize).map((t) => (t.includes(" ") ? `"${t}"` : t));
+    chunks.push(quoted.length > 1 ? `(${quoted.join(" OR ")})` : quoted[0]);
+  }
+  return chunks;
 }
 
-export async function fetchGdeltArticles(searchTerms: string, maxRecords = 75): Promise<GdeltArticle[]> {
+export async function fetchGdeltArticles(
+  searchTerms: string,
+  maxRecords = 250, // GDELT's documented max per request — was 75, starving niche/narrow topics of candidates
+  timespan = "6h" // was 1h — too narrow a window for low-volume topics to have any hits at all
+): Promise<GdeltArticle[]> {
   const params = new URLSearchParams({
     query: searchTerms,
     mode: "artlist",
     maxrecords: String(maxRecords),
     format: "json",
     sort: "datedesc",
-    timespan: "1h",
+    timespan,
   });
 
   const res = await fetch(`${GDELT_ENDPOINT}?${params.toString()}`, {
@@ -134,6 +152,56 @@ export async function fetchGdeltArticles(searchTerms: string, maxRecords = 75):
   return Array.isArray(articles) ? (articles as GdeltArticle[]) : [];
 }
 
+const FULLTEXT_TIMEOUT_MS = 4000;
+const FULLTEXT_MAX_CHARS = 4000;
+const DEFAULT_FULLTEXT_BUDGET = 15; // per pollGdelt() call — see note on fulltextCache below
+
+function stripHtml(html: string): string {
+  return html
+    .replace(/<script[\s\S]*?<\/script>/gi, " ")
+    .replace(/<style[\s\S]*?<\/style>/gi, " ")
+    .replace(/<[^>]+>/g, " ")
+    .replace(/&nbsp;/gi, " ")
+    .replace(/&amp;/gi, "&")
+    .replace(/&#39;|&apos;/gi, "'")
+    .replace(/&quot;/gi, '"')
+    .replace(/\s+/g, " ")
+    .trim();
+}
+
+/** Best-effort fetch of an article's visible text.
+ *
+ *  This is the actual fix for narrow/AND-heavy queries never matching: GDELT's
+ *  DOC API only ever returns a headline, never body text, and events were being
+ *  matched against that headline alone. A query like `"cholera" AND "Nairobi"`
+ *  needs both words to literally co-occur in ~10 words of headline, which is
+ *  rare even when a genuinely relevant article exists — whereas a single-term
+ *  query like `ebola` only ever needed one word to be present, so it looked
+ *  like it "worked" while narrower queries silently starved. Pulling in the
+ *  article body gives the boolean matcher enough text for multi-term queries
+ *  to actually have a chance of matching.
+ *
+ *  Fails soft: any network error, timeout, paywall, or robots block just
+ *  falls back to matching on the headline alone (the old behavior), never
+ *  breaks ingestion. */
+async function fetchArticleText(url: string): Promise<string | null> {
+  const controller = new AbortController();
+  const timeout = setTimeout(() => controller.abort(), FULLTEXT_TIMEOUT_MS);
+  try {
+    const res = await fetch(url, {
+      signal: controller.signal,
+      headers: { "User-Agent": "SentinelCrisisMonitor/1.0 (+https://github.com/SimonMutie/Mutie)" },
+    });
+    if (!res.ok) return null;
+    const html = await res.text();
+    return stripHtml(html).slice(0, FULLTEXT_MAX_CHARS) || null;
+  } catch {
+    return null;
+  } finally {
+    clearTimeout(timeout);
+  }
+}
+
 async function getOrCreateGdeltSourceId(env: Env): Promise<string | null> {
   const existing = await all<{ id: string }>(env.DB, "SELECT id FROM sources WHERE name = ?", ["GDELT News Wire"]);
   if (existing[0]) return existing[0].id;
@@ -146,15 +214,62 @@ async function getOrCreateGdeltSourceId(env: Env): Promise<string | null> {
   return id;
 }
 
-/** Fetches and inserts new GDELT articles (deduped by URL via the events table's
- *  partial unique index), returning the inserted rows. */
-export async function pollGdelt(env: Env, searchTerms: string): Promise<EventRecord[]> {
+export interface PollGdeltOptions {
+  maxRecords?: number;
+  timespan?: string;
+  /** Per-call budget for how many *new* articles get a full-text fetch attempt
+   *  (see fetchArticleText). Kept modest since a scheduled tick may call
+   *  pollGdelt once per active query, and each fetch costs a real HTTP round
+   *  trip against the target news site. */
+  fulltextBudget?: number;
+  /** Shared across every pollGdelt() call within one cron tick (pass the same
+   *  Map from the caller's loop). Multiple monitoring queries' broad GDELT
+   *  recall very often surfaces the same trending article — this cache means
+   *  we fetch that article's body at most once per tick instead of once per
+   *  query that happened to also recall it. */
+  fulltextCache?: Map<string, string | null>;
+}
+
+/** Fetches every chunk of a (possibly multi-chunk, "any size") query, merges
+ *  and dedupes the results by URL, enriches a bounded number of new articles
+ *  with full-text for better boolean matching, and inserts (deduped again by
+ *  the events table's partial unique index), returning the inserted rows. */
+export async function pollGdelt(env: Env, searchTermChunks: string[], opts: PollGdeltOptions = {}): Promise<EventRecord[]> {
   const sourceId = await getOrCreateGdeltSourceId(env);
-  const articles = await fetchGdeltArticles(searchTerms);
+
+  const byUrl = new Map<string, GdeltArticle>();
+  for (const [i, chunk] of searchTermChunks.entries()) {
+    if (i > 0) await new Promise((resolve) => setTimeout(resolve, GDELT_CHUNK_STAGGER_MS));
+    try {
+      const articles = await fetchGdeltArticles(chunk, opts.maxRecords, opts.timespan);
+      for (const article of articles) {
+        if (article.url) byUrl.set(article.url, article);
+      }
+    } catch (err) {
+      console.error(`[gdelt] chunk query failed (query="${chunk}"):`, err);
+      // keep going — one bad/oversized chunk shouldn't sink the other chunks of this query
+    }
+  }
+
   const inserted: EventRecord[] = [];
+  const fulltextCache = opts.fulltextCache ?? new Map<string, string | null>();
+  let fulltextBudget = opts.fulltextBudget ?? DEFAULT_FULLTEXT_BUDGET;
 
-  for (const article of articles) {
+  for (const article of byUrl.values()) {
     if (!article.url || !article.title) continue;
+
+    let content = article.title;
+    if (!fulltextCache.has(article.url)) {
+      if (fulltextBudget > 0) {
+        fulltextBudget--;
+        fulltextCache.set(article.url, await fetchArticleText(article.url));
+      } else {
+        fulltextCache.set(article.url, null); // out of budget this tick — remember so we don't retry pointlessly
+      }
+    }
+    const bodyText = fulltextCache.get(article.url);
+    if (bodyText) content = `${article.title} ${bodyText}`;
+
     const centroid = COUNTRY_CENTROIDS[article.sourcecountry] ?? null;
     const id = newId();
     const now = nowIso();
@@ -172,7 +287,7 @@ export async function pollGdelt(env: Env, searchTerms: string): Promise<EventRec
         sourceId,
         article.url,
         article.domain ?? null,
-        article.title,
+        content,
         article.url,
         (article.language ?? "en").toLowerCase(),
         publishedAt,
diff --git a/crisis-monitor/backend/src/index.ts b/crisis-monitor/backend/src/index.ts
index 218e398..c5e20e7 100644
--- a/crisis-monitor/backend/src/index.ts
+++ b/crisis-monitor/backend/src/index.ts
@@ -7,7 +7,7 @@ import { eventsRouter } from "./routes/events";
 import { alertsRouter } from "./routes/alerts";
 import { statsRouter } from "./routes/stats";
 import { matchAndBroadcast, loadActiveCompiledQueries } from "./ingest";
-import { buildQueryFromTerms, pollGdelt } from "./connectors/gdelt";
+import { buildQueryChunks, pollGdelt } from "./connectors/gdelt";
 
 export { LiveFeedHub } from "./durableObjects/liveFeedHub";
 export { IngestionActor } from "./durableObjects/ingestionActor";
@@ -74,23 +74,37 @@ export default {
     // search still gets deduped against events already in the table, and any
     // newly-inserted article is matched against *every* active query (not
     // just the one whose search happened to surface it), same as before.
+    //
+    // Each query's terms are further split into GDELT-sized chunks
+    // (buildQueryChunks) rather than truncated to a fixed max, so a query can
+    // have any number of terms — it just costs one extra GDELT request per
+    // chunk beyond the first. MAX_CHUNKS_PER_QUERY is a safety ceiling (not a
+    // silent-drop cap) to keep one pathological query from eating the whole
+    // tick's time budget; raise it if you need to monitor genuinely huge
+    // term lists.
     const MAX_QUERIES_PER_TICK = 25;
+    const MAX_CHUNKS_PER_QUERY = 20; // 20 chunks * 10 terms/chunk = up to 200 terms per query
     const GDELT_REQUEST_STAGGER_MS = 1500;
     const compiled = await loadActiveCompiledQueries(env);
 
+    // Shared across every query this tick: if several queries' broad recall
+    // both surface the same trending article, we fetch its full text once,
+    // not once per query.
+    const fulltextCache = new Map<string, string | null>();
+
     for (const [i, q] of compiled.slice(0, MAX_QUERIES_PER_TICK).entries()) {
       // Be a good citizen of GDELT's free API — spread requests out within
       // the tick instead of firing them back to back.
       if (i > 0) await new Promise((resolve) => setTimeout(resolve, GDELT_REQUEST_STAGGER_MS));
 
       try {
-        const searchTerms = buildQueryFromTerms(q.parsed.positiveTerms);
-        const inserted = await pollGdelt(env, searchTerms);
+        const chunks = buildQueryChunks(q.parsed.positiveTerms).slice(0, MAX_CHUNKS_PER_QUERY);
+        const inserted = await pollGdelt(env, chunks, { fulltextCache });
         for (const event of inserted) {
           await matchAndBroadcast(env, event);
         }
         if (inserted.length > 0) {
-          console.log(`[gdelt] query=${q.id} terms="${searchTerms}" -> ${inserted.length} new articles`);
+          console.log(`[gdelt] query=${q.id} chunks=${chunks.length} -> ${inserted.length} new articles`);
         }
       } catch (err) {
         console.error(`[gdelt] poll failed for query ${q.id}:`, err);
