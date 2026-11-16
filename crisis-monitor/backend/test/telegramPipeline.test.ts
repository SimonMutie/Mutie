import { describe, expect, it } from "vitest";
import { africaChannelsDue } from "../src/lib/osintFeed";

describe("Africa Telegram channels for the pipeline", () => {
  it("reads a few channels per tick and gets round all of them", () => {
    const seen = new Set<string>();
    for (let tick = 0; tick < 3; tick++) {
      const due = africaChannelsDue(tick * 300_000);
      expect(due).toHaveLength(6);
      due.forEach((h) => seen.add(h));
    }
    expect(seen.size).toBe(17);
  });
});
