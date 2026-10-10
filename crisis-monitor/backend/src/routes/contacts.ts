import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import { audit, clientIp } from "../lib/audit";
import { cleanDestination } from "../lib/notify";
import { ensureContactTables } from "../lib/contacts";
import type { Env } from "../bindings";

/** Contact groups and the contacts in them. Platform admin only. */
export const contactsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
contactsRouter.use("*", requireAuth, requireAdmin);

const MAX_CONTACTS = 5000;

const groupSchema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).nullable().optional() });
const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  organisation: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().max(254).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  active: z.boolean().optional(),
  group_ids: z.array(z.string()).max(50).optional(),
});

/** Checks the email and phone; returns the cleaned pair or an error message. */
function cleanPair(email?: string | null, phone?: string | null): { email: string | null; phone: string | null } | string {
  let e: string | null = null;
  let p: string | null = null;
  if (email) {
    e = cleanDestination("email", email);
    if (!e) return `"${email}" is not a valid email address.`;
  }
  if (phone) {
    p = cleanDestination("sms", phone);
    if (!p) return `"${phone}" is not a valid phone number. Use the country code, like +254712345678.`;
  }
  if (!e && !p) return "Give an email address or a phone number.";
  return { email: e, phone: p };
}

contactsRouter.get("/groups", async (c) => {
  await ensureContactTables(c.env);
  const rows = await all(
    c.env.DB,
    `SELECT g.id, g.name, g.description, g.created_at, COUNT(c.id) AS members
       FROM contact_groups g LEFT JOIN contact_group_members m ON m.group_id = g.id LEFT JOIN contacts c ON c.id = m.contact_id AND c.active = 1
      GROUP BY g.id ORDER BY g.name`
  );
  return c.json(rows);
});

contactsRouter.post("/groups", async (c) => {
  await ensureContactTables(c.env);
  const parsed = groupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Give the group a name (2 to 80 characters)." }, 400);
  if (await first(c.env.DB, "SELECT id FROM contact_groups WHERE lower(name) = lower(?)", [parsed.data.name])) return c.json({ error: "A group with that name already exists." }, 409);
  const id = newId();
  await run(c.env.DB, "INSERT INTO contact_groups (id, name, description, created_at) VALUES (?,?,?,?)", [id, parsed.data.name, parsed.data.description ?? null, nowIso()]);
  await audit(c.env, { userId: c.get("userId"), action: "contacts.group_created", detail: parsed.data.name, ip: clientIp(c.req) });
  return c.json({ id, name: parsed.data.name, description: parsed.data.description ?? null, members: 0 }, 201);
});

contactsRouter.patch("/groups/:id", async (c) => {
  await ensureContactTables(c.env);
  const parsed = groupSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the name." }, 400);
  const g = await first<{ name: string; description: string | null }>(c.env.DB, "SELECT name, description FROM contact_groups WHERE id = ?", [c.req.param("id")]);
  if (!g) return c.json({ error: "Not found" }, 404);
  const name = parsed.data.name ?? g.name;
  const clash = await first(c.env.DB, "SELECT id FROM contact_groups WHERE lower(name) = lower(?) AND id != ?", [name, c.req.param("id")]);
  if (clash) return c.json({ error: "A group with that name already exists." }, 409);
  await run(c.env.DB, "UPDATE contact_groups SET name = ?, description = ? WHERE id = ?", [name, parsed.data.description === undefined ? g.description : parsed.data.description, c.req.param("id")]);
  return c.json({ ok: true });
});

contactsRouter.delete("/groups/:id", async (c) => {
  await ensureContactTables(c.env);
  await run(c.env.DB, "DELETE FROM contact_group_members WHERE group_id = ?", [c.req.param("id")]);
  await run(c.env.DB, "DELETE FROM contact_groups WHERE id = ?", [c.req.param("id")]);
  await audit(c.env, { userId: c.get("userId"), action: "contacts.group_deleted", detail: c.req.param("id"), ip: clientIp(c.req) });
  return c.json({ ok: true });
});

