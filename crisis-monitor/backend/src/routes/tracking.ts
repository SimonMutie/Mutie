import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

/**
 * Vehicle tracking. A tracker (the Traccar Client phone app, a DIY board, or a relay for ready-made trackers) sends
 * its position to /api/tracking/osmand with the vehicle's secret token as its device id. The Lens keeps the
 * positions (90 days) and shows the vehicles on Live OSINT. Only the token's hash is stored; the token itself is
 * shown once, when the vehicle is added. Vehicles are seen by admins and by the user who added them.
 */

export const trackingRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const KEEP_DAYS = 90;

let tablesReady = false;
async function ensureTables(db: D1Database) {
  if (tablesReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#f5a524',
      token_hash TEXT NOT NULL UNIQUE,
      owner_user_id TEXT NOT NULL,
      speed_limit_kmh REAL,
      created_at TEXT NOT NULL,
      last_at TEXT, last_lat REAL, last_lng REAL, last_speed_kmh REAL, last_heading REAL, last_ignition INTEGER, last_battery REAL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tracking_log (at TEXT NOT NULL, outcome TEXT NOT NULL, method TEXT, content_type TEXT, user_agent TEXT, device TEXT, sample TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vehicle_positions (
      vehicle_id TEXT NOT NULL,
      at TEXT NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL,
      speed_kmh REAL, heading REAL, accuracy_m REAL, altitude_m REAL, ignition INTEGER, battery REAL,
      PRIMARY KEY (vehicle_id, at)
    )`),
  ]);
  tablesReady = true;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 24 letters and digits, with no dash or symbol, so double-clicking the token selects all of it. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "x").replace(/\//g, "y").replace(/=+$/, "");
}

/** The vehicle for a device id. Earlier tokens began "lens-", which double-click copying leaves off: either works. */
async function vehicleForToken(db: D1Database, token: string): Promise<{ id: string } | null> {
  const t = token.trim();
  for (const candidate of t.startsWith("lens-") ? [t, t.slice(5)] : [t, `lens-${t}`]) {
    const v = await first<{ id: string }>(db, `SELECT id FROM vehicles WHERE token_hash = ?`, [await sha256(candidate)]);
    if (v) return v;
  }
  return null;
}

/* ── Receiving positions (no sign-in: the token is the credential) ─────────── */

export interface Fix {
  token: string;
  lat: number;
  lng: number;
  at: string;
  speedKmh: number | null;
  heading: number | null;
  accuracy: number | null;
  altitude: number | null;
  ignition: boolean | null;
  battery: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean | null => (v === undefined || v === null || v === "" ? null : v === true || v === "true" || v === "1" || v === 1);
/** A time from seconds, milliseconds or an ISO string; now when missing or absurd. */
function timeOf(v: unknown): string {
  const now = Date.now();
  let t: number | null = null;
  if (typeof v === "string" && /\D/.test(v)) t = Date.parse(v);
  else {
    const n = num(v);
    if (n !== null) t = n < 1e12 ? n * 1000 : n;
  }
  // Positions from the future or older than a week (a wrong phone clock) are dated now.
  return t !== null && Number.isFinite(t) && t <= now + 120_000 && t > now - 7 * 864e5 ? new Date(t).toISOString() : new Date(now).toISOString();
}

/**
 * The positions in a request, in either of the OsmAnd protocol's forms: query or form fields (id, lat, lon,
 * timestamp, speed in knots, bearing, accuracy, altitude, batt, ignition) as older Traccar Client versions and most
 * DIY trackers send, or the JSON body newer Traccar Client versions send (device_id and a location object, speed in
 * metres a second; or a list of locations sent together after a signal gap).
 */
export function parseFixes(query: Record<string, string>, form: Record<string, unknown> | null, json: unknown): Fix[] {
  const fields = { ...(form ?? {}), ...query } as Record<string, unknown>;
  if (fields.id && (fields.lat !== undefined || fields.latitude !== undefined)) {
    const lat = num(fields.lat ?? fields.latitude), lng = num(fields.lon ?? fields.lng ?? fields.longitude);
    if (lat === null || lng === null) return [];
    const knots = num(fields.speed);
    return [
      {
        token: String(fields.id),
        lat,
        lng,
        at: timeOf(fields.timestamp),
        speedKmh: knots === null ? null : knots * 1.852,
        heading: num(fields.bearing ?? fields.heading),
        accuracy: num(fields.accuracy ?? fields.hdop),
        altitude: num(fields.altitude),
        ignition: bool(fields.ignition),
        battery: num(fields.batt ?? fields.battery),
      },
    ];
  }
  if (json && typeof json === "object") {
    const j = json as Record<string, unknown>;
    const token = String(j.device_id ?? j.deviceId ?? j.id ?? "");
    const locs = Array.isArray(j.location) ? j.location : Array.isArray(j.locations) ? j.locations : j.location ? [j.location] : [];
    return locs.flatMap((l): Fix[] => {
      const loc = l as Record<string, unknown>;
      const c = (loc.coords ?? {}) as Record<string, unknown>;
      const lat = num(c.latitude), lng = num(c.longitude);
      if (!token || lat === null || lng === null) return [];
      const ms = num(c.speed);
      const batt = (loc.battery ?? {}) as Record<string, unknown>;
      const level = num(batt.level);
      return [
        {
          token,
          lat,
          lng,
          at: timeOf(loc.timestamp),
          speedKmh: ms === null || ms < 0 ? null : ms * 3.6,
          heading: num(c.heading) !== null && (num(c.heading) as number) >= 0 ? num(c.heading) : null,
          accuracy: num(c.accuracy),
          altitude: num(c.altitude),
          ignition: bool((loc.extras as Record<string, unknown> | undefined)?.ignition),
          battery: level === null ? null : level <= 1 ? Math.round(level * 100) : level,
        },
      ];
    });
  }
  return [];
}

const validFix = (f: Fix) => Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180 && !(f.lat === 0 && f.lng === 0);

/** A device id shortened for the log, so the log never holds a usable token. */
const masked = (t: string) => (t.length > 10 ? `${t.slice(0, 9)}…` : t ? "(short id)" : "(none)");

/** Every attempt to report, with what went wrong, for the Settings card (the last 50 are kept). */
async function logAttempt(db: D1Database, outcome: string, info: { method: string; type: string; ua: string; device: string; sample: string }) {
  try {
    await db.batch([
      db.prepare(`INSERT INTO tracking_log (at, outcome, method, content_type, user_agent, device, sample) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(nowIso(), outcome, info.method, info.type.slice(0, 80), info.ua.slice(0, 120), info.device, info.sample.slice(0, 400)),
      db.prepare(`DELETE FROM tracking_log WHERE rowid NOT IN (SELECT rowid FROM tracking_log ORDER BY at DESC LIMIT 50)`),
    ]);
  } catch {
    /* the log is a help, never a reason to refuse a position */
  }
}

