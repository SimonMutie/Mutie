import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import { all, first, run, nowIso } from "../db";
import { audit, clientIp } from "../lib/audit";
import type { Env } from "../bindings";

/**
 * Published visuals: one timeline, chart, infographic or dashboard widget,
 * published as its own link. The picture is stored in D1 in chunks, because a
 * single row is capped well below a chart's PNG. The public link shows only
 * this picture, never the rest of the app.
 */

const CHUNK = 80_000; // characters per row
const MAX_CHUNKS = 60; // about 4.8 MB of picture data
const MAX_IMAGE = CHUNK * MAX_CHUNKS;
const IMAGE_PREFIX = /^data:(image\/gif);base64,/;

const publishSchema = z.object({
  title: z.string().trim().min(1).max(160),
  kicker: z.string().trim().max(80).default(""),
  /** The animation, as a GIF data URL. */
  image: z.string().max(MAX_IMAGE + 40),
});

let ready: Promise<void> | null = null;
function ensureTables(db: Env["DB"]): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await run(
        db,
        `CREATE TABLE IF NOT EXISTS published_visuals (
          token TEXT PRIMARY KEY, title TEXT NOT NULL, kicker TEXT NOT NULL DEFAULT '', chunks INTEGER NOT NULL,
          mime TEXT NOT NULL DEFAULT 'image/gif', created_by TEXT, created_at TEXT NOT NULL, revoked_at TEXT)`,
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
  await ensureTables(c.env.DB);
  const { title, kicker, image } = parsed.data;
  const prefix = IMAGE_PREFIX.exec(image);
  if (!prefix) return c.json({ error: "This visual could not be published. Try again." }, 400);
  const mime = prefix[1];
  const data = image.slice(prefix[0].length);
  const chunks = Math.max(1, Math.ceil(data.length / CHUNK));
  if (chunks > MAX_CHUNKS) return c.json({ error: "This visual is too large to publish. Make the section shorter and try again." }, 413);
  const token = newToken();
  await run(
    c.env.DB,
    `INSERT INTO published_visuals (token, title, kicker, chunks, mime, created_by, created_at, revoked_at) VALUES (?,?,?,?,?,?,?,NULL)`,
    [token, title, kicker, chunks, mime, c.get("userId"), nowIso()],
  );
  for (let i = 0; i < chunks; i++) {
    await run(c.env.DB, `INSERT INTO published_visual_chunks (token, idx, data) VALUES (?,?,?)`, [token, i, data.slice(i * CHUNK, (i + 1) * CHUNK)]);
  }
  await audit(c.env, { userId: c.get("userId"), action: "visual.publish", detail: title, ip: clientIp(c.req) });
  return c.json({ token, path: `/visual/${token}` });
});

visualsRouter.get("/", async (c) => {
  await ensureTables(c.env.DB);
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT token, title, kicker, created_at FROM published_visuals WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 200`,
  );
  return c.json({ visuals: rows.map((r) => ({ ...r, path: `/visual/${r.token}` })) });
});

visualsRouter.delete("/:token", async (c) => {
  await ensureTables(c.env.DB);
  await run(c.env.DB, `UPDATE published_visuals SET revoked_at = ? WHERE token = ?`, [nowIso(), c.req.param("token")]);
  await audit(c.env, { userId: c.get("userId"), action: "visual.revoke", detail: c.req.param("token"), ip: clientIp(c.req) });
  return c.json({ ok: true });
});

/** Public: the picture of one published visual, for anyone with the link. */
export const publicVisualsRouter = new Hono<{ Bindings: Env }>();

publicVisualsRouter.get("/:token", async (c) => {
  await ensureTables(c.env.DB);
  const token = c.req.param("token");
  const visual = await first<{ title: string; kicker: string; chunks: number; mime: string; created_at: string }>(
    c.env.DB,
    `SELECT title, kicker, chunks, mime, created_at FROM published_visuals WHERE token = ? AND revoked_at IS NULL`,
    [token],
  );
  if (!visual) return c.json({ error: "This link is not active." }, 404);
  const parts = await all<{ data: string }>(c.env.DB, `SELECT data FROM published_visual_chunks WHERE token = ? ORDER BY idx`, [token]);
  return c.json({
    title: visual.title,
    kicker: visual.kicker,
    created_at: visual.created_at,
    image: `data:${visual.mime};base64,${parts.map((p) => p.data).join("")}`,
  });
});
