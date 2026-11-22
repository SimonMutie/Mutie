import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";
import { getClaudeUsage, loadAiSettings, saveAiSettings, type AiSettings } from "../lib/aiSettings";
import { getAiUsage } from "../lib/aiBudget";

/**
 * Settings → AI reading (admins): which AI reads for the platform (Claude, Cloudflare's own AI, or Claude with
 * Cloudflare as the fallback), which Claude models, the Anthropic key, and each provider's daily limit. The key is
 * never sent back, only whether one is set and its last four characters.
 */
export const aiSettingsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
aiSettingsRouter.use("*", requireAuth, requireAdmin);

/** Claude models offered in the menu; any other model id can be typed in. */
const MODELS = [
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5 (fast; for reading articles)" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5 (stronger; for assessments)" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5 (strongest)" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (previous)" },
];

function view(env: Env, s: AiSettings) {
  const key = env.ANTHROPIC_API_KEY || s.anthropicKey;
  return {
    provider: s.provider,
    coderModel: env.ESCALATION_CODER_MODEL || s.coderModel,
    analystModel: env.ESCALATION_ANALYST_MODEL || s.analystModel,
    modelsFromEnv: !!(env.ESCALATION_CODER_MODEL || env.ESCALATION_ANALYST_MODEL),
    claudeDailyCalls: s.claudeDailyCalls,
    cloudflareDailyNeurons: s.cloudflareDailyNeurons,
    keySet: !!key,
    keyHint: key ? key.slice(-4) : null,
    keyFromEnv: !!env.ANTHROPIC_API_KEY,
    updatedAt: s.updatedAt,
    models: MODELS,
  };
}

aiSettingsRouter.get("/", async (c) => {
  const s = await loadAiSettings(c.env, true);
  const [claude, cloudflare] = await Promise.all([getClaudeUsage(c.env), getAiUsage(c.env)]);
  return c.json({ ...view(c.env, s), usage: { claude, cloudflare } });
});

const modelId = z.string().trim().regex(/^[a-z0-9][a-z0-9.-]{2,80}$/i, "That is not a model id.");
const schema = z.object({
  provider: z.enum(["auto", "claude", "cloudflare"]).optional(),
  coderModel: modelId.optional(),
  analystModel: modelId.optional(),
  claudeDailyCalls: z.number().int().min(0).max(100_000).optional(),
  cloudflareDailyNeurons: z.number().int().min(0).max(10_000_000).nullable().optional(),
  /** A new key, or null to remove the saved one. Left out: unchanged. */
  anthropicKey: z.string().trim().regex(/^sk-ant-[A-Za-z0-9_-]{20,}$/, "That does not look like an Anthropic API key (it starts with sk-ant-).").nullable().optional(),
});

aiSettingsRouter.put("/", async (c) => {
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings." }, 400);
  const d = parsed.data;
  // A new key is checked with Anthropic before it is saved, so a typo cannot silently stop Claude reading.
  if (d.anthropicKey) {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": d.anthropicKey, "anthropic-version": "2023-06-01" } }).catch(() => null);
    if (!res || res.status === 401 || res.status === 403) return c.json({ error: "Anthropic did not accept this key. Check it and try again." }, 400);
  }
  const s = await saveAiSettings(c.env, d);
  const [claude, cloudflare] = await Promise.all([getClaudeUsage(c.env), getAiUsage(c.env)]);
  return c.json({ ...view(c.env, s), usage: { claude, cloudflare } });
});