async function receive(c: { env: Env; req: { method: string; url: string; query: () => Record<string, string>; header: (n: string) => string | undefined; text: () => Promise<string> } }) {
  const db = c.env.DB;
  await ensureTables(db);
  const type = c.req.header("content-type") ?? "";
  const raw = c.req.method === "POST" ? await c.req.text().catch(() => "") : "";
  let form: Record<string, unknown> | null = null;
  let json: unknown = null;
  const trimmed = raw.trim();
  // By what the body is, not only what it says it is (some apps send JSON without saying so).
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      json = JSON.parse(trimmed);
    } catch {
      json = null;
    }
  } else if (trimmed.includes("=")) form = Object.fromEntries(new URLSearchParams(trimmed));
  const query = c.req.query();
  const fixes = parseFixes(query, form, json).filter(validFix).slice(0, 500);
  const deviceOf = () => masked(String(query.id ?? form?.id ?? (json as Record<string, unknown> | null)?.device_id ?? ""));
  const info = { method: c.req.method, type, ua: c.req.header("user-agent") ?? "", device: deviceOf(), sample: (new URL(c.req.url).search.replace(/id=[^&]+/, "id=…") + " " + raw.replace(/("device_id"\s*:\s*")[^"]+/, "$1…").replace(/(^|&)id=[^&]+/, "$1id=…")).trim() };
  if (!fixes.length) {
    await logAttempt(db, "No position found in the report", info);
    return { status: 400 as const, body: "No position in the request" };
  }
  const byToken = new Map<string, { id: string } | null>();
  let saved = 0;
  for (const f of fixes) {
    if (!byToken.has(f.token)) byToken.set(f.token, await vehicleForToken(db, f.token));
    const v = byToken.get(f.token);
    if (!v) continue;
    await run(
      db,
      `INSERT OR REPLACE INTO vehicle_positions (vehicle_id, at, lat, lng, speed_kmh, heading, accuracy_m, altitude_m, ignition, battery) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.id, f.at, f.lat, f.lng, f.speedKmh, f.heading, f.accuracy, f.altitude, f.ignition === null ? null : f.ignition ? 1 : 0, f.battery]
    );
    // The latest position, unless this one is older (positions stored during a signal gap arrive late).
    await run(
      db,
      `UPDATE vehicles SET last_at = ?, last_lat = ?, last_lng = ?, last_speed_kmh = ?, last_heading = COALESCE(?, last_heading), last_ignition = COALESCE(?, last_ignition), last_battery = COALESCE(?, last_battery)
       WHERE id = ? AND (last_at IS NULL OR last_at <= ?)`,
      [f.at, f.lat, f.lng, f.speedKmh, f.heading, f.ignition === null ? null : f.ignition ? 1 : 0, f.battery, v.id, f.at]
    );
    saved++;
  }
  // An unknown token: refused, so a mistyped device id shows as an error in the app rather than silently vanishing.
  if (!saved) {
    await logAttempt(db, "Unknown device id: the token does not match any vehicle", info);
    return { status: 401 as const, body: "Unknown device id" };
  }
  await logAttempt(db, `Saved ${saved} position${saved > 1 ? "s" : ""}`, { ...info, sample: "" });
  return { status: 200 as const, body: "OK" };
}

trackingRouter.all("/osmand", async (c) => {
  if (c.req.method !== "GET" && c.req.method !== "POST") return c.text("Method not allowed", 405);
  const r = await receive(c as never);
  return c.text(r.body, r.status);
});

/* ── Managing and viewing vehicles (signed in) ─────────────────────────────── */

const authed = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
authed.use("*", requireAuth);

interface VehicleRow {
  id: string;
  name: string;
  color: string;
  owner_user_id: string;
  speed_limit_kmh: number | null;
  created_at: string;
  last_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_speed_kmh: number | null;
  last_heading: number | null;
  last_ignition: number | null;
  last_battery: number | null;
}
const shape = (v: VehicleRow) => ({
  id: v.id,
  name: v.name,
  color: v.color,
  speedLimitKmh: v.speed_limit_kmh,
  createdAt: v.created_at,
  last: v.last_at
    ? { at: v.last_at, lat: v.last_lat, lng: v.last_lng, speedKmh: v.last_speed_kmh, heading: v.last_heading, ignition: v.last_ignition === null ? null : !!v.last_ignition, battery: v.last_battery }
    : null,
});

/** The vehicles this user may see: all for an admin, their own otherwise. */
async function visible(c: { env: Env; get: (k: "userId" | "role") => string }, id?: string): Promise<VehicleRow[]> {
  const admin = c.get("role") === "admin";
  const where = [admin ? "1 = 1" : "owner_user_id = ?", id ? "id = ?" : "1 = 1"].join(" AND ");
  const params = [...(admin ? [] : [c.get("userId")]), ...(id ? [id] : [])];
  return all<VehicleRow>(c.env.DB, `SELECT * FROM vehicles WHERE ${where} ORDER BY name`, params);
}

authed.get("/vehicles", async (c) => {
  await ensureTables(c.env.DB);
  return c.json({ vehicles: (await visible(c as never)).map(shape) });
});

const vehicleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#f5a524"),
  speedLimitKmh: z.number().min(10).max(250).nullable().optional(),
});

authed.post("/vehicles", requireAdmin, async (c) => {
  await ensureTables(c.env.DB);
  const parsed = vehicleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid vehicle" }, 400);
  const id = crypto.randomUUID();
  const token = newToken();
  await run(c.env.DB, `INSERT INTO vehicles (id, name, color, token_hash, owner_user_id, speed_limit_kmh, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    id,
    parsed.data.name,
    parsed.data.color,
    await sha256(token),
    c.get("userId"),
    parsed.data.speedLimitKmh ?? null,
    nowIso(),
  ]);
  const [row] = await visible(c as never, id);
  return c.json({ vehicle: shape(row), token }, 201);
});

