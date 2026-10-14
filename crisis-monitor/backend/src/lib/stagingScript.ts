import { all, batchRun, first, nowIso } from "../db";
import type { Env } from "../bindings";
import { callStructured } from "./llm";
import { htmlToText } from "./telegram";
import type { StagedRow } from "../incidentStaging";

/**
 * The review script: a few Python-style lines an analyst writes to work through
 * the pending rows of the daily review. It is a fixed set of steps, not a
 * Python interpreter, and the AI is used only for the coding step.
 *
 *   # comments start with a hash
 *   for row in pending where country = "Sudan":
 *       open(row)
 *       code(row, taxonomy="Incident coding 2026")
 *       fill(row, severity="High")
 *       approve(row)
 *
 * Steps: open(row) fetches the article text from the row's link; code(row, taxonomy="NAME")
 * asks the AI to fill empty fields from a saved taxonomy; fill(row, field="value") sets
 * fields by hand; approve(row) and reject(row) set the status; print("text") writes to the log.
 *
 * Nothing is saved unless the run is applied. A preview shows exactly what would change.
 * Rows already pushed to the incidents table are never touched.
 */

export const STAGED_FIELDS = [
  "date", "time", "country", "province", "county", "district", "city", "suburb", "precise_location",
  "latitude", "longitude", "sector", "actor", "operation", "tactic", "severity", "details", "target",
  "interest_group", "actual_main_victim", "intended_primary_target", "civilian_death_child",
  "civilian_death_female", "civilian_death_male", "civilian_death_unknown", "civilian_injury_female",
  "civilian_injury_male", "civilian_injury_unknown", "kidnappings_ngo",
] as const satisfies readonly (keyof StagedRow)[];
const FIELD_SET = new Set<string>(STAGED_FIELDS);
const NUMERIC_FIELDS = new Set<string>(["latitude", "longitude", "kidnappings_ngo", "civilian_death_child", "civilian_death_female", "civilian_death_male", "civilian_death_unknown", "civilian_injury_female", "civilian_injury_male", "civilian_injury_unknown"]);

export const MAX_ROWS_PER_RUN = 200;
const MAX_OPENS_PER_RUN = 60;
const MAX_CODES_PER_RUN = 60;
const MAX_TAXONOMY_CHARS = 20_000;
const PAGE_TEXT_CHARS = 6_000;
const FETCH_TIMEOUT_MS = 8_000;

export type Step =
  | { op: "open" }
  | { op: "approve" }
  | { op: "reject" }
  | { op: "code"; taxonomy: string }
  | { op: "fill"; values: Record<string, string | number> }
  | { op: "print"; text: string };

export interface Block {
  line: number;
  filter: { field: string; value: string } | null;
  steps: { line: number; step: Step }[];
}

export type ParseResult = { ok: true; blocks: Block[] } | { ok: false; line: number; message: string };

const HEADER = /^for row in pending(?:\s+where\s+(\w+)\s*=\s*"([^"]*)")?\s*:$/;
const CALL = /^(\w+)\((.*)\)$/;
const KV = /(\w+)\s*=\s*(?:"([^"]*)"|(-?\d+(?:\.\d+)?))/g;

export function parseScript(src: string): ParseResult {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const raw = lines[i];
    const text = raw.trim();
    if (text === "" || text.startsWith("#")) continue;
    const indented = /^\s/.test(raw);
    if (!indented) {
      const h = HEADER.exec(text);
      if (!h) return { ok: false, line: n, message: 'Start a block with: for row in pending:  or  for row in pending where country = "Kenya":' };
      if (h[1] !== undefined && h[1] !== "status" && !FIELD_SET.has(h[1])) return { ok: false, line: n, message: `"${h[1]}" is not a field. Use a field name such as country, tactic or severity.` };
      if (current && current.steps.length === 0) return { ok: false, line: current.line, message: "This block has no steps under it." };
      current = { line: n, filter: h[1] ? { field: h[1], value: h[2] } : null, steps: [] };
      blocks.push(current);
      continue;
    }
    if (!current) return { ok: false, line: n, message: "An indented step must come under a for row in pending line." };
    const parsed = parseStep(text);
    if (!parsed.ok) return { ok: false, line: n, message: parsed.message };
    current.steps.push({ line: n, step: parsed.step });
  }
  if (blocks.length === 0) return { ok: false, line: 1, message: "The script is empty. Start with: for row in pending:" };
  if (current && current.steps.length === 0) return { ok: false, line: current.line, message: "This block has no steps under it." };
  return { ok: true, blocks };
}

