import { describe, it, expect, vi, afterAll } from "vitest";
import { AfricaWireActor } from "../src/durableObjects/africaWireActor";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";
import { resetAiBudgetTableCheck } from "../src/lib/aiBudget";

const pub = new Date(Date.now() - 3600_000).toUTCString();
const item = (n: number, title: string) => `<item><title>${title}</title><link>https://journal.example/a${n}</link><pubDate>${pub}</pubDate><description>Des combats ont éclaté près de la frontière, selon l'armée (${n}).</description></item>`;
const feed = (items: string[]) => `<?xml version="1.0"?><rss><channel><title>Journal</title>${items.join("")}</channel></rss>`;

describe("Africa Wire translation", () => {
  const store = new Map<string, unknown>();
  const storage = {
    get: async (k: string) => store.get(k),
    put: async (k: string, v: unknown) => void store.set(k, v),
    list: async ({ prefix }: { prefix: string }) => new Map([...store].filter(([k]) => k.startsWith(prefix))),
  };
  const aiRun = vi.fn(async () => ({ translated_text: "Fighting broke out near the border, the army said." }));
  // Translation is counted against the daily AI ceiling, so it needs a database to count in.
  resetAiBudgetTableCheck();
  const env = { AI: { run: aiRun }, TRANSLATION_ENABLED: "true", DB: fakeD1().DB } as unknown as Env;
  let current = feed([item(1, "Combats à la frontière"), item(2, "Attaque près de Djibo : dix soldats tués")]);
  vi.stubGlobal("fetch", async () => new Response(current, { headers: { "content-type": "application/rss+xml" } }));
  afterAll(() => vi.unstubAllGlobals());

  const actor = new AfricaWireActor({ storage } as unknown as DurableObjectState, env);
  const crawl = () => actor.fetch(new Request("http://africa-wire-actor/process-source?index=0"));
  store.set("source:0", { url: "https://journal.example/", country: "BF", status: "ok", feedUrl: "https://journal.example/feed", lastCheckedAt: new Date().toISOString() });

  it("translates each item once, however many times the source is re-crawled", async () => {
    await crawl();
    expect(aiRun).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 5; i++) await crawl();
    expect(aiRun).toHaveBeenCalledTimes(2);
    const items = store.get("items:0") as { riskTextEn?: string }[];
    expect(items.every((it) => it.riskTextEn?.includes("Fighting broke out"))).toBe(true);
  });

  it("translates only the new item when the feed changes", async () => {
    current = feed([item(3, "Frappe de drone près de Kidal"), item(1, "Combats à la frontière"), item(2, "Attaque près de Djibo : dix soldats tués")]);
    await crawl();
    expect(aiRun).toHaveBeenCalledTimes(3);
  });

  it("never calls the translation model when translation is switched off (the default)", async () => {
    const offStore = new Map<string, unknown>([["source:0", store.get("source:0")]]);
    const offStorage = { get: async (k: string) => offStore.get(k), put: async (k: string, v: unknown) => void offStore.set(k, v), list: async () => new Map() };
    const offRun = vi.fn();
    const off = new AfricaWireActor({ storage: offStorage } as unknown as DurableObjectState, { AI: { run: offRun } } as unknown as Env);
    for (let i = 0; i < 3; i++) await off.fetch(new Request("http://africa-wire-actor/process-source?index=0"));
    expect(offRun).not.toHaveBeenCalled();
    // The items are still crawled and stored, just untranslated.
    expect((offStore.get("items:0") as unknown[]).length).toBeGreaterThan(0);
  });

  it("does not retry an item whose translation failed", async () => {
    aiRun.mockImplementationOnce(async () => {
      throw new Error("model error");
    });
    current = feed([item(4, "Embuscade meurtrière près de Tillabéri")]);
    await crawl();
    await crawl();
    expect(aiRun).toHaveBeenCalledTimes(4);
  });
});
