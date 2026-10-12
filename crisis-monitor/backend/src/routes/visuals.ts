import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import { all, first, run, nowIso } from "../db";
import { audit, clientIp } from "../lib/audit";
import type { Env } from "../bindings";

/**
 * Published visuals: one timeline, chart, infographic or dashboard widget,
 * published as its own link. Two kinds:
 *  - "html": a live copy of the visual. Its CSS motion plays in the viewer's
 *    browser. Scripts are not included, so maps and globes show as still frames.
 *  - "gif": a short animated recording of the visual.
 * The content is stored in D1 in chunks, because one row is capped well below
 * a visual's size. The public link shows only this visual.
 */

const CHUNK = 80_000; // characters per row
const MAX_CHUNKS = 60; // about 4.8 MB per visual
const MAX_CONTENT = CHUNK * MAX_CHUNKS;
const GIF_PREFIX = "data:image/gif;base64,";

const publishSchema = z.object({
  title: z.string().trim().min(1).max(160),
  kicker: z.string().trim().max(80).default(""),
  kind: z.enum(["html", "gif"]),
  content: z.string().min(1).max(MAX_CONTENT + GIF_PREFIX.length + 10),
  width: z.number().int().min(1).max(4000).default(800),
  height: z.number().int().min(1).max(8000).default(400),
});

let ready: Promise<void> | null = null;
function ensureTables(db: Env["DB"]): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await run(
        db,
        `CREATE TABLE IF NOT EXISTS visual_links (
          token TEXT PRIMARY KEY, title TEXT NOT NULL, kicker TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
          width INTEGER NOT NULL, height INTEGER NOT NULL, chunks INTEGER NOT NULL,
          created_by TEXT, created_at TEXT NOT NULL, revoked_at TEXT)`,
      );
      await run(
        db,
        `CREATE TABLE IF NOT EXISTS published_visual_chunks (
          token TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (token, idx))`,
      );
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

/** A share token: 18 random bytes, URL-safe. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const visualsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
visualsRouter.use("*", requireAuth, requireAdmin);

visualsRouter.post("/", async (c) => {
  const parsed = publishSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "This visual could not be published. Try again." }, 400);
  const { title, kicker, kind, width, height } = parsed.data;
  let content = parsed.data.content;
  if (kind === "gif") {
    if (!content.startsWith(GIF_PREFIX)) return c.json({ error: "This visual could not be published. Try again." }, 400);
    content = content.slice(GIF_PREFIX.length);
  }
  if (content.length > MAX_CONTENT) {
    return c.json({ error: "This visual is too large to publish. Make the section shorter and try again." }, 413);
  }
  await ensureTables(c.env.DB);
  const chunks = Math.max(1, Math.ceil(content.length / CHUNK));
  const token = newToken();
  await run(
    c.env.DB,
    `INSERT INTO visual_links (token, title, kicker, kind, width, height, chunks, created_by, created_at, revoked_at) VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
    [token, title, kicker, kind, width, height, chunks, c.get("userId"), nowIso()],
  );
  for (let i = 0; i < chunks; i++) {
    await run(c.env.DB, `INSERT INTO published_visual_chunks (token, idx, data) VALUES (?,?,?)`, [token, i, content.slice(i * CHUNK, (i + 1) * CHUNK)]);
  }
  await audit(c.env, { userId: c.get("userId"), action: "visual.publish", detail: `${kind}: ${title}`, ip: clientIp(c.req) });
  return c.json({ token, path: `/visual/${token}` });
});

visualsRouter.get("/", async (c) => {
  await ensureTables(c.env.DB);
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT token, title, kicker, kind, created_at FROM visual_links WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 200`,
  );
  return c.json({ visuals: rows.map((r) => ({ ...r, path: `/visual/${r.token}` })) });
});

visualsRouter.delete("/:token", async (c) => {
  await ensureTables(c.env.DB);
  await run(c.env.DB, `UPDATE visual_links SET revoked_at = ? WHERE token = ?`, [nowIso(), c.req.param("token")]);
  await audit(c.env, { userId: c.get("userId"), action: "visual.revoke", detail: c.req.param("token"), ip: clientIp(c.req) });
  return c.json({ ok: true });
});

/** Public: one published visual, for anyone with the link. */
export const publicVisualsRouter = new Hono<{ Bindings: Env }>();

publicVisualsRouter.get("/:token", async (c) => {
  await ensureTables(c.env.DB);
  const token = c.req.param("token");
  const visual = await first<{ title: string; kicker: string; kind: string; width: number; height: number; created_at: string }>(
    c.env.DB,
    `SELECT title, kicker, kind, width, height, created_at FROM visual_links WHERE token = ? AND revoked_at IS NULL`,
    [token],
  );
  if (!visual) return c.json({ error: "This link is not active." }, 404);
  const parts = await all<{ data: string }>(c.env.DB, `SELECT data FROM published_visual_chunks WHERE token = ? ORDER BY idx`, [token]);
  const joined = parts.map((p) => p.data).join("");
  return c.json({
    title: visual.title,
    kicker: visual.kicker,
    kind: visual.kind,
    width: visual.width,
    height: visual.height,
    created_at: visual.created_at,
    content: visual.kind === "gif" ? GIF_PREFIX + joined : joined,
  });
});
