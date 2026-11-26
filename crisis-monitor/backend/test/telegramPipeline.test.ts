import { describe, expect, it } from "vitest";
import { africaChannelsDue, mergePosts, readChannelSince } from "../src/lib/osintFeed";
import type { TelegramPost } from "../src/lib/telegram";

describe("Africa Telegram channels", () => {
  it("reads a few at a time, the oldest first, and leaves fresh ones alone", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const first = africaChannelsDue(new Map(), now);
    expect(first).toHaveLength(44);
    const readAt = new Map(first.map((h) => [h, now]));
    const second = africaChannelsDue(readAt, now + 60_000);
    expect(second).toHaveLength(44);
    expect(second.some((h) => first.includes(h))).toBe(false);
    // Once everything is fresh, nothing is due.
    const all = new Map<string, number>();
    for (let i = 0; i < 20; i++) africaChannelsDue(all, now).forEach((h) => all.set(h, now));
    expect(africaChannelsDue(all, now + 5 * 60_000)).toEqual([]);
    expect(all.size).toBe(130);
    expect(africaChannelsDue(all, now + 16 * 60_000)).toHaveLength(44);
  });

  const now = Date.parse("2026-11-26T18:00:00Z");
  const post = (n: number, hoursAgo = 1): TelegramPost => ({ id: `ch/${n}`, channel: "ch", url: `https://t.me/ch/${n}`, publishedAt: new Date(now - hoursAgo * 3600_000).toISOString(), text: `post ${n}`, headline: `post ${n}`, flag: null, summary: "", media: null });
  // A channel whose pages hold 20 posts each, numbered 1..200, newest last.
  const pages = (before?: number) => {
    const top = (before ?? 201) - 1;
    return Array.from({ length: 20 }, (_, i) => top - 19 + i).filter((n) => n >= 1).map((n) => post(n, (200 - n) * 0.1));
  };
  const reader = async (_c: unknown, before?: number) => pages(before);
  const channel = { handle: "ch", name: "Ch", lean: "", bloc: "regional" as const };

  it("pages back until it reaches posts already held", async () => {
    const known = new Set(["ch/150"]);
    const got = await readChannelSince(channel, known, now, reader);
    expect(got[0].id).toBe("ch/141");
    expect(got.at(-1)?.id).toBe("ch/200");
    expect(got).toHaveLength(60);
  });

  it("stops at the page limit, and at posts older than 72 hours", async () => {
    expect(await readChannelSince(channel, new Set(), now, reader)).toHaveLength(80);
    const old = async (_c: unknown, before?: number) => pages(before).map((p) => ({ ...p, publishedAt: new Date(now - 100 * 3600_000).toISOString() }));
    expect(await readChannelSince(channel, new Set(), now, old)).toHaveLength(20);
  });

  it("keeps what was read when a later page fails", async () => {
    let calls = 0;
    const flaky = async (_c: unknown, before?: number) => {
      if (calls++ > 0) throw new Error("HTTP 429");
      return pages(before);
    };
    expect(await readChannelSince(channel, new Set(), now, flaky)).toHaveLength(20);
  });

  it("adds readings together instead of replacing them, within 72 hours", () => {
    const merged = mergePosts([post(1, 80), post(2, 5), post(3, 4)], [post(3, 4), post(4, 1)], now);
    expect(merged.map((p) => p.id)).toEqual(["ch/2", "ch/3", "ch/4"]);
  });
});
