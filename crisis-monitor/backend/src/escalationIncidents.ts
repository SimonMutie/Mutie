import { all, first, run, nowIso } from "./db";
import { newId } from "./ids";
import type { Env } from "./bindings";
import { toGdeltTimestamp } from "./connectors/gdeltBulk";
import { hashId, fetchWireArticleItems } from "./lib/osintFeed";
import { candidatePriority, isCandidateText } from "./lib/escalationKeywords";
import { normalizeForMatch, readArticle } from "./lib/articleReader";
import { codeArticle, verifyCoding, synthesizeIncident, fallbackSynthesis, type ArticleForCoding, type VerifiedIndicator, type IncidentSynthesis, type SynthesisSource } from "./lib/escalationCoder";
import { resolvePlace, type GeocodeBudget } from "./lib/geocoder";
import { countryAt, countryName, distanceKm, lookupKnownPlace, looseKey, mentionsAfrica, resolveCountryCode, type GeoPrecision } from "./lib/africaGeo";
import { ACTIVE_WINDOW_HOURS, decideLevel, INDICATOR_BY_ID, type Confidence, type EscalationLevel, type IndicatorId, type Trajectory } from "./lib/escalationCodebook";
import { describeProvider, getLastModelError } from "./lib/llm";
import type { EscalationCandidate } from "./durableObjects/africaWireActor";

/**
 * The escalation pipeline. Replaces the old country-level scorer
 * (countryEscalation.ts), which counted GDELT event codes per country,
 * matched countries by substring, placed markers from GDELT's own
 * coordinates and summarised from headlines.
 *
 * Each 5-minute tick:
 *
 *   1. COLLECT candidate articles from three places — the Africa Wire crawl,
 *      the wire-service feeds, and the URLs behind GDELT's conflict-coded
 *      events located in Africa. A loose keyword filter only decides what is
 *      worth reading; GDELT's codes and coordinates are used for nothing else.
 *   2. READ each new candidate in full (lib/articleReader.ts).
 *   3. CODE it against the written codebook (lib/escalationCoder.ts): is this
 *      a real, dated event; where exactly; who; which indicators, each with a
 *      verbatim quote. The coding is then verified against the article text.
 *   4. LOCATE each event from the place the article names, inside the country
 *      the article says it is in (lib/geocoder.ts, lib/africaGeo.ts).
 *   5. GROUP reports into incidents by place, and set each incident's level
 *      with the fixed rules in lib/escalationCodebook.ts.
 *   6. ASSESS each flagged incident: one analyst call writes the summary and
 *      assessment from that incident's own coded reports, with citations.
 *   7. ALERT once per incident (and again only if it rises to Critical), and
 *      close the alert when the incident ages out.
 *
 * Every decision is stored: escalation_articles records why each article was
 * coded or rejected, escalation_reports holds each event with its quotes and
 * how its location was resolved, and escalation_incidents holds the criteria
 * met. The audit and status endpoints in routes/liveLayers.ts read these.
 */

const DEFAULT_ARTICLES_PER_TICK = 12;
const CODING_CONCURRENCY = 3;
const SYNTHESES_PER_TICK = 4;
const GEOCODER_CALLS_PER_TICK = 6;
const CANDIDATE_MAX_AGE_HOURS = 72;
const GDELT_CANDIDATE_WINDOW_HOURS = 24;
const MAX_ATTEMPTS = 3;
/** Place-level reports within this distance of an incident's anchor join it. */
export const CLUSTER_RADIUS_KM = 50;
const LOCK_TTL_MS = 4 * 60_000;

// ── Schema ───────────────────────────────────────────────────────────────