/** Contacts, optionally those in one group or matching a search. */
contactsRouter.get("/", async (c) => {
  await ensureContactTables(c.env);
  const group = c.req.query("group_id");
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const where: string[] = [];
  const params: unknown[] = [];
  if (group) {
    where.push("c.id IN (SELECT contact_id FROM contact_group_members WHERE group_id = ?)");
    params.push(group);
  }
  if (q) {
    where.push("(lower(c.name) LIKE ? OR lower(COALESCE(c.email,'')) LIKE ? OR COALESCE(c.phone,'') LIKE ? OR lower(COALESCE(c.organisation,'')) LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = await all<Record<string, unknown> & { id: string }>(c.env.DB, `SELECT c.* FROM contacts c ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY c.name LIMIT 1000`, params);
  const memberships = await all<{ contact_id: string; group_id: string }>(c.env.DB, "SELECT contact_id, group_id FROM contact_group_members");
  const byContact = new Map<string, string[]>();
  for (const m of memberships) byContact.set(m.contact_id, [...(byContact.get(m.contact_id) ?? []), m.group_id]);
  return c.json(rows.map((r) => ({ ...r, active: !!r.active, group_ids: byContact.get(r.id) ?? [] })));
});

async function setGroups(env: Env, contactId: string, groupIds: string[]) {
  await run(env.DB, "DELETE FROM contact_group_members WHERE contact_id = ?", [contactId]);
  for (const g of groupIds) await run(env.DB, "INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?,?)", [g, contactId]);
}

contactsRouter.post("/", async (c) => {
  await ensureContactTables(c.env);
  const parsed = contactSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the name, email and phone." }, 400);
  const d = parsed.data;
  const pair = cleanPair(d.email, d.phone);
  if (typeof pair === "string") return c.json({ error: pair }, 400);
  const count = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM contacts");
  if ((count?.n ?? 0) >= MAX_CONTACTS) return c.json({ error: `The contact book is full (${MAX_CONTACTS}).` }, 400);
  const id = newId();
  await run(c.env.DB, "INSERT INTO contacts (id, name, organisation, email, phone, notes, active, created_at) VALUES (?,?,?,?,?,?,1,?)", [id, d.name, d.organisation ?? null, pair.email, pair.phone, d.notes ?? null, nowIso()]);
  if (d.group_ids?.length) await setGroups(c.env, id, d.group_ids);
  return c.json({ id }, 201);
});

contactsRouter.patch("/:id", async (c) => {
  await ensureContactTables(c.env);
  const cur = await first<{ name: string; organisation: string | null; email: string | null; phone: string | null; notes: string | null; active: number }>(c.env.DB, "SELECT * FROM contacts WHERE id = ?", [c.req.param("id")]);
  if (!cur) return c.json({ error: "Not found" }, 404);
  const parsed = contactSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the values." }, 400);
  const d = parsed.data;
  const pair = cleanPair(d.email === undefined ? cur.email : d.email, d.phone === undefined ? cur.phone : d.phone);
  if (typeof pair === "string") return c.json({ error: pair }, 400);
  await run(c.env.DB, "UPDATE contacts SET name = ?, organisation = ?, email = ?, phone = ?, notes = ?, active = ? WHERE id = ?", [
    d.name ?? cur.name, d.organisation === undefined ? cur.organisation : d.organisation, pair.email, pair.phone, d.notes === undefined ? cur.notes : d.notes, d.active === undefined ? cur.active : d.active ? 1 : 0, c.req.param("id"),
  ]);
  if (d.group_ids) await setGroups(c.env, c.req.param("id"), d.group_ids);
  return c.json({ ok: true });
});

contactsRouter.delete("/:id", async (c) => {
  await ensureContactTables(c.env);
  await run(c.env.DB, "DELETE FROM contact_group_members WHERE contact_id = ?", [c.req.param("id")]);
  await run(c.env.DB, "DELETE FROM contacts WHERE id = ?", [c.req.param("id")]);
  return c.json({ ok: true });
});

/**
 * Bulk add from pasted lines: "Name, email, phone, organisation" per line (any of email/phone may be empty,
 * and a header row is ignored). People already in the book (same email or phone) are reused, not duplicated,
 * and added to the group if one is given.
 */
contactsRouter.post("/import", async (c) => {
  await ensureContactTables(c.env);
  const parsed = z.object({ text: z.string().min(3).max(300_000), group_id: z.string().nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Paste at least one line." }, 400);
  if (parsed.data.group_id && !(await first(c.env.DB, "SELECT id FROM contact_groups WHERE id = ?", [parsed.data.group_id]))) return c.json({ error: "That group no longer exists." }, 404);
  const lines = parsed.data.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 2000) return c.json({ error: "Import up to 2000 lines at a time." }, 400);
  let added = 0;
  let reused = 0;
  const rejected: { line: string; reason: string }[] = [];
  for (const line of lines) {
    const cells = line.split(/[,\t;]/).map((x) => x.trim().replace(/^"|"$/g, ""));
    if (/^name$/i.test(cells[0] ?? "")) continue; // header
    const [name, email, phone, organisation] = cells;
    const pair = cleanPair(email || null, phone || null);
    if (typeof pair === "string") {
      rejected.push({ line: line.slice(0, 80), reason: pair });
      continue;
    }
    const existing = await first<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE (? IS NOT NULL AND lower(email) = ?) OR (? IS NOT NULL AND phone = ?)", [pair.email, pair.email, pair.phone, pair.phone]);
    let id = existing?.id;
    if (id) reused++;
    else {
      id = newId();
      await run(c.env.DB, "INSERT INTO contacts (id, name, organisation, email, phone, active, created_at) VALUES (?,?,?,?,?,1,?)", [id, name || pair.email || pair.phone, organisation || null, pair.email, pair.phone, nowIso()]);
      added++;
    }
    if (parsed.data.group_id) await run(c.env.DB, "INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?,?)", [parsed.data.group_id, id]);
  }
  await audit(c.env, { userId: c.get("userId"), action: "contacts.imported", detail: `${added} new, ${reused} existing, ${rejected.length} rejected`, ip: clientIp(c.req) });
  return c.json({ added, reused, rejected: rejected.slice(0, 50), rejected_total: rejected.length });
});
