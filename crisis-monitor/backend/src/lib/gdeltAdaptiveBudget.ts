import { all, run, nowIso } from "../db";
import type { Env } from "../bindings";

/**
 * Self-tuning replacement for the old fixed GDELT_REQUEST_BUDGET_PER_TICK=20
 * constant in index.ts. That number was never measured against GDELT —
 * it was a guess calibrated to the Worker's old 1,000-subrequest cap (since
 * removed, see Cloudflare's Feb 2026 changelog), not to anything GDELT
 * itself actually enforces. GDELT publishes no documented rate limit for
 * its free DOC 2.0 API; fetchGdeltArticles/pollGdelt (connectors/gdelt.ts)
 * already detect its real signal directly — a 429/403 response — so the
 * right "fix" is to let the tick budget climb until that signal actually
 * fires, then back off, rather than keep guessing a static ceiling.
 *
 * Classic AIMD (additive-increase/multiplicative-decrease) congestion
 * control, the same shape TCP uses for exactly this problem (discovering a
 * shared, undocumented, variable capacity without a central authority to
 * ask): climb steadily while nothing complains, cut hard and cool off the
 * moment something does. State persists in D1 (self-provisioned below,
 * no migration file needed) so it survives across cron ticks, which run as
 * fresh Worker invocations every 5 minutes.
 */

const MIN_BUDGET = 10; // never throttle below roughly where the old static budget started
const MAX_BUDGET = 80; // ~80 requests * ~2.75s average stagger ≈ 3.7 min worst case — stays inside the 5-minute tick window with headroom
const STEP_UP = 5; // additive climb per tick that fully used its budget without a 429
const COOLDOWN_MS = 15 * 60_000; // 3 ticks — give GDELT's rate limiter real time to reset before probing again

interface BudgetState {
  budget: number;
  cooldownUntil: string | null;
}

/** Lazily creates the one-row table this lives in — no separate migration
 *  file needed (this app's D1 schema is otherwise applied by hand via
 *  `wrangler d1 execute`, with no migration files checked into the repo;
 *  see gdeltBulk.ts's "migration_023" comment — this sidesteps that gap
 *  entirely for a piece of state small enough not to need one). */
async function ensureTable(env: Env): Promise<void> {
  await run(
    env.DB,
    `CREATE TABLE IF NOT EXISTS gdelt_adaptive_state (
      id TEXT PRIMARY KEY,
      budget INTEGER NOT NULL,
      cooldown_until TEXT,
      updated_at TEXT NOT NULL
    )`
  );
}

async function loadState(env: Env): Promise<BudgetState> {
  await ensureTable(env);
  const rows = await all<{ budget: number; cooldown_until: string | null }>(
    env.DB,
    "SELECT budget, cooldown_until FROM gdelt_adaptive_state WHERE id = 'gdelt'"
  );
  if (rows[0]) return { budget: rows[0].budget, cooldownUntil: rows[0].cooldown_until };
  return { budget: MIN_BUDGET * 2, cooldownUntil: null }; // first-ever tick: start at 20, same as the old static default
}

async function saveState(env: Env, state: BudgetState): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO gdelt_adaptive_state (id, budget, cooldown_until, updated_at) VALUES ('gdelt', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET budget = excluded.budget, cooldown_until = excluded.cooldown_until, updated_at = excluded.updated_at`,
    [state.budget, state.cooldownUntil, nowIso()]
  );
}

/** Call once at the top of the tick. Returns the budget to poll with this
 *  tick — 0 while still inside a post-429 cooldown window, so the caller's
 *  existing "budget <= 0 means skip" handling (already in index.ts/pollGdelt)
 *  does the right thing with no extra branching needed there. */
export async function getTickBudget(env: Env): Promise<{ budget: number; cooldownRemainingMs: number }> {
  const state = await loadState(env);
  if (state.cooldownUntil) {
    const remaining = new Date(state.cooldownUntil).getTime() - Date.now();
    if (remaining > 0) return { budget: 0, cooldownRemainingMs: remaining };
  }
  return { budget: state.budget, cooldownRemainingMs: 0 };
}

/** Call once at the end of the tick with how it actually went, to adjust
 *  next tick's budget. `requestsUsed`/`allocatedBudget` are both 0 on a
 *  tick that was skipped for cooldown — that's a no-op here, the cooldown
 *  timer set by the previous rate-limited tick is what's already ticking
 *  down in storage. */
export async function recordTickOutcome(
  env: Env,
  opts: { allocatedBudget: number; requestsUsed: number; rateLimited: boolean }
): Promise<void> {
  if (opts.allocatedBudget === 0 && !opts.rateLimited) return; // skipped tick (cooldown) — nothing to learn

  const state = await loadState(env);

  if (opts.rateLimited) {
    const newBudget = Math.max(MIN_BUDGET, Math.floor(state.budget / 2));
    console.warn(`[gdelt-budget] 429/403 hit — cutting budget ${state.budget} -> ${newBudget}, cooling down ${COOLDOWN_MS / 60_000}min`);
    await saveState(env, { budget: newBudget, cooldownUntil: new Date(Date.now() + COOLDOWN_MS).toISOString() });
    return;
  }

  if (opts.requestsUsed >= opts.allocatedBudget && state.budget < MAX_BUDGET) {
    // Every allowed request got used and nothing complained — there was more
    // demand than this tick's ceiling allowed, so it's safe to probe higher.
    const newBudget = Math.min(MAX_BUDGET, state.budget + STEP_UP);
    console.log(`[gdelt-budget] tick fully used budget with no rate limit — raising ${state.budget} -> ${newBudget}`);
    await saveState(env, { budget: newBudget, cooldownUntil: null });
    return;
  }

  // Budget had headroom left (fewer active queries/chunks than the ceiling
  // allowed) — already generous enough for current demand, leave it as is,
  // just clear any stale cooldown marker.
  if (state.cooldownUntil) await saveState(env, { budget: state.budget, cooldownUntil: null });
}
