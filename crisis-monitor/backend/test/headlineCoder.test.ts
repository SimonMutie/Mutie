/**
 * The headline tier: what a rule-based reading of a headline and feed
 * summary will and will not code. Every positive also goes through the
 * same verification as a model's coding.
 */
import { describe, it, expect } from "vitest";
import { codeHeadline } from "../src/lib/headlineCoder";
import { verifyCoding, type ArticleForCoding } from "../src/lib/escalationCoder";
import { decideLevel, type ScoringReport } from "../src/lib/escalationCodebook";

const NOW = new Date("2026-10-05T12:00:00Z");
const item = (title: string, feedText = "") => ({ title, feedText, publishedAt: NOW.toISOString() });

function code(title: string, feedText = "") {
  const raw = codeHeadline(item(title, feedText), NOW);
  const article: ArticleForCoding = { url: "https://x.example/a", title, text: feedText || title, textBasis: "feed_summary", publishedAt: NOW.toISOString(), domain: "x.example" };
  const outcome = verifyCoding(raw, article, NOW);
  const r = outcome.reports[0];
  return { raw, outcome, report: r, ids: r ? r.indicators.map((i) => i.id).sort() : [], where: r ? `${r.place ?? r.admin1}, ${r.countryCode}` : null };
}

describe("what the headline tier codes", () => {
  it("an attack with a death toll, at the place named with it", () => {
    const c = code("Gunmen kill 12 villagers in Plateau State attack", "Gunmen killed 12 villagers in an overnight attack on Bokkos in Plateau State, residents said on Monday.");
    expect(c.ids).toEqual(["attack_on_civilians", "mass_atrocity"]);
    expect(c.report.fatalities).toBe(12);
    expect(c.report.countryCode).toBe("NG");
    expect(c.report.confidence).toBe("low");
    expect(c.report.indicators[0].quote).toContain("Gunmen kill");
  });

  it("an air or drone strike", () => {
    const c = code("Drone strike hits Mekelle market, officials say", "A drone strike hit a market in Mekelle, the capital of Ethiopia's Tigray region, on Monday.");
    expect(c.ids).toEqual(["air_or_drone_strike"]);
    expect(c.where).toBe("Mekelle, ET");
  });

  it("clashes, shelling and a town changing hands, in one report", () => {
    const c = code("RSF captures town of Babanusa after days of heavy fighting", "The Rapid Support Forces captured the town of Babanusa in West Kordofan after days of heavy fighting and shelling, residents said.");
    expect(c.ids).toEqual(["armed_clash", "heavy_weapons", "territorial_change"]);
    expect(c.report.countryCode).toBe("SD");
    expect(c.report.actors.join(" ").toLowerCase()).toContain("rapid support forces");
  });

  it("a named armed group and a violent act, with no generic word like 'gunmen'", () => {
    const c = code("JNIM kills 15 soldiers in attack on army base near Gao");
    expect(c.ids).toContain("attack_on_security_forces");
    expect(c.report.fatalities).toBe(15);
    expect(c.report.countryCode).toBe("ML");
  });

  it("French-language reports", () => {
    const c = code("Burkina Faso : des hommes armés tuent 20 civils près de Djibo", "Des hommes armés ont attaqué un village près de Djibo, dans le nord du Burkina Faso, faisant 20 morts selon des sources locales.");
    expect(c.ids).toContain("attack_on_civilians");
    expect(c.report.countryCode).toBe("BF");
    expect(c.report.fatalities).toBe(20);
  });

  it("takes the place from the sentence that reports the event, not from where someone was speaking", () => {
    const c = code("Minister briefs press in Nairobi", "Speaking in Nairobi, the minister gave an update. Clashes erupted in Jonglei State between rival militias on Sunday.");
    expect(c.where).toBe("Jonglei, SS");
  });

  it("a number that is not a death toll is not read as one", () => {
    expect(code("Clashes erupt in Goma, 25 km from the border", "").report.fatalities).toBeNull();
    expect(code("Fighting resumes in El Fasher as siege enters 500 days", "").report.fatalities).toBeNull();
    // A war's running total is not one event's toll.
    expect(code("Drone strike hits Omdurman", "A drone strike hit Omdurman on Monday. More than 150 people have been killed since the fighting began.").report.fatalities).toBeNull();
  });
});

describe("death tolls: the figure stated for the event, or none", () => {
  // Shapes taken from a day's real conflict headlines, reworded.
  it("takes the toll, not another number in the sentence", () => {
    // "across three districts" follows the verb, but 28 is the toll.
    const plateau = code("Nigeria: 28 Killed Despite Curfew in Plateau", "At least 28 people have been killed in a new wave of attacks across three districts of Plateau State despite a curfew.");
    expect(plateau.report.fatalities).toBe(28);
    expect(code("Boko Haram fighters gun down farmers in Borno", "Suspected Boko Haram insurgents ambushed and killed 15 farmers and abducted three others in Marte, Borno State.").report.fatalities).toBe(15);
    expect(code("Bandits kill at least nine in raid on Zamfara village").report.fatalities).toBe(9);
    expect(code("Attack on Mopti village leaves 20 dead").report.fatalities).toBe(20);
  });

  it("does not read the wounded, the abducted or the displaced as the dead", () => {
    const elObeid = code("Drone strike on El Obeid shelter kills boy, wounds 12 children", "A drone strike on a shelter in El Obeid, North Kordofan, reportedly killed a boy and wounded 12 children.");
    expect(elObeid.ids).toEqual(["air_or_drone_strike"]);
    expect(elObeid.report.fatalities).toBeNull();
    expect(code("Gunmen attack Kaduna village, 14 abducted, two killed").report.fatalities).not.toBe(14);
    expect(code("Shelling hits Kadugli, 30 injured").report.fatalities).toBeNull();
  });

  it("does not take several days' or a month's total as one event's toll", () => {
    const alamata = code("Alamata fighting leaves trail of civilian casualties", "More than 50 civilians have reportedly been killed in and around Alamata, southern Tigray, during several days of intense fighting in late September.");
    expect(alamata.ids).toContain("armed_clash");
    expect(alamata.report.fatalities).toBeNull();
  });

  it("prefers a stated figure to 'dozens', and reads 'dozens' as the least it can mean", () => {
    expect(code("Dozens dead after rebels attack village in Ituri", "At least 31 people were killed when rebels attacked a village in Ituri province overnight.").report.fatalities).toBe(31);
    expect(code("Dozens killed as gunmen attack village in Benue State").report.fatalities).toBe(24);
  });
});

