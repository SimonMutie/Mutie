import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import type { Env } from "../bindings";
import { callStructured } from "./llm";

/**
 * The Analyst Notebook's analytical summary: one editable written reading of
 * a query's dashboard, kept per query and shared with everyone who can open
 * it. A draft is written by the analyst model from the figures, stories,
 * alerts and notes the dashboard holds for the chosen period; the analyst
 * then edits it freely. A redraft keeps the text it replaced, so nothing an
 * analyst wrote is lost to one click.
 *
 * The model never supplies links. It cites stories by number, and the
 * Sources list at the foot is built here from the stories it was given.
 */

export const NOTEBOOK_MAX = 20_000;
const DEFAULT_DRAFTS_PER_DAY = 30;
const COOLDOWN_SECONDS = 20;

// ── Storage ──────────────────────────────────────────────────────────────

let ready = false;
export function resetNotebookTableCheck(): void {
  ready = false;
}
export async function ensureNotebookTables(env: Env): Promise<void> {
  if (ready) return;
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS query_notebooks (
      query_id TEXT PRIMARY KEY,
      body TEXT NOT NULL DEFAULT '',
      previous_body TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      model TEXT,
      period_from TEXT,
      period_to TEXT,
      generated_at TEXT,
      updated_at TEXT NOT NULL,
      updated_by_name TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS query_notebook_log (id INTEGER PRIMARY KEY AUTOINCREMENT, query_id TEXT NOT NULL, created_at TEXT NOT NULL)`,
  ]) await env.DB.prepare(sql).run();
  ready = true;
}

export interface NotebookRow {
  query_id: string;
  body: string;
  previous_body: string | null;
  source: "ai" | "manual";
  model: string | null;
  period_from: string | null;
  period_to: string | null;
  generated_at: string | null;
  updated_at: string;
  updated_by_name: string | null;
}

export async function getNotebook(env: Env, queryId: string): Promise<NotebookRow | null> {
  await ensureNotebookTables(env);
  return first<NotebookRow>(env.DB, "SELECT * FROM query_notebooks WHERE query_id = ?", [queryId]);
}

export type SaveResult = { ok: true; row: NotebookRow } | { ok: false; status: 409; error: string };

/** Saves the analyst's own text. `expected` is the updated_at they were looking at; if someone else saved since, it is refused rather than overwritten. */
export async function saveNotebook(env: Env, queryId: string, body: string, expected: string | null, authorName: string | null): Promise<SaveResult> {
  const existing = await getNotebook(env, queryId);
  if (existing && expected !== null && existing.updated_at !== expected) return { ok: false, status: 409, error: "Someone else changed this summary while you were editing. Reload it to see their version before saving." };
  const now = nowIso();
  await run(
    env.DB,
    `INSERT INTO query_notebooks (query_id, body, source, updated_at, updated_by_name) VALUES (?,?,?,?,?)
     ON CONFLICT(query_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, updated_by_name = excluded.updated_by_name,
       source = CASE WHEN query_notebooks.body = excluded.body THEN query_notebooks.source ELSE 'manual' END`,
    [queryId, body, existing?.source ?? "manual", now, authorName]
  );
  return { ok: true, row: (await getNotebook(env, queryId))! };
}

export async function restorePrevious(env: Env, queryId: string, authorName: string | null): Promise<NotebookRow | null> {
  const existing = await getNotebook(env, queryId);
  if (!existing?.previous_body) return null;
  await run(env.DB, "UPDATE query_notebooks SET body = ?, previous_body = ?, source = 'manual', updated_at = ?, updated_by_name = ? WHERE query_id = ?", [existing.previous_body, existing.body, nowIso(), authorName, queryId]);
  return getNotebook(env, queryId);
}

// ── What the model is shown ──────────────────────────────────────────────

const s = (max: number) => z.string().max(max);
const labelled = z.array(z.object({ label: s(120), count: z.number().finite() })).max(15);

export const digestSchema = z.object({
  periodLabel: s(80),
  from: s(40),
  to: s(40),
  total: z.number().finite(),
  previousTotal: z.number().finite().nullable().optional(),
  perDay: z.number().finite().nullable().optional(),
  busiest: s(120).nullable().optional(),
  negativePct: z.number().finite().nullable().optional(),
  previousNegativePct: z.number().finite().nullable().optional(),
  watch: z.object({ last24h: z.number().finite(), usual: z.number().finite(), state: s(20) }).nullable().optional(),
  alerts: z.array(z.object({ title: s(200), description: s(500) })).max(10),
  incidents: z
    .array(z.object({ level: s(20), headline: s(240), place: s(160), summary: s(700), criteriaMet: z.array(s(240)).max(8), preliminary: z.boolean(), fatalitiesMax: z.number().finite().nullable().optional() }))
    .max(8),
  stories: z
    .array(z.object({ title: s(240), url: s(600).nullable(), outlets: z.number().finite(), items: z.number().finite(), place: s(120).nullable(), first: s(40), last: s(40), sources: z.array(s(80)).max(6) }))
    .max(12),
  names: labelled,
  rising: z.array(z.object({ label: s(120), recent: z.number().finite(), earlier: z.number().finite(), fresh: z.boolean().optional() })).max(10),
  topics: labelled,
  places: labelled,
  outlets: labelled,
  sourceMixNote: s(500).nullable().optional(),
});
export type Digest = z.infer<typeof digestSchema>;

const webUrl = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);

export function digestText(d: Digest, notes: { day: string; body: string }[]): string {
  const list = (xs: { label: string; count: number }[]) => xs.map((x) => `${x.label} (${x.count})`).join(", ");
  const out: string[] = [];
  out.push(`PERIOD: ${d.periodLabel} (${d.from.slice(0, 10)} to ${d.to.slice(0, 10)})`);
  out.push(`ITEMS COLLECTED: ${d.total}${d.previousTotal != null ? ` (previous period: ${d.previousTotal})` : ""}${d.perDay != null ? `; about ${d.perDay} a day` : ""}${d.busiest ? `; busiest: ${d.busiest}` : ""}`);
  if (d.negativePct != null) out.push(`TONE: ${d.negativePct}% negative${d.previousNegativePct != null ? ` (previous period ${d.previousNegativePct}%)` : ""}; estimated from the wording only`);
  if (d.watch) out.push(`LAST 24 HOURS: ${d.watch.last24h} items against a usual day of about ${d.watch.usual} (${d.watch.state})`);
  if (d.alerts.length) out.push(`OPEN PLATFORM ALERTS (counts of reporting, not confirmed events):\n${d.alerts.map((a) => `- ${a.title}: ${a.description}`).join("\n")}`);
  if (d.incidents.length)
    out.push(
      `ESCALATION INCIDENTS MATCHING THIS QUERY (coded from articles against written criteria):\n${d.incidents
        .map((i) => `- ${i.level.toUpperCase()} · ${i.place}: ${i.headline}. ${i.summary} Criteria: ${i.criteriaMet.join("; ") || "n/a"}.${i.fatalitiesMax ? ` Up to ${i.fatalitiesMax} reported killed.` : ""}${i.preliminary ? " PRELIMINARY: headlines only." : ""}`)
        .join("\n")}`
    );
  if (d.stories.length)
    out.push(`TOP STORIES (reports of one event grouped; cite by number):\n${d.stories.map((st, k) => `[${k + 1}] ${st.title} — ${st.outlets} outlet${st.outlets === 1 ? "" : "s"}, ${st.items} report${st.items === 1 ? "" : "s"}, ${st.first.slice(0, 10)} to ${st.last.slice(0, 10)}${st.place ? `, ${st.place}` : ""}${st.sources.length ? ` (${st.sources.join(", ")})` : ""}`).join("\n")}`);
  if (d.names.length) out.push(`NAMES MOST WRITTEN: ${list(d.names)}`);
  if (d.rising.length) out.push(`RISING IN THE LATER HALF: ${d.rising.map((r) => `${r.label} (${r.recent}, ${r.fresh ? "new" : `was ${r.earlier}`})`).join(", ")}`);
  if (d.topics.length) out.push(`RECURRING TOPICS: ${list(d.topics)}`);
  if (d.places.length) out.push(`PLACES NAMED: ${list(d.places)}`);
  if (d.outlets.length) out.push(`OUTLETS WITH MOST REPORTS: ${list(d.outlets)}`);
  if (d.sourceMixNote) out.push(`SOURCE MIX: ${d.sourceMixNote}`);
  if (notes.length) out.push(`ANALYST NOTES (written by the team, dated):\n${notes.map((n) => `- ${n.day}: ${n.body}`).join("\n")}`);
  return out.join("\n\n");
}

// ── The draft ────────────────────────────────────────────────────────────

const SYSTEM = `You are a senior conflict analyst at an African security consultancy writing the analytical summary at the head of a client's monitoring dashboard. You are given the dashboard's figures, top stories, platform alerts, escalation incidents and the team's own dated notes for one period.

Write an interpretive reading, not a recap of the numbers:
- "bottom_line": two or three sentences. What is the main development, and what does it mean?
- "developments": four to six items, each one concrete development (who, what, where, when), most important first. Cite the top-story numbers it rests on in "sources". A development with no story behind it (for example from an incident or an analyst note) has an empty list.
- "analysis": one or two short paragraphs. Explain what is driving the picture, how the developments connect or conflict, who benefits or is exposed, and what the pattern suggests. Say where you are inferring.
- "watch": three or four specific things to watch next, each a short sentence naming a place, actor or indicator.
- "caveats": two or three sentences on the limits: how firm the evidence is, single-outlet or headline-only claims, preliminary incidents, small counts, tone read from wording only.

Rules: use only what is given; add no outside facts or background. Counts are counts of REPORTING, never evidence that events increased. Call something an "escalation" only if an incident above is coded as one. If the analyst notes add context or contradict the data, say so. Name places and actors as the material does. No preamble, no bullet characters inside fields, plain text, do not put bracketed numbers anywhere except in "sources".`;

const SCHEMA = {
  type: "object",
  properties: {
    bottom_line: { type: "string" },
    developments: { type: "array", items: { type: "object", properties: { text: { type: "string" }, sources: { type: "array", items: { type: "integer" } } }, required: ["text", "sources"] } },
    analysis: { type: "string" },
    watch: { type: "array", items: { type: "string" } },
    caveats: { type: "string" },
  },
  required: ["bottom_line", "developments", "analysis", "watch", "caveats"],
};

const tidy = (t: unknown) => String(t ?? "").replace(/\s*\[\d+\]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

interface ModelDraft {
  bottom_line?: string;
  developments?: { text?: string; sources?: unknown[] }[];
  analysis?: string;
  watch?: unknown[];
  caveats?: string;
}

/** The notebook text: headings, bullets and a numbered Sources list, in plain text that stays easy to edit. */
export function composeNotebook(m: ModelDraft, stories: Digest["stories"], heading: string): string | null {
  const bottom = tidy(m.bottom_line);
  const analysis = tidy(m.analysis);
  if (bottom.length < 40 || analysis.length < 40) return null;
  const developments = (m.developments ?? [])
    .map((d) => ({ text: tidy(d?.text), sources: [...new Set((d?.sources ?? []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= stories.length))].sort((a, b) => a - b) }))
    .filter((d) => d.text.length >= 15)
    .slice(0, 6);
  if (developments.length === 0) return null;
  const watch = (m.watch ?? []).map(tidy).filter((w) => w.length >= 8).slice(0, 5);
  const caveats = tidy(m.caveats);
  const cited = [...new Set(developments.flatMap((d) => d.sources))].sort((a, b) => a - b);

  const lines: string[] = [`## Bottom line (${heading})`, bottom, "", "## Key developments"];
  for (const d of developments) lines.push(`- ${d.text}${d.sources.length ? ` [${d.sources.join("][")}]` : ""}`);
  lines.push("", "## Analysis", analysis);
  if (watch.length) lines.push("", "## What to watch", ...watch.map((w) => `- ${w}`));
  if (caveats) lines.push("", "## Confidence and gaps", caveats);
  if (cited.length) {
    lines.push("", "## Sources");
    for (const n of cited) {
      const st = stories[n - 1];
      lines.push(`[${n}] ${st.title}${st.sources.length ? ` (${st.sources.slice(0, 3).join(", ")})` : ""}${webUrl(st.url) ? ` ${st.url}` : ""}`);
    }
  }
  return lines.join("\n");
}

export type DraftResult = { ok: true; row: NotebookRow } | { ok: false; status: 429 | 502; error: string };

export async function draftNotebook(env: Env, query: { id: string; name: string; boolean_query: string }, digest: Digest, authorName: string | null): Promise<DraftResult> {
  await ensureNotebookTables(env);
  const since = new Date(Date.now() - COOLDOWN_SECONDS * 1000).toISOString();
  const recent = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM query_notebook_log WHERE query_id = ? AND created_at > ?", [query.id, since]);
  if (Number(recent?.n ?? 0) > 0) return { ok: false, status: 429, error: "A draft was only just written. Give it a few seconds." };
  const cap = Math.max(0, Number(env.NOTEBOOK_DRAFTS_PER_DAY ?? DEFAULT_DRAFTS_PER_DAY) || 0);
  const today = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM query_notebook_log WHERE created_at >= ?", [`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`]);
  if (Number(today?.n ?? 0) >= cap) return { ok: false, status: 429, error: `Today's ${cap} AI drafts have been used. More can be written after 03:00 Nairobi time (00:00 UTC).` };

  const notes = await all<{ day: string; body: string }>(env.DB, "SELECT day, body FROM query_notes WHERE query_id = ? AND day >= ? AND day <= ? ORDER BY day LIMIT 20", [query.id, digest.from.slice(0, 10), digest.to.slice(0, 10)]).catch(() => []);
  await run(env.DB, "INSERT INTO query_notebook_log (query_id, created_at) VALUES (?,?)", [query.id, nowIso()]);

  const user = `MONITORING QUERY: ${query.name}\nQUERY SYNTAX: ${query.boolean_query.slice(0, 300)}\n\n${digestText(digest, notes)}`;
  const result = await callStructured<ModelDraft>(env, { role: "analyst", system: SYSTEM, user, schema: SCHEMA as unknown as Record<string, unknown>, toolName: "record_summary", toolDescription: "Record the analytical summary.", maxTokens: 1500 }).catch(() => null);
  const body = result ? composeNotebook(result.data, digest.stories, digest.periodLabel.replace(/^the /, "")) : null;
  if (!result || !body) return { ok: false, status: 502, error: "The AI did not return a usable draft just now. Most likely today's free AI allowance is used up; it resets at 03:00 Nairobi time (00:00 UTC). Your existing text is unchanged." };

  const existing = await getNotebook(env, query.id);
  const now = nowIso();
  await run(
    env.DB,
    `INSERT INTO query_notebooks (query_id, body, previous_body, source, model, period_from, period_to, generated_at, updated_at, updated_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(query_id) DO UPDATE SET body = excluded.body, previous_body = excluded.previous_body, source = 'ai', model = excluded.model,
       period_from = excluded.period_from, period_to = excluded.period_to, generated_at = excluded.generated_at, updated_at = excluded.updated_at, updated_by_name = excluded.updated_by_name`,
    [query.id, body, existing?.body?.trim() ? existing.body : (existing?.previous_body ?? null), "ai", result.model, digest.from, digest.to, now, now, authorName]
  );
  return { ok: true, row: (await getNotebook(env, query.id))! };
}
