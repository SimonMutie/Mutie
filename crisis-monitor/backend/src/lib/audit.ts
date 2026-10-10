import type { Env } from "../bindings";

/**
 * A plain record of who did what on the platform: sign-ins (and refusals),
 * account changes, sharing, quota edits. It exists so the admin can answer
 * "who opened this, and when?" and so odd behaviour on a client login shows
 * up. Writing it never blocks or breaks the action it describes.
 *
 * Entries older than RETENTION_DAYS are removed as new ones are written, so
 * the log does not grow into a permanent record of people's activity.
 */
export const RETENTION_DAYS = 180;

export interface AuditEntry {
  id?: number;
  at: string;
  user_id: string | null;
  username: string | null;
  action: string;
  detail: string | null;
  ip: string | null;
}

let tableReady: Promise<unknown> | null = null;
function ensureTable(env: Env) {
  if (!tableReady) {
    tableReady = (async () => {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT, username TEXT, action TEXT NOT NULL, detail TEXT, ip TEXT)`
      ).run();
      await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at DESC)`).run();
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

export function clientIp(req: Request | { header(name: string): string | undefined }): string | null {
  const get = (n: string) => ("headers" in req ? (req as Request).headers.get(n) : (req as { header(name: string): string | undefined }).header(n));
  return get("CF-Connecting-IP") ?? get("X-Forwarded-For")?.split(",")[0]?.trim() ?? null;
}

let writes = 0;

export async function audit(
  env: Env,
  entry: { userId?: string | null; username?: string | null; action: string; detail?: string | null; ip?: string | null }
): Promise<void> {
  try {
    await ensureTable(env);
    await env.DB.prepare(`INSERT INTO audit_log (at, user_id, username, action, detail, ip) VALUES (?,?,?,?,?,?)`)
      .bind(new Date().toISOString(), entry.userId ?? null, entry.username ?? null, entry.action, entry.detail?.slice(0, 500) ?? null, entry.ip ?? null)
      .run();
    if (++writes % 50 === 0) {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
      await env.DB.prepare(`DELETE FROM audit_log WHERE at < ?`).bind(cutoff).run();
    }
  } catch (err) {
    console.error("[audit] could not record entry:", err);
  }
}

export async function readAudit(env: Env, opts: { limit?: number; action?: string; username?: string } = {}): Promise<AuditEntry[]> {
  await ensureTable(env);
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.action) {
    where.push("action LIKE ?");
    params.push(`${opts.action}%`);
  }
  if (opts.username) {
    where.push("username = ?");
    params.push(opts.username);
  }
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const res = await env.DB.prepare(`SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ${limit}`)
    .bind(...params)
    .all<AuditEntry>();
  return res.results ?? [];
}