describe("what the headline tier leaves alone", () => {
  const rejected = (title: string, feedText = "") => {
    const c = code(title, feedText);
    return c.outcome.reports.length === 0 ? (c.raw.rejection_reason ?? c.outcome.rejectionReason) : `CODED ${c.ids.join(",")}`;
  };

  it("warnings, threats, fears and plans — nothing has happened", () => {
    expect(rejected("Army warns of attack on Maiduguri", "The army warned of a possible attack on Maiduguri by insurgents.")).toBe("threat_or_warning_only");
    expect(rejected("Rebels threaten to seize control of Goma")).toBe("threat_or_warning_only");
    expect(rejected("Fears of fresh fighting in Tigray grow as talks stall")).toBe("threat_or_warning_only");
  });

  it("commentary, court news, anniversaries, sport and figurative language", () => {
    expect(rejected("Analysis: why the clashes in Darfur keep spreading")).toBe("commentary_or_analysis");
    expect(rejected("Court jails militia leader over attack that killed 30 in Ituri")).toBe("legal_or_court");
    expect(rejected("Ten years on: remembering the Garissa attack that killed 148")).toBe("retrospective");
    expect(rejected("Kaduna massacre of 2023: survivors still wait for justice")).toBe("retrospective");
    expect(rejected("Striker's late attack kills off Enyimba in Kano league clash")).toBe("not_security_related");
  });

  it("events outside Africa that mention an African country", () => {
    expect(rejected("Kenyan killed in drone strike in Ukraine, family in Kisumu says")).toBe("outside_africa");
    expect(rejected("Drone strike kills 10 in the capital, officials say")).toBe("outside_africa");
  });

  it("protests, accidents, disease and animals, whatever words they use", () => {
    expect(rejected("Police clash with protesters in Lagos over fuel prices")).toBe("threat_or_warning_only");
    expect(rejected("Bus crash kills 22 near Nakuru")).toBe("threat_or_warning_only");
    expect(rejected("Cholera kills 40 in Borno camp")).toBe("threat_or_warning_only");
    expect(rejected("Hippo attack kills three fishermen on Lake Naivasha")).toBe("threat_or_warning_only");
    expect(rejected("Gold mine collapse kills 20 in Kayes")).toBe("threat_or_warning_only");
  });

  it("an event with only a country named is left for a full reading rather than pinned to the country's centre", () => {
    expect(rejected("Gunmen kill 9 in Nigeria attack")).toBe("unverified");
  });
});

describe("what a headline-tier report can and cannot flag by itself", () => {
  const report = (title: string, feedText: string, domain: string): ScoringReport => {
    const r = code(title, feedText).report;
    return { sourceKey: domain, indicators: r.indicators.map((i) => i.id), fatalities: r.fatalities, trajectory: r.trajectory, confidence: r.confidence };
  };
  it("one outlet reporting a strike with no death toll does not raise a marker; a second outlet does", () => {
    const a = report("Drone strike hits Mekelle market", "", "a.example");
    const b = report("Air strike reported in Mekelle, Tigray", "", "b.example");
    expect(decideLevel([a]).level).toBe("watch");
    expect(decideLevel([a, b]).level).toBe("elevated");
  });
  it("a stated death toll of five or more raises one; twenty-five or more is critical only with a second outlet", () => {
    expect(decideLevel([report("Bandits kill 7 in Zamfara village raid", "", "a.example")]).level).toBe("elevated");
    expect(decideLevel([report("Bandits kill 3 in Zamfara village raid", "", "a.example")]).level).toBe("watch");
    const one = decideLevel([report("Gunmen kill 40 villagers in attack in Benue", "", "a.example")]);
    expect(one.level).toBe("elevated");
    expect(one.criteriaMet.join(" ")).toMatch(/Elevated until a second source reports it or the article is read in full/);
    expect(decideLevel([report("Gunmen kill 40 villagers in attack in Benue", "", "a.example"), report("Benue: 40 villagers killed in gunmen attack", "", "b.example")]).level).toBe("critical");
  });
  it("a strike or clash from one outlet is raised by a death toll, or by a second outlet reporting violence there", () => {
    expect(decideLevel([report("Drone strike kills seven near El Fasher", "", "a.example")]).level).toBe("elevated");
    expect(decideLevel([report("Drone strike hits El Fasher market", "", "a.example")]).level).toBe("watch");
    expect(decideLevel([report("Drone strike hits El Fasher market", "", "a.example"), report("Gunmen kill two traders in El Fasher", "", "b.example")]).level).toBe("elevated");
  });
});
