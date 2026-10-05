import type { Env } from "../bindings";

/**
 * A hard daily ceiling on Workers AI use, so the platform cannot run up an
 * AI bill.
 *
 * Cloudflare gives every account 10,000 "neurons" of Workers AI a day at no
 * charge (the allowance resets at 00:00 UTC) and bills anything beyond it.
 * Nothing on Cloudflare's side stops a paid account at the free amount, so
 * the stop is enforced here: every model call first reserves its worst-case
 * cost against today's budget, and is simply not made if that would go over.
 * After the call the reservation is corrected to what was actually used.
 *
 * The budget defaults to 9,000 — under the free 10,000 on purpose, because
 * the cost of a call is worked out here from token counts rather than read
 * from the bill, and the margin absorbs any small difference. It can be
 * changed with the AI_DAILY_NEURON_BUDGET variable ("0" switches AI off
 * entirely). Setting it above 10,000 is a decision to pay.
 *
 * Reservations are made with a single conditional UPDATE, so several calls
 * running at once cannot each believe the last of the budget is theirs.
 */

export const FREE_DAILY_NEURONS = 10_000;
export const DEFAULT_DAILY_NEURON_BUDGET = 9_000;

/** Neurons per million tokens, from Cloudflare's published Workers AI
 *  pricing (developers.cloudflare.com/workers-ai/platform/pricing, read
 *  2026-10-05). A model not listed here is costed at the dearest rate
 *  below, so an unknown model can only be over-counted, never under. */
const NEURON_RATES: Record<string, { input: number; output: number }> = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 26_668, output: 204_805 },
  "@cf/meta/llama-3.1-70b-instruct-fp8-fast": { input: 26_668, output: 204_805 },
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": { input: 4_119, output: 34_868 },
  "@cf/meta/llama-4-scout-17b-16e-instruct": { input: 24_545, output: 77_273 },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": { input: 31_876, output: 50_488 },
  "@cf/openai/gpt-oss-20b": { input: 18_182, output: 27_273 },
  "@cf/openai/gpt-oss-120b": { input: 31_818, output: 68_182 },
  // Translation: priced per token at one rate for input and output.
  "@cf/meta/m2m100-1.2b": { input: 31_050, output: 31_050 },
};
const UNKNOWN_MODEL_RATE = { input: 60_000, output: 204_805 };

/** Deliberately pessimistic: real text runs nearer four characters a token,
 *  so an estimate made this way errs towards reserving too much. */
const CHARS_PER_TOKEN = 3;

export function neuronsFor(model: string, inputTokens: number, outputTokens: number): number {
  const rate = NEURON_RATES[model] ?? UNKNOWN_MODEL_RATE;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/** Worst-case cost of a call before it is made. */
export function estimateNeurons(model: string, inputChars: number, maxOutputTokens: number): number {
  return neuronsFor(model, Math.ceil(inputChars / CHARS_PER_TOKEN), maxOutputTokens);
}

export function dailyNeuronBudget(env: Env, now = new Date()): number {
  // No AI at all before this UTC date, if one is set. Used on the day the
  // ceiling was introduced: that day's free allowance had already been
  // spent (by translation) before the platform started counting, so any
  // further call that day would have been billed.
  if (env.AI_BUDGET_NOT_BEFORE && usageDay(now) < env.AI_BUDGET_NOT_BEFORE) return 0;
  const raw = env.AI_DAILY_NEURON_BUDGET;
  if (raw === undefined || raw === null || String(raw).trim() === "") return DEFAULT_DAILY_NEURON_BUDGET;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_NEURON_BUDGET;
}

/** The allowance's own day: UTC, because that is when Cloudflare resets it. */
export function usageDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

let tableReady: Promise<void> | null = null;
function ensureTable(env: Env): Promise<void> {
  if (!tableReady) {
    tableReady = env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_usage_daily (day TEXT PRIMARY KEY, neurons REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0)`)
      .run()
      .then(() => undefined)
      .catch((err) => {
        tableReady = null;
        throw err;
      });
  }
  return tableReady;
}

/** Test hook. */
export function resetAiBudgetTableCheck(): void {
  tableReady = null;
}

/**
 * Sets aside `neurons` from today's budget. Returns false — and reserves
 * nothing — when that would take the day over `limit` (by default the whole
 * budget; callers that should leave room for others pass a lower figure).
 *
 * If the usage table cannot be read or written, the answer is false: when
 * spending cannot be counted, nothing is spent.
 */
export async function reserveNeurons(env: Env, neurons: number, limit = dailyNeuronBudget(env)): Promise<boolean> {
  if (limit <= 0 || neurons > limit) return false;
  try {
    await ensureTable(env);
    const day = usageDay();
    await env.DB.prepare(`INSERT INTO ai_usage_daily (day, neurons, calls) VALUES (?, 0, 0) ON CONFLICT(day) DO NOTHING`).bind(day).run();
    const res = await env.DB.prepare(`UPDATE ai_usage_daily SET neurons = neurons + ?, calls = calls + 1 WHERE day = ? AND neurons + ? <= ? RETURNING neurons`).bind(neurons, day, neurons, limit).all();
    return (res.results?.length ?? 0) > 0;
  } catch (err) {
    console.error("[ai-budget] could not record a reservation, so the call is not made:", err);
    return false;
  }
}

/** Replaces a reservation with what the call really used. `actual` of 0
 *  hands the whole reservation back (the call failed before running). */
export async function settleNeurons(env: Env, reserved: number, actual: number): Promise<void> {
  const delta = actual - reserved;
  if (delta === 0) return;
  try {
    await env.DB.prepare(`UPDATE ai_usage_daily SET neurons = MAX(0, neurons + ?) WHERE day = ?`).bind(delta, usageDay()).run();
  } catch (err) {
    // The reservation stays as it was: over-counted, never under.
    console.error("[ai-budget] could not correct a reservation:", err);
  }
}

export interface AiUsage {
  /** UTC date the figures are for. */
  day: string;
  used: number;
  calls: number;
  /** The platform's own ceiling; no model call is made beyond it. */
  budget: number;
  /** What Cloudflare gives free each day. */
  freeAllowance: number;
  remaining: number;
}

export async function getAiUsage(env: Env): Promise<AiUsage> {
  const budget = dailyNeuronBudget(env);
  const day = usageDay();
  let used = 0;
  let calls = 0;
  try {
    await ensureTable(env);
    const row = await env.DB.prepare(`SELECT neurons, calls FROM ai_usage_daily WHERE day = ?`).bind(day).first<{ neurons: number; calls: number }>();
    used = row?.neurons ?? 0;
    calls = row?.calls ?? 0;
  } catch (err) {
    console.error("[ai-budget] could not read today's usage:", err);
  }
  return { day, used: Math.round(used), calls, budget, freeAllowance: FREE_DAILY_NEURONS, remaining: Math.max(0, Math.round(budget - used)) };
}
