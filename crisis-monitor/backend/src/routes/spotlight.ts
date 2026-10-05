import { Hono } from "hono";
import { z } from "zod";
import { all, first, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import { SPOTLIGHT_REGIONS, SPOTLIGHT_REGION_SLUGS } from "../lib/spotlightRegions";
import type { Env } from "../bindings";

/**
 * Regional Spotlight — a database of publications ("products": analyses,
 * situation updates, reports ...) filed under a region, with no limit on
 * how many a region holds.
 *
 * Every entry is either a draft or published:
 *   - draft      visible only to platform admins, who write and edit it;
 *   - published  live for every signed-in user of the platform.
 * A published entry can additionally be made public, which gives it a link
 * (/spotlight/<id>) that opens without signing in. That is a separate,
 * deliberate switch — publishing alone never exposes anything outside the
 * platform.
 *
 * Only platform admins can create, edit, publish or delete.
 */
export const spotlightRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
export const publicSpotlightRouter = new Hono<{ Bindings: Env }>();

/** The table is created here rather than by a hand-run migration file: a
 *  migration that is never pasted into the database console would leave
 *  the whole page failing (as happened with events.title). Once per
 *  isolate; a failed attempt is retried on the next request. */
let tableReady: Promise<void> | null = null;
export function ensureSpotlightTable(env: Env): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS spotlight_entries (
          id TEXT PRIMARY KEY,
          region TEXT NOT NULL,
          title TEXT NOT NULL,
          product_type TEXT NOT NULL DEFAULT 'Analysis',
          countries TEXT,
          summary TEXT,
          body TEXT,
          cover_image_url TEXT,
          link_url TEXT,
          link_label TEXT,
          author TEXT,
          publication_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          is_public INTEGER NOT NULL DEFAULT 0,
          published_at TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      ).run();
      await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_spotlight_region_date ON spotlight_entries (region, publication_date DESC)`).run();
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

/** Test hook. */
export function resetSpotlightTableCheck(): void {
  tableReady = null;
}

spotlightRouter.use("*", requireAuth);
spotlightRouter.use("*", async (c, next) => {
  await ensureSpotlightTable(c.env);
  await next();
});

const LIST_COLUMNS = "id, region, title, product_type, countries, summary, cover_image_url, link_url, link_label, author, publication_date, status, is_public, published_at, created_at, updated_at";

function toEntry(row: Record<string, unknown>) {
  return { ...row, is_public: !!row.is_public };
}

// Links are rendered as clickable anchors and images, so only real web
// addresses are accepted — never javascript:, data: or the like.
const webUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\/\S+$/i.test(v), "must be a web address starting with http:// or https://");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const optionalUrl = z.union([webUrl, z.literal(""), z.null(), z.undefined()]).transform((v) => (v ? v : null));

const entryFields = {
  region: z.enum(SPOTLIGHT_REGION_SLUGS),
  title: z.string().trim().min(1, "is required").max(300),
  product_type: z.string().trim().min(1, "is required").max(60),
  countries: optionalText(300),
  summary: optionalText(1500),
  body: optionalText(200_000),
  cover_image_url: optionalUrl,
  link_url: optionalUrl,
  link_label: optionalText(80),
  author: optionalText(120),
  publication_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date (YYYY-MM-DD)"),
  status: z.enum(["draft", "published"]),
  is_public: z.boolean(),
};

const createSchema = z.object({
  ...entryFields,
  product_type: entryFields.product_type.default("Analysis"),
  publication_date: entryFields.publication_date.optional(),
  status: entryFields.status.default("draft"),
  is_public: entryFields.is_public.default(false),
});
const updateSchema = z.object(entryFields).partial();

const FIELD_NAMES: Record<string, string> = {
  region: "Region",
  title: "Title",
  product_type: "Product type",
  countries: "Countries",
  summary: "Summary",
  body: "Text",
  cover_image_url: "Cover image address",
  link_url: "Link address",
  link_label: "Link label",
  author: "Author",
  publication_date: "Date",
};

/** One plain sentence instead of a validation object, so the form can show it as is. */
function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = String(issue?.path[0] ?? "");
  return `${FIELD_NAMES[field] ?? "Entry"} ${issue?.message ?? "is not valid"}`.replace(/\bString must contain at most (\d+) character\(s\)/, "is too long (limit $1 characters)");
}

/** Per-region counts, for the menu. Drafts are counted for admins only. */
spotlightRouter.get("/regions", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const rows = await all<{ region: string; status: string; n: number }>(c.env.DB, `SELECT region, status, COUNT(*) AS n FROM spotlight_entries GROUP BY region, status`);
  return c.json(
    SPOTLIGHT_REGIONS.map((r) => ({
      ...r,
      published: rows.find((x) => x.region === r.slug && x.status === "published")?.n ?? 0,
      drafts: isAdmin ? (rows.find((x) => x.region === r.slug && x.status === "draft")?.n ?? 0) : 0,
    }))
  );
});

/** Entries, newest publication date first, without their full text.
 *  ?region=<slug> limits to one region. Non-admins only ever receive
 *  published entries. */
spotlightRouter.get("/", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const region = c.req.query("region");
  const where: string[] = [];
  const params: unknown[] = [];
  if (region) {
    if (!SPOTLIGHT_REGION_SLUGS.includes(region as (typeof SPOTLIGHT_REGION_SLUGS)[number])) return c.json({ error: "Unknown region" }, 400);
    where.push("region = ?");
    params.push(region);
  }
  if (!isAdmin) where.push("status = 'published'");
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT ${LIST_COLUMNS} FROM spotlight_entries ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY publication_date DESC, created_at DESC LIMIT 1000`,
    params
  );
  return c.json(rows.map(toEntry));
});

