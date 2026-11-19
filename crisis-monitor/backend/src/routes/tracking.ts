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
    db.prepare(`CREATE TABLE IF NOT EXISTS vehicle_alerts (
      id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL,
      at TEXT NOT NULL, lat REAL, lng REAL, acknowledged_at TEXT
    )`),
  ]);
  // Columns added after the first version (alert rules, the last fix's accuracy, the alert state).
  const cols = new Set((await all<{ name: string }>(db, `PRAGMA table_info(vehicles)`)).map((c) => c.name));
  const add: [string, string][] = [
    ["last_accuracy", "REAL"],
    ["zone_lat", "REAL"],
    ["zone_lng", "REAL"],
    ["zone_radius_m", "REAL"],
    ["quiet_from", "INTEGER"],
    ["quiet_to", "INTEGER"],
    ["silent_minutes", "INTEGER"],
    ["alert_state", "TEXT"],
  ];
  for (const [name, type] of add) if (!cols.has(name)) await run(db, `ALTER TABLE vehicles ADD COLUMN ${name} ${type}`);
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
    // The latest position, unless this one is older (positions stored during a signal gap arrive late). A rough fix
    // (a phone indoors falling back to Wi-Fi or cell towers) does not move the car off a precise fix from the last
    // five minutes: the car stays where it was precisely seen, and only the time it was heard from moves on.
    const prev = await first<VehicleRow>(db, `SELECT * FROM vehicles WHERE id = ?`, [v.id]);
    if (prev && (!prev.last_at || prev.last_at <= f.at)) {
      const shown = await placeCar(db, prev, f);
      if (!shown) {
        await run(db, `UPDATE vehicles SET last_battery = COALESCE(?, last_battery) WHERE id = ?`, [f.battery, v.id]);
      } else {
        await run(
          db,
          `UPDATE vehicles SET last_at = ?, last_lat = ?, last_lng = ?, last_speed_kmh = ?, last_heading = COALESCE(?, last_heading), last_ignition = COALESCE(?, last_ignition), last_battery = COALESCE(?, last_battery), last_accuracy = ? WHERE id = ?`,
          [f.at, shown.lat, shown.lng, f.speedKmh, f.heading, f.ignition === null ? null : f.ignition ? 1 : 0, f.battery, shown.accuracy, v.id]
        );
      }
      await checkRules(db, prev, { ...f, ...(shown ? { lat: shown.lat, lng: shown.lng, accuracy: shown.accuracy } : {}) });
    }
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

/** Beyond this many metres a fix is rough (Wi-Fi or cell towers rather than satellites). */
const ROUGH_M = 30;

const metres = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const r = Math.PI / 180;
  const x = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
};
/**
 * Where to draw the car for a new fix, or null to leave it where it is. Three standard GPS filters:
 *  - a rough fix (worse than ±30 m: Wi-Fi or cell towers, no satellites) does not move the car off a precise fix from
 *    the last five minutes;
 *  - a jump no car could make (faster than 250 km/h from the last precise fix) is ignored as a glitch;
 *  - a parked car (not moving, all recent fixes within 40 m) is drawn at the precision-weighted average of its last
 *    few minutes of fixes, which removes the few metres of wander every GPS has standing still.
 */
