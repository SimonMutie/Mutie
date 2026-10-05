import { Hono } from "hono";
import { z } from "zod";
import { all, first, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import { SPOTLIGHT_REGIONS, SPOTLIGHT_REGION_SLUGS } from "../lib/spotlightRegions";
import { isSpotlightDoc, validateSpotlightDoc } from "../lib/spotlightDoc";
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
          updated_at TEXT NOT NULL,
          layout_width TEXT NOT NULL DEFAULT 'wide'
        )`
      ).run();
      await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_spotlight_region_date ON spotlight_entries (region, publication_date DESC)`).run();
      // The first version of this table had no layout_width. Add it where
      // it is missing; existing entries then read as 'wide'.
      try {
        await env.DB.prepare(`SELECT layout_width FROM spotlight_entries LIMIT 0`).all();
      } catch (err) {
        if (!String(err instanceof Error ? err.message : err).toLowerCase().includes("no such column")) throw err;
        await env.DB.prepare(`ALTER TABLE spotlight_entries ADD COLUMN layout_width TEXT NOT NULL DEFAULT 'wide'`).run();
      }
      // Images uploaded into articles (maps, infographics, photos). Held in
      // the database because the platform has no file storage attached;
      // each row stays under D1's 2 MB row limit (see MEDIA_MAX_BYTES).
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS spotlight_media (
          id TEXT PRIMARY KEY,
          mime TEXT NOT NULL,
          size INTEGER NOT NULL,
          data TEXT NOT NULL,
          created_by TEXT,
          created_at TEXT NOT NULL
        )`
      ).run();
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

const LIST_COLUMNS = "id, region, title, product_type, countries, summary, cover_image_url, link_url, link_label, author, publication_date, status, is_public, published_at, created_at, updated_at, layout_width";

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
  // Either a formatting-editor document (JSON, checked by bodyProblem below)
  // or the older plain text. Images are stored separately and referenced by
  // address, so even a long, heavily illustrated article stays far below this.
  body: optionalText(1_000_000),
  // How much of the page the article takes: a reading column, a wide
  // column, or the full width.
  layout_width: z.enum(["standard", "wide", "full"]),
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
  layout_width: entryFields.layout_width.default("wide"),
});

/** Why a body cannot be stored, or null when it can. */
function bodyProblem(body: string | null | undefined): string | null {
  if (!body || !isSpotlightDoc(body)) return null; // plain text is shown as text, never interpreted
  const problem = validateSpotlightDoc(body);
  return problem ? `Text ${problem}` : null;
}
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
  layout_width: "Page width",
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
  const problem = bodyProblem(d.body);
  if (problem) return c.json({ error: problem }, 400);
  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO spotlight_entries
      (id, region, title, product_type, countries, summary, body, cover_image_url, link_url, link_label, author, publication_date, status, is_public, published_at, created_by, created_at, updated_at, layout_width)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
      now,
      d.layout_width
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
  const problem = bodyProblem(parsed.data.body);
  if (problem) return c.json({ error: problem }, 400);

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

/* ── images ─────────────────────────────────────────────────────────── */

/** Per-image ceiling. Stored as base64 text, which is a third larger than
 *  the file, and one database row cannot exceed 2,000,000 bytes — so the
 *  file itself is capped comfortably below that. The editor shrinks larger
 *  pictures in the browser before uploading (see frontend imageUpload.ts). */
export const MEDIA_MAX_BYTES = 1_350_000;
const MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** What the file actually is, from its first bytes — the type the browser
 *  claims is not trusted. SVG is deliberately not accepted: it can carry
 *  script. */
function sniffImageType(bytes: Uint8Array): (typeof MEDIA_TYPES)[number] | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Upload one image (the request body is the file itself). Returns the
 *  path it is served from; the editor puts that address into the article. */
spotlightRouter.post("/media", requireAdmin, async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) return c.json({ error: "No image was received." }, 400);
  if (bytes.length > MEDIA_MAX_BYTES) return c.json({ error: `That image is too large to store (${(bytes.length / 1_000_000).toFixed(1)} MB; the limit is ${(MEDIA_MAX_BYTES / 1_000_000).toFixed(2)} MB).` }, 413);
  const mime = sniffImageType(bytes);
  if (!mime) return c.json({ error: "That file is not a PNG, JPEG, WebP or GIF image." }, 415);
  const id = newId();
  await c.env.DB.prepare(`INSERT INTO spotlight_media (id, mime, size, data, created_by, created_at) VALUES (?,?,?,?,?,?)`)
    .bind(id, mime, bytes.length, toBase64(bytes), c.get("userId"), nowIso())
    .run();
  return c.json({ id, path: `/api/public/spotlight/media/${id}`, mime, size: bytes.length }, 201);
});

/** Serves an uploaded image. No sign-in: a browser cannot send a session
 *  with an <img>, and a public article must be able to show its pictures.
 *  The address contains a random id that cannot be guessed, and nothing
 *  lists them. Never changes once stored, so it is cached for a year. */
publicSpotlightRouter.get("/media/:id", async (c) => {
  await ensureSpotlightTable(c.env);
  const row = await first<{ mime: string; data: string }>(c.env.DB, `SELECT mime, data FROM spotlight_media WHERE id = ?`, [c.req.param("id")]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return new Response(fromBase64(row.data), {
    headers: {
      "content-type": row.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
    },
  });
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
    `SELECT id, region, title, product_type, countries, summary, body, cover_image_url, link_url, link_label, author, publication_date, published_at, updated_at, layout_width
     FROM spotlight_entries WHERE id = ? AND status = 'published' AND is_public = 1`,
    [c.req.param("id")]
  );
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});
