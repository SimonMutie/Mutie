/**
 * The daily ceiling on Workers AI use: the platform must not be able to go
 * past Cloudflare's free allowance, whatever the pipeline asks for.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DEFAULT_DAILY_NEURON_BUDGET, FREE_DAILY_NEURONS, estimateNeurons, getAiUsage, neuronsFor, reserveNeurons, resetAiBudgetTableCheck, settleNeurons } from "../src/lib/aiBudget";
import { callStructured, WORKERS_AI_MODEL, CODER_BUDGET_SHARE, getLastModelError } from "../src/lib/llm";
import { translateToEnglish } from "../src/lib/translate";
import { freeAllowancePacing } from "../src/escalationIncidents";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

const makeEnv = (extra: Record<string, unknown> = {}) => ({ DB: fakeD1().DB, ...extra }) as unknown as Env;
beforeEach(() => resetAiBudgetTableCheck());

describe("daily AI ceiling", () => {
  it("defaults to a budget below Cloudflare's free allowance", async () => {
    expect(DEFAULT_DAILY_NEURON_BUDGET).toBeLessThan(FREE_DAILY_NEURONS);
    const usage = await getAiUsage(makeEnv());
    expect(usage).toMatchObject({ used: 0, calls: 0, budget: 9000, freeAllowance: 10000, remaining: 9000 });
    expect(usage.day).toBe(new Date().toISOString().slice(0, 10)); // the UTC day, when Cloudflare resets
  });

  it("refuses a reservation that would go over, and lets nothing through at once", async () => {
    const env = makeEnv();
    expect(await reserveNeurons(env, 8000)).toBe(true);
    expect(await reserveNeurons(env, 1001)).toBe(false);
    expect(await reserveNeurons(env, 1000)).toBe(true);
    expect(await reserveNeurons(env, 1)).toBe(false);
    expect((await getAiUsage(env)).used).toBe(9000);

    // Many calls arriving together cannot each take the last of the budget.
    resetAiBudgetTableCheck(); // a second, empty database
    const racing = makeEnv();
    const granted = (await Promise.all(Array.from({ length: 50 }, () => reserveNeurons(racing, 600)))).filter(Boolean).length;
    expect(granted).toBe(15); // 15 x 600 = 9,000
    expect((await getAiUsage(racing)).used).toBe(9000);
  });

  it("corrects a reservation to what was really used", async () => {
    const env = makeEnv();
    await reserveNeurons(env, 600);
    await settleNeurons(env, 600, 240);
    expect((await getAiUsage(env)).used).toBe(240);
    await reserveNeurons(env, 600);
    await settleNeurons(env, 600, 0); // the call never ran
    expect((await getAiUsage(env)).used).toBe(240);
  });

  it("can be switched off, and spends nothing when usage cannot be counted", async () => {
    expect(await reserveNeurons(makeEnv({ AI_DAILY_NEURON_BUDGET: "0" }), 1)).toBe(false);
    expect(await reserveNeurons({} as Env, 1)).toBe(false); // no database
    const broken = { DB: { prepare: () => { throw new Error("db down"); } } } as unknown as Env;
    expect(await reserveNeurons(broken, 1)).toBe(false);
  });

  it("makes no call before the start date, when one is set", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    expect(await reserveNeurons(makeEnv({ AI_BUDGET_NOT_BEFORE: tomorrow }), 1)).toBe(false);
    expect((await getAiUsage(makeEnv({ AI_BUDGET_NOT_BEFORE: tomorrow }))).budget).toBe(0);
    resetAiBudgetTableCheck();
    expect(await reserveNeurons(makeEnv({ AI_BUDGET_NOT_BEFORE: today }), 1)).toBe(true);
  });

  it("costs calls from Cloudflare's published rates, estimating high beforehand", () => {
    // 1M input tokens of the 70B model = 26,668 neurons; 1M output = 204,805.
    expect(neuronsFor(WORKERS_AI_MODEL, 1_000_000, 0)).toBeCloseTo(26_668);
    expect(neuronsFor(WORKERS_AI_MODEL, 0, 1_000_000)).toBeCloseTo(204_805);
    // The estimate assumes more tokens than the same text really has.
    expect(estimateNeurons(WORKERS_AI_MODEL, 20_000, 500)).toBeGreaterThan(neuronsFor(WORKERS_AI_MODEL, 5_000, 500));
    // A model not in the table is costed at the dearest rate, never as free.
    expect(neuronsFor("@cf/some/new-model", 1000, 1000)).toBeGreaterThanOrEqual(neuronsFor(WORKERS_AI_MODEL, 1000, 1000));
  });
});

describe("model calls under the ceiling", () => {
  const call = (role: "coder" | "analyst") => ({ system: "s".repeat(9000), user: "u".repeat(9000), schema: { type: "object" }, toolName: "t", toolDescription: "d", maxTokens: 2000, role });
  // Roughly what reading one article costs: 5,500 tokens in, 500 out = about 249 neurons.
  const reply = { response: { ok: true }, usage: { prompt_tokens: 5500, completion_tokens: 500 } };
  const perCall = neuronsFor(WORKERS_AI_MODEL, 5500, 500);

  it("stops calling the model when the day's allowance is spent — however many articles are waiting", async () => {
    const run = vi.fn(async () => reply);
    const env = makeEnv({ AI: { run } });
    let answered = 0;
    for (let i = 0; i < 200; i++) if (await callStructured(env, call("coder"))) answered++;

    const usage = await getAiUsage(env);
    expect(run.mock.calls.length).toBe(answered);
    expect(answered).toBeGreaterThan(20); // a useful number of articles ...
    expect(answered).toBeLessThan(40); // ... but bounded
    expect(usage.used).toBeLessThanOrEqual(9000 * CODER_BUDGET_SHARE);
    expect(usage.used).toBeCloseTo(answered * perCall, -1);
    expect(usage.used).toBeLessThan(FREE_DAILY_NEURONS);
    expect(getLastModelError()?.message).toMatch(/free AI allowance is used up/);

    // Article reading has stopped, but the share kept for incident assessments is still there.
    expect(await callStructured(env, call("analyst"))).not.toBeNull();
    // ... until that is spent too. Nothing ever goes past the budget.
    for (let i = 0; i < 50; i++) await callStructured(env, call("analyst"));
    expect((await getAiUsage(env)).used).toBeLessThanOrEqual(9000);
    const callsAtLimit = run.mock.calls.length;
    await callStructured(env, call("analyst"));
    expect(run.mock.calls.length).toBe(callsAtLimit);
  });

  it("does not charge for a call the model refused, and makes no call at all with AI switched off", async () => {
    const refusing = vi.fn(async () => {
      throw new Error("5007: No such model");
    });
    const env = makeEnv({ AI: { run: refusing } });
    expect(await callStructured(env, call("coder"))).toBeNull();
    expect(refusing).toHaveBeenCalledTimes(2); // JSON mode, then the plain attempt
    expect((await getAiUsage(env)).used).toBe(0);

    const run = vi.fn(async () => reply);
    expect(await callStructured(makeEnv({ AI: { run }, AI_DAILY_NEURON_BUDGET: "0" }), call("coder"))).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("holds translation to the same ceiling if it is ever switched back on", async () => {
    const run = vi.fn(async () => ({ translated_text: "Fighting broke out." }));
    const env = makeEnv({ AI: { run } });
    await reserveNeurons(env, 8990);
    const result = await translateToEnglish(env, "Des combats ont éclaté près de la frontière, selon l'armée. ".repeat(20));
    expect(result.translated).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("pacing article reading through the day", () => {
  const at = (hhmm: string) => new Date(`2026-10-06T${hhmm}:00Z`);
  it("allows a little at the start of the day and more as it goes on, instead of spending everything at once", () => {
    expect(freeAllowancePacing({ used: 0, budget: 9000 }, at("00:00"))).toEqual({ articles: 1, reached: false });
    expect(freeAllowancePacing({ used: 0, budget: 9000 }, at("12:00")).articles).toBeGreaterThan(10);
    // Already used what the morning allows: wait.
    expect(freeAllowancePacing({ used: 3000, budget: 9000 }, at("06:00"))).toEqual({ articles: 0, reached: false });
    // The same usage later in the day leaves room again.
    expect(freeAllowancePacing({ used: 3000, budget: 9000 }, at("18:00")).articles).toBeGreaterThan(0);
  });
  it("reports the day's reading budget as spent once it is", () => {
    expect(freeAllowancePacing({ used: 7400, budget: 9000 }, at("23:00"))).toEqual({ articles: 0, reached: true });
    expect(freeAllowancePacing({ used: 0, budget: 0 }, at("12:00"))).toEqual({ articles: 0, reached: true });
  });
});
