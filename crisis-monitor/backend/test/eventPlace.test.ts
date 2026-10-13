/**
 * Where an event happened, as against where its story was filed from.
 *
 * The case behind this file: a drone strike on Riyadh was put in Dubai,
 * because the Reuters story began "DUBAI, Oct 12 (Reuters) -", and the
 * location rule took the first place a text names. Stories about Saudi
 * Arabia are routinely filed from Dubai; the same happens with Beirut,
 * Nairobi or Cairo for their regions.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { splitDateline, stripDatelines, datelinePlaces } from "../src/lib/dateline";
import { placeFromEvidence } from "../src/lib/eventPlace";
import { verifyCoding, type ArticleForCoding, type RawCodedEvent, type RawCoding } from "../src/lib/escalationCoder";
import { codeHeadline, headlineText } from "../src/lib/headlineCoder";
import { locateEventText } from "../src/lib/eventLocation";
import { locateText, resolvePlaceOffline } from "../src/lib/africaGeo";
import { getFlaggedIncidents, relocateRecentReports, resetEscalationTableCheck } from "../src/escalationIncidents";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

describe("datelines", () => {
  const cases: [string, string | null, string][] = [
    ["DUBAI, Oct 12 (Reuters) - Saudi air defences intercepted drones over Riyadh.", "DUBAI", "Saudi air defences intercepted drones over Riyadh."],
    ["DUBAI (Reuters) - Saudi air defences intercepted drones.", "DUBAI", "Saudi air defences intercepted drones."],
    ["DUBAI/RIYADH, Oct 12 (Reuters) - Saudi Arabia said.", "DUBAI/RIYADH", "Saudi Arabia said."],
    ["RIYADH (AP) — Drones struck the capital.", "RIYADH", "Drones struck the capital."],
    ["Dubai, United Arab Emirates (AP) — Drones struck Riyadh.", "Dubai", "Drones struck Riyadh."],
    ["KHARTOUM, Sudan, Oct. 12 (Xinhua) -- Fighting resumed.", "KHARTOUM", "Fighting resumed."],
    ["Riyadh, October 12, 2026, SPA -- Air defense forces intercepted a drone.", "Riyadh", "Air defense forces intercepted a drone."],
    ["RIYADH: Saudi air defenses intercepted two drones.", "RIYADH", "Saudi air defenses intercepted two drones."],
    ["BEIRUT — Israeli strikes hit the south.", "BEIRUT", "Israeli strikes hit the south."],
    ["Jeddah, Saudi Arabia — Officials said.", "Jeddah", "Officials said."],
    ["(Reuters) - Saudi Arabia said on Sunday.", null, "Saudi Arabia said on Sunday."],
  ];
  it.each(cases)("reads %s", (text, dateline, rest) => {
    expect(splitDateline(text)).toEqual({ dateline, rest });
  });

  it.each([
    "Riyadh said on Monday it had intercepted drones.",
    "Dubai airport closed after a drone sighting.",
    "UN: Ceasefire talks resume in Jeddah.",
    "BREAKING — Explosions heard in Riyadh.",
    "El Fasher - RSF shelling continued overnight.",
    "Saudi Arabia — drones intercepted over Riyadh",
  ])("leaves an ordinary opening alone: %s", (text) => {
    expect(splitDateline(text)).toEqual({ dateline: null, rest: text });
  });

  it("finds the places a dateline names, and strips one at the start of any paragraph", () => {
    expect(datelinePlaces("DUBAI/RIYADH, Oct 12 (Reuters) - Saudi Arabia said.")).toEqual([
      { label: "Dubai", countryCode: "AE" },
      { label: "Riyadh", countryCode: "SA" },
    ]);
    expect(stripDatelines("Saudi drone attack\nDUBAI (Reuters) - Drones hit Riyadh.")).toBe("Saudi drone attack\nDrones hit Riyadh.");
  });
});

describe("the place the event's description names", () => {
  const base = { countryCode: "AE", admin1: null, filedFrom: [{ label: "Dubai", countryCode: "AE" }] };

  it("moves an event from its dateline to the one town its description names", () => {
    const fix = placeFromEvidence({ ...base, place: "Dubai", evidence: ["Saudi air defences intercepted drones over Riyadh, the defence ministry said."] });
    expect(fix).toMatchObject({ countryCode: "SA", place: "Riyadh", admin1: null });
    expect(fix!.note).toMatch(/Dubai is only the story's dateline/);
  });
  it("keeps a place the description names", () => {
    expect(placeFromEvidence({ ...base, countryCode: "SA", place: "Riyadh", evidence: ["Drones were intercepted over Riyadh."] })).toBeNull();
  });
  it("keeps a town the story itself reports on, even when this event's description names another", () => {
    const evidence = ["Two drones were shot down over Riyadh on Sunday night.", "drones were shot down over Riyadh"];
    expect(placeFromEvidence({ countryCode: "SA", place: "Dammam", admin1: null, filedFrom: [], evidence })).toBeNull();
    expect(placeFromEvidence({ countryCode: "SA", place: "Dammam", admin1: null, filedFrom: [], evidence, articleText: "Drones were shot down over Riyadh, and a drone struck near the airport in Dammam." })).toBeNull();
  });
  it("moves a place the story never names to the one town the description names", () => {
    const fix = placeFromEvidence({ countryCode: "SA", place: "Dammam", admin1: null, filedFrom: [], evidence: ["Two drones were shot down over Riyadh on Sunday night."], articleText: "Two drones were shot down over Riyadh on Sunday night." });
    expect(fix).toMatchObject({ countryCode: "SA", place: "Riyadh" });
  });
  it("places an event at a site inside its town that the description names", () => {
    const fix = placeFromEvidence({ countryCode: "SA", place: "Dammam", admin1: null, filedFrom: [], evidence: ["A drone struck Dammam's King Fahd International Airport, halting flights."] });
    expect(fix).toMatchObject({ countryCode: "SA", place: "King Fahd International Airport" });
    expect(placeFromEvidence({ countryCode: "SA", place: "King Fahd International Airport", admin1: null, filedFrom: [], evidence: ["Debris fell at Dammam airport."] })).toBeNull();
  });
  it("does not guess when the description names several towns", () => {
    expect(placeFromEvidence({ countryCode: "YE", place: "Marib", admin1: null, filedFrom: [], evidence: ["Houthi forces in Sanaa fired missiles at Riyadh."] })).toBeNull();
  });
  it("drops a dateline place to the country when the description names no town", () => {
    const fix = placeFromEvidence({ ...base, place: "Dubai", evidence: ["Saudi Arabia said its air defences intercepted several drones."] });
    expect(fix).toMatchObject({ countryCode: "SA", place: null, admin1: null });
  });
  it("corrects a country that came only from the dateline", () => {
    const fix = placeFromEvidence({ ...base, place: null, evidence: ["Drones struck an oil facility near Riyadh."] });
    expect(fix).toMatchObject({ countryCode: "SA", place: "Riyadh" });
  });
  it("leaves things alone when there is nothing to go on", () => {
    expect(placeFromEvidence({ countryCode: "SD", place: null, admin1: null, filedFrom: [], evidence: ["Fighting continued, residents said."] })).toBeNull();
  });
});

const NOW = new Date("2026-10-12T12:00:00Z");
const article = (text: string, over: Partial<ArticleForCoding> = {}): ArticleForCoding => ({ url: "https://reuters.example/a", title: "Saudi Arabia intercepts drones", text, textBasis: "full_text", publishedAt: "2026-10-12T08:00:00Z", domain: "reuters.example", ...over });
const event = (over: Partial<RawCodedEvent>): RawCodedEvent => ({
  country: "Saudi Arabia", country_iso2: "SA", place: null, admin1: null, lat: null, lon: null, event_date: "2026-10-12", novelty: "new_event",
  actors: [], indicators: [], fatalities: null, fatalities_quote: null, trajectory: "unclear", trajectory_reason: null,
  what_happened: "Something happened.", significance: null, confidence: "high", ...over,
});
const coding = (...events: RawCodedEvent[]): RawCoding => ({ is_event_report: true, rejection_reason: null, events });
const RIYADH_STORY = "DUBAI, Oct 12 (Reuters) - Saudi air defences intercepted and destroyed drones launched at Riyadh early on Sunday, the defence ministry said. Debris fell on a residential district of Riyadh, wounding three people.";

describe("the full reading", () => {
  it("does not put a Riyadh strike at the story's dateline, whatever the model says", () => {
    const out = verifyCoding(
      coding(event({ country: "United Arab Emirates", country_iso2: "AE", place: "Dubai", what_happened: "Drones launched at Riyadh were intercepted and debris wounded three people.", indicators: [{ id: "air_or_drone_strike", quote: "intercepted and destroyed drones launched at Riyadh" }] })),
      article(RIYADH_STORY),
      NOW
    );
    expect(out.reports).toHaveLength(1);
    expect(out.reports[0]).toMatchObject({ countryCode: "SA", place: "Riyadh" });
    expect(out.reports[0].notes.join(" ")).toMatch(/dateline/);
  });
  it("leaves a correct coding untouched", () => {
    const out = verifyCoding(coding(event({ place: "Riyadh", what_happened: "Drones launched at Riyadh were intercepted.", indicators: [{ id: "air_or_drone_strike", quote: "intercepted and destroyed drones launched at Riyadh" }] })), article(RIYADH_STORY), NOW);
    expect(out.reports[0]).toMatchObject({ countryCode: "SA", place: "Riyadh" });
    expect(out.reports[0].notes.join(" ")).not.toMatch(/dateline/);
  });
});

describe("the headline pass", () => {
  it("reads past the dateline at the start of a feed summary", () => {
    const item = { title: "Saudi air defences intercept drones over Riyadh", feedText: "DUBAI, Oct 12 (Reuters) - Saudi air defences intercepted drones launched at Riyadh early on Sunday, the defence ministry said.", publishedAt: NOW.toISOString() };
    expect(headlineText(item)).not.toMatch(/DUBAI/);
    const raw = codeHeadline(item, NOW);
    if (raw.is_event_report) expect(raw.events[0]).toMatchObject({ country_iso2: "SA", place: "Riyadh" });
    else expect(raw.rejection_reason).not.toBe("outside_africa");
  });
});

describe("Dammam's airport", () => {
  it("is read as the place, and labelled with its town", () => {
    expect(locateText("Drones targeted Dammam's King Fahd International Airport")).toMatchObject({ label: "King Fahd International Airport", within: "Dammam", countryCode: "SA" });
    expect(locateText("Explosions heard in Dammam")).toMatchObject({ label: "Dammam" });
    expect(resolvePlaceOffline({ countryCode: "SA", place: "Dammam airport" })).toMatchObject({ label: "King Fahd International Airport, Dammam", precision: "place" });
    expect(locateEventText("Drone hits Dammam's King Fahd International Airport", "")).toMatchObject({ place: "King Fahd International Airport, Dammam, Saudi Arabia" });
  });
  it("keeps a Dammam airport event in a story that also reports Riyadh", () => {
    const story = "DUBAI, Oct 12 (Reuters) - Saudi air defences intercepted drones over Riyadh on Sunday. Separately, a drone struck near Dammam's King Fahd International Airport, briefly halting flights.";
    const out = verifyCoding(
      coding(
        event({ place: "Riyadh", what_happened: "Drones over Riyadh were intercepted.", indicators: [{ id: "air_or_drone_strike", quote: "intercepted drones over Riyadh" }] }),
        event({ place: "Dammam", what_happened: "A drone struck near the King Fahd International Airport, halting flights.", indicators: [{ id: "air_or_drone_strike", quote: "a drone struck near Dammam's King Fahd International Airport" }] })
      ),
      article(story),
      NOW
    );
    expect(out.reports.map((r) => r.place)).toEqual(["Riyadh", "King Fahd International Airport"]);
  });
});

describe("the query maps", () => {
  it("place an item where its text says, not where it was filed", () => {
    expect(locateEventText("Drones intercepted over the Saudi capital", "DUBAI (Reuters) - Saudi air defences intercepted drones over Riyadh on Sunday.")).toMatchObject({ place: "Riyadh, Saudi Arabia" });
  });
});

describe("repairing reports already filed at a dateline", () => {
  let env: Env;
  let db: ReturnType<typeof fakeD1>["db"];
  beforeAll(async () => {
    resetEscalationTableCheck();
    const d1 = fakeD1();
    db = d1.db;
    env = { DB: d1.DB, GEOCODER_ENABLED: "false" } as unknown as Env;
    await getFlaggedIncidents(env); // makes the tables
    const now = new Date().toISOString();
    db.prepare("INSERT INTO escalation_articles (id, url, domain, title, origin, published_at, text_basis, status, processed_at) VALUES ('a1', 'https://reuters.example/a', 'reuters.example', 'Saudi Arabia intercepts drones', 'gdelt', ?, 'full_text', 'coded', ?)").run(now, now);
    const ins = db.prepare(
      `INSERT INTO escalation_reports (id, article_id, incident_id, country_code, country_name, place, admin1, lat, lon, geo_precision, geo_method, geo_label, event_date, date_basis, actors, indicators, fatalities, trajectory, what_happened, confidence, notes, excerpt, created_at)
       VALUES (?, 'a1', 'inc-dubai', ?, ?, ?, NULL, ?, ?, 'place', 'gazetteer', ?, '2026-10-12', 'stated', '[]', ?, NULL, 'unclear', ?, 'high', '[]', ?, ?)`
    );
    ins.run("r-dubai", "AE", "United Arab Emirates", "Dubai", 25.2, 55.27, "Dubai", JSON.stringify([{ id: "air_or_drone_strike", label: "Air or drone strike", quote: "intercepted and destroyed drones launched at Riyadh" }]), "Drones launched at Riyadh were intercepted.", RIYADH_STORY, now);
    // Moved to Riyadh by the first version of the repair, though the story reported the airport in Dammam.
    db.prepare(
      `INSERT INTO escalation_reports (id, article_id, incident_id, country_code, country_name, place, admin1, lat, lon, geo_precision, geo_method, geo_label, event_date, date_basis, actors, indicators, fatalities, trajectory, what_happened, confidence, notes, excerpt, created_at)
       VALUES ('r-airport', 'a1', 'inc-riyadh', 'SA', 'Saudi Arabia', 'Riyadh', NULL, 24.71, 46.68, 'place', 'curated', 'Riyadh', '2026-10-12', 'stated', '[]', ?, NULL, 'unclear', ?, 'high', ?, ?, ?)`
    ).run(
      JSON.stringify([{ id: "air_or_drone_strike", label: "Air or drone strike", quote: "a drone launched at Riyadh struck King Fahd International Airport" }]),
      "Of the drones launched at Riyadh, one struck King Fahd International Airport.",
      JSON.stringify(["Located at Riyadh, Saudi Arabia, the place the event's own description names, not Dammam."]),
      "a drone struck King Fahd International Airport in Dammam",
      now
    );
    ins.run("r-ok", "SA", "Saudi Arabia", "Riyadh", 24.71, 46.68, "Riyadh", JSON.stringify([{ id: "air_or_drone_strike", label: "Air or drone strike", quote: "drones launched at Riyadh" }]), "Drones launched at Riyadh were intercepted.", RIYADH_STORY, now);
  });

  it("moves the misplaced report to Riyadh, releases it from its incident to be re-filed, and does it once", async () => {
    expect(await relocateRecentReports(env)).toBe(2);
    const airport = db.prepare("SELECT place, lat, geo_label, incident_id, notes FROM escalation_reports WHERE id = 'r-airport'").get() as { place: string; lat: number; geo_label: string; incident_id: string | null; notes: string };
    expect(airport).toMatchObject({ place: "King Fahd International Airport", geo_label: "King Fahd International Airport, Dammam", incident_id: null });
    expect(Math.abs(airport.lat - 26.47)).toBeLessThan(0.05);
    expect(airport.notes).not.toMatch(/not Dammam/);
    const moved = db.prepare("SELECT country_code, place, lat, lon, incident_id, notes FROM escalation_reports WHERE id = 'r-dubai'").get() as { country_code: string; place: string; lat: number; lon: number; incident_id: string | null; notes: string };
    expect(moved).toMatchObject({ country_code: "SA", place: "Riyadh", incident_id: null });
    expect(Math.abs(moved.lat - 24.71)).toBeLessThan(0.1);
    expect(JSON.parse(moved.notes).join(" ")).toMatch(/dateline/);
    expect((db.prepare("SELECT incident_id FROM escalation_reports WHERE id = 'r-ok'").get() as { incident_id: string }).incident_id).toBe("inc-dubai");
    expect(await relocateRecentReports(env)).toBe(0);
  });
});
