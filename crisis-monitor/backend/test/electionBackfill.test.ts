import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { backfillElectionFromGdelt, backfillElectionIfNeeded, ensureElectionWatchTables, KE_WATCH, resetElectionWatchCheck, runArchiveJob } from "../src/lib/electionWatch";
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
      const many = Array.from({ length: 250 }, (_, i) => article(1000 + urls.length * 300 + i, `Kenya election rally ${i} in Nairobi IEBC`));
      return jsonResponse({ articles: many });
    }) as unknown as typeof fetch;

    const job = await runArchiveJob(env, KE_WATCH, { months: 1, maxSlices: 100, paceMs: 0 });
    expect(job?.status).toBe("done");
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const u of urls) {
      expect(u.searchParams.get("startdatetime")).toMatch(/^\d{14}$/);
      expect(u.searchParams.get("enddatetime")).toMatch(/^\d{14}$/);
      expect(u.searchParams.has("timespan")).toBe(false);
    }
    expect(job?.capped).toBe(urls.length);
  });

  it("stops at a rate limit, keeps its place, and carries on from the same slice", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      // The third search is refused; after that GDELT answers again.
      if (calls === 3) return new Response("slow down", { status: 429, headers: { "retry-after": "30" } });
      return jsonResponse({ articles: [article(2000 + calls, `Kenya IEBC rally number ${calls} in Nairobi`)] });
    }) as unknown as typeof fetch;

    const first = await runArchiveJob(env, KE_WATCH, { months: 3, maxSlices: 100, paceMs: 0 });
    expect(first?.status).toBe("rate_limited");
    const cursorAtStop = first!.cursor;
    const slicesAtStop = first!.slicesDone;

    globalThis.fetch = vi.fn(async () => jsonResponse({ articles: [article(3000, "Ruto addresses Kenyans in Nakuru on IEBC reforms")] })) as unknown as typeof fetch;
    // Wait out GDELT's cooldown, as a later tick would.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10 * 60_000);
    const resumed = await runArchiveJob(env, KE_WATCH, { maxSlices: 100, paceMs: 0 });
    vi.useRealTimers();
    expect(resumed?.cursor).toBeLessThan(cursorAtStop);
    expect(resumed?.slicesDone).toBeGreaterThan(slicesAtStop);
    expect(resumed?.status).toBe("done");
  });
  it("waits out GDELT's retry-after before asking again, across periods and ticks", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response("slow down", { status: 429, headers: { "retry-after": "30" } });
    }) as unknown as typeof fetch;

    const refused = await runArchiveJob(env, KE_WATCH, { months: 1, maxSlices: 5, paceMs: 0 });
    expect(refused?.status).toBe("rate_limited");
    expect(refused?.retryAt).toBeGreaterThan(Date.now() + 4 * 60_000); // at least five minutes, whatever GDELT asked
    const callsAtRefusal = calls;

    // A scheduled tick, and a button press for a different period, both wait.
    await runArchiveJob(env, KE_WATCH, { maxSlices: 5, paceMs: 0 });
    const otherPeriod = await runArchiveJob(env, KE_WATCH, { months: 3, maxSlices: 5, paceMs: 0 });
    expect(calls).toBe(callsAtRefusal);
    expect(otherPeriod?.status).toBe("rate_limited");
    expect(otherPeriod?.slicesDone).toBe(0);
  });
});
