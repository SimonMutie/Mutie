/** Settings → AI reading: Claude, Cloudflare's AI, or both, with each one's daily limit. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callStructured, describeProvider } from "../src/lib/llm";
import { getClaudeUsage, loadAiSettings, resetAiSettingsCache, saveAiSettings } from "../src/lib/aiSettings";
import { dailyNeuronBudget, resetAiBudgetTableCheck } from "../src/lib/aiBudget";
import { claudePacing } from "../src/escalationIncidents";
import { aiSettingsRouter } from "../src/routes/aiSettings";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

const KEY = "sk-ant-api03-" + "x".repeat(40);
const call = { system: "s", user: "u", schema: { type: "object" }, toolName: "record", toolDescription: "d", maxTokens: 100, role: "coder" as const };

function setup() {
  const d1 = fakeD1();
  const run = vi.fn(async () => ({ response: { from: "cloudflare" }, usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  const env = { DB: d1.DB, AI: { run }, SESSION_SECRET: "s" } as unknown as Env;
  const claude = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/v1/models")) return new Response("{}", { status: 200 });
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record", input: { from: "claude", model: body.model } }], usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 900 } }));
  });
  vi.stubGlobal("fetch", claude);
  return { d1, env, run, claude };
}

beforeEach(() => {
  resetAiSettingsCache();
  resetAiBudgetTableCheck();
});
afterEach(() => vi.unstubAllGlobals());

describe("AI reading settings", () => {
  it("with no key, reads with Cloudflare's AI", async () => {
    const { env, claude } = setup();
    const r = await callStructured(env, call);
    expect(r?.provider).toBe("workers-ai");
    expect(claude).not.toHaveBeenCalled();
  });

  it("with a key saved in Settings, reads with Claude Haiku 5.5 and counts the call and its tokens", async () => {
    const { env, run } = setup();
    await saveAiSettings(env, { anthropicKey: KEY });
    const r = await callStructured<{ from: string; model: string }>(env, call);
    expect(r).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", data: { from: "claude" } });
    expect(run).not.toHaveBeenCalled();
    expect(await getClaudeUsage(env)).toMatchObject({ calls: 1, inputTokens: 1200, outputTokens: 300, cacheReadTokens: 900 });
    expect(describeProvider(env)).toMatchObject({ provider: "anthropic", coderModel: "claude-haiku-5-5" });
  });

  it("at Claude's daily limit, automatic falls back to Cloudflare and Claude-only stops", async () => {
    const { env } = setup();
    await saveAiSettings(env, { anthropicKey: KEY, claudeDailyCalls: 1 });
    expect((await callStructured(env, call))?.provider).toBe("anthropic");
    expect((await callStructured(env, call))?.provider).toBe("workers-ai");
    await saveAiSettings(env, { provider: "claude" });
    expect(await callStructured(env, call)).toBeNull();
  });

  it("Cloudflare only never calls Claude, and its daily allowance can be set", async () => {
    const { env, claude } = setup();
    await saveAiSettings(env, { anthropicKey: KEY, provider: "cloudflare", cloudflareDailyNeurons: 50_000 });
    expect((await callStructured(env, call))?.provider).toBe("workers-ai");
    expect(claude).not.toHaveBeenCalled();
    expect(dailyNeuronBudget(env)).toBe(50_000);
    expect(describeProvider(env).provider).toBe("workers-ai");
  });

  it("uses separate models for reading and assessments", async () => {
    const { env } = setup();
    await saveAiSettings(env, { anthropicKey: KEY, analystModel: "claude-sonnet-5-5" });
    expect((await callStructured(env, { ...call, role: "analyst" }))?.model).toBe("claude-sonnet-5-5");
    expect((await callStructured(env, call))?.model).toBe("claude-haiku-5-5");
  });

  it("paces Claude reading across the day", () => {
    expect(claudePacing({ calls: 0, limit: 4000 }, new Date("2026-11-22T00:00:00Z")).articles).toBeGreaterThan(0);
    expect(claudePacing({ calls: 4000, limit: 4000 }).reached).toBe(true);
  });

  it("the admin route never returns the key", async () => {
    const { d1, env } = setup();
    d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, role TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0); INSERT INTO users (id, username, role) VALUES ('a', 'admin', 'admin');`);
    const h = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}`, "content-type": "application/json" };
    const put = await aiSettingsRouter.request("/", { method: "PUT", headers: h, body: JSON.stringify({ anthropicKey: KEY, provider: "auto" }) }, env);
    expect(put.status).toBe(200);
    const got = (await (await aiSettingsRouter.request("/", { headers: h }, env)).json()) as Record<string, unknown>;
    expect(got).toMatchObject({ keySet: true, keyHint: "xxxx", provider: "auto", coderModel: "claude-haiku-5-5" });
    expect(JSON.stringify(got)).not.toContain(KEY);
    const bad = await aiSettingsRouter.request("/", { method: "PUT", headers: h, body: JSON.stringify({ anthropicKey: "nope" }) }, env);
    expect(bad.status).toBe(400);
    await loadAiSettings(env, true);
  });
});
