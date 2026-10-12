import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { backfillElectionFromGdelt, backfillElectionIfNeeded, ensureElectionWatchTables, KE_WATCH, resetElectionWatchCheck } from "../src/lib/electionWatch";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

let env: Env;
const originalFetch = globalThis.fetch;
const article = (n: number, title: string, seendate = "20260815T120000Z") => ({
  url: `https://news.example/story-${n}`,
  title,
  seendate,
  domain: "news.example",
  language: "English",
  sourcecountry: "Kenya",
});
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  resetElectionWatchCheck();
  env = { DB: fakeD1().DB } as unknown as Env;
  await ensureElectionWatchTables(env, KE_WATCH);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("GDELT archive backfill for the election watch", () => {
  it("stores coded stories from the archive once, and skips them on a repeat run", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        articles: [
          article(1, "Kenya police fire tear gas as IEBC protesters march in Nairobi"),
          article(2, "Gachagua rally in Nyeri draws thousands"),
        ],
      })
    ) as unknown as typeof fetch;

    const first = await backfillElectionFromGdelt(env, KE_WATCH);
    expect(first.status).toBe("done");
    expect(first.timespan).toBe("full");
    expect(first.scanned).toBeGreaterThan(0);

    const again = await backfillElectionFromGdelt(env, KE_WATCH);
    expect(again.inserted).toBe(0);
  });

  it("falls back to three months when GDELT refuses the full-history search", async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const span = new URL(url).searchParams.get("timespan") ?? "";
      seen.push(span);
      if (span === "full") return new Response("Invalid timespan", { status: 400 });
      return jsonResponse({ articles: [article(3, "Sifuna and Kalonzo join opposition rally in Kisumu")] });
    }) as unknown as typeof fetch;

    const result = await backfillElectionFromGdelt(env, KE_WATCH);
    expect(seen).toContain("full");
    expect(seen).toContain("3months");
    expect(result.timespan).toBe("3months");
    expect(result.status).toBe("done");
  });

  it("stops and reports rate limiting, so the next run tries again", async () => {
    globalThis.fetch = vi.fn(async () => new Response("slow down", { status: 429, headers: { "retry-after": "30" } })) as unknown as typeof fetch;
    const result = await backfillElectionFromGdelt(env, KE_WATCH);
    expect(result.status).toBe("rate_limited");
    // Not marked as done, so the scheduled run will try again.
    globalThis.fetch = vi.fn(async () => jsonResponse({ articles: [article(4, "Ruto signs bill in Nairobi")] })) as unknown as typeof fetch;
    const retry = await backfillElectionIfNeeded(env, KE_WATCH);
    expect(retry?.status).toBe("done");
    expect(await backfillElectionIfNeeded(env, KE_WATCH)).toBeNull();
  });

  it("reads a period in two-week date slices, and reports searches that hit GDELT's cap", async () => {
    const urls: URL[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(new URL(String(input)));
      // Every slice answers with the full 250, so the cap is reported.
      const many = Array.from({ length: 250 }, (_, i) => article(1000 + urls.length * 300 + i, `Kenya election rally ${i} in Nairobi IEBC`));
      return jsonResponse({ articles: many });
    }) as unknown as typeof fetch;

    const result = await backfillElectionFromGdelt(env, KE_WATCH, { months: 1 });
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const u of urls) {
      expect(u.searchParams.get("startdatetime")).toMatch(/^\d{14}$/);
      expect(u.searchParams.get("enddatetime")).toMatch(/^\d{14}$/);
      expect(u.searchParams.has("timespan")).toBe(false);
    }
    expect(result.capped).toBe(urls.length);
    // A period run is not marked as the one-time archive backfill.
    expect(await backfillElectionIfNeeded(env, KE_WATCH)).not.toBeNull();
  });
});