async function placeCar(db: D1Database, prev: VehicleRow, f: Fix): Promise<{ lat: number; lng: number; accuracy: number | null } | null> {
  const lastPrecise = prev.last_at && prev.last_lat !== null && prev.last_lng !== null && prev.last_accuracy !== null && prev.last_accuracy <= ROUGH_M;
  const gapMs = prev.last_at ? Date.parse(f.at) - Date.parse(prev.last_at) : Infinity;
  if (f.accuracy !== null && f.accuracy > ROUGH_M && lastPrecise && gapMs < 5 * 60_000) return null;
  if (lastPrecise && gapMs > 0 && gapMs < 10 * 60_000) {
    const kmh = metres(prev.last_lat as number, prev.last_lng as number, f.lat, f.lng) / 1000 / (gapMs / 3600_000);
    if (kmh > 250) return null;
  }
  if ((f.speedKmh ?? 0) < 3 && (f.accuracy === null || f.accuracy <= ROUGH_M)) {
    const recent = await all<{ lat: number; lng: number; accuracy_m: number | null; speed_kmh: number | null }>(
      db,
      `SELECT lat, lng, accuracy_m, speed_kmh FROM vehicle_positions WHERE vehicle_id = ? AND at >= ? AND at <= ? AND (accuracy_m IS NULL OR accuracy_m <= ?) ORDER BY at DESC LIMIT 12`,
      [prev.id, new Date(Date.parse(f.at) - 3 * 60_000).toISOString(), f.at, ROUGH_M]
    );
    const still = recent.filter((r) => (r.speed_kmh ?? 0) < 3 && metres(r.lat, r.lng, f.lat, f.lng) < 40);
    if (still.length >= 3) {
      let w = 0, lat = 0, lng = 0;
      for (const r of still) {
        const a = Math.max(3, r.accuracy_m ?? 10);
        const k = 1 / (a * a);
        w += k;
        lat += r.lat * k;
        lng += r.lng * k;
      }
      return { lat: lat / w, lng: lng / w, accuracy: Math.max(1, Math.round(Math.sqrt(1 / w))) };
    }
  }
  return { lat: f.lat, lng: f.lng, accuracy: f.accuracy };
}

/** The hour in Nairobi (the alert rules' quiet hours are local time). */
const nairobiHour = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "numeric", hour12: false }).format(new Date(iso))) % 24;
const inQuiet = (h: number, from: number, to: number) => (from === to ? false : from < to ? h >= from && h < to : h >= from || h < to);

interface AlertState {
  speeding?: boolean;
  outside?: boolean;
  quietMoving?: string; // the night (date) already alerted
  silent?: boolean;
}
const stateOf = (v: VehicleRow): AlertState => {
  try {
    return v.alert_state ? (JSON.parse(v.alert_state) as AlertState) : {};
  } catch {
    return {};
  }
};

