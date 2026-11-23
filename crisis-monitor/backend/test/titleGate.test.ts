import { afterEach, describe, expect, it } from "vitest";
import { titleIsRelevant } from "../src/lib/titleGate";
import { resetAiSettingsCache, saveAiSettings } from "../src/lib/aiSettings";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

const PASS = [
  // English: conflict, security, crime, intercommunal, killing, and the vague words headlines use for violence.
  "RSF drone strike hits El Fasher market",
  "Gunmen kill 12 in Plateau village",
  "Herders and farmers clash in Benue",
  "Al-Shabaab attack on army base near Mogadishu",
  "Bandits abduct 30 students in Zamfara",
  "Police arrest suspects after Nairobi robbery",
  "Kenya: intercommunal violence flares in Marsabit",
  "Tension in Kasai after weekend events",
  "Residents flee as gunshots heard in Bunia",
  "Unrest grips Kismayo",
  "Mob burns suspect in Kisumu",
  "Cattle raiders strike Turkana village",
  "Hostilities resume in Kordofan",
  "Bodies found in Lake Victoria",
  "Death toll rises in Goma",
  "Two die in Mandera incident",
  "Houses torched in Tana River revenge raid",
  "Curfew imposed in Jos",
  "Fighters seize town in Cabo Delgado",
  "Chaos in Juba as soldiers loot market",
  "Man hacked to death in Kisii land dispute",
  "Teachers' strike enters second week",
  "Security forces deployed to Lamu",
  // French, Portuguese
  "Mali : une attaque djihadiste fait 20 morts",
  "RDC : des miliciens CODECO tuent 15 civils en Ituri",
  "Burkina : enlèvement de 50 femmes près d'Arbinda",
  "Cameroun : heurts entre éleveurs et agriculteurs",
  "Moçambique: insurgentes atacam aldeia, vários mortos",
  "Angola: polícia dispersa manifestação em Luanda",
  // Arabic, Amharic, Swahili, Hausa, Somali, Oromo, Kinyarwanda, Lingala
  "مقتل 10 في قصف على الفاشر",
  "اشتباكات قبلية في جنوب كردفان",
  "በአማራ ክልል ግጭት",
  "Watu watano wauawa Lamu",
  "Majambazi wavamia benki Mombasa",
  "'Yan bindiga sun kashe mutane 20 a Zamfara",
  "Al-Shabaab oo weerar ku qaaday Baydhabo",
  "Lola Wallaggaa keessatti",
  "Abantu batanu bishwe mu gitero",
  "Bitumba na Rutshuru",
];
const STOP = [
  "Kenya's central bank holds rates steady",
  "Nigeria wins AFCON qualifier",
  "New maize variety boosts yields in Malawi",
  "Ethiopia's airline adds Lagos flights",
  "Mortgage rates fall in South Africa",
  "Diesel prices rise on Tuesday",
  "Robert Ruto opens new hospital wing",
  "Treasury securities auction oversubscribed",
  "Tech hub opens in Kigali",
  "Safaricom executive unveils mobile money deadline",
  "Warm weather expected in Mombasa this Wednesday",
  "Burna Boy to headline Nairobi festival",
  "Fleet of new buses arrives in Dar es Salaam",
  "Coupon scheme boosts retail sales",
  "Stability returns to the shilling",
  "Policy dialogue on trade opens in Addis Ababa",
];

describe("the headline gate", () => {
  afterEach(() => resetAiSettingsCache());
  it("passes conflict, security, crime, intercommunal violence and killing, in every language read", () => {
    for (const t of PASS) expect(titleIsRelevant(t), t).toBe(true);
  });
  it("passes over everything else, including words that only look alike", () => {
    for (const t of STOP) expect(titleIsRelevant(t), t).toBe(false);
    expect(titleIsRelevant("")).toBe(false);
  });
  it("passes headlines with an admin's own extra words", async () => {
    const env = { DB: fakeD1().DB } as unknown as Env;
    expect(titleIsRelevant("Boda boda riders block highway in Kakamega")).toBe(false);
    await saveAiSettings(env, { extraKeywords: "boda boda\nhighway block" });
    expect(titleIsRelevant("Boda boda riders block highway in Kakamega")).toBe(true);
  });
});

import { candidateCountry, shareByCountry } from "../src/escalationIncidents";
describe("sharing reading slots by country", () => {
  it("lets Ethiopia in between a run of Sudan stories", () => {
    const c = (id: string, title: string) => ({ id, url: id, domain: "x", origin: "africa-wire" as const, title, feedText: null, publishedAt: null, priority: 1 });
    const list = [c("1", "RSF shells El Fasher"), c("2", "Clashes in Khartoum"), c("3", "Drone strike in Kordofan"), c("4", "Fano fighters attack Gondar in Amhara"), c("5", "በአማራ ክልል ግጭት")];
    expect(candidateCountry(list[3])).toBe("ET");
    expect(candidateCountry(list[4])).toBe("ET");
    const order = shareByCountry(list).map((x) => x.id);
    expect(order.slice(0, 2).sort()).toEqual(["1", "4"]);
  });
});

import { gateText } from "../src/lib/titleGate";
describe("Ethiopian and Eritrean items", () => {
  it("judges a post by its text, not only its first line", () => {
    const post = { title: "#Tikvah (Telegram: Tikvah-Ethiopia)", feedText: "#Tikvah\nበምዕራብ ጎጃም ዞን በተፈጸመ ጥቃት 12 ሰዎች ተገደሉ።" };
    expect(titleIsRelevant(post.title)).toBe(false);
    expect(titleIsRelevant(gateText(post))).toBe(true);
  });
  it("passes Tigrinya, Afaan Oromoo and Amharic reports", () => {
    for (const t of ["ኲናት ኣብ ምብራቕ ትግራይ", "ሰራዊት ኤርትራ ተቐቲሎም", "Godina Wallagga Lixaa keessatti namoonni 10 ajjeefaman", "Rasaasa humnoota mootummaan", "በአማራ ክልል ተኩስ", "ታጣቂዎች ሰዎችን አፈኑ"])
      expect(titleIsRelevant(t), t).toBe(true);
  });
});
