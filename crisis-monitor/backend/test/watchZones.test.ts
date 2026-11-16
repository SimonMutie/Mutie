import { describe, expect, it } from "vitest";
import { buildZones, matchZone } from "../src/lib/watchZones";

describe("watch zones", () => {
  it("matches whole words and prefers the more specific zone", () => {
    expect(matchZone("Houthi missile hits ship in the Red Sea")?.id).toBe("red-sea");
    expect(matchZone("Houthis claim strike on Sanaa airport")?.id).toBe("yemen");
    expect(matchZone("Fano fighters seize town in Amhara")?.id).toBe("ethiopia");
    expect(matchZone("Clashes in Juba as South Sudan tensions rise")?.id).toBe("south-sudan");
    expect(matchZone("Weather warning for the weekend")).toBeNull();
    expect(matchZone("Sudanese pound falls")).toBeNull();
  });
  it("files headlines once, newest first, and places incidents by position", () => {
    const zones = buildZones(
      [
        { title: "Drone attack on vessel in the Red Sea", text: "", link: "https://a/1", source: "BBC", published: "2026-11-15T10:00:00Z", telegram: false },
        { title: "Drone attack on vessel in the Red Sea", text: "", link: "https://b/1", source: "AJ", published: "2026-11-15T11:00:00Z", telegram: false },
        { title: "Tigray forces mobilise", text: "", link: "https://t.me/x/1", source: "Africa Intel", published: "2026-11-16T09:00:00Z", telegram: true },
      ],
      [{ id: "i1", headline: "Fighting near Alamata", level: "elevated", locationLabel: "Alamata", countryName: "Ethiopia", lat: 12.4, lon: 39.6 }]
    );
    const red = zones.find((z) => z.id === "red-sea")!;
    expect(red.headlineCount).toBe(1);
    const eth = zones.find((z) => z.id === "ethiopia")!;
    expect(eth.headlines[0].telegram).toBe(true);
    expect(eth.incidents.map((i) => i.id)).toEqual(["i1"]);
  });
});
