import type { Context, Next } from "hono";
import type { Env } from "./bindings";
import type { UserRole } from "./types";
import { verifySessionToken } from "./auth";
import { rateLimited } from "./lib/quota";

export interface AuthedVariables {
  userId: string;
  role: UserRole;
  readOnly?: boolean;
}

type AuthedContext = Context<{ Bindings: Env; Variables: AuthedVariables }>;

function extractToken(c: AuthedContext): string | null {
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return c.req.query("token") ?? null;
}

/** What a viewer (read-only) login may still change: only its own credentials. */
const VIEWER_WRITE_ALLOWED = [/^\/api\/auth\/change-password$/, /^\/api\/auth\/logout-all$/];

export type Section = "live_osint" | "trends" | "afrintel";

interface Gate {
  readOnly: boolean;
  disabled: boolean;
  validAfter: number;
  /** The login's client organisation is paused: every request except signing in and out is refused. */
  paused: boolean;
  /** Parts of the Lens the login's client may not open (empty for the admin and standalone logins). */
  blocked: Section[];
  at: number;
}

/**
 * Which API paths belong to each part of the Lens a client can be given or refused (Admin → client → Resources).
 * Regional Spotlight and due-diligence screening have their own checks in their routes.
 */
export const SECTION_PATHS: [Section, RegExp][] = [
  ["live_osint", /^\/api\/(live-layers|global-status|social-listening|listening-queries|map-routes|map-shapes|queries|events|query-insights)(\/|$)/],
  ["trends", /^\/api\/(incidents|incident-staging|custom-dashboards|datasets|analytics)(\/|$)/],
  ["afrintel", /^\/api\/afrintel(\/|$)/],
];
const SECTION_NAMES: Record<Section, string> = { live_osint: "Live OSINT", trends: "Trends & Patterns", afrintel: "AfrIntel" };

/** What a paused client's logins may still reach: their own session (to see the paused notice) and sign-out. */
const PAUSED_ALLOWED = /^\/api\/auth\//;

/** The answer for a request, given the login's gate: null to let it through, or the refusal. */
export function gateRefusal(gate: Pick<Gate, "paused" | "blocked">, path: string): { status: 403; error: string; paused?: true } | null {
  if (gate.paused && !PAUSED_ALLOWED.test(path)) return { status: 403, error: "Your organisation's access to the Lens is paused. Please contact Afrilens.", paused: true };
  for (const [section, re] of SECTION_PATHS) {
    if (gate.blocked.includes(section) && re.test(path)) return { status: 403, error: `${SECTION_NAMES[section]} is not part of your organisation's access.` };
  }
  return null;
}
const gateCache = new Map<string, Gate>();
const GATE_TTL_MS = 15_000;

/** Drop the cached account state so a change (disable, viewer flag, sign-out
 *  everywhere) applies at once in this isolate; others catch up within the TTL. */
export function forgetGate(userId?: string) {
  if (userId) gateCache.delete(userId);
  else gateCache.clear();
}

/** Current account state, read from the database rather than trusted from
 *  the long-lived signed token — that is what makes disabling a login, making
 *  it read-only, or signing it out everywhere take effect within seconds. */
async function loadGate(env: Env, userId: string): Promise<Gate | null | "unknown"> {
  const hit = gateCache.get(userId);
  if (hit && Date.now() - hit.at < GATE_TTL_MS) return hit;
  try {
    const row = await env.DB.prepare(
      `SELECT u.read_only, u.disabled, u.tokens_valid_after, u.role, c.id AS client_id, c.paused, c.can_live_osint, c.can_trends, c.can_afrintel
       FROM users u LEFT JOIN clients c ON c.id = u.client_id WHERE u.id = ?`
    ).bind(userId).first<Record<string, unknown>>();
    if (!row) return null;
    // The platform admin is never paused or limited; logins outside any client have nothing to limit.
    const limited = row.role !== "admin" && row.client_id != null;
    const blocked: Section[] = [];
    if (limited) {
      if (Number(row.can_live_osint ?? 1) === 0) blocked.push("live_osint");
      if (Number(row.can_trends ?? 1) === 0) blocked.push("trends");
      if (Number(row.can_afrintel ?? 1) === 0) blocked.push("afrintel");
    }
    const gate: Gate = {
      readOnly: Boolean(row.read_only),
      disabled: Boolean(row.disabled),
      validAfter: Number(row.tokens_valid_after ?? 0),
      paused: limited && Boolean(row.paused),
      blocked,
      at: Date.now(),
    };
    gateCache.set(userId, gate);
    return gate;
  } catch (err) {
    // Columns not created yet (very first request after a deploy): the schema
    // check adds them; don't lock everyone out in the meantime.
    const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (m.includes("no such column") || m.includes("no such table")) return "unknown";
    throw err;
  }
}

export async function requireAuth(c: AuthedContext, next: Next) {
  const token = extractToken(c);
  if (!token) return c.json({ error: "Authentication required" }, 401);

  const payload = await verifySessionToken(token, c.env.SESSION_SECRET);
  if (!payload) return c.json({ error: "Invalid or expired session" }, 401);

  if (rateLimited(payload.userId, payload.role)) {
    c.header("Retry-After", "30");
    return c.json({ error: "Too many requests — slow down for a moment." }, 429);
  }

  const gate = await loadGate(c.env, payload.userId);
  if (gate === null) return c.json({ error: "Invalid or expired session" }, 401);
  if (gate !== "unknown") {
    if (gate.disabled) return c.json({ error: "This account has been disabled" }, 403);
    if ((payload.iat ?? 0) < gate.validAfter) return c.json({ error: "Session ended — please sign in again" }, 401);
    const refusal = gateRefusal(gate, new URL(c.req.url).pathname);
    if (refusal) return c.json({ error: refusal.error, ...(refusal.paused ? { paused: true } : {}) }, refusal.status);
    if (gate.readOnly) {
      c.set("readOnly", true);
      const method = c.req.method.toUpperCase();
      const path = new URL(c.req.url).pathname;
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !VIEWER_WRITE_ALLOWED.some((re) => re.test(path))) {
        return c.json({ error: "This is a read-only (viewer) login — changes are not permitted" }, 403);
      }
    }
  }

  c.set("userId", payload.userId);
  c.set("role", payload.role);
  await next();
}

export async function requireAdmin(c: AuthedContext, next: Next) {
  if (c.get("role") !== "admin") return c.json({ error: "Admin access required" }, 403);
  await next();
}
