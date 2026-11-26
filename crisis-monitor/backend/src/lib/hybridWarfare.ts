import type { Env } from "../bindings";
import { buildOsintFeed } from "./osintFeed";

/**
 * Hybrid warfare: hostile action short of open armed conflict. That covers sabotage of infrastructure, GPS jamming
 * and spoofing, cyberattacks, influence and disinformation operations, unexplained drone incursions over sensitive
 * sites, and damage to subsea cables.
 *
 * Two sources:
 *  - escalation incidents whose headline or summary describe hybrid activity (flagged when the history is read);
 *  - located reports from the wire and Telegram feeds, saved every 30 minutes in hybrid_events so they build up a
 *    history (the feeds themselves only hold the last few days).
 */

export type HybridKind = "sabotage" | "jamming" | "cyber" | "influence" | "drones" | "cables";

export const HYBRID_LABEL: Record<HybridKind, string> = {
  sabotage: "Sabotage",
  jamming: "GPS jamming or spoofing",
  cyber: "Cyberattack",
  influence: "Influence or disinformation operation",
  drones: "Drone incursion",
  cables: "Subsea cable damage",
};

const RULES: [HybridKind, RegExp][] = [
  ["cables", /\b(undersea|subsea|submarine)\s+(internet\s+|data\s+|fib(re|er)[- ]optic\s+|telecom(munication)?s?\s+)?cables?\b[^.]{0,60}\b(cut|damag|sever|disrupt|outage)|\b(cut|damag|sever)\w*\b[^.]{0,40}\b(undersea|subsea|submarine)\s+(internet\s+|data\s+)?cables?/i],
  ["jamming", /\bGPS\s+(jamming|spoofing|interference|disruption)|\b(jamm|spoof)(ing|ed)\b[^.]{0,30}\b(GPS|GNSS|navigation|satellite signals?)|\bGNSS\s+(jamming|spoofing|interference)/i],
  ["cyber", /\bcyber[- ]?attacks?\b|\bransomware\b|\bDDoS\b|\bhack(ed|ers?|ing)\b[^.]{0,40}\b(ministry|government|bank|telecom|airport|port|grid|network|systems?|websites?|electoral|election)|\bdata breach\b/i],
  ["influence", /\bdisinformation\b|\binfluence (operation|campaign)s?\b|\binformation (operation|warfare)s?\b|\bpropaganda campaign\b|\btroll farms?\b|\bbot networks?\b|\b(election|electoral) interference\b|\bcoordinated inauthentic\b/i],
  ["drones", /\b(unidentified|unknown|mystery|suspicious)\s+drones?\b|\bdrones?\s+(were\s+)?(spotted|sighted|seen|flying)\s+over\b|\bdrone incursions?\b/i],
  ["sabotage", /\bsabotag(e|ed|ing)\b/i],
];

/** The kind of hybrid activity a text describes, or null. */
export function hybridKind(text: string): HybridKind | null {
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
  return null;
}

let ready = new WeakSet<D1Database>();
export async function ensureHybridTable(db: D1Database) {
  if (ready.has(db)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS hybrid_events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, link TEXT, source TEXT, place TEXT, lat REAL NOT NULL, lon REAL NOT NULL, date TEXT NOT NULL, created_at TEXT NOT NULL)`
    )
    .run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_hybrid_events_date ON hybrid_events (date)`).run();
  ready.add(db);
}
/** For tests: forget which databases have the table. */
export function resetHybridTableCache() {
  ready = new WeakSet();
}

const KEY = "hybrid_collect_at";
const EVERY_MS = 30 * 60_000;

/** Saves the located hybrid-warfare reports in the feeds, at most every 30 minutes. */
export async function collectHybridEvents(env: Env, now = Date.now()): Promise<number> {
  await ensureHybridTable(env.DB);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS lens_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
  const last = await env.DB.prepare(`SELECT value FROM lens_state WHERE key = ?`).bind(KEY).first<{ value: string }>();
  if (last && now - Number(last.value) < EVERY_MS) return 0;
  await env.DB.prepare(`INSERT INTO lens_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(KEY, String(now)).run();
  const feed = await buildOsintFeed(env.DB);
  let added = 0;
  for (const a of feed.alerts) {
    // Only reports placed at a named place, not at a default position.
    if (!a.coords || a.coords_default) continue;
    const kind = hybridKind(`${a.title}. ${a.summary || a.description}`);
    if (!kind) continue;
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO hybrid_events (id, kind, title, link, source, place, lat, lon, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(a.id, kind, a.title.slice(0, 300), a.link, a.source_name, a.coords_anchor, a.coords[0], a.coords[1], (a.published || new Date(now).toISOString()).slice(0, 10), new Date(now).toISOString())
      .run();
    added += r.meta?.changes ?? 0;
  }
  return added;
}

export interface HybridEventRow {
  id: string;
  kind: HybridKind;
  title: string;
  link: string | null;
  source: string | null;
  place: string | null;
  lat: number;
  lon: number;
  date: string;
}
export async function getHybridEvents(env: Env, since: string): Promise<HybridEventRow[]> {
  await ensureHybridTable(env.DB);
  return (await env.DB.prepare(`SELECT id, kind, title, link, source, place, lat, lon, date FROM hybrid_events WHERE date >= ? ORDER BY date DESC LIMIT 20000`).bind(since).all<HybridEventRow>()).results ?? [];
}
