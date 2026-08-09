import type { Context, Next } from "hono";
import type { Env } from "./bindings";
import type { UserRole } from "./types";
import { verifySessionToken } from "./auth";

export interface AuthedVariables {
  userId: string;
  role: UserRole;
}

type AuthedContext = Context<{ Bindings: Env; Variables: AuthedVariables }>;

function extractToken(c: AuthedContext): string | null {
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return c.req.query("token") ?? null;
}

export async function requireAuth(c: AuthedContext, next: Next) {
  const token = extractToken(c);
  if (!token) return c.json({ error: "Authentication required" }, 401);

  const payload = await verifySessionToken(token, c.env.SESSION_SECRET);
  if (!payload) return c.json({ error: "Invalid or expired session" }, 401);

  c.set("userId", payload.userId);
  c.set("role", payload.role);
  await next();
}

export async function requireAdmin(c: AuthedContext, next: Next) {
  if (c.get("role") !== "admin") return c.json({ error: "Admin access required" }, 403);
  await next();
}
