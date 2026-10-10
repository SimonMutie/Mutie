/**
 * The Reshuffle Ledger, South Sudan 2023–2026: an analyst compilation from the
 * Master Matrix V9 (data cut-off 2 October 2026). We have not independently
 * verified its counts. They are floors: many decrees are read on state radio
 * without a published text, and the matrix tracks some posts only as events.
 * The 22 September 2026 order is checked against allAfrica (see SOURCES.dissolution);
 * the caretaker names are as the compilation gives them.
 */

export const LEDGER = {
  cutOff: "2026-10-02",
  source: "The Reshuffle Ledger · Master Matrix V9 · data cut-off 2 Oct 2026",
  headline: { rows: 236, violations: 17, contested: 8, reinstatements: 23, caretakerPosts: 37 },
} as const;

/** Office-change rows per year. 2026 is split at the 22 September dissolution. */
export const ROWS_BY_YEAR = [
  { year: 2023, total: 17 },
  { year: 2024, total: 31 },
  { year: 2025, total: 87 },
  { year: 2026, total: 101, before: 55, after: 46 },
];

/** Coded seats by year: V = power-sharing violation, C = contested (SPLM-IO seat refilled from the Par Kuol splinter). */
export const CODED_BY_YEAR = [
  { year: 2023, v: 2, c: 0 },
  { year: 2024, v: 2, c: 0 },
  { year: 2025, v: 11, c: 3 },
  { year: 2026, v: 2, c: 5 },
];

/** Churn: appointments per post, Jan 2023 to Sep 2026 (dissolution excluded). */
export const CHURN = [
  { cat: "National Executive", posts: 5, appts: 4, index: 0.8, level: "Low" },
  { cat: "Cabinet", posts: 35, appts: 54, index: 1.54, level: "Moderate" },
  { cat: "Governors", posts: 10, appts: 20, index: 2.0, level: "High" },
  { cat: "Admin areas", posts: 3, appts: 8, index: 2.67, level: "High" },
  { cat: "Economy & judiciary", posts: 4, appts: 11, index: 2.75, level: "High" },
  { cat: "Security & intelligence", posts: 7, appts: 23, index: 3.29, level: "Extreme" },
] as const;

/** Incoming appointees by party tag (all 236 rows; 6 untagged or compound). */
export const PARTY_TAGS: { tag: string; count: number; note: string }[] = [
  { tag: "SPLM (Kiir)", count: 113, note: "IG" },
  { tag: "Technocrat or career", count: 75, note: "tech" },
  { tag: "Mixed", count: 16, note: "mixed" },
  { tag: "SPLM-IO (Par Kuol)", count: 10, note: "IO-PK" },
  { tag: "SPLM-IO (Machar wing)", count: 5, note: "IO-M" },
  { tag: "SPLM-IO (unspecified)", count: 5, note: "IO" },
  { tag: "SSOA", count: 4, note: "SSOA" },
  { tag: "FD", count: 1, note: "FD" },
  { tag: "Other party", count: 1, note: "OPP" },
];

