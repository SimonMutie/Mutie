import { describe, expect, it } from "vitest";
import { locateEventText } from "../src/lib/eventLocation";

describe("province of a located report", () => {
  it("names the nearest listed province, and none for a country-only report", () => {
    expect(locateEventText("Gunmen attack village near Bor, South Sudan", "")?.province).toBe("Jonglei");
    expect(locateEventText("Attack in Maiduguri Nigeria", "")?.province).toBe("Borno");
    expect(locateEventText("South Sudan economy slows", "")?.province ?? null).toBeNull();
  });
});
