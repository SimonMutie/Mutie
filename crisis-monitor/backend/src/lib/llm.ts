import type { Env } from "../bindings";

/**
 * One structured-output model call, with a provider fallback chain.
 *
 *   1. Anthropic Messages API, when ANTHROPIC_API_KEY is set. The response
 *      is forced through a tool call whose input_schema is the JSON schema
 *      the caller wants, so the result is always a parsed object, never
 *      free text to be scraped.
 *   2. Workers AI (this Worker's own AI binding — no key needed) with JSON
 *      mode, when the key is unset or the Anthropic call failed.
 *
 * Returns null only when every provider failed; the caller decides what a
 * failure means (the escalation pipeline leaves the article queued for a
 * retry rather than guessing).
 */

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
export const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const ANTHROPIC_TIMEOUT_MS = 45_000;
const WORKERS_AI_TIMEOUT_MS = 45_000;

export interface StructuredCall {
  system: string;
  user: string;
  /** JSON Schema (draft-07 subset) for the object to return. */
  schema: Record<string, unknown>;
  toolName: string;
  toolDescription: string;
  maxTokens: number;
  /** "coder" reads one article; "analyst" writes an incident assessment.
   *  Each can be pointed at a different model with the
   *  ESCALATION_CODER_MODEL / ESCALATION_ANALYST_MODEL vars. */
  role: "coder" | "analyst";
}

export interface StructuredResult<T> {
  data: T;
  provider: "anthropic" | "workers-ai";
  model: string;
}

function anthropicModelsFor(env: Env, role: "coder" | "analyst"): string[] {
  const coder = env.ESCALATION_CODER_MODEL || DEFAULT_ANTHROPIC_MODEL;
  const analyst = env.ESCALATION_ANALYST_MODEL || coder;
  // If a configured analyst model is rejected (wrong ID, no access), fall
  // back to the coder model before leaving Anthropic altogether.
  return role === "analyst" ? [...new Set([analyst, coder])] : [coder];
}

async function callAnthropic<T>(env: Env, model: string, call: StructuredCall): Promise<T | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: call.maxTokens,
      // The system prompt (codebook + rules) is identical on every call, so it
      // is marked cacheable; where the model supports it, repeat calls within
      // the cache window are billed at the reduced cached-input rate.
      system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: call.user }],
      tools: [{ name: call.toolName, description: call.toolDescription, input_schema: call.schema }],
      tool_choice: { type: "tool", name: call.toolName },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    noteModelError(`anthropic ${model}`, `HTTP ${res.status}: ${body.slice(0, 240)}`);
    return null;
  }
  const data = (await res.json()) as { content?: Array<{ type?: string; name?: string; input?: unknown }>; stop_reason?: string };
  const block = data.content?.find((b) => b.type === "tool_use" && b.name === call.toolName);
  if (!block?.input || typeof block.input !== "object") {
    console.error(`[llm] Anthropic ${model} returned no tool_use block (stop_reason=${data.stop_reason})`);
    return null;
  }
  return block.input as T;
}

/** Pulls the first balanced JSON object out of a text response — Workers AI
 *  models sometimes wrap JSON in prose or code fences even in JSON mode. */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** The most recent provider failure, kept so the pipeline can record WHY no
 *  coding was produced (see escalationIncidents.ts's last_run state) —
 *  otherwise a failing model is only visible in the Worker's logs. */
let lastModelError: { at: string; provider: string; message: string } | null = null;
function noteModelError(provider: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  lastModelError = { at: new Date().toISOString(), provider, message: message.slice(0, 300) };
  console.error(`[llm] ${provider} failed: ${message.slice(0, 300)}`);
}
export function getLastModelError(): { at: string; provider: string; message: string } | null {
  return lastModelError;
}

async function runWorkersAi(env: Env, input: Record<string, unknown>): Promise<unknown> {
  const run = env.AI.run as unknown as (model: string, input: unknown) => Promise<unknown>;
  const result = await Promise.race([
    run(WORKERS_AI_MODEL, input),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("workers-ai timeout")), WORKERS_AI_TIMEOUT_MS)),
  ]);
  return (result as { response?: unknown })?.response;
}

function parseWorkersAiResponse<T>(response: unknown): T | null {
  if (response && typeof response === "object") return response as T;
  if (typeof response === "string") return extractJsonObject(response) as T | null;
  return null;
}

/** Two attempts. The first asks for schema-constrained JSON; if the model or
 *  the platform rejects that (not every schema feature is supported in JSON
 *  mode) or returns something unparsable, the second asks in plain text with
 *  the schema spelled out in the prompt, and the JSON is extracted from the
 *  reply. Either way the result still goes through the caller's own
 *  verification, so a loosely-shaped reply cannot introduce anything
 *  unchecked. */
async function callWorkersAi<T>(env: Env, call: StructuredCall): Promise<T | null> {
  const messages = [
    { role: "system", content: `${call.system}\n\nRespond with a single JSON object that matches this JSON Schema exactly, and nothing else — no prose, no code fences:\n${JSON.stringify(call.schema)}` },
    { role: "user", content: call.user },
  ];
  try {
    const data = parseWorkersAiResponse<T>(await runWorkersAi(env, { messages, response_format: { type: "json_schema", json_schema: call.schema }, max_tokens: call.maxTokens, temperature: 0.1 }));
    if (data) return data;
    noteModelError("workers-ai (json mode)", "response was empty or not valid JSON");
  } catch (err) {
    noteModelError("workers-ai (json mode)", err);
  }
  try {
    const data = parseWorkersAiResponse<T>(await runWorkersAi(env, { messages, max_tokens: call.maxTokens, temperature: 0.1 }));
    if (data) return data;
    noteModelError("workers-ai (plain)", "response was empty or not valid JSON");
  } catch (err) {
    noteModelError("workers-ai (plain)", err);
  }
  return null;
}

export async function callStructured<T>(env: Env, call: StructuredCall): Promise<StructuredResult<T> | null> {
  if (env.ANTHROPIC_API_KEY) {
    for (const model of anthropicModelsFor(env, call.role)) {
      try {
        const data = await callAnthropic<T>(env, model, call);
        if (data) return { data, provider: "anthropic", model };
      } catch (err) {
        noteModelError(`anthropic ${model}`, err);
      }
    }
  }
  const data = await callWorkersAi<T>(env, call);
  if (data) return { data, provider: "workers-ai", model: WORKERS_AI_MODEL };
  return null;
}

/** Which provider the pipeline will use right now — surfaced by the status
 *  endpoint so "why do summaries read weakly" has a visible answer. */
export function describeProvider(env: Env): { provider: "anthropic" | "workers-ai"; coderModel: string; analystModel: string } {
  if (env.ANTHROPIC_API_KEY) {
    return { provider: "anthropic", coderModel: anthropicModelsFor(env, "coder")[0], analystModel: anthropicModelsFor(env, "analyst")[0] };
  }
  return { provider: "workers-ai", coderModel: WORKERS_AI_MODEL, analystModel: WORKERS_AI_MODEL };
}