/** The coded seats, as the compilation lists them (25 rows: V, C or the one mixed bundle). */
export const CODED: { date: string; post: string; code: "Violation" | "Contested" | "Mixed"; change: string }[] = [
  { date: "2023-03-03", post: "Defence & Veteran Affairs", code: "Violation", change: "Angelina Teny → vacated (seat to SPLM)" },
  { date: "2023-03-29", post: "Defence & Veteran Affairs", code: "Violation", change: "vacant → Chol Thon Balok" },
  { date: "2024-04-13", post: "TNLA · 3 SPLM-IO members", code: "Violation", change: "3 IO-M MPs → replacements" },
  { date: "2024-06", post: "TNLA / Lakes Assembly (IO sweep)", code: "Violation", change: "David Yau Yau and others → replacements" },
  { date: "2025-02-07", post: "Western Equatoria governor", code: "Violation", change: "Alfred Futuyo Karaba → vacant" },
  { date: "2025-02-10", post: "Health", code: "Contested", change: "Yolanda Awel Deng → vacant" },
  { date: "2025-03", post: "Jonglei governor", code: "Violation", change: "Mahjoub Biel Turuk → Riek Gai Kok" },
  { date: "2025-03-19", post: "Upper Nile governor", code: "Violation", change: "James Odhok Oyai → James Koang Chuol" },
  { date: "2025-05-06", post: "Upper Nile / CES / Warrap state govts", code: "Violation", change: "Assembly speaker Jacob Dollar and others; Ulang & Nasir commissioners → SSPDF generals" },
  { date: "2025-05-07", post: "Higher Education, Science & Tech.", code: "Violation", change: "Gabriel Changson Chang → Madut Biar Yel" },
  { date: "2025-05-27", post: "Health", code: "Contested", change: "vacant → Sarah Cleto Rial" },
  { date: "2025-08-06", post: "Western Equatoria governor", code: "Violation", change: "vacant → James Al-Tayib Jazz Birapai" },
  { date: "2025-08-13", post: "TNLA 1st Dep. Speaker + CoS Speaker + whip", code: "Violation", change: "Oyet Nathaniel; Deng Deng Akon; Faruk Gatkuoth (+3 MPs) → IO-PK replacements" },
  { date: "2025-08-14", post: "Water Resources & Irrigation", code: "Contested", change: "Pal Mai Deng → James Mawich Makuach" },
  { date: "2025-09-01", post: "Western Bahr el Ghazal governor", code: "Violation", change: "Emmanuel Primo Okello → Sherif Daniel Sherif" },
  { date: "2025-10-08", post: "Wildlife Conservation & Tourism", code: "Violation", change: "→ Denay Jock Chagor" },
  { date: "2025-10-08", post: "Transport", code: "Violation", change: "Lam Akol → Rizik Zakaria Hassan" },
  { date: "2025-10-08", post: "East African Community Affairs", code: "Violation", change: "Beny Gideon Mabor → Pieng Deng Kuol" },
  { date: "2026-01-07", post: "Federal Affairs", code: "Contested", change: "Lasuba Lodoru Wango → Pur Solomon Gok" },
  { date: "2026-01-07", post: "Mining", code: "Contested", change: "Martin Gama Abocha → Lasuba Lodoru Wango" },
  { date: "2026-01-07", post: "Energy & Dams", code: "Contested", change: "Peter Marcelo Nasir → Agok Makur Kur" },
  { date: "2026-01-07", post: "Gender, Child & Social Welfare", code: "Contested", change: "Aya Benjamin Warile → Nuna Rhoda Rudolf Ndefu" },
  { date: "2026-01-07", post: "TNLA · 11 members", code: "Violation", change: "11 IO-allocated MPs → replacements" },
  { date: "2026-03-28", post: "Health", code: "Contested", change: "Sarah Cleto Rial → Luk Thomson Thoan" },
  { date: "2026-04-24", post: "Upper Nile state government (full format)", code: "Mixed", change: "Advisers, 11 ministers, 2 commissions, 4 county commissioners" },
  { date: "2026-05-15", post: "TNLA · 47 SPLM-IO members + ~10 CoS", code: "Violation", change: "47 IO-M MPs; about 10 IO CoS → 47 IO-PK replacements" },
];

/** Posts before and after the 22 September order. */
export const BEFORE_AFTER = [
  { label: "Vice-presidencies", before: 5, after: 0 },
  { label: "Ministers", before: 35, after: 17 },
  { label: "Governors", before: 10, after: 10 },
  { label: "Admin areas", before: 3, after: 3 },
];

/** The sequence of the dissolution, as the compilation dates it. */
export const SEQUENCE: { date: string; text: string; note?: string }[] = [
  { date: "9 Sep", text: "Maj. Gen. Atem Salva Kiir, the president’s son, replaces Deng Madhang Kuach as Tiger Division commander.", note: "Last row before the dissolution" },
  { date: "21 Sep", text: "Kiir signs amendments to the National Elections Act. They remove the legal tie of elections to a permanent constitution and to a census.", note: "allAfrica, 23 Sep" },
  { date: "22 Sep", text: "Republican Order removes the vice-presidents, ministers and local administrators, dissolves the national and state legislatures and the transitional government. Kiir stays president until a successor is sworn in. 13 caretaker ministers named the same day.", note: "allAfrica, 23 Sep" },
  { date: "28 Sep", text: "Four more ministers: Humanitarian, Health, General Education, Wildlife. Caretaker governors may name state ministers and commissioners.", note: "Radio Tamazuj dates it 28 Sep; Eye Radio 29 Sep" },
  { date: "1 Oct", text: "Health minister John Gai Yoh sacked after about three days; Dak Duop Bichiok appointed. The shortest caretaker tenure in the record." },
];

