import type { MiddlewareHandler } from "hono";
import type { Env } from "../bindings";
import type { AuthedVariables } from "../middleware";

/**
 * Remembers the answers behind dashboards (counts, breakdowns, cross-tabs, filter lists, map pages) until the
 * incident data changes, so opening a dashboard again, or opening it on another device, does not recount the whole
 * incident table. Before this, every open ran 30 to 50 full-table counts, one at a time, on the single-threaded
 * database.
 *
 * Freshness: a counter in incidents_meta goes up on every insert, edit and delete of an incident, by database
 * triggers (so no upload or edit path can forget to bump it), and the counter is part of every remembered answer's
 * key: one changed incident and every dashboard is counted afresh. Answers are also kept per user, because what a
 * user may see depends on their client and its countries, and for at most 15 minutes, so a change to someone's
 * access shows within that time.
 */
const TTL_SECONDS = 900;
let schemaReady = false;

export async function ensureIncidentVersion(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS incidents_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)`),
    db.prepare(`INSERT OR IGNORE INTO incidents_meta (k, v) VALUES ('version', 0)`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS incidents_version_ins AFTER INSERT ON incidents BEGIN UPDATE incidents_meta SET v = v + 1 WHERE k = 'version'; END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS incidents_version_upd AFTER UPDATE ON incidents BEGIN UPDATE incidents_meta SET v = v + 1 WHERE k = 'version'; END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS incidents_version_del AFTER DELETE ON incidents BEGIN UPDATE incidents_meta SET v = v + 1 WHERE k = 'version'; END`),
  ]);
  schemaReady = true;
}

/** Test hook. */
export function resetIncidentVersionState(): void {
  schemaReady = false;
}

export async function incidentVersion(db: D1Database): Promise<number> {
  await ensureIncidentVersion(db);
  const row = await db.prepare(`SELECT v FROM incidents_meta WHERE k = 'version'`).first<{ v: number }>();
  return row?.v ?? 0;
}

/** The key an answer is remembered under: the path, its parameters in a fixed order, who asked, and the data version. */
export function incidentCacheKey(url: string, userId: string, role: string, version: number): string {
  const u = new URL(url);
  const params = [...u.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  const qs = new URLSearchParams(params);
  qs.set("_u", userId);
  qs.set("_r", role);
  qs.set("_v", String(version));
  return `https://incident-answers.lens.internal${u.pathname}?${qs.toString()}`;
}

export const incidentReadCache: MiddlewareHandler<{ Bindings: Env; Variables: AuthedVariables }> = async (c, next) => {
  if (c.req.method !== "GET" || typeof caches === "undefined") return next();
  let key: Request;
  try {
    key = new Request(incidentCacheKey(c.req.url, c.get("userId"), c.get("role"), await incidentVersion(c.env.DB)));
  } catch {
    return next();
  }
  const hit = await caches.default.match(key);
  if (hit) {
    return new Response(hit.body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Lens-Answer": "remembered" } });
  }
  await next();
  if (c.res.status !== 200) return;
  const body = await c.res.clone().arrayBuffer();
  const stored = new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${TTL_SECONDS}` } });
  const put = caches.default.put(key, stored).catch(() => {});
  try {
    c.executionCtx.waitUntil(put);
  } catch {
    await put;
  }
  c.res.headers.set("Cache-Control", "private, no-store");
};
