import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import { audit, clientIp } from "../lib/audit";
import { countryName, ensureRegister, KINDS, listRegister, regionOf, seedRegister, checkNextLinks, assessmentFor, OWNERSHIP_LABEL, RELIABILITY_LABEL, type SourceKind } from "../lib/sourceRegister";
import type { Env } from "../bindings";

/**
 * The Sources Register. Platform super admin only: it is the admin's own
 * reference for answering "what are your sources?", not something clients
 * browse themselves.
 */
export const sourceRegisterRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
sourceRegisterRouter.use("*", requireAuth, requireAdmin);

const kinds = Object.keys(KINDS) as [SourceKind, ...SourceKind[]];

const entrySchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), "Use a web link starting with http:// or https://"),
  country: z.string().trim().min(2).max(5).transform((s) => s.toUpperCase()),
  kind: z.enum(kinds),
  role: z.enum(["pulled", "reference"]),
  notes: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
  reliability: z.enum(["A", "B", "C", "D", "E", "F"]).optional(),
  ownership: z.enum(Object.keys(OWNERSHIP_LABEL) as [string, ...string[]]).optional(),
  orientation: z.string().trim().max(200).nullable().optional(),
  rating_note: z.string().trim().max(500).nullable().optional(),
  language: z.string().trim().max(60).nullable().optional(),
});

/** Who is rating: the signed-in admin's login name. */
async function raterName(c: { env: Env; get: (k: "userId") => string }): Promise<string> {
  const u = await first<{ username: string }>(c.env.DB, "SELECT username FROM users WHERE id = ?", [c.get("userId")]);
  return u?.username ?? "admin";
}

sourceRegisterRouter.get("/", async (c) => {
  const entries = await listRegister(c.env);
  return c.json({
    kinds: KINDS,
    reliability_labels: RELIABILITY_LABEL,
    ownership_labels: OWNERSHIP_LABEL,
    entries: entries.map((e) => ({ ...e, active: !!e.active, country_name: countryName(e.country) })),
  });
});

sourceRegisterRouter.post("/", async (c) => {
  await ensureRegister(c.env);
  const parsed = entrySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the name and link, and that the country is a two-letter code (or PAN, INT, INST, DATA)." }, 400);
  const d = parsed.data;
  const dup = await first<{ id: string }>(c.env.DB, "SELECT id FROM source_register WHERE lower(url) = lower(?)", [d.url]);
  if (dup) return c.json({ error: "That link is already in the register." }, 409);
  const id = newId();
  const now = nowIso();
  const base = assessmentFor(d.url, d.kind);
  const rated = d.reliability !== undefined || d.ownership !== undefined || d.orientation !== undefined || d.rating_note !== undefined;
  const who = rated ? await raterName(c) : null;
  await run(c.env.DB, `INSERT INTO source_register (id, name, url, country, region, kind, role, notes, reliability, ownership, orientation, rating_note, rating_basis, rated_by, rated_at, language, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    id, d.name, d.url, d.country, regionOf(d.country), d.kind, d.role, d.notes ?? null,
    d.reliability ?? base.reliability, d.ownership ?? base.ownership, d.orientation ?? base.orientation, d.rating_note ?? base.rating_note,
    rated ? "reviewed" : base.rating_basis, rated ? who : base.rating_basis === "desk" ? "Afrilens desk baseline" : null, rated || base.rating_basis === "desk" ? now : null,
    d.language ?? null, d.active === false ? 0 : 1, now, now,
  ]);
  await audit(c.env, { userId: c.get("userId"), action: "sources.added", detail: `${d.name} (${d.country})`, ip: clientIp(c.req) });
  const row = await first<Record<string, unknown>>(c.env.DB, "SELECT * FROM source_register WHERE id = ?", [id]);
  return c.json({ ...row, active: !!row!.active, country_name: countryName(d.country) }, 201);
});

sourceRegisterRouter.patch("/:id", async (c) => {
  await ensureRegister(c.env);
  const id = c.req.param("id");
  const existing = await first<{ id: string }>(c.env.DB, "SELECT id FROM source_register WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const parsed = entrySchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the values and try again." }, 400);
  const d = parsed.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    params.push(v);
  };
  if (d.name !== undefined) add("name", d.name);
  if (d.url !== undefined) {
    const dup = await first<{ id: string }>(c.env.DB, "SELECT id FROM source_register WHERE lower(url) = lower(?) AND id != ?", [d.url, id]);
    if (dup) return c.json({ error: "That link is already in the register." }, 409);
    add("url", d.url);
  }
  if (d.country !== undefined) {
    add("country", d.country);
    add("region", regionOf(d.country));
  }
  if (d.kind !== undefined) add("kind", d.kind);
  if (d.role !== undefined) add("role", d.role);
  if (d.notes !== undefined) add("notes", d.notes);
  if (d.active !== undefined) add("active", d.active ? 1 : 0);
  if (d.reliability !== undefined) add("reliability", d.reliability);
  if (d.ownership !== undefined) add("ownership", d.ownership);
  if (d.orientation !== undefined) add("orientation", d.orientation);
  if (d.rating_note !== undefined) add("rating_note", d.rating_note);
  if (d.language !== undefined) add("language", d.language);
  if (d.reliability !== undefined || d.ownership !== undefined || d.orientation !== undefined || d.rating_note !== undefined) {
    add("rating_basis", "reviewed");
    add("rated_by", await raterName(c));
    add("rated_at", nowIso());
  }
  if (sets.length === 0) return c.json({ error: "Nothing to update" }, 400);
  add("updated_at", nowIso());
  params.push(id);
  await run(c.env.DB, `UPDATE source_register SET ${sets.join(", ")} WHERE id = ?`, params);
  await audit(c.env, { userId: c.get("userId"), action: "sources.updated", detail: id, ip: clientIp(c.req) });
  const row = await first<Record<string, unknown>>(c.env.DB, "SELECT * FROM source_register WHERE id = ?", [id]);
  return c.json({ ...row, active: !!row!.active, country_name: countryName(String(row!.country)) });
});

sourceRegisterRouter.delete("/:id", async (c) => {
  await ensureRegister(c.env);
  await run(c.env.DB, "DELETE FROM source_register WHERE id = ?", [c.req.param("id")]);
  await audit(c.env, { userId: c.get("userId"), action: "sources.removed", detail: c.req.param("id"), ip: clientIp(c.req) });
  return c.json({ ok: true });
});

/** Opens the next batch of links and records which are alive. Call repeatedly until "remaining" is 0. */
sourceRegisterRouter.post("/check-links", async (c) => {
  // A check from the last 20 minutes counts as fresh, so one full run does not loop forever.
  const staleBefore = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const r = await checkNextLinks(c.env, 20, staleBefore);
  return c.json(r);
});

/** Adds any default entry that is missing (never changes or removes yours). Useful after the platform adds a new feed. */
sourceRegisterRouter.post("/restore-defaults", async (c) => {
  await ensureRegister(c.env);
  const before = (await all<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM source_register"))[0]?.n ?? 0;
  await seedRegister(c.env);
  const after = (await all<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM source_register"))[0]?.n ?? 0;
  return c.json({ added: after - before });
});
