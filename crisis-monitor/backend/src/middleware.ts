import type { Context, Next } from "hono";
import type { Env } from "./bindings";
import type { UserRole } from "./types";
import { verifySessionToken } from "./auth";

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

interface Gate {
  readOnly: boolean;
  disabled: boolean;
  validAfter: number;
  at: number;
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
    const row = await env.DB.prepare("SELECT read_only, disabled, tokens_valid_after FROM users WHERE id = ?").bind(userId).first<Record<string, unknown>>();
    if (!row) return null;
    const gate: Gate = {
      readOnly: Boolean(row.read_only),
      disabled: Boolean(row.disabled),
      validAfter: Number(row.tokens_valid_after ?? 0),
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

  const gate = await loadGate(c.env, payload.userId);
  if (gate === null) return c.json({ error: "Invalid or expired session" }, 401);
  if (gate !== "unknown") {
    if (gate.disabled) return c.json({ error: "This account has been disabled" }, 403);
    if ((payload.iat ?? 0) < gate.validAfter) return c.json({ error: "Session ended — please sign in again" }, 401);
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
