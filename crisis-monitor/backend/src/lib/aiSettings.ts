import type { Env } from "../bindings";

/**
 * How the platform reads with AI, set by an admin in Settings (routes/aiSettings.ts) and kept in the database.
 *
 *   provider  "auto": Claude first (when a key is set and today's Claude limit is not reached), Cloudflare's own
 *             AI when Claude is unavailable, fails or is at its limit.
 *             "claude": Claude only; nothing is read once its limit is reached.
 *             "cloudflare": Cloudflare's AI only, the free allowance (or a higher daily allowance set here).
 *   models    which Claude model reads articles and which writes incident assessments.
 *   limits    the most Claude calls a day, and Cloudflare's daily allowance in neurons (the free 10,000, less a
 *             margin, unless raised here; anything above 10,000 is billed by Cloudflare).
 *   key       the Anthropic API key, when it is not set as a Worker secret. Never sent back to the browser.
 *
 * Settings are read once a minute per Worker instance; loadAiSettings is called at the start of every request and
 * scheduled run, so the synchronous accessors below always see a recent copy.
 */

export type AiProvider = "auto" | "claude" | "cloudflare";

export interface AiSettings {
  provider: AiProvider;
  coderModel: string;
  analystModel: string;
  claudeDailyCalls: number;
  cloudflareDailyNeurons: number | null;
  anthropicKey: string | null;
  /** Extra headline words that let an article through the headline gate (lib/titleGate.ts), one per line. */
  extraKeywords: string;
  updatedAt: string | null;
}

export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";
/** About 600 full article readings a day plus assessments, digests and summaries: on Haiku 5.5, roughly a dollar a
 *  day at most. (The first default, 4,000, let a day's use reach about five dollars.) */
export const DEFAULT_CLAUDE_DAILY_CALLS = 800;
/** The first default, kept in some saved settings rows; read as the current default. */
const OLD_DEFAULT_CLAUDE_DAILY_CALLS = 4000;

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "auto",
  coderModel: DEFAULT_CLAUDE_MODEL,
  analystModel: DEFAULT_CLAUDE_MODEL,
  claudeDailyCalls: DEFAULT_CLAUDE_DAILY_CALLS,
  cloudflareDailyNeurons: null,
  anthropicKey: null,
  extraKeywords: "",
  updatedAt: null,
};

let cached: { at: number; settings: AiSettings } | null = null;
const TTL_MS = 60_000;