let tablesReady = false;
async function ensureTables(env: Env): Promise<void> {
  if (tablesReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS escalation_articles (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      domain TEXT NOT NULL,
      title TEXT,
      origin TEXT NOT NULL,
      published_at TEXT,
      text_basis TEXT,
      status TEXT NOT NULL,
      rejection_reason TEXT,
      rejection_note TEXT,
      report_count INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 1,
      model TEXT,
      processed_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_escalation_articles_processed ON escalation_articles (processed_at)`,
    `CREATE TABLE IF NOT EXISTS escalation_reports (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      incident_id TEXT,
      country_code TEXT NOT NULL,
      country_name TEXT NOT NULL,
      place TEXT,
      admin1 TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      geo_precision TEXT NOT NULL,
      geo_method TEXT NOT NULL,
      geo_label TEXT,
      event_date TEXT NOT NULL,
      date_basis TEXT NOT NULL,
      actors TEXT NOT NULL DEFAULT '[]',
      indicators TEXT NOT NULL DEFAULT '[]',
      fatalities INTEGER,
      trajectory TEXT NOT NULL,
      trajectory_reason TEXT,
      what_happened TEXT NOT NULL,
      significance TEXT,
      confidence TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '[]',
      excerpt TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_escalation_reports_incident ON escalation_reports (incident_id)`,
    `CREATE INDEX IF NOT EXISTS idx_escalation_reports_event_date ON escalation_reports (event_date)`,
    `CREATE TABLE IF NOT EXISTS escalation_incidents (
      id TEXT PRIMARY KEY,
      country_code TEXT NOT NULL,
      country_name TEXT NOT NULL,
      region_key TEXT NOT NULL DEFAULT '',
      location_label TEXT,
      admin1 TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      geo_precision TEXT NOT NULL,
      level TEXT NOT NULL,
      status TEXT NOT NULL,
      headline TEXT,
      summary TEXT,
      assessment TEXT,
      outlook TEXT,
      caveats TEXT,
      detail TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT,
      state_hash TEXT,
      synthesis_model TEXT,
      alerted_level TEXT,
      alert_id TEXT,
      first_event_date TEXT,
      last_event_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_escalation_incidents_status ON escalation_incidents (status, level)`,
    `CREATE TABLE IF NOT EXISTS escalation_pipeline_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ];
  for (const sql of stmts) await env.DB.prepare(sql).run();
  tablesReady = true;
}

async function getState(env: Env, key: string): Promise<string | null> {
  return (await first<{ value: string }>(env.DB, "SELECT value FROM escalation_pipeline_state WHERE key = ?", [key]))?.value ?? null;
}
async function setState(env: Env, key: string, value: string): Promise<void> {
  await run(env.DB, "INSERT INTO escalation_pipeline_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
}

// ── Candidates ───────────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  url: string;
  domain: string;
  origin: "africa-wire" | "wire-feed" | "gdelt";
  title: string | null;
  /** Feed summary — used only if the full page cannot be read. */
  feedText: string | null;
  publishedAt: string | null;
  priority: number;
}

const TRACKING_PARAM_RX = /^(?:utm_|fbclid|gclid|mc_|ref$|source$|cmpid|ocid)/i;

/** One id per article however its URL was decorated. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAM_RX.test(key)) u.searchParams.delete(key);
    const host = u.hostname.toLowerCase().replace(/^(?:www|m|amp)\./, "");
    const path = u.pathname.replace(/\/amp\/?$/, "/").replace(/\/+$/, "");
    const qs = u.searchParams.toString();
    return `${host}${path}${qs ? `?${qs}` : ""}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(?:www|m|amp)\./, "");
  } catch {
    return "unknown";
  }
}

function gdeltTimestampToIso(ts: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(ts);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

async function gatherAfricaWire(env: Env): Promise<Candidate[]> {
  try {
    const stub = env.AFRICA_WIRE_ACTOR.get(env.AFRICA_WIRE_ACTOR.idFromName("global"));
    const res = await stub.fetch(`http://africa-wire-actor/escalation-candidates?maxAgeHours=${CANDIDATE_MAX_AGE_HOURS}`);
    if (!res.ok) return [];
    const data = await res.json<{ candidates: EscalationCandidate[] }>();
    return data.candidates.map((c) => ({
      id: hashId(canonicalUrl(c.link)),
      url: c.link,
      domain: domainOf(c.link),
      origin: "africa-wire" as const,
      title: c.title,
      feedText: `${c.title}. ${c.description}`.trim(),
      publishedAt: c.published,
      priority: c.priority,
    }));
  } catch (err) {
    console.error("[escalation] Africa Wire candidates failed", err);
    return [];
  }
}

const AFRICA_FOCUSED_FEEDS = new Set(["allafrica.com", "dabangasudan.org", "sudantribune.com", "africanews.com"]);

async function gatherWireFeeds(): Promise<Candidate[]> {
  try {
    const items = await fetchWireArticleItems();
    return items
      // These feeds are mostly world news; only items that mention somewhere
      // in Africa are worth reading (Africa-focused outlets are exempt).
      .filter((it) => isCandidateText(`${it.title} ${it.description}`) && (AFRICA_FOCUSED_FEEDS.has(it.domain) || mentionsAfrica(`${it.title} ${it.description}`)))
      .map((it) => ({
        id: hashId(canonicalUrl(it.link)),
        url: it.link,
        domain: domainOf(it.link),
        origin: "wire-feed" as const,
        title: it.title,
        feedText: it.description,
        publishedAt: it.published,
        priority: candidatePriority(`${it.title} ${it.description}`),
      }));
  } catch (err) {
    console.error("[escalation] wire-feed candidates failed", err);
    return [];
  }
}

/** The article URLs behind GDELT's conflict-coded events whose reported
 *  location is in Africa. GDELT's event code and coordinates are used ONLY
 *  to pick these URLs for reading — the article itself decides everything
 *  else, including where the event really was. */
async function gatherGdelt(env: Env): Promise<Candidate[]> {
  try {
    const since = toGdeltTimestamp(new Date(Date.now() - GDELT_CANDIDATE_WINDOW_HOURS * 3600_000));
    const rows = await all<{ source_url: string; mentions: number | null; date_added: string; lat: number; lon: number; place_name: string }>(
      env.DB,
      `SELECT source_url, MAX(num_mentions) AS mentions, MAX(date_added) AS date_added, MIN(lat) AS lat, MIN(lon) AS lon, MIN(place_name) AS place_name
       FROM gdelt_bulk_events
       WHERE date_added >= ? AND source_url LIKE 'http%'
         AND (event_code LIKE '15%' OR event_code LIKE '18%' OR event_code LIKE '19%' OR event_code LIKE '20%')
         AND lat BETWEEN -36 AND 38.5 AND lon BETWEEN -26 AND 60
       GROUP BY source_url ORDER BY mentions DESC LIMIT 400`,
      [since]
    );
    return rows
      .filter((r) => countryAt(r.lat, r.lon) !== null || resolveCountryCode((r.place_name ?? "").split(",").pop()?.trim()) !== null)
      .map((r) => ({
        id: hashId(canonicalUrl(r.source_url)),
        url: r.source_url,
        domain: domainOf(r.source_url),
        origin: "gdelt" as const,
        title: null,
        feedText: null,
        publishedAt: gdeltTimestampToIso(r.date_added),
        priority: r.mentions ?? 0,
      }));
  } catch (err) {
    console.error("[escalation] GDELT candidates failed", err);
    return [];
  }
}

/** Round-robin across the three origins so no single source starves the
 *  others within one tick's reading budget. Each list is already in its own
 *  priority order. */
export function pickBatch(lists: Candidate[][], n: number): Candidate[] {
  const queues = lists.map((l) => [...l]);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  while (out.length < n && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      while (q.length > 0) {
        const c = q.shift()!;
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
        break;
      }
      if (out.length >= n) break;
    }
  }
  return out;
}

// ── Reading and coding one article ───────────────────────────────────────

function excerptAround(text: string, indicators: VerifiedIndicator[]): string {
  const lower = text.toLowerCase();
  for (const ind of indicators) {
    const probe = ind.quote.slice(0, 40).toLowerCase();
    const at = probe.length >= 12 ? lower.indexOf(probe) : -1;
    if (at >= 0) return text.slice(Math.max(0, at - 250), at + 500).replace(/\s+/g, " ").trim();
  }
  return text.slice(0, 700).replace(/\s+/g, " ").trim();
}

interface ProcessStats {
  coded: number;
  rejected: number;
  unreadable: number;
  errors: number;
  reports: number;
  /** Articles for which no model returned a coding this tick. */
  modelFailures: number;
}

async function claimArticle(env: Env, c: Candidate): Promise<boolean> {
  const now = nowIso();
  const inserted = await env.DB.prepare(
    `INSERT INTO escalation_articles (id, url, domain, title, origin, published_at, status, attempts, processed_at)
     VALUES (?,?,?,?,?,?, 'processing', 1, ?) ON CONFLICT(id) DO NOTHING`
  )
    .bind(c.id, c.url, c.domain, c.title, c.origin, c.publishedAt, now)
    .run();
  if ((inserted.meta?.changes ?? 0) > 0) return true;
  // Already known: retry only a failed or abandoned attempt, a bounded number of times.
  const stale = new Date(Date.now() - 15 * 60_000).toISOString();
  const retried = await env.DB.prepare(
    `UPDATE escalation_articles SET status = 'processing', attempts = attempts + 1, processed_at = ?
     WHERE id = ? AND ((status = 'error' AND (attempts < ? OR rejection_reason = 'model_unavailable')) OR (status = 'processing' AND processed_at < ?))`
  )
    .bind(now, c.id, MAX_ATTEMPTS, stale)
    .run();
  return (retried.meta?.changes ?? 0) > 0;
}

async function processCandidate(env: Env, c: Candidate, geocodeBudget: GeocodeBudget, stats: ProcessStats): Promise<void> {
  const finish = (status: string, fields: { reason?: string | null; note?: string | null; reports?: number; model?: string | null; title?: string | null; textBasis?: string | null; publishedAt?: string | null }) =>
    run(
      env.DB,
      `UPDATE escalation_articles SET status = ?, rejection_reason = ?, rejection_note = ?, report_count = ?, model = ?, title = COALESCE(?, title), text_basis = ?, published_at = COALESCE(?, published_at), processed_at = ? WHERE id = ?`,
      [status, fields.reason ?? null, fields.note ?? null, fields.reports ?? 0, fields.model ?? null, fields.title ?? null, fields.textBasis ?? null, fields.publishedAt ?? null, nowIso(), c.id]
    );

  try {
    const page = await readArticle(c.url);
    let article: ArticleForCoding | null = null;
    if (page) {
      article = { url: c.url, title: c.title ?? page.title ?? "(untitled)", text: page.text, textBasis: "full_text", publishedAt: page.publishedAt ?? c.publishedAt, domain: c.domain };
    } else if (c.feedText && c.feedText.length >= 200) {
      // The page could not be read; the feed's own summary is long enough to
      // code from, at reduced confidence (see verifyCoding).
      article = { url: c.url, title: c.title ?? "(untitled)", text: c.feedText, textBasis: "feed_summary", publishedAt: c.publishedAt, domain: c.domain };
    }
    if (!article) {
      stats.unreadable++;
      await finish("unreadable", { reason: "unreadable", note: "The article page could not be fetched or had no readable body." });
      return;
    }
    if (article.publishedAt && Date.now() - Date.parse(article.publishedAt) > 6 * 86_400_000) {
      stats.rejected++;
      await finish("rejected", { reason: "retrospective", note: "Published more than six days ago.", title: article.title, textBasis: article.textBasis, publishedAt: article.publishedAt });
      return;
    }

    const coded = await codeArticle(env, article);
    if (!coded) {
      stats.errors++;
      stats.modelFailures++;
      await finish("error", { reason: "model_unavailable", note: "No model produced a coding for this article; it will be retried.", title: article.title, textBasis: article.textBasis });
      return;
    }
    const outcome = verifyCoding(coded.raw, article);
    if (outcome.reports.length === 0) {
      stats.rejected++;
      await finish("rejected", { reason: outcome.rejectionReason, note: outcome.rejectionNote, model: coded.model, title: article.title, textBasis: article.textBasis, publishedAt: article.publishedAt });
      return;
    }

    for (const r of outcome.reports) {
      const loc = await resolvePlace(env, { countryCode: r.countryCode, place: r.place, admin1: r.admin1, modelLat: r.modelLat, modelLon: r.modelLon }, geocodeBudget);
      await run(
        env.DB,
        `INSERT INTO escalation_reports
          (id, article_id, incident_id, country_code, country_name, place, admin1, lat, lon, geo_precision, geo_method, geo_label,
           event_date, date_basis, actors, indicators, fatalities, trajectory, trajectory_reason, what_happened, significance, confidence, notes, excerpt, created_at)
         VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          newId(), c.id, r.countryCode, r.countryName, r.place, r.admin1, loc.lat, loc.lon, loc.precision, loc.method, loc.label,
          r.eventDate, r.dateBasis, JSON.stringify(r.actors), JSON.stringify(r.indicators), r.fatalities, r.trajectory, r.trajectoryReason,
          r.whatHappened, r.significance, r.confidence, JSON.stringify(r.notes), excerptAround(article.text, r.indicators), nowIso(),
        ]
      );
      stats.reports++;
    }
    stats.coded++;
    await finish("coded", { reports: outcome.reports.length, model: coded.model, title: article.title, textBasis: article.textBasis, publishedAt: article.publishedAt });
  } catch (err) {
    stats.errors++;
    console.error(`[escalation] processing failed for ${c.url}`, err);
    await finish("error", { reason: "processing_error", note: err instanceof Error ? err.message.slice(0, 200) : "unknown error" }).catch(() => {});
  }
}

// ── Incidents ────────────────────────────────────────────────────────────

export interface StoredReport {
  id: string;
  articleId: string;
  incidentId: string | null;
  countryCode: string;
  countryName: string;
  place: string | null;
  admin1: string | null;
  lat: number;
  lon: number;
  geoPrecision: GeoPrecision;
  geoMethod: string;
  geoLabel: string | null;
  eventDate: string;
  dateBasis: string;
  actors: string[];
  indicators: VerifiedIndicator[];
  fatalities: number | null;
  trajectory: Trajectory;
  trajectoryReason: string | null;
  whatHappened: string;
  significance: string | null;
  confidence: Confidence;
  notes: string[];
  excerpt: string | null;
  // from the article row
  url: string;
  title: string | null;
  domain: string;
  publishedAt: string | null;
  textBasis: string | null;
}

interface ReportDbRow {
  id: string; article_id: string; incident_id: string | null; country_code: string; country_name: string; place: string | null; admin1: string | null;
  lat: number; lon: number; geo_precision: GeoPrecision; geo_method: string; geo_label: string | null; event_date: string; date_basis: string;
  actors: string; indicators: string; fatalities: number | null; trajectory: Trajectory; trajectory_reason: string | null; what_happened: string;
  significance: string | null; confidence: Confidence; notes: string; excerpt: string | null;
  url: string; title: string | null; domain: string; published_at: string | null; text_basis: string | null;
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function toStoredReport(r: ReportDbRow): StoredReport {
  return {
    id: r.id, articleId: r.article_id, incidentId: r.incident_id, countryCode: r.country_code, countryName: r.country_name, place: r.place, admin1: r.admin1,
    lat: r.lat, lon: r.lon, geoPrecision: r.geo_precision, geoMethod: r.geo_method, geoLabel: r.geo_label, eventDate: r.event_date, dateBasis: r.date_basis,
    actors: parseJson<string[]>(r.actors, []), indicators: parseJson<VerifiedIndicator[]>(r.indicators, []), fatalities: r.fatalities, trajectory: r.trajectory,
    trajectoryReason: r.trajectory_reason, whatHappened: r.what_happened, significance: r.significance, confidence: r.confidence, notes: parseJson<string[]>(r.notes, []),
    excerpt: r.excerpt, url: r.url, title: r.title, domain: r.domain, publishedAt: r.published_at, textBasis: r.text_basis,
  };
}

const REPORT_SELECT = `SELECT r.*, a.url, a.title, a.domain, a.published_at, a.text_basis FROM escalation_reports r JOIN escalation_articles a ON a.id = r.article_id`;

/** Is this report's event still inside the active window? Event dates are
 *  day-granular, so the whole event day counts. */
export function isLive(eventDate: string, now: Date): boolean {
  const start = Date.parse(`${eventDate}T00:00:00Z`);
  if (!Number.isFinite(start)) return false;
  return now.getTime() - start <= (ACTIVE_WINDOW_HOURS + 24) * 3600_000;
}

/** Region key for grouping — the resolved region's canonical name when the
 *  gazetteer knows it ("Tigray Region" and "Tigray" are one region). */
export function regionKeyOf(countryCode: string, admin1: string | null | undefined): string {
  if (!admin1) return "";
  const known = lookupKnownPlace(countryCode, admin1);
  return looseKey(known?.name ?? admin1);
}

export interface IncidentAnchor {
  id: string;
  countryCode: string;
  regionKey: string;
  lat: number;
  lon: number;
  geoPrecision: GeoPrecision;
  reportCount: number;
}

const isPointLevel = (p: GeoPrecision) => p === "place" || p === "approximate";

/** Which existing incident a report belongs to, or null to open a new one.
 *  Never crosses a country border.
 *    - A report with a located place joins an incident anchored within
 *      CLUSTER_RADIUS_KM, or a region-level incident for the same region
 *      (which it then makes more specific).
 *    - A report that names only a region joins that region's incident.
 *    - A report that names only the country joins that country's
 *      country-level incident. */
export function assignIncident(report: Pick<StoredReport, "countryCode" | "admin1" | "lat" | "lon" | "geoPrecision" | "geoLabel">, incidents: IncidentAnchor[]): string | null {
  const sameCountry = incidents.filter((i) => i.countryCode === report.countryCode);
  const regionKey = report.geoPrecision === "region" && !report.admin1 ? looseKey(report.geoLabel ?? "") : regionKeyOf(report.countryCode, report.admin1);

  if (isPointLevel(report.geoPrecision)) {
    const near = sameCountry
      .filter((i) => isPointLevel(i.geoPrecision))
      .map((i) => ({ i, d: distanceKm(report.lat, report.lon, i.lat, i.lon) }))
      .filter((x) => x.d <= CLUSTER_RADIUS_KM)
      .sort((a, b) => a.d - b.d)[0];
    if (near) return near.i.id;
    const regional = regionKey ? sameCountry.find((i) => i.geoPrecision === "region" && i.regionKey === regionKey) : undefined;
    return regional?.id ?? null;
  }
  if (report.geoPrecision === "region") {
    if (!regionKey) return null;
    const matches = sameCountry.filter((i) => i.regionKey === regionKey).sort((a, b) => b.reportCount - a.reportCount);
    return matches[0]?.id ?? null;
  }
  return sameCountry.find((i) => i.geoPrecision === "country")?.id ?? null;
}

export interface IncidentSourceRef {
  n: number;
  url: string;
  title: string | null;
  domain: string;
  publishedAt: string | null;
  textBasis: string | null;
}

export interface IncidentIndicator {
  id: IndicatorId;
  label: string;
  tier: string;
  evidence: { quote: string; source: number }[];
}

export interface IncidentComputed {
  level: EscalationLevel;
  criteriaMet: string[];
  notes: string[];
  indicators: IncidentIndicator[];
  sources: IncidentSourceRef[];
  actors: string[];
  places: string[];
  fatalitiesMax: number | null;
  location: { lat: number; lon: number; precision: GeoPrecision; label: string | null; admin1: string | null; method: string };
  firstEventDate: string;
  lastEventDate: string;
  contentHash: string;
  synthesisSources: SynthesisSource[];
}

const PRECISION_RANK: Record<GeoPrecision, number> = { place: 3, approximate: 2, region: 1, country: 0 };

/** Everything about an incident that follows mechanically from its live
 *  reports: level and criteria, the indicator list with quotes and source
 *  numbers, the source list, and the marker position. Pure — covered by
 *  test/incidents.test.ts. */
export function computeIncident(live: StoredReport[]): IncidentComputed {
  // Sources: one per article, newest first, numbered from 1.
  const byArticle = new Map<string, StoredReport>();
  for (const r of [...live].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))) if (!byArticle.has(r.articleId)) byArticle.set(r.articleId, r);
  const sources: IncidentSourceRef[] = [...byArticle.values()].map((r, i) => ({ n: i + 1, url: r.url, title: r.title, domain: r.domain, publishedAt: r.publishedAt, textBasis: r.textBasis }));
  const sourceNumber = new Map<string, number>([...byArticle.keys()].map((id, i) => [id, i + 1]));

  // Independent sources: one per publisher — and syndicated copies of the
  // same wire story (identical supporting quotes on different sites) count
  // as ONE source, so a single agency report republished by three outlets
  // is not mistaken for three-way corroboration.
  const quoteOwner = new Map<string, string>();
  const sourceKeyOf = new Map<string, string>();
  for (const r of [...live].sort((a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""))) {
    const quotes = r.indicators.map((i) => normalizeForMatch(i.quote)).filter((q) => q.length >= 40);
    const owner = quotes.map((q) => quoteOwner.get(q)).find((o): o is string => !!o) ?? r.domain;
    for (const q of quotes) if (!quoteOwner.has(q)) quoteOwner.set(q, owner);
    sourceKeyOf.set(r.id, owner);
  }

  const decision = decideLevel(
    live.map((r) => ({ sourceKey: sourceKeyOf.get(r.id) ?? r.domain, indicators: r.indicators.map((i) => i.id), fatalities: r.fatalities, trajectory: r.trajectory, confidence: r.confidence }))
  );

  const indicatorMap = new Map<IndicatorId, IncidentIndicator>();
  for (const r of live) {
    if (r.trajectory === "de-escalation") continue;
    for (const ind of r.indicators) {
      const def = INDICATOR_BY_ID[ind.id];
      if (!def) continue;
      let entry = indicatorMap.get(ind.id);
      if (!entry) indicatorMap.set(ind.id, (entry = { id: ind.id, label: def.label, tier: def.tier, evidence: [] }));
      const n = sourceNumber.get(r.articleId)!;
      if (!entry.evidence.some((e) => e.source === n)) entry.evidence.push({ quote: ind.quote, source: n });
    }
  }
  const tierOrder = { critical: 0, posture: 1, contextual: 2 } as Record<string, number>;
  const indicators = [...indicatorMap.values()].sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || b.evidence.length - a.evidence.length);

  // Marker position: the most specific location named, and among equally
  // specific ones the place most reports name (ties to the most recent).
  const bestRank = Math.max(...live.map((r) => PRECISION_RANK[r.geoPrecision]));
  const best = live.filter((r) => PRECISION_RANK[r.geoPrecision] === bestRank);
  const counts = new Map<string, { count: number; latest: string; report: StoredReport }>();
  for (const r of best) {
    const key = looseKey(r.geoLabel ?? "") || "_";
    const c = counts.get(key);
    if (!c) counts.set(key, { count: 1, latest: r.eventDate, report: r });
    else {
      c.count++;
      if (r.eventDate > c.latest) {
        c.latest = r.eventDate;
        c.report = r;
      }
    }
  }
  const anchor = [...counts.values()].sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest))[0].report;
  const admin1 = anchor.admin1 ? (lookupKnownPlace(anchor.countryCode, anchor.admin1)?.name ?? anchor.admin1) : (live.find((r) => r.admin1)?.admin1 ?? null);

  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const dates = live.map((r) => r.eventDate).sort();
  const fatalities = live.map((r) => r.fatalities).filter((f): f is number => f != null);

  const synthesisSources: SynthesisSource[] = live
    .slice()
    .sort((a, b) => (sourceNumber.get(a.articleId)! - sourceNumber.get(b.articleId)!))
    .slice(0, 8)
    .map((r) => ({
      n: sourceNumber.get(r.articleId)!,
      domain: r.domain,
      title: r.title ?? "(untitled)",
      publishedAt: r.publishedAt,
      eventDate: r.eventDate,
      place: r.geoLabel ?? r.place,
      actors: r.actors,
      indicators: r.indicators.map((i) => ({ label: i.label, quote: i.quote })),
      fatalities: r.fatalities,
      whatHappened: r.whatHappened,
      significance: r.significance,
      trajectoryReason: r.trajectoryReason,
      confidence: r.confidence,
      excerpt: (r.excerpt ?? "").slice(0, 700),
    }));

  return {
    level: decision.level,
    criteriaMet: decision.criteriaMet,
    notes: decision.notes,
    indicators,
    sources,
    actors: uniq(live.flatMap((r) => r.actors)).slice(0, 12),
    places: uniq(live.map((r) => r.geoLabel ?? r.place)),
    fatalitiesMax: fatalities.length ? Math.max(...fatalities) : null,
    location: { lat: anchor.lat, lon: anchor.lon, precision: anchor.geoPrecision, label: anchor.geoLabel, admin1, method: anchor.geoMethod },
    firstEventDate: dates[0],
    lastEventDate: dates[dates.length - 1],
    contentHash: hashId(`${decision.level}|${live.map((r) => r.id).sort().join(",")}`),
    synthesisSources,
  };
}

/** "Mekelle, Tigray" / "Tigray" / null (country-level). */
export function locationLabel(loc: IncidentComputed["location"]): string | null {
  if (loc.precision === "country") return null;
  if (loc.precision === "region") return loc.label ?? loc.admin1;
  if (loc.label && loc.admin1 && looseKey(loc.label) !== looseKey(loc.admin1)) return `${loc.label}, ${loc.admin1}`;
  return loc.label ?? loc.admin1;
}

const stripCitations = (s: string | null | undefined) => (s ?? "").replace(/\s*\[\d+\]/g, "").replace(/\s+/g, " ").trim();

async function broadcast(env: Env, type: string, payload: unknown) {
  const id = env.LIVE_FEED.idFromName("global");
  await env.LIVE_FEED.get(id).fetch("http://live-feed/broadcast", {
    method: "POST",
    body: JSON.stringify({ type, payload, ownerIds: [] }), // house signal — admins only over the live socket; everyone can still poll the REST endpoints
  });
}

interface IncidentDbRow {
  id: string; country_code: string; country_name: string; region_key: string; location_label: string | null; admin1: string | null; lat: number; lon: number;
  geo_precision: GeoPrecision; level: EscalationLevel; status: string; headline: string | null; summary: string | null; assessment: string | null;
  outlook: string | null; caveats: string | null; detail: string; content_hash: string | null; state_hash: string | null; synthesis_model: string | null; alerted_level: string | null;
  alert_id: string | null; first_event_date: string | null; last_event_date: string | null; created_at: string; updated_at: string;
}

async function assignNewReports(env: Env): Promise<void> {
  const unassigned = (await all<ReportDbRow>(env.DB, `${REPORT_SELECT} WHERE r.incident_id IS NULL ORDER BY r.created_at`)).map(toStoredReport);
  if (unassigned.length === 0) return;
  const rows = await all<IncidentDbRow & { report_count: number }>(
    env.DB,
    `SELECT i.*, (SELECT COUNT(*) FROM escalation_reports r WHERE r.incident_id = i.id) AS report_count FROM escalation_incidents i WHERE i.status = 'active'`
  );
  const anchors: IncidentAnchor[] = rows.map((i) => ({ id: i.id, countryCode: i.country_code, regionKey: i.region_key, lat: i.lat, lon: i.lon, geoPrecision: i.geo_precision, reportCount: i.report_count }));

  // Most specifically located first, so a vaguer report joins the incident a
  // precise one has already anchored rather than the other way round.
  unassigned.sort((a, b) => PRECISION_RANK[b.geoPrecision] - PRECISION_RANK[a.geoPrecision]);
  const now = new Date();
  for (const r of unassigned) {
    if (!isLive(r.eventDate, now)) {
      // Too old to open or extend an incident; park it so it is not re-examined every tick.
      await run(env.DB, "UPDATE escalation_reports SET incident_id = 'stale' WHERE id = ?", [r.id]);
      continue;
    }
    let incidentId = assignIncident(r, anchors);
    if (!incidentId) {
      incidentId = newId();
      const regionKey = r.geoPrecision === "region" && !r.admin1 ? looseKey(r.geoLabel ?? "") : regionKeyOf(r.countryCode, r.admin1);
      const ts = nowIso();
      await run(
        env.DB,
        `INSERT INTO escalation_incidents (id, country_code, country_name, region_key, location_label, admin1, lat, lon, geo_precision, level, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'none', 'active', ?, ?)`,
        [incidentId, r.countryCode, r.countryName, regionKey, r.geoLabel, r.admin1, r.lat, r.lon, r.geoPrecision, ts, ts]
      );
      anchors.push({ id: incidentId, countryCode: r.countryCode, regionKey, lat: r.lat, lon: r.lon, geoPrecision: r.geoPrecision, reportCount: 0 });
    }
    const anchor = anchors.find((a) => a.id === incidentId)!;
    anchor.reportCount++;
    // A located report makes a region-level incident more specific.
    if (isPointLevel(r.geoPrecision) && !isPointLevel(anchor.geoPrecision)) {
      anchor.lat = r.lat;
      anchor.lon = r.lon;
      anchor.geoPrecision = r.geoPrecision;
    }
    await run(env.DB, "UPDATE escalation_reports SET incident_id = ? WHERE id = ?", [incidentId, r.id]);
  }
}

async function resolveAlert(env: Env, alertId: string | null): Promise<void> {
  if (!alertId) return;
  await run(env.DB, "UPDATE alerts SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL", [nowIso(), alertId]);
}

async function refreshIncidents(env: Env): Promise<{ active: number; elevated: number; critical: number; synthesized: number }> {
  const now = new Date();
  const incidents = await all<IncidentDbRow>(env.DB, "SELECT * FROM escalation_incidents WHERE status = 'active'");
  const out = { active: 0, elevated: 0, critical: 0, synthesized: 0 };
  let synthBudget = SYNTHESES_PER_TICK;

  // One query for every active incident's reports, grouped in memory — the
  // steady-state cost of a tick with nothing new is two reads and no writes.
  const reportsByIncident = new Map<string, StoredReport[]>();
  for (const row of await all<ReportDbRow>(env.DB, `${REPORT_SELECT} JOIN escalation_incidents i ON i.id = r.incident_id WHERE i.status = 'active'`)) {
    const r = toStoredReport(row);
    if (!reportsByIncident.has(r.incidentId!)) reportsByIncident.set(r.incidentId!, []);
    reportsByIncident.get(r.incidentId!)!.push(r);
  }

  for (const inc of incidents) {
    const live = (reportsByIncident.get(inc.id) ?? []).filter((r) => isLive(r.eventDate, now));
    if (live.length === 0) {
      await run(env.DB, "UPDATE escalation_incidents SET status = 'expired', updated_at = ? WHERE id = ?", [nowIso(), inc.id]);
      await resolveAlert(env, inc.alert_id);
      continue;
    }

    const c = computeIncident(live);
    const label = locationLabel(c.location);
    const flagged = c.level === "elevated" || c.level === "critical";
    out.active++;
    if (c.level === "elevated") out.elevated++;
    if (c.level === "critical") out.critical++;

    // Nothing about this incident changed since it was last written, and it
    // is not waiting on an analyst retry: leave the row and its alert alone.
    const hasAnalystText = !!inc.headline && !!inc.summary && inc.synthesis_model !== "fallback" && inc.content_hash === c.contentHash;
    if (inc.state_hash === c.contentHash && inc.level === c.level && (!flagged || hasAnalystText)) continue;

    let synthesis: IncidentSynthesis | null = inc.headline && inc.summary ? { headline: inc.headline, summary: inc.summary, assessment: inc.assessment ?? "", outlook: inc.outlook ?? "", caveats: inc.caveats } : null;
    let synthesisModel = inc.synthesis_model;
    let storedHash = inc.content_hash;
    if (flagged && (c.contentHash !== inc.content_hash || !synthesis || inc.synthesis_model === "fallback")) {
      const input = { locationLabel: label ?? "location not specified in reporting", countryName: inc.country_name, level: c.level as "elevated" | "critical", criteriaMet: c.criteriaMet, sources: c.synthesisSources };
      let fresh: { synthesis: IncidentSynthesis; model: string } | null = null;
      if (synthBudget > 0) {
        synthBudget--;
        fresh = await synthesizeIncident(env, input);
        if (fresh) out.synthesized++;
      }
      if (fresh) {
        synthesis = fresh.synthesis;
        synthesisModel = fresh.model;
        storedHash = c.contentHash;
      } else if (!synthesis || inc.synthesis_model === "fallback") {
        // No analyst text exists for this incident yet: show text assembled
        // directly from the coded reports, and retry the analyst next tick.
        synthesis = fallbackSynthesis(input);
        synthesisModel = "fallback";
        storedHash = c.contentHash;
      }
      // Otherwise keep the previous analyst text for now; the stale hash
      // means the analyst is asked again on the next tick.
    }

    const detail = {
      criteriaMet: c.criteriaMet,
      notes: c.notes,
      indicators: c.indicators,
      sources: c.sources,
      actors: c.actors,
      places: c.places,
      fatalitiesMax: c.fatalitiesMax,
      geoMethod: c.location.method,
      reportCount: live.length,
    };
    await run(
      env.DB,
      `UPDATE escalation_incidents SET location_label = ?, admin1 = ?, lat = ?, lon = ?, geo_precision = ?, level = ?, headline = ?, summary = ?, assessment = ?, outlook = ?, caveats = ?,
         detail = ?, content_hash = ?, state_hash = ?, synthesis_model = ?, first_event_date = ?, last_event_date = ?, updated_at = ? WHERE id = ?`,
      [
        label, c.location.admin1, c.location.lat, c.location.lon, c.location.precision, c.level,
        synthesis?.headline ?? null, synthesis?.summary ?? null, synthesis?.assessment ?? null, synthesis?.outlook ?? null, synthesis?.caveats ?? null,
        JSON.stringify(detail), flagged ? storedHash : inc.content_hash, c.contentHash, synthesisModel, c.firstEventDate, c.lastEventDate, nowIso(), inc.id,
      ]
    );

    // Alerts: one per incident, a second only on a rise to Critical; kept in
    // step with the incident and closed when it drops below Elevated.
    if (!flagged) {
      if (inc.alert_id) {
        await resolveAlert(env, inc.alert_id);
        await run(env.DB, "UPDATE escalation_incidents SET alert_id = NULL, alerted_level = NULL WHERE id = ?", [inc.id]);
      }
      continue;
    }
    if (!synthesis) continue;
    const geoLabel = label ? `${label}, ${inc.country_name}` : `${inc.country_name} (location not specified in reporting)`;
    const title = `${c.level === "critical" ? "Critical" : "Elevated"}: ${synthesis.headline}`;
    const description = [stripCitations(synthesis.summary), stripCitations(synthesis.assessment)].filter(Boolean).join(" ");
    const snapshot = JSON.stringify({
      incidentId: inc.id,
      criteriaMet: c.criteriaMet,
      indicators: c.indicators.map((i) => i.label),
      sourceCount: c.sources.length,
      fatalitiesMax: c.fatalitiesMax,
      geoPrecision: c.location.precision,
    });
    const needsNewAlert = !inc.alert_id || (inc.alerted_level === "elevated" && c.level === "critical");
    if (needsNewAlert) {
      await resolveAlert(env, inc.alert_id);
      const alertId = newId();
      const rows = await all<Record<string, unknown>>(
        env.DB,
        `INSERT INTO alerts (id, query_id, level, title, description, metric_snapshot, geo_label, geo_lat, geo_lng, created_at)
         VALUES (?,NULL,?,?,?,?,?,?,?,?) RETURNING *`,
        [alertId, c.level, title, description, snapshot, geoLabel, c.location.lat, c.location.lon, nowIso()]
      );
      await run(env.DB, "UPDATE escalation_incidents SET alert_id = ?, alerted_level = ? WHERE id = ?", [alertId, c.level, inc.id]);
      if (rows[0]) await broadcast(env, "alert", { ...rows[0], metric_snapshot: JSON.parse(snapshot) }).catch((err) => console.error("[escalation] broadcast failed", err));
    } else {
      await run(env.DB, "UPDATE alerts SET level = ?, title = ?, description = ?, metric_snapshot = ?, geo_label = ?, geo_lat = ?, geo_lng = ? WHERE id = ?", [
        c.level, title, description, snapshot, geoLabel, c.location.lat, c.location.lon, inc.alert_id,
      ]);
      if (inc.alerted_level !== c.level) await run(env.DB, "UPDATE escalation_incidents SET alerted_level = ? WHERE id = ?", [c.level, inc.id]);
    }
  }
  return out;
}

/** Closes the alerts the old country-level scorer raised ("Elevated
 *  escalation: Kenya") — they were produced by the logic this pipeline
 *  replaces and have no incident, criteria or sources behind them. */
async function retireLegacyAlerts(env: Env): Promise<void> {
  await run(
    env.DB,
    `UPDATE alerts SET resolved_at = ? WHERE query_id IS NULL AND resolved_at IS NULL AND title LIKE '% escalation: %' AND metric_snapshot NOT LIKE '%"incidentId"%'`,
    [nowIso()]
  );
}

async function pruneOldRows(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await run(env.DB, "DELETE FROM escalation_reports WHERE created_at < ?", [cutoff]);
  await run(env.DB, "DELETE FROM escalation_articles WHERE processed_at < ?", [cutoff]);
  await run(env.DB, "DELETE FROM escalation_incidents WHERE status = 'expired' AND updated_at < ?", [cutoff]);
}

/** One pipeline tick — called from index.ts's scheduled() handler. */
export async function runEscalationPipeline(env: Env): Promise<void> {
  await ensureTables(env);

  // One tick at a time: a slow tick must not overlap the next cron firing.
  const lock = await getState(env, "lock");
  if (lock && Date.now() - Number(lock) < LOCK_TTL_MS) return;
  await setState(env, "lock", String(Date.now()));

  const stats: ProcessStats & { candidates: number; fresh: number } = { coded: 0, rejected: 0, unreadable: 0, errors: 0, reports: 0, modelFailures: 0, candidates: 0, fresh: 0 };
  try {
    await retireLegacyAlerts(env);

    if ((env.ESCALATION_PIPELINE_ENABLED ?? "true") !== "false") {
      const [africaWire, wireFeeds, gdelt] = await Promise.all([gatherAfricaWire(env), gatherWireFeeds(), gatherGdelt(env)]);
      // Wire feeds are generalist (world news); order them by priority so the
      // Africa-relevant conflict items are read first.
      wireFeeds.sort((a, b) => b.priority - a.priority || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
      stats.candidates = africaWire.length + wireFeeds.length + gdelt.length;

      // Drop everything already decided (coded, rejected, unreadable, or out of retries).
      // (Candidates are at most CANDIDATE_MAX_AGE_HOURS old, so only recent rows can match.)
      const knownSince = new Date(Date.now() - (CANDIDATE_MAX_AGE_HOURS + 72) * 3600_000).toISOString();
      const known = new Set(
        // An article that failed only because no model answered stays
        // retryable however many times that has happened: a model outage or
        // an empty credit balance must not permanently discard the news of
        // that period.
        (await all<{ id: string }>(env.DB, `SELECT id FROM escalation_articles WHERE processed_at >= ? AND NOT (status = 'error' AND (attempts < ? OR rejection_reason = 'model_unavailable'))`, [knownSince, MAX_ATTEMPTS])).map((r) => r.id)
      );
      const freshOf = (list: Candidate[]) => list.filter((c) => !known.has(c.id));
      const lists = [freshOf(africaWire), freshOf(wireFeeds), freshOf(gdelt)];
      stats.fresh = new Set(lists.flat().map((c) => c.id)).size;

      const perTick = Math.max(1, Math.min(60, Number(env.ESCALATION_ARTICLES_PER_TICK) || DEFAULT_ARTICLES_PER_TICK));
      const batch = pickBatch(lists, perTick);
      const geocodeBudget: GeocodeBudget = { remaining: GEOCODER_CALLS_PER_TICK };

      for (let i = 0; i < batch.length; i += CODING_CONCURRENCY) {
        const failuresBefore = stats.modelFailures;
        const chunk = batch.slice(i, i + CODING_CONCURRENCY);
        await Promise.all(
          chunk.map(async (c) => {
            if (await claimArticle(env, c)) await processCandidate(env, c, geocodeBudget, stats);
          })
        );
        // If no model answered for a whole group, the model is down or out of
        // credit: stop reading for this tick instead of fetching more articles
        // that cannot be coded. They stay queued and are retried next tick.
        if (stats.modelFailures - failuresBefore >= chunk.length) break;
      }
    }

    await assignNewReports(env);
    const incidents = await refreshIncidents(env);
    if (new Date().getUTCMinutes() < 5) await pruneOldRows(env);

    await setState(env, "last_run", JSON.stringify({ at: nowIso(), ...stats, incidents, ...describeProvider(env), lastModelError: stats.modelFailures > 0 ? getLastModelError() : null }));
    if (stats.coded + stats.rejected + stats.unreadable + stats.errors > 0) {
      console.log(`[escalation] tick: ${stats.coded} coded (${stats.reports} reports), ${stats.rejected} rejected, ${stats.unreadable} unreadable, ${stats.errors} errors (${stats.modelFailures} with no model answer); backlog ${stats.fresh}; incidents ${incidents.elevated} elevated / ${incidents.critical} critical`);
    }
  } finally {
    await setState(env, "lock", "0");
  }
}

// ── Read API ─────────────────────────────────────────────────────────────

export interface IncidentView {
  id: string;
  countryCode: string;
  countryName: string;
  /** "Mekelle, Tigray" — null when reporting names no place below the country. */
  locationLabel: string | null;
  lat: number;
  lon: number;
  geoPrecision: GeoPrecision;
  geoMethod: string | null;
  level: "elevated" | "critical";
  headline: string;
  summary: string;
  assessment: string;
  outlook: string;
  caveats: string | null;
  /** True when the text was written by the analyst model; false when it was
   *  assembled directly from the coded reports because that call failed. */
  analystWritten: boolean;
  criteriaMet: string[];
  indicators: IncidentIndicator[];
  sources: IncidentSourceRef[];
  actors: string[];
  places: string[];
  fatalitiesMax: number | null;
  reportCount: number;
  firstEventDate: string | null;
  lastEventDate: string | null;
  updatedAt: string;
}

interface IncidentDetailJson {
  criteriaMet?: string[];
  indicators?: IncidentIndicator[];
  sources?: IncidentSourceRef[];
  actors?: string[];
  places?: string[];
  fatalitiesMax?: number | null;
  geoMethod?: string;
  reportCount?: number;
}

function toIncidentView(r: IncidentDbRow): IncidentView {
  const d = parseJson<IncidentDetailJson>(r.detail, {});
  return {
    id: r.id,
    countryCode: r.country_code,
    countryName: r.country_name,
    locationLabel: r.location_label,
    lat: r.lat,
    lon: r.lon,
    geoPrecision: r.geo_precision,
    geoMethod: d.geoMethod ?? null,
    level: r.level as "elevated" | "critical",
    headline: r.headline ?? "",
    summary: r.summary ?? "",
    assessment: r.assessment ?? "",
    outlook: r.outlook ?? "",
    caveats: r.caveats,
    analystWritten: !!r.synthesis_model && r.synthesis_model !== "fallback",
    criteriaMet: d.criteriaMet ?? [],
    indicators: d.indicators ?? [],
    sources: d.sources ?? [],
    actors: d.actors ?? [],
    places: d.places ?? [],
    fatalitiesMax: d.fatalitiesMax ?? null,
    reportCount: d.reportCount ?? 0,
    firstEventDate: r.first_event_date,
    lastEventDate: r.last_event_date,
    updatedAt: r.updated_at,
  };
}

/** Every incident currently flagged Elevated or Critical. */
export async function getFlaggedIncidents(env: Env): Promise<IncidentView[]> {
  await ensureTables(env);
  const rows = await all<IncidentDbRow>(
    env.DB,
    `SELECT * FROM escalation_incidents WHERE status = 'active' AND level IN ('elevated','critical') AND headline IS NOT NULL
     ORDER BY CASE level WHEN 'critical' THEN 0 ELSE 1 END, last_event_date DESC, updated_at DESC`
  );
  return rows.map(toIncidentView);
}

export async function getIncident(env: Env, id: string): Promise<IncidentView | null> {
  await ensureTables(env);
  const row = await first<IncidentDbRow>(env.DB, "SELECT * FROM escalation_incidents WHERE id = ?", [id]);
  return row ? toIncidentView(row) : null;
}

export interface AuditEntry {
  url: string;
  domain: string;
  title: string | null;
  origin: string;
  publishedAt: string | null;
  status: string;
  textBasis: string | null;
  rejectionReason: string | null;
  rejectionNote: string | null;
  processedAt: string;
  reports: { country: string; location: string | null; geoPrecision: string; geoMethod: string; eventDate: string; indicators: string[]; confidence: string; incidentId: string | null; notes: string[] }[];
}

/** What the pipeline decided about each article it read, newest first —
 *  the answer to "why is / isn't X flagged". `country` narrows to articles
 *  that produced a report in that country; `q` matches title or URL. */
export async function getAuditLog(env: Env, opts: { country?: string | null; q?: string | null; status?: string | null; limit?: number }): Promise<AuditEntry[]> {
  await ensureTables(env);
  const where: string[] = ["a.status != 'processing'"];
  const params: unknown[] = [];
  const code = opts.country ? resolveCountryCode(opts.country) : null;
  if (code) {
    where.push("EXISTS (SELECT 1 FROM escalation_reports r WHERE r.article_id = a.id AND r.country_code = ?)");
    params.push(code);
  }
  if (opts.q) {
    where.push("(a.title LIKE ? OR a.url LIKE ? OR a.rejection_note LIKE ?)");
    params.push(`%${opts.q}%`, `%${opts.q}%`, `%${opts.q}%`);
  }
  if (opts.status) {
    where.push("a.status = ?");
    params.push(opts.status);
  }
  params.push(Math.min(Math.max(opts.limit ?? 100, 1), 300));
  const articles = await all<{ id: string; url: string; domain: string; title: string | null; origin: string; published_at: string | null; status: string; text_basis: string | null; rejection_reason: string | null; rejection_note: string | null; processed_at: string }>(
    env.DB,
    `SELECT a.* FROM escalation_articles a WHERE ${where.join(" AND ")} ORDER BY a.processed_at DESC LIMIT ?`,
    params
  );
  if (articles.length === 0) return [];
  const reports: ReportDbRow[] = [];
  const ids = articles.filter((a) => a.status === "coded").map((a) => a.id);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    reports.push(...(await all<ReportDbRow>(env.DB, `${REPORT_SELECT} WHERE r.article_id IN (${chunk.map(() => "?").join(",")})`, chunk)));
  }
  const byArticle = new Map<string, StoredReport[]>();
  for (const r of reports.map(toStoredReport)) {
    if (!byArticle.has(r.articleId)) byArticle.set(r.articleId, []);
    byArticle.get(r.articleId)!.push(r);
  }
  return articles.map((a) => ({
    url: a.url,
    domain: a.domain,
    title: a.title,
    origin: a.origin,
    publishedAt: a.published_at,
    status: a.status,
    textBasis: a.text_basis,
    rejectionReason: a.rejection_reason,
    rejectionNote: a.rejection_note,
    processedAt: a.processed_at,
    reports: (byArticle.get(a.id) ?? []).map((r) => ({
      country: countryName(r.countryCode),
      location: r.geoLabel ?? r.place,
      geoPrecision: r.geoPrecision,
      geoMethod: r.geoMethod,
      eventDate: r.eventDate,
      indicators: r.indicators.map((i) => i.label),
      confidence: r.confidence,
      incidentId: r.incidentId === "stale" ? null : r.incidentId,
      notes: r.notes,
    })),
  }));
}

export interface PipelineStatus {
  provider: ReturnType<typeof describeProvider>;
  enabled: boolean;
  lastRun: Record<string, unknown> | null;
  last24h: { status: string; count: number }[];
  rejectionReasons24h: { reason: string; count: number }[];
  incidents: { level: string; count: number }[];
}

export async function getPipelineStatus(env: Env): Promise<PipelineStatus> {
  await ensureTables(env);
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [lastRun, byStatus, byReason, byLevel] = await Promise.all([
    getState(env, "last_run"),
    all<{ status: string; count: number }>(env.DB, "SELECT status, COUNT(*) AS count FROM escalation_articles WHERE processed_at >= ? GROUP BY status", [since]),
    all<{ reason: string; count: number }>(
      env.DB,
      "SELECT COALESCE(rejection_reason, 'unspecified') AS reason, COUNT(*) AS count FROM escalation_articles WHERE processed_at >= ? AND status IN ('rejected','unreadable','error') GROUP BY rejection_reason ORDER BY count DESC",
      [since]
    ),
    all<{ level: string; count: number }>(env.DB, "SELECT level, COUNT(*) AS count FROM escalation_incidents WHERE status = 'active' GROUP BY level"),
  ]);
  return {
    provider: describeProvider(env),
    enabled: (env.ESCALATION_PIPELINE_ENABLED ?? "true") !== "false",
    lastRun: parseJson<Record<string, unknown> | null>(lastRun, null),
    last24h: byStatus,
    rejectionReasons24h: byReason,
    incidents: byLevel,
  };
}
