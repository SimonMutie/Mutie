import { describe, expect, it } from "vitest";
import { candidatePriority, isCandidateText, matchesNativeLexicon } from "../src/lib/escalationKeywords";
import { interleaveByKey } from "../src/escalationIncidents";

describe("reports in Horn and East African languages pass the gate", () => {
  it.each([
    ["Amharic: Fano and the army clash in Gojjam", "በጎጃም ፋኖ እና የመከላከያ ሰራዊት መካከል ውጊያ ተካሄደ"],
    ["Amharic: civilians killed in a drone strike", "በድሮን ጥቃት ሰላማዊ ሰዎች ተገደሉ"],
    ["Tigrinya: attack", "ኣብ ዞባ ደቡብ መጥቃዕቲ ተፈፂሙ"],
    ["Afaan Oromoo: OLA attack", "WBOn haleellaa raawwate, namoonni ajjeefaman"],
    ["Somali: fighting", "Dagaal culus ayaa ka dhacay degmada"],
    ["Swahili: soldiers attacked", "Wanajeshi walishambuliwa na waasi"],
  ])("%s", (_label, text) => {
    expect(matchesNativeLexicon(text)).toBe(true);
    expect(isCandidateText(text)).toBe(true);
    expect(candidatePriority(text)).toBeGreaterThan(0);
  });

  it("leaves everyday news out", () => {
    expect(isCandidateText("የኢትዮጵያ ቡና ወደ ውጭ ገበያ ተላከ")).toBe(false); // Ethiopian coffee exported
    expect(isCandidateText("Ethiopian Airlines opens a new route to Lagos")).toBe(false);
  });
});

describe("GDELT's reading budget is shared out by country", () => {
  it("takes one per country in turn, keeping each country's own order", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({ c: "SD", i })),
      ...Array.from({ length: 10 }, (_, i) => ({ c: "PS", i })),
      { c: "ET", i: 0 },
      { c: "ET", i: 1 },
    ];
    const out = interleaveByKey(rows, (r) => r.c, 6);
    expect(out.map((r) => `${r.c}${r.i}`)).toEqual(["SD0", "PS0", "ET0", "SD1", "PS1", "ET1"]);
    expect(interleaveByKey(rows, (r) => r.c, 100)).toHaveLength(22);
  });
});
