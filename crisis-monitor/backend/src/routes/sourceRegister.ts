import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import { audit, clientIp } from "../lib/audit";
import { countryName, ensureRegister, KINDS, listRegister, regionOf, seedRegister, type SourceKind } from "../lib/sourceRegister";
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
});

sourceRegisterRouter.get("/", async (c) => {
  const entries = await listRegister(c.env);
  return c.json({
    kinds: KINDS,
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
  await run(c.env.DB, `INSERT INTO source_register (id, name, url, country, region, kind, role, notes, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
    id, d.name, d.url, d.country, regionOf(d.country), d.kind, d.role, d.notes ?? null, d.active === false ? 0 : 1, now, now,
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

/** Adds any default entry that is missing (never changes or removes yours). Useful after the platform adds a new feed. */
sourceRegisterRouter.post("/restore-defaults", async (c) => {
  await ensureRegister(c.env);
  const before = (await all<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM source_register"))[0]?.n ?? 0;
  await seedRegister(c.env);
  const after = (await all<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM source_register"))[0]?.n ?? 0;
  return c.json({ added: after - before });
});