async function raise(db: D1Database, v: VehicleRow, kind: string, severity: "alert" | "info", message: string, lat: number | null, lng: number | null, at: string) {
  await run(db, `INSERT INTO vehicle_alerts (id, vehicle_id, kind, severity, message, at, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [crypto.randomUUID(), v.id, kind, severity, message, at, lat, lng]);
  await run(db, `DELETE FROM vehicle_alerts WHERE at < ?`, [new Date(Date.now() - KEEP_DAYS * 864e5).toISOString()]);
}

/**
 * A vehicle's alert rules against a new position: over its speed limit; outside its safe zone (left, then back);
 * moving in its quiet hours (once a night); and reporting again after going silent. Each alert is raised once when
 * the rule is broken, not on every report, and the zone only judges precise fixes (a rough one could put a parked
 * car outside its own gate).
 */
export async function checkRules(db: D1Database, v: VehicleRow, f: Fix): Promise<void> {
  const st = stateOf(v);
  const was = JSON.stringify(st);
  const kmh = f.speedKmh ?? 0;
  if (st.silent) {
    st.silent = false;
    await raise(db, v, "silent", "info", `${v.name} is reporting again`, f.lat, f.lng, f.at);
  }
  if (v.speed_limit_kmh) {
    if (!st.speeding && kmh > v.speed_limit_kmh) {
      st.speeding = true;
      await raise(db, v, "speed", "alert", `${v.name} is speeding: ${Math.round(kmh)} km/h, limit ${v.speed_limit_kmh} km/h`, f.lat, f.lng, f.at);
    } else if (st.speeding && kmh < v.speed_limit_kmh - 5) st.speeding = false;
  }
  if (v.zone_lat !== null && v.zone_lng !== null && v.zone_radius_m && (f.accuracy === null || f.accuracy <= ROUGH_M)) {
    const d = metres(v.zone_lat, v.zone_lng, f.lat, f.lng);
    if (!st.outside && d > v.zone_radius_m) {
      st.outside = true;
      await raise(db, v, "zone", "alert", `${v.name} has left its safe zone (${Math.round(d)} m from the centre)`, f.lat, f.lng, f.at);
    } else if (st.outside && d < v.zone_radius_m * 0.9) {
      st.outside = false;
      await raise(db, v, "zone", "info", `${v.name} is back inside its safe zone`, f.lat, f.lng, f.at);
    }
  }
  if (v.quiet_from !== null && v.quiet_to !== null && kmh > 8 && inQuiet(nairobiHour(f.at), v.quiet_from, v.quiet_to)) {
    const night = new Date(Date.parse(f.at) - 12 * 3600_000).toISOString().slice(0, 10);
    if (st.quietMoving !== night) {
      st.quietMoving = night;
      const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
      await raise(db, v, "quiet", "alert", `${v.name} is moving in its quiet hours (${hh(v.quiet_from)}–${hh(v.quiet_to)}): ${Math.round(kmh)} km/h`, f.lat, f.lng, f.at);
    }
  }
  if (JSON.stringify(st) !== was) await run(db, `UPDATE vehicles SET alert_state = ? WHERE id = ?`, [JSON.stringify(st), v.id]);
}

/** Vehicles silent for longer than their limit: one alert each (run every five minutes from the cron). */
export async function checkSilentVehicles(db: D1Database): Promise<void> {
  try {
    await ensureTables(db);
    const rows = await all<VehicleRow>(db, `SELECT * FROM vehicles WHERE silent_minutes IS NOT NULL AND last_at IS NOT NULL`);
    for (const v of rows) {
      const st = stateOf(v);
      if (st.silent || !v.silent_minutes || !v.last_at) continue;
      const mins = (Date.now() - Date.parse(v.last_at)) / 60000;
      if (mins < v.silent_minutes) continue;
      st.silent = true;
      await raise(db, v, "silent", "alert", `${v.name} has not reported for ${Math.round(mins)} minutes`, v.last_lat, v.last_lng, nowIso());
      await run(db, `UPDATE vehicles SET alert_state = ? WHERE id = ?`, [JSON.stringify(st), v.id]);
    }
  } catch {
    /* tracking never set up */
  }
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
  last_accuracy: number | null;
  zone_lat: number | null;
  zone_lng: number | null;
  zone_radius_m: number | null;
  quiet_from: number | null;
  quiet_to: number | null;
  silent_minutes: number | null;
  alert_state: string | null;
}
const shape = (v: VehicleRow) => ({
  id: v.id,
  name: v.name,
  color: v.color,
  speedLimitKmh: v.speed_limit_kmh,
  zone: v.zone_lat !== null && v.zone_lng !== null && v.zone_radius_m ? { lat: v.zone_lat, lng: v.zone_lng, radiusM: v.zone_radius_m } : null,
  quietHours: v.quiet_from !== null && v.quiet_to !== null ? { from: v.quiet_from, to: v.quiet_to } : null,
  silentMinutes: v.silent_minutes,
  alerting: (() => {
    const st = stateOf(v);
    return !!(st.speeding || st.outside || st.silent);
  })(),
  createdAt: v.created_at,
  last: v.last_at
    ? { at: v.last_at, lat: v.last_lat, lng: v.last_lng, speedKmh: v.last_speed_kmh, heading: v.last_heading, ignition: v.last_ignition === null ? null : !!v.last_ignition, battery: v.last_battery, accuracyM: v.last_accuracy }
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
  zone: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusM: z.number().min(50).max(500000) }).nullable().optional(),
  quietHours: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(23) }).nullable().optional(),
  silentMinutes: z.number().int().min(5).max(10080).nullable().optional(),
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
  const keep = <T,>(next: T | undefined, current: T) => (next === undefined ? current : next);
  const zone = d.zone === undefined ? (row.zone_lat !== null ? { lat: row.zone_lat, lng: row.zone_lng as number, radiusM: row.zone_radius_m as number } : null) : d.zone;
  const quiet = d.quietHours === undefined ? (row.quiet_from !== null ? { from: row.quiet_from, to: row.quiet_to as number } : null) : d.quietHours;
  // Changing a rule starts it afresh (no stale "already alerted" carried over).
  const st = stateOf(row);
  if (d.zone !== undefined) delete st.outside;
  if (d.speedLimitKmh !== undefined) delete st.speeding;
  if (d.quietHours !== undefined) delete st.quietMoving;
  if (d.silentMinutes !== undefined) delete st.silent;
  await run(
    c.env.DB,
    `UPDATE vehicles SET name = COALESCE(?, name), color = COALESCE(?, color), speed_limit_kmh = ?, zone_lat = ?, zone_lng = ?, zone_radius_m = ?, quiet_from = ?, quiet_to = ?, silent_minutes = ?, alert_state = ? WHERE id = ?`,
    [
      d.name ?? null,
      d.color ?? null,
      keep(d.speedLimitKmh, row.speed_limit_kmh),
      zone?.lat ?? null,
      zone?.lng ?? null,
      zone?.radiusM ?? null,
      quiet?.from ?? null,
      quiet?.to ?? null,
      keep(d.silentMinutes, row.silent_minutes),
      JSON.stringify(st),
      row.id,
    ]
  );
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
  // The trail is drawn from precise fixes only (rough ones zigzag around a parked car).
  const points = await all<{ at: string; lat: number; lng: number; speed_kmh: number | null; heading: number | null; ignition: number | null }>(
    c.env.DB,
    `SELECT at, lat, lng, speed_kmh, heading, ignition FROM vehicle_positions WHERE vehicle_id = ? AND at >= ? AND at <= ? AND (accuracy_m IS NULL OR accuracy_m <= ?) ORDER BY at LIMIT 20000`,
    [row.id, from, to, ROUGH_M]
  );
  return c.json({
    vehicle: shape(row),
    points: points.map((p) => ({ at: p.at, lat: p.lat, lng: p.lng, speedKmh: p.speed_kmh, heading: p.heading, ignition: p.ignition === null ? null : !!p.ignition })),
  });
});

/** Vehicle alerts for the vehicles this user may see: the open ones (not yet acknowledged), or all since `after`. */
authed.get("/alerts", async (c) => {
  await ensureTables(c.env.DB);
  const ids = (await visible(c as never)).map((v) => v.id);
  if (!ids.length) return c.json({ alerts: [] });
  const after = c.req.query("after");
  const rows = await all<{ id: string; vehicle_id: string; kind: string; severity: string; message: string; at: string; lat: number | null; lng: number | null; acknowledged_at: string | null }>(
    c.env.DB,
    `SELECT * FROM vehicle_alerts WHERE vehicle_id IN (${ids.map(() => "?").join(",")}) AND ${after ? "at > ?" : "acknowledged_at IS NULL"} ORDER BY at DESC LIMIT 50`,
    [...ids, ...(after ? [after] : [])]
  );
  return c.json({
    alerts: rows.map((r) => ({ id: r.id, vehicleId: r.vehicle_id, kind: r.kind, severity: r.severity, message: r.message, at: r.at, lat: r.lat, lng: r.lng, acknowledged: !!r.acknowledged_at })),
  });
});

authed.post("/alerts/:id/ack", async (c) => {
  await ensureTables(c.env.DB);
  const ids = (await visible(c as never)).map((v) => v.id);
  if (ids.length) await run(c.env.DB, `UPDATE vehicle_alerts SET acknowledged_at = ? WHERE id = ? AND vehicle_id IN (${ids.map(() => "?").join(",")})`, [nowIso(), c.req.param("id"), ...ids]);
  return c.json({ ok: true });
});

/** A vehicle's last 30 fixes as the phone sent them (rough ones included), for checking precision in Settings. */
authed.get("/vehicles/:id/recent", async (c) => {
  await ensureTables(c.env.DB);
  const [row] = await visible(c as never, c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  const points = await all<{ at: string; lat: number; lng: number; accuracy_m: number | null; speed_kmh: number | null }>(
    c.env.DB,
    `SELECT at, lat, lng, accuracy_m, speed_kmh FROM vehicle_positions WHERE vehicle_id = ? ORDER BY at DESC LIMIT 30`,
    [row.id]
  );
  return c.json({ shown: shape(row).last, points: points.map((p) => ({ at: p.at, lat: p.lat, lng: p.lng, accuracyM: p.accuracy_m, speedKmh: p.speed_kmh })) });
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
