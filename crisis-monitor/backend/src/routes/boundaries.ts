import { Hono } from "hono";
import { all, run, nowIso } from "../db";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

/**
 * The administrative boundary library: country, state (ADM1), district (ADM2) and lower levels for every country,
 * from geoBoundaries (gbOpen, CC BY 4.0; www.geoboundaries.org). The server fetches a level the first time anyone
 * asks for it, trims it (names and ids only, coordinates to about 10 m), and keeps it in the database, so the next
 * request is served from there. The catalogue (which levels each country has, and what they are called) is kept
 * for a week.
 */

export const boundariesRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
boundariesRouter.use("*", requireAuth);

const API = "https://www.geoboundaries.org/api/current/gbOpen";
const CHUNK = 900_000; // characters per stored piece (D1 rows stay well under their 2 MB limit)
const CATALOGUE_DAYS = 7;
const LAYER_DAYS = 90;

let ready = false;
async function ensureTables(db: D1Database) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS boundary_cache (key TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, fetched_at TEXT NOT NULL, PRIMARY KEY (key, part))`),
  ]);
  ready = true;
}

async function readCache(db: D1Database, key: string, maxDays: number): Promise<string | null> {
  const rows = await all<{ part: number; data: string; fetched_at: string }>(db, `SELECT part, data, fetched_at FROM boundary_cache WHERE key = ? ORDER BY part`, [key]);
  if (!rows.length) return null;
  if (Date.now() - Date.parse(rows[0].fetched_at) > maxDays * 864e5) return null;
  return rows.map((r) => r.data).join("");
}
async function writeCache(db: D1Database, key: string, text: string) {
  const now = nowIso();
  const stmts = [db.prepare(`DELETE FROM boundary_cache WHERE key = ?`).bind(key)];
  for (let i = 0, part = 0; i < text.length; i += CHUNK, part++) stmts.push(db.prepare(`INSERT INTO boundary_cache (key, part, data, fetched_at) VALUES (?, ?, ?, ?)`).bind(key, part, text.slice(i, i + CHUNK), now));
  await db.batch(stmts);
}

interface Meta {
  boundaryISO: string;
  boundaryName: string;
  boundaryType: string;
  boundaryCanonical?: string;
  admUnitCount?: string | number;
  simplifiedGeometryGeoJSON?: string;
  boundaryLicense?: string;
}

/** Every country and the levels it has: { iso, name, levels: [{ level, canonical, units }] }. */
boundariesRouter.get("/catalogue", async (c) => {
  const db = c.env.DB;
  await ensureTables(db);
  const cached = await readCache(db, "catalogue", CATALOGUE_DAYS);
  if (cached) return c.body(cached, 200, { "Content-Type": "application/json" });
  const res = await fetch(`${API}/ALL/ALL/`, { headers: { Accept: "application/json" } }).catch(() => null);
  if (!res || !res.ok) {
    const stale = await readCache(db, "catalogue", 3650);
    if (stale) return c.body(stale, 200, { "Content-Type": "application/json" });
    return c.json({ error: `The boundary catalogue (geoBoundaries) did not answer${res ? `: ${res.status}` : ""}. Try again shortly.` }, 502);
  }
  const all = (await res.json()) as Meta[];
  const byIso = new Map<string, { iso: string; name: string; levels: { level: string; canonical: string; units: number }[] }>();
  for (const m of all) {
    if (!m.boundaryISO || !/^ADM\d$/.test(m.boundaryType)) continue;
    const e = byIso.get(m.boundaryISO) ?? { iso: m.boundaryISO, name: m.boundaryName, levels: [] };
    e.levels.push({ level: m.boundaryType, canonical: m.boundaryCanonical && m.boundaryCanonical !== "Unknown" ? m.boundaryCanonical : "", units: Number(m.admUnitCount) || 0 });
    byIso.set(m.boundaryISO, e);
  }
  const countries = [...byIso.values()].map((e) => ({ ...e, levels: e.levels.sort((a, b) => a.level.localeCompare(b.level)) })).sort((a, b) => a.name.localeCompare(b.name));
  const text = JSON.stringify({ countries, source: "geoBoundaries (gbOpen), CC BY 4.0", fetchedAt: nowIso() });
  await writeCache(db, "catalogue", text);
  return c.body(text, 200, { "Content-Type": "application/json" });
});

/** Coordinates rounded to 4 decimals (about 11 m), repeated points dropped. */
function trimCoords(g: { type: string; coordinates: unknown }): { type: string; coordinates: unknown } {
  const ring = (r: number[][]) => {
    const out: number[][] = [];
    for (const p of r) {
      const q = [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
      const last = out[out.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
    }
    return out;
  };
  if (g.type === "Polygon") return { type: "Polygon", coordinates: (g.coordinates as number[][][]).map(ring).filter((r) => r.length >= 4) };
  if (g.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: (g.coordinates as number[][][][]).map((p) => p.map(ring).filter((r) => r.length >= 4)).filter((p) => p.length) };
  return g;
}

/** One country's boundaries at one level, as GeoJSON with { id, name, iso, level } on each area. */
boundariesRouter.get("/:iso/:level", async (c) => {
  const iso = c.req.param("iso").toUpperCase();
  const level = c.req.param("level").toUpperCase();
  if (!/^[A-Z]{3}$/.test(iso) || !/^ADM[0-5]$/.test(level)) return c.json({ error: "Ask for a country code and a level, e.g. /SDN/ADM1" }, 400);
  const db = c.env.DB;
  await ensureTables(db);
  const key = `layer:${iso}:${level}`;
  const cached = await readCache(db, key, LAYER_DAYS);
  if (cached) return c.body(cached, 200, { "Content-Type": "application/json", "Cache-Control": "private, max-age=86400" });
  const metaRes = await fetch(`${API}/${iso}/${level}/`, { headers: { Accept: "application/json" } }).catch(() => null);
  if (!metaRes || !metaRes.ok) return c.json({ error: `geoBoundaries has no ${level} boundaries for ${iso}${metaRes ? ` (${metaRes.status})` : ""}.` }, metaRes?.status === 404 ? 404 : 502);
  const meta = (await metaRes.json()) as Meta | Meta[];
  const m = Array.isArray(meta) ? meta[0] : meta;
  if (!m?.simplifiedGeometryGeoJSON) return c.json({ error: `geoBoundaries lists no file for ${iso} ${level}.` }, 404);
  const geoRes = await fetch(m.simplifiedGeometryGeoJSON).catch(() => null);
  if (!geoRes || !geoRes.ok) return c.json({ error: `The ${iso} ${level} file could not be downloaded${geoRes ? ` (${geoRes.status})` : ""}.` }, 502);
  const fc = (await geoRes.json()) as { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }[] };
  const features = fc.features
    .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
    .map((f, i) => ({
      type: "Feature",
      properties: { id: String(f.properties.shapeID ?? `${iso}-${level}-${i}`), name: String(f.properties.shapeName ?? `Area ${i + 1}`), iso, level },
      geometry: trimCoords(f.geometry!),
    }));
  const text = JSON.stringify({ type: "FeatureCollection", iso, level, canonical: m.boundaryCanonical ?? "", license: m.boundaryLicense ?? "", features });
  await writeCache(db, key, text);
  return c.body(text, 200, { "Content-Type": "application/json", "Cache-Control": "private, max-age=86400" });
});