spotlightRouter.get("/:id", async (c) => {
  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM spotlight_entries WHERE id = ?`, [c.req.param("id")]);
  // A draft does not exist as far as a non-admin is concerned.
  if (!row || (row.status !== "published" && c.get("role") !== "admin")) return c.json({ error: "Not found" }, 404);
  return c.json(toEntry(row));
});

spotlightRouter.post("/", requireAdmin, async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: describeIssue(parsed.error) }, 400);
  const d = parsed.data;
  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO spotlight_entries
      (id, region, title, product_type, countries, summary, body, cover_image_url, link_url, link_label, author, publication_date, status, is_public, published_at, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      d.region,
      d.title,
      d.product_type,
      d.countries,
      d.summary,
      d.body,
      d.cover_image_url,
      d.link_url,
      d.link_label,
      d.author,
      d.publication_date ?? now.slice(0, 10),
      d.status,
      d.is_public ? 1 : 0,
      d.status === "published" ? now : null,
      c.get("userId"),
      now,
      now
    )
    .run();
  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM spotlight_entries WHERE id = ?`, [id]);
  return c.json(toEntry(row!), 201);
});

spotlightRouter.patch("/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const existing = await first<{ status: string; published_at: string | null }>(c.env.DB, `SELECT status, published_at FROM spotlight_entries WHERE id = ?`, [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: describeIssue(parsed.error) }, 400);

  const now = nowIso();
  const updates: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    updates.push(`${key} = ?`); // keys come from the schema above, never from the request
    params.push(key === "is_public" ? (value ? 1 : 0) : value);
  }
  // First time it goes live is when it was published; taking it down and
  // putting it back up does not rewrite that.
  if (parsed.data.status === "published" && !existing.published_at) {
    updates.push("published_at = ?");
    params.push(now);
  }
  updates.push("updated_at = ?");
  params.push(now, id);
  await c.env.DB.prepare(`UPDATE spotlight_entries SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();
  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM spotlight_entries WHERE id = ?`, [id]);
  return c.json(toEntry(row!));
});

spotlightRouter.delete("/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const existing = await first<{ id: string }>(c.env.DB, `SELECT id FROM spotlight_entries WHERE id = ?`, [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  await c.env.DB.prepare(`DELETE FROM spotlight_entries WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

/** The public link: no sign-in. Serves an entry only while it is BOTH
 *  published and marked public; anything else is "not found", so a link
 *  stops working the moment either switch is turned off. */
publicSpotlightRouter.get("/:id", async (c) => {
  await ensureSpotlightTable(c.env);
  const row = await first<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, region, title, product_type, countries, summary, body, cover_image_url, link_url, link_label, author, publication_date, published_at, updated_at
     FROM spotlight_entries WHERE id = ? AND status = 'published' AND is_public = 1`,
    [c.req.param("id")]
  );
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});