function parseStep(text: string): { ok: true; step: Step } | { ok: false; message: string } {
  const m = CALL.exec(text);
  if (!m) return { ok: false, message: `Not a step: "${text}". Write a step such as open(row) or approve(row).` };
  const [, name, argsRaw] = m;
  const args = argsRaw.trim();
  const rowOnly = (): boolean => args === "row";
  switch (name) {
    case "open":
    case "approve":
    case "reject":
      if (!rowOnly()) return { ok: false, message: `${name}() takes only row: ${name}(row)` };
      return { ok: true, step: { op: name } };
    case "code": {
      const parts = args.split(",").map((s) => s.trim());
      if (parts[0] !== "row") return { ok: false, message: 'code() starts with row: code(row, taxonomy="NAME")' };
      const kv = Array.from(args.matchAll(KV));
      const tax = kv.find((k) => k[1] === "taxonomy");
      if (!tax || tax[2] === undefined) return { ok: false, message: 'code() needs a taxonomy name in quotes: code(row, taxonomy="NAME")' };
      return { ok: true, step: { op: "code", taxonomy: tax[2] } };
    }
    case "fill": {
      const parts = args.split(",").map((s) => s.trim());
      if (parts[0] !== "row" || parts.length < 2) return { ok: false, message: 'fill() looks like: fill(row, tactic="Airstrike", severity="High")' };
      const values: Record<string, string | number> = {};
      for (const k of Array.from(args.matchAll(KV))) {
        const field = k[1];
        if (!FIELD_SET.has(field)) return { ok: false, message: `fill() cannot set "${field}". It is not a field.` };
        values[field] = k[2] !== undefined ? k[2] : Number(k[3]);
      }
      if (Object.keys(values).length === 0) return { ok: false, message: 'fill() needs at least one field="value" pair.' };
      return { ok: true, step: { op: "fill", values } };
    }
    case "print": {
      const p = /^"([^"]*)"$/.exec(args);
      if (!p) return { ok: false, message: 'print() takes one quoted text: print("text")' };
      return { ok: true, step: { op: "print", text: p[1] } };
    }
    default:
      return { ok: false, message: `Unknown step "${name}". Use open, code, fill, approve, reject or print.` };
  }
}

export interface LogLine {
  level: "info" | "warn" | "error";
  text: string;
  row?: string;
}

export interface RowChange {
  id: string;
  batch_date: string;
  status_from: string;
  status_to: string;
  changed_fields: string[];
  row: Record<string, unknown>;
  source_url: string | null;
}

export interface ScriptResult {
  ok: boolean;
  applied: boolean;
  rows_seen: number;
  rows_changed: number;
  log: LogLine[];
  changes: RowChange[];
  error?: { line: number; message: string };
}

interface Item {
  id: string;
  batch_date: string;
  startStatus: string;
  status: string;
  source_url: string | null;
  original: Record<string, unknown>;
  row: Record<string, unknown>;
  text: string | null;
  opened: boolean;
}

