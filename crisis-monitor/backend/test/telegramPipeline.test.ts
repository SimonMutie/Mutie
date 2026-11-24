import { describe, expect, it } from "vitest";
import { africaChannelsDue } from "../src/lib/osintFeed";

describe("Africa Telegram channels", () => {
  it("reads a few at a time, the oldest first, and leaves fresh ones alone", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const first = africaChannelsDue(new Map(), now);
    expect(first).toHaveLength(20);
    const readAt = new Map(first.map((h) => [h, now]));
    const second = africaChannelsDue(readAt, now + 60_000);
    expect(second).toHaveLength(20);
    expect(second.some((h) => first.includes(h))).toBe(false);
    // Once everything is fresh, nothing is due.
    const all = new Map<string, number>();
    for (let i = 0; i < 20; i++) africaChannelsDue(all, now).forEach((h) => all.set(h, now));
    expect(africaChannelsDue(all, now + 5 * 60_000)).toEqual([]);
    expect(all.size).toBe(96);
    expect(africaChannelsDue(all, now + 16 * 60_000)).toHaveLength(20);
  });
});