/** The caretaker roster: [post, holder, party tag, date, status]. Status is the compilation's own tag. */
export const ROSTER: [string, string, string, string, "Retained" | "Prior holder" | "No prior entry"][] = [
  ["Presidential Affairs", "Africano Mande Gedima", "IG", "22 Sep", "Prior holder"],
  ["Cabinet Affairs", "Martin Elia Lomuro", "IG", "22 Sep", "No prior entry"],
  ["Foreign Affairs", "Cecilia Adut Manyok", "IG", "22 Sep", "No prior entry"],
  ["Defence & Veteran Affairs", "Ayor Akuoch Anok", "IG", "22 Sep", "No prior entry"],
  ["Interior", "Rizik Zakaria Hassan", "IG", "22 Sep", "Prior holder"],
  ["Justice & Constitutional Affairs", "Wek Mamer Kuol", "IG", "22 Sep", "Prior holder"],
  ["National Security (OoP)", "Obuto Mamur Mete", "IG", "22 Sep", "Prior holder"],
  ["Finance & Planning", "Athian Diing Athian", "tech", "22 Sep", "Prior holder"],
  ["Petroleum", "Awow Daniel Chuang", "tech", "22 Sep", "Prior holder"],
  ["Trade & Industry", "Dr. Labanya Margaret Mathya", "tech", "22 Sep", "Prior holder"],
  ["Information & ICT", "Ateny Wek Ateny", "IG", "22 Sep", "Prior holder"],
  ["East African Community Affairs", "Michael Makuei Lueth", "IG", "22 Sep", "Prior holder"],
  ["Peacebuilding", "Stephen Par Kuol", "IO-PK", "22 Sep", "No prior entry"],
  ["Humanitarian Affairs & Disaster Mgmt", "Peter Mayen Majongdit", "OPP", "28 Sep", "Prior holder"],
  ["Health", "Dak Duop Bichiok", "IG", "1 Oct", "Prior holder"],
  ["General Education & Instruction", "Kuyok Abol Kuyok", "IG", "28 Sep", "Prior holder"],
  ["Wildlife, Tourism & Conservation", "Denay Jock Chagor", "IG", "28 Sep", "Prior holder"],
  ["Defence · Deputy", "Marial Chanuong Yol", "IG", "22 Sep", "No prior entry"],
  ["Foreign Affairs · Deputy", "Philip Jada Natana", "IG", "22 Sep", "No prior entry"],
  ["Interior · Deputy", "David Marial Gumke", "IG", "22 Sep", "No prior entry"],
  ["National Communication Authority · DG", "Gieth Kon Mathiang", "tech", "22 Sep", "No prior entry"],
  ["Civil Aviation Authority · DG", "Mosety Kat Majok", "tech", "22 Sep", "No prior entry"],
  ["Revenue Authority (SSRA) · CG", "Rizik Dominic Samuel", "tech", "22 Sep", "No prior entry"],
  ["Central Equatoria", "Augustino Jadalla Wani", "IG", "22 Sep", "Prior holder"],
  ["Eastern Equatoria", "Louis Lobong Lojore", "IG", "22 Sep", "Retained"],
  ["Jonglei", "Moses Majok Gatluak", "IG", "22 Sep", "No prior entry"],
  ["Lakes", "Rin Tueny Mabor", "IG", "22 Sep", "Prior holder"],
  ["Northern Bahr el Ghazal", "Charles Madut Akol", "IG", "22 Sep", "No prior entry"],
  ["Unity", "Joseph Nguen Monytuil", "IG", "22 Sep", "Retained"],
  ["Upper Nile", "James Koang Chuol", "IG", "22 Sep", "Retained"],
  ["Warrap", "Bol Wek Agoth", "IG", "22 Sep", "Retained"],
  ["Western Bahr el Ghazal", "Sherif Daniel Sherif", "IO-PK", "22 Sep", "Retained"],
  ["Western Equatoria", "Daniel Badagbu Rimbasa", "IG", "22 Sep", "Retained"],
  ["Abyei · Chief Administrator", "Charles Abyei Jok", "IG", "22 Sep", "Retained"],
  ["Greater Pibor · Chief Administrator", "Joseph Boboya Ngere", "IG", "22 Sep", "No prior entry"],
  ["Ruweng · Chief Administrator", "Daniel Makuei Thiyeer", "IG", "22 Sep", "Retained"],
  ["Presidential Adviser on Governance", "Joseph Ngere Paciko", "IG", "22 Sep", "Prior holder"],
];

/** Removed before the roster was complete: named here so the record is not silently short. */
export const REMOVED = "Health: John Gai Yoh, named 28 Sep, removed 1 Oct 2026 after about three days.";

/** The chain of the Chief of Defence Forces, from the compilation. */
export const CHAIN_CDF = [
  { date: "Dec 2024", name: "Santino Deng Wol" },
  { date: "Jul 2025", name: "Paul Nang Majok" },
  { date: "Oct 2025", name: "Dau Aturjong Nyuol" },
  { date: "May 2026", name: "Santino Deng Wol" },
];

export const FLAGS = [
  "Caretaker name spellings differ across sources (Gedima, Obuto Mamur Mete, Awow Daniel Chuang, Badagbu Rimbasa).",
  "Prior-holder status is unconfirmed for the new Jonglei, Northern Bahr el Ghazal and Greater Pibor appointees.",
  "The four-minister decree is dated 28 Sep by Radio Tamazuj and 29 Sep by Eye Radio. The name appears as both Gai Yoh and Gai Yoah.",
  "Sub-gubernatorial changes are a partial floor (45 logged). The caretaker period is undercounted, because governors now appoint state ministers and county commissioners without decrees.",
];