export async function ensureTaxonomyTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS staging_taxonomies (name TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)`
  ).run();
}

export function validTaxonomyBody(body: unknown): body is string {
  return typeof body === "string" && body.trim().length > 0 && body.length <= MAX_TAXONOMY_CHARS;
}

export async function runScript(
  env: Env,
  src: string,
  opts: { apply: boolean; batchDate?: string; userId: string | null }
): Promise<ScriptResult> {
  const empty = (error?: { line: number; message: string }): ScriptResult => ({ ok: false, applied: false, rows_seen: 0, rows_changed: 0, log: [], changes: [], error });
  const parsed = parseScript(src);
  if (!parsed.ok) return empty({ line: parsed.line, message: parsed.message });

  // Every taxonomy the script names must exist before anything runs.
  const taxonomies = new Map<string, string>();
  for (const b of parsed.blocks) {
    for (const s of b.steps) {
      if (s.step.op !== "code" || taxonomies.has(s.step.taxonomy)) continue;
      await ensureTaxonomyTable(env);
      const t = await first<{ body: string }>(env.DB, `SELECT body FROM staging_taxonomies WHERE name = ?`, [s.step.taxonomy]);
      if (!t) return empty({ line: s.line, message: `No taxonomy called "${s.step.taxonomy}". Save it under Taxonomies first.` });
      taxonomies.set(s.step.taxonomy, t.body);
    }
  }

  const rows = await all<{ id: string; batch_date: string; status: string; row_json: string; source_url: string | null }>(
    env.DB,
    `SELECT id, batch_date, status, row_json, source_url FROM incident_staging
      WHERE status = 'pending' ${opts.batchDate ? "AND batch_date = ?" : ""}
      ORDER BY batch_date DESC, created_at LIMIT ?`,
    opts.batchDate ? [opts.batchDate, MAX_ROWS_PER_RUN] : [MAX_ROWS_PER_RUN]
  );
  const items: Item[] = rows.map((r) => {
    const row = JSON.parse(r.row_json) as Record<string, unknown>;
    return { id: r.id, batch_date: r.batch_date, startStatus: r.status, status: r.status, source_url: r.source_url, original: row, row: { ...row }, text: null, opened: false };
  });

  const log: LogLine[] = [];
  const say = (line: LogLine): void => {
    log.push(line);
  };
  const pageCache = new Map<string, string | null>();
  const counts = { opens: 0, codes: 0, aiStopped: false, seen: 0 };
  const changedFields = new Map<string, Set<string>>();
  const markChanged = (it: Item, field: string) => {
    if (!changedFields.has(it.id)) changedFields.set(it.id, new Set());
    changedFields.get(it.id)!.add(field);
  };

  for (const block of parsed.blocks) {
    const matches = items.filter((it) => it.status === "pending" && (!block.filter || matchesFilter(it, block.filter)));
    for (const it of matches) {
      if (counts.seen >= MAX_ROWS_PER_RUN) break;
      counts.seen++;
      for (const { step } of block.steps) {
        await execute(step, it);
      }
    }
  }

  async function execute(step: Step, it: Item): Promise<void> {
    const tag = it.id.slice(0, 8);
    switch (step.op) {
      case "open": {
        if (!it.source_url || !/^https?:\/\//.test(it.source_url)) return say({ level: "warn", row: tag, text: "open: no link on this row" });
        if (counts.opens >= MAX_OPENS_PER_RUN) return say({ level: "warn", row: tag, text: `open: stopped at ${MAX_OPENS_PER_RUN} links for one run` });
        counts.opens++;
        const text = await fetchPageText(it.source_url, pageCache);
        if (!text) return say({ level: "warn", row: tag, text: `open: could not read ${it.source_url}` });
        it.text = text;
        it.opened = true;
        return say({ level: "info", row: tag, text: `open: read ${text.length} characters` });
      }
      case "code": {
        const tax = taxonomies.get(step.taxonomy)!;
        if (!it.text) return say({ level: "warn", row: tag, text: "code: open(row) first, so there is text to code" });
        if (counts.aiStopped) return say({ level: "warn", row: tag, text: "code: AI not available for the rest of this run" });
        if (counts.codes >= MAX_CODES_PER_RUN) return say({ level: "warn", row: tag, text: `code: stopped at ${MAX_CODES_PER_RUN} codings for one run` });
        counts.codes++;
        const result = await codeWithAi(env, tax, it).catch(() => null);
        if (!result) {
          counts.aiStopped = true;
          return say({ level: "warn", row: tag, text: "code: no coding returned (today's AI allowance may be used up). Later rows will not be coded in this run." });
        }
        let filled = 0;
        for (const { field, value } of result.fields) {
          if (!FIELD_SET.has(field)) continue;
          const current = it.row[field];
          if (current !== null && current !== undefined && current !== "") continue; // coding never overwrites what is already there
          const v = NUMERIC_FIELDS.has(field) ? Number(value) : String(value).trim();
          if (NUMERIC_FIELDS.has(field) && !Number.isFinite(v as number)) continue;
          if (v === "") continue;
          it.row[field] = v;
          markChanged(it, field);
          filled++;
        }
        return say({ level: "info", row: tag, text: `code: filled ${filled} empty field${filled === 1 ? "" : "s"} from ${step.taxonomy}` });
      }
      case "fill": {
        for (const [field, value] of Object.entries(step.values)) {
          const v = NUMERIC_FIELDS.has(field) ? Number(value) : value;
          it.row[field] = v;
          markChanged(it, field);
        }
        return say({ level: "info", row: tag, text: `fill: ${Object.keys(step.values).join(", ")}` });
      }
      case "approve":
        it.status = "approved";
        return say({ level: "info", row: tag, text: "approve" });
      case "reject":
        it.status = "rejected";
        return say({ level: "info", row: tag, text: "reject" });
      case "print":
        return say({ level: "info", row: tag, text: step.text });
    }
  }

  // Compare each row with what it was when the run began.
  const changes: RowChange[] = [];
  for (const it of items) {
    const fields = Array.from(changedFields.get(it.id) ?? []);
    if (fields.length === 0 && it.status === it.startStatus) continue;
    changes.push({ id: it.id, batch_date: it.batch_date, status_from: it.startStatus, status_to: it.status, changed_fields: fields, row: it.row, source_url: it.source_url });
  }

  if (opts.apply && changes.length > 0) {
    const now = nowIso();
    await batchRun(
      env.DB,
      changes.map((c) => ({
        sql: `UPDATE incident_staging SET row_json = ?, status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ? AND status != 'pushed'`,
        params: [JSON.stringify(c.row), c.status_to, now, opts.userId, c.id],
      }))
    );
  }

  return {
    ok: true,
    applied: opts.apply,
    rows_seen: counts.seen,
    rows_changed: changes.length,
    log,
    changes,
  };
}

function matchesFilter(it: Item, f: { field: string; value: string }): boolean {
  const v = f.field === "status" ? it.status : it.row[f.field];
  return String(v ?? "").trim().toLowerCase() === f.value.trim().toLowerCase();
}

export async function fetchPageText(url: string, cache: Map<string, string | null>, maxChars = PAGE_TEXT_CHARS): Promise<string | null> {
  if (cache.has(url)) return cache.get(url)!;
  let text: string | null = null;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "TheLensReview/1.0 (analyst review; contact via the platform)", accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const html = await res.text();
      text = htmlToText(html).replace(/\s+\n/g, "\n").trim().slice(0, maxChars) || null;
    }
  } catch {
    text = null;
  }
  cache.set(url, text);
  return text;
}

const CODING_SCHEMA = {
  type: "object",
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: { field: { type: "string" }, value: { type: "string" } },
        required: ["field", "value"],
      },
    },
  },
  required: ["fields"],
};

async function codeWithAi(env: Env, taxonomy: string, it: Item): Promise<{ fields: { field: string; value: string }[] } | null> {
  const system =
    "You code one reported security incident for an analyst's spreadsheet. Use only the taxonomy below. " +
    "Return a field only when the article states it. Never guess, and leave out anything the text does not support. " +
    "Use the field names exactly as listed.";
  const user =
    `TAXONOMY:\n${taxonomy}\n\n` +
    `FIELDS YOU MAY FILL: ${STAGED_FIELDS.join(", ")}\n\n` +
    `ROW SO FAR: ${JSON.stringify(Object.fromEntries(Object.entries(it.row).filter(([, v]) => v !== null && v !== "")))}\n\n` +
    `ARTICLE:\n${it.text}`;
  const result = await callStructured<{ fields: { field: string; value: string }[] }>(env, {
    role: "coder",
    system,
    user,
    schema: CODING_SCHEMA,
    toolName: "record_coding",
    toolDescription: "Record the coding of this incident against the taxonomy.",
    maxTokens: 800,
  });
  if (!result || !result.data || !Array.isArray(result.data.fields)) return null;
  return result.data;
}