authed.patch("/vehicles/:id", requireAdmin, async (c) => {
  const [row] = await visible(c as never, c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  const parsed = vehicleSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid vehicle" }, 400);
  const d = parsed.data;
  await run(c.env.DB, `UPDATE vehicles SET name = COALESCE(?, name), color = COALESCE(?, color), speed_limit_kmh = ? WHERE id = ?`, [
    d.name ?? null,
    d.color ?? null,
    d.speedLimitKmh === undefined ? row.speed_limit_kmh : d.speedLimitKmh,
    row.id,
  ]);
  const [updated] = await visible(c as never, row.id);
  return c.json({ vehicle: shape(updated) });
});

/** A new token (the old one stops working at once), e.g. if a phone is lost. */
authed.post("/vehicles/:id/token", requireAdmin, async (c) => {
  const [row] = await visible(c as never, c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  const token = newToken();
  await run(c.env.DB, `UPDATE vehicles SET token_hash = ? WHERE id = ?`, [await sha256(token), row.id]);
  return c.json({ token });
});

authed.delete("/vehicles/:id", requireAdmin, async (c) => {
  const [row] = await visible(c as never, c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  await c.env.DB.batch([c.env.DB.prepare(`DELETE FROM vehicle_positions WHERE vehicle_id = ?`).bind(row.id), c.env.DB.prepare(`DELETE FROM vehicles WHERE id = ?`).bind(row.id)]);
  return c.json({ ok: true });
});

/** A vehicle's track: positions over the last `hours` (up to 7 days), or between `from` and `to`, oldest first. */
authed.get("/vehicles/:id/track", async (c) => {
  await ensureTables(c.env.DB);
  const [row] = await visible(c as never, c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  const hours = Math.min(168, Math.max(0.25, Number(c.req.query("hours") ?? 6) || 6));
  const from = c.req.query("from") ?? new Date(Date.now() - hours * 3600_000).toISOString();
  const to = c.req.query("to") ?? new Date(Date.now() + 120_000).toISOString();
  const points = await all<{ at: string; lat: number; lng: number; speed_kmh: number | null; heading: number | null; ignition: number | null }>(
    c.env.DB,
    `SELECT at, lat, lng, speed_kmh, heading, ignition FROM vehicle_positions WHERE vehicle_id = ? AND at >= ? AND at <= ? ORDER BY at LIMIT 20000`,
    [row.id, from, to]
  );
  return c.json({
    vehicle: shape(row),
    points: points.map((p) => ({ at: p.at, lat: p.lat, lng: p.lng, speedKmh: p.speed_kmh, heading: p.heading, ignition: p.ignition === null ? null : !!p.ignition })),
  });
});

/** The last reports received (for the Settings card), admins only. */
authed.get("/log", requireAdmin, async (c) => {
  await ensureTables(c.env.DB);
  const rows = await all<{ at: string; outcome: string; method: string; content_type: string; user_agent: string; device: string; sample: string }>(c.env.DB, `SELECT * FROM tracking_log ORDER BY at DESC LIMIT 20`);
  return c.json({ log: rows.map((r) => ({ at: r.at, outcome: r.outcome, method: r.method, contentType: r.content_type, userAgent: r.user_agent, device: r.device, sample: r.sample })) });
});

trackingRouter.route("/", authed);

/** Old positions removed (run from the daily cron). */
export async function pruneVehiclePositions(db: D1Database): Promise<void> {
  try {
    await ensureTables(db);
    await run(db, `DELETE FROM vehicle_positions WHERE at < ?`, [new Date(Date.now() - KEEP_DAYS * 864e5).toISOString()]);
  } catch {
    /* tracking never set up */
  }
}