let ready: Promise<void> | null = null;
function ensureTables(env: Env): Promise<void> {
  ready ??= env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ai_settings (id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'auto', coder_model TEXT, analyst_model TEXT, claude_daily_calls INTEGER, cloudflare_daily_neurons INTEGER, anthropic_key TEXT, updated_at TEXT)`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS claude_usage_feature (day TEXT NOT NULL, feature TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, feature))`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS claude_usage_daily (day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0)`
    ),
  ])
    // Added later: kept in its own step, as it fails harmlessly once the column exists.
    .then(() => env.DB.prepare(`ALTER TABLE ai_settings ADD COLUMN extra_keywords TEXT`).run().catch(() => undefined))
    .then(() => undefined)
    .catch((err) => {
      ready = null;
      throw err;
    });
  return ready;
}

interface Row {
  provider: string;
  coder_model: string | null;
  analyst_model: string | null;
  claude_daily_calls: number | null;
  cloudflare_daily_neurons: number | null;
  anthropic_key: string | null;
  extra_keywords?: string | null;
  updated_at: string | null;
}

function fromRow(r: Row | null): AiSettings {
  if (!r) return { ...DEFAULT_AI_SETTINGS };
  const provider: AiProvider = r.provider === "claude" || r.provider === "cloudflare" ? r.provider : "auto";
  return {
    provider,
    coderModel: r.coder_model || DEFAULT_CLAUDE_MODEL,
    analystModel: r.analyst_model || r.coder_model || DEFAULT_CLAUDE_MODEL,
    claudeDailyCalls: r.claude_daily_calls === null || r.claude_daily_calls === OLD_DEFAULT_CLAUDE_DAILY_CALLS ? DEFAULT_CLAUDE_DAILY_CALLS : r.claude_daily_calls,
    cloudflareDailyNeurons: r.cloudflare_daily_neurons,
    anthropicKey: r.anthropic_key || null,
    extraKeywords: r.extra_keywords ?? "",
    updatedAt: r.updated_at,
  };
}

/** The settings, from the database at most once a minute. Never throws: on any error the last copy (or the
 *  defaults) stands. */
export async function loadAiSettings(env: Env, force = false): Promise<AiSettings> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.settings;
  try {
    await ensureTables(env);
    const row = await env.DB.prepare(`SELECT * FROM ai_settings WHERE id = 'default'`).first<Row>();
    cached = { at: Date.now(), settings: fromRow(row) };
  } catch (err) {
    console.error("[ai-settings] could not read:", err);
    cached = { at: Date.now(), settings: cached?.settings ?? { ...DEFAULT_AI_SETTINGS } };
  }
  return cached.settings;
}

/** The last loaded settings (the defaults before the first load). */
export function aiSettingsNow(): AiSettings {
  return cached?.settings ?? DEFAULT_AI_SETTINGS;
}

export async function saveAiSettings(env: Env, next: Partial<Omit<AiSettings, "updatedAt">>): Promise<AiSettings> {
  await ensureTables(env);
  const cur = await loadAiSettings(env, true);
  const s: AiSettings = { ...cur, ...next, updatedAt: new Date().toISOString() };
  await env.DB.prepare(
    `INSERT INTO ai_settings (id, provider, coder_model, analyst_model, claude_daily_calls, cloudflare_daily_neurons, anthropic_key, extra_keywords, updated_at)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, coder_model = excluded.coder_model, analyst_model = excluded.analyst_model,
       claude_daily_calls = excluded.claude_daily_calls, cloudflare_daily_neurons = excluded.cloudflare_daily_neurons,
       anthropic_key = excluded.anthropic_key, extra_keywords = excluded.extra_keywords, updated_at = excluded.updated_at`
  )
    .bind(s.provider, s.coderModel, s.analystModel, s.claudeDailyCalls, s.cloudflareDailyNeurons, s.anthropicKey, s.extraKeywords, s.updatedAt)
    .run();
  cached = { at: Date.now(), settings: s };
  return s;
}

/** The Anthropic key: the Worker secret if set, else the one saved in Settings. */
export function anthropicKey(env: Env): string | undefined {
  return env.ANTHROPIC_API_KEY || aiSettingsNow().anthropicKey || undefined;
}

/** Whether Claude is to be tried at all (a key, and Claude not switched off). Today's limit is checked per call. */
export function claudeEnabled(env: Env): boolean {
  return !!anthropicKey(env) && aiSettingsNow().provider !== "cloudflare";
}

/** Whether Cloudflare's AI may be used (always, unless Claude only was chosen). */
export function cloudflareEnabled(): boolean {
  return aiSettingsNow().provider !== "claude";
}

/* ── Claude's daily count ───────────────────────────────────────────────────────────────────────────────────── */

const day = () => new Date().toISOString().slice(0, 10);

/** Counts one Claude call against today's limit. False (nothing counted) at the limit or when it cannot be counted. */
export async function reserveClaudeCall(env: Env): Promise<boolean> {
  const limit = aiSettingsNow().claudeDailyCalls;
  if (limit <= 0) return false;
  try {
    await ensureTables(env);
    const d = day();
    await env.DB.prepare(`INSERT INTO claude_usage_daily (day) VALUES (?) ON CONFLICT(day) DO NOTHING`).bind(d).run();
    const res = await env.DB.prepare(`UPDATE claude_usage_daily SET calls = calls + 1 WHERE day = ? AND calls < ? RETURNING calls`).bind(d, limit).all();
    return (res.results?.length ?? 0) > 0;
  } catch (err) {
    console.error("[ai-settings] could not count a Claude call:", err);
    return false;
  }
}

export async function recordClaudeTokens(env: Env, u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined, feature = "other"): Promise<void> {
  if (!u) return;
  try {
    const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    await env.DB.prepare(
      `INSERT INTO claude_usage_feature (day, feature, calls, input_tokens, output_tokens) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(day, feature) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`
    )
      .bind(day(), feature, input, u.output_tokens ?? 0)
      .run();
    await env.DB.prepare(
      `UPDATE claude_usage_daily SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cache_read_tokens = cache_read_tokens + ?, cache_write_tokens = cache_write_tokens + ? WHERE day = ?`
    )
      .bind(u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0, day())
      .run();
  } catch (err) {
    console.error("[ai-settings] could not record Claude tokens:", err);
  }
}

export interface ClaudeUsage {
  day: string;
  /** Today's calls and tokens by what they were for. */
  byFeature: { feature: string; calls: number; inputTokens: number; outputTokens: number }[];
  calls: number;
  limit: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export async function getClaudeUsage(env: Env): Promise<ClaudeUsage> {
  const d = day();
  const limit = aiSettingsNow().claudeDailyCalls;
  try {
    await ensureTables(env);
    const r = await env.DB.prepare(`SELECT * FROM claude_usage_daily WHERE day = ?`)
      .bind(d)
      .first<{ calls: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number }>();
    const f = await env.DB.prepare(`SELECT feature, calls, input_tokens, output_tokens FROM claude_usage_feature WHERE day = ? ORDER BY input_tokens + 5 * output_tokens DESC`)
      .bind(d)
      .all<{ feature: string; calls: number; input_tokens: number; output_tokens: number }>();
    const byFeature = (f.results ?? []).map((x) => ({ feature: x.feature, calls: x.calls, inputTokens: x.input_tokens, outputTokens: x.output_tokens }));
    return { day: d, byFeature, calls: r?.calls ?? 0, limit, inputTokens: r?.input_tokens ?? 0, outputTokens: r?.output_tokens ?? 0, cacheReadTokens: r?.cache_read_tokens ?? 0, cacheWriteTokens: r?.cache_write_tokens ?? 0 };
  } catch {
    return { day: d, byFeature: [], calls: 0, limit, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  }
}

/** Test hook. */
export function resetAiSettingsCache(): void {
  cached = null;
  ready = null;
}
