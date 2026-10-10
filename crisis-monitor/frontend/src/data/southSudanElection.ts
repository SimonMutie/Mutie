/**
 * South Sudan: the transition, the agreement and the conflict, as sourced at
 * the date below. Every fact carries its source. Where the sources held do
 * not say, the entry says "not reported" rather than guessing.
 *
 * The Revitalised Agreement (R-ARCSS) benchmark statuses come from the
 * latest RJMEC and UN material we could read. The RJMEC quarterly reports for
 * 2024 are PDFs we could not read, so the most recent RJMEC status used here
 * is its September 2023 statement, and each row says which date it is from.
 */

export const AS_OF = "2026-10-10";
export const ELECTION_DAY = "2026-12-22";
export const FUNDING_NEED_USD = 250_000_000;

export const SOURCES = {
  necDate: { label: "NEC sets 22 December 2026 as election date", publisher: "Radio Yei", date: "22 Jun 2026", url: "https://radioyei.org/news/politics/breaking-news-nec-sets-22-december-2026-as-south-sudans-election-date/" },
  civicEd: { label: "Electoral body outlines plan for general elections", publisher: "Radio Tamazuj", date: "13 Jan 2026", url: "https://www.radiotamazuj.org/en/news/article/electoral-body-outlines-plan-for-general-elections" },
  reshuffle2025: { label: "Kiir sacks vice presidents Igga and Abdelbagi in massive reshuffle", publisher: "Eye Radio", date: "10 Feb 2025", url: "https://www.eyeradio.org/president-kiir-sacks-vice-presidents-igga-abdelbagi-in-massive-reshuffle/" },
  bolMel: { label: "Kiir sacks powerful VP Bol Mel, seen as his successor", publisher: "The EastAfrican", date: "13 Nov 2025", url: "https://www.theeastafrican.co.ke/tea/news/east-africa/south-sudan-president-salva-kiir-sacks-powerful-vp-bol-mel-seen-as-his-successor-5262912" },
  reshuffle2025b: { label: "Kiir returns Igga, Adil and axes four ministers", publisher: "Eye Radio", date: "17 Nov 2025", url: "https://www.eyeradio.org/kiir-returns-igga-adil-and-axes-four-ministers-in-another-dramatic-shake-up/" },
  iggaBack: { label: "Wani Igga returns as South Sudan VP in latest Kiir shuffle", publisher: "The EastAfrican", date: "18 Nov 2025", url: "https://www.theeastafrican.co.ke/tea/news/east-africa/wani-igga-returns-as-vp-in-latest-kiir-shuffle-5268750" },
  macharTrial: { label: "SSBC to air live trial of Machar, SPLM-IO leaders", publisher: "Eye Radio", date: "22 Sep 2025", url: "https://www.eyeradio.org/?p=154658" },
  unmiss: { label: "Remarks by the UNMISS Officer in Charge to the AU Peace and Security Council", publisher: "UNMISS", date: "23 Jan 2026", url: "https://monuc.unmissions.org/sites/default/files/2026-01/Remarks%20by%20the%20UNMISS%20Officer%20in%20Charge%20Mr.%20Graham%20Maitland%20to%20the%20AU%20Peace%20and%20Security%20Council.pdf" },
  rjmec2023: { label: "Five years of the R-ARCSS: need to redouble efforts", publisher: "RJMEC", date: "12 Sep 2023", url: "https://jmecsouthsudan.org/index.php/media-center/news/item/704-five-years-of-the-r-arcss-need-to-redouble-efforts-as-the-end-of-the-transitional-period-edges-closer" },
  horn: { label: "South Sudan at the edge: a broken peace, a jailed leader, fragmented militias", publisher: "Horn Review", date: "23 Jan 2026", url: "https://hornreview.org/2026/01/23/south-sudan-at-the-edge-how-a-broken-peace-a-jailed-leader-and-fragmented-militias-are-pushing-the-country-toward-collapse/" },
} as const;

export type SourceKey = keyof typeof SOURCES;

/* ── states ───────────────────────────────────────────────── */

export const STATES: { code: string; name: string }[] = [
  { code: "CE", name: "Central Equatoria" },
  { code: "EE", name: "Eastern Equatoria" },
  { code: "JG", name: "Jonglei" },
  { code: "LK", name: "Lakes" },
  { code: "NBG", name: "Northern Bahr el Ghazal" },
  { code: "UN", name: "Unity" },
  { code: "UP", name: "Upper Nile" },
  { code: "WR", name: "Warrap" },
  { code: "WBG", name: "Western Bahr el Ghazal" },
  { code: "WE", name: "Western Equatoria" },
];
/** Abyei is claimed by both Sudan and South Sudan and is not in the boundary file the map uses, so it is listed but not drawn. */
export const PLACES: { code: string; name: string }[] = [...STATES, { code: "AB", name: "Abyei Area (not drawn)" }];

/* ── the calendar ─────────────────────────────────────────── */

export interface Milestone {
  id: string;
  date: string;
  until?: string;
  /** Shown as "c." when the day is not in the sources. */
  approx?: boolean;
  title: string;
  short?: string;
  detail: string;
  basis: "nec" | "agreement" | "court" | "event";
  source: SourceKey;
  key?: boolean;
}

export const TIMELINE: Milestone[] = [
  { id: "2024-postponed", date: "2024-11-01", approx: true, title: "Vote postponed again, to December 2026", short: "Postponed", detail: "The election had already been moved from 2022 to 2024 and then to December 2026, as UN News and DW reported (cited by Horn Review).", basis: "agreement", source: "horn" },
  { id: "2025-transition", date: "2025-02-22", title: "End of the agreed transitional period", short: "Transition ends", detail: "The most recent extension ran 24 months, from February 2022 to February 2025 (RJMEC, Sept 2023). In January 2026 UNMISS asked the parties to agree “a clear and consensual path to ending the transition period”. No further agreed end date appears in the material we hold.", basis: "agreement", source: "unmiss", key: true },
  { id: "2025-03-machar", date: "2025-03-01", approx: true, title: "First Vice-President Riek Machar arrested", short: "Machar arrested", detail: "Arrested in March 2025 after clashes in Nasir. Horn Review says the arrest “effectively killed the peace deal”.", basis: "event", source: "horn" },
  { id: "2025-09-trial", date: "2025-09-22", title: "Machar trial opens in a special court in Juba", short: "Trial opens", detail: "Machar and seven co-accused face murder, treason, conspiracy, terrorist financing and crimes-against-humanity charges over the March Nasir clashes. Defence counsel said the trial opened that day.", basis: "court", source: "macharTrial" },
  { id: "2025-11-12", date: "2025-11-12", title: "Vice-President Bol Mel dismissed", short: "Bol Mel out", detail: "Read on state television, with no reason given. Kiir also fired the central bank governor and the head of the revenue authority, both seen as close to Bol Mel.", basis: "event", source: "bolMel" },
  { id: "2025-11-16", date: "2025-11-16", title: "Igga reinstated; ministers and police chief replaced", short: "Reshuffle", detail: "Decrees read on SSBC. Wani Igga returned as vice-president for the economic cluster and First Deputy Chairman of the SPLM. Four ministers were dismissed, the Central Equatoria governor was replaced and the police chief was dismissed.", basis: "event", source: "reshuffle2025b", key: true },
  { id: "2025-12-29", date: "2025-12-29", title: "Fighting between SPLA-IO and SSPDF in Jonglei", short: "Jonglei fighting", detail: "UNMISS says the fighting that began on 29 December has displaced more than 180,000 people and that hundreds have been abducted.", basis: "event", source: "unmiss", key: true },
  { id: "2026-01-19", date: "2026-01-19", title: "SPLA-IO commanders order a march on Juba", short: "March on Juba", detail: "Reported by Reuters and KFGO, and cited by Horn Review. The outcome is not in the material we hold.", basis: "event", source: "horn" },
  { id: "2026-01-23", date: "2026-01-23", title: "UN: ceasefire violations now systemic", short: "UN briefing", detail: "UNMISS to the AU Peace and Security Council: direct military confrontations in eight of ten states; sexual violence up 40% on 2024 (no count given); the last mainstream SPLM-IO ministers removed from cabinet and 11 SPLM-IO MPs from parliament.", basis: "agreement", source: "unmiss", key: true },
  { id: "2026-02-civic", date: "2026-02-01", approx: true, title: "Civic education planned to begin", short: "Civic education", detail: "NEC chairperson Abednego Akok Kacuol said civic education would start in February 2026, with voter registration to follow. The detailed timetable was promised for the end of January. We have not found it published.", basis: "nec", source: "civicEd" },
  { id: "2026-06-22", date: "2026-06-22", title: "NEC fixes polling day: 22 December 2026", short: "Date set", detail: "Announced at NEC headquarters in Juba. It gives the six months’ notice the National Elections Act 2012, as amended in 2023, requires. NEC says the law still has contradictions to amend and that about US$250 million is needed, of which only a fraction is secured.", basis: "nec", source: "necDate", key: true },
  { id: "2026-12-22", date: "2026-12-22", title: "Polling day (NEC)", short: "Polling day", detail: "The date NEC has set. Voter registration, the voter roll and the candidate timetable have not been published in the material we hold.", basis: "nec", source: "necDate", key: true },
];

/* ── government changes ───────────────────────────────────── */

export type HolderHow = "appointed" | "reinstated" | "reappointed" | "acting" | "dismissed" | "detained";

export interface Holder {
  id: string;
  post: string;
  name: string;
  how: HolderHow;
  /** When the office holder started or changed, if the source says. */
  from?: string;
  /** When they left, if the source says. Missing means "not reported", not "still in office". */
  to?: string;
  note?: string;
  source: SourceKey;
}

/** Each post is one row. Holders are listed in order; a dated run of holders reads as the musical chairs. */
export const POSTS: { id: string; label: string; group: string }[] = [
  { id: "vp-econ", label: "Vice-President, economic cluster", group: "Presidency" },
  { id: "vp-other", label: "Vice-President", group: "Presidency" },
  { id: "spl-post", label: "SPLM party post", group: "Presidency" },
  { id: "first-vp", label: "First Vice-President (R-ARCSS post)", group: "Presidency" },
  { id: "gov-ce", label: "Governor, Central Equatoria", group: "States" },
  { id: "gov-we", label: "Governor, Western Equatoria", group: "States" },
  { id: "min-info", label: "Minister of Information", group: "Ministries" },
  { id: "min-env", label: "Minister of Environment", group: "Ministries" },
  { id: "min-roads", label: "Minister of Roads and Bridges", group: "Ministries" },
  { id: "min-justice", label: "Minister of Justice", group: "Ministries" },
  { id: "min-health", label: "Minister of Health", group: "Ministries" },
  { id: "police", label: "Police (head of the national police)", group: "Security" },
  { id: "nss-internal", label: "Internal Security Bureau, Director-General", group: "Security" },
];

export const HOLDERS: Holder[] = [
  { id: "bol-mel-vp", post: "vp-econ", name: "Benjamin Bol Mel", how: "appointed", from: "2025-02-10", to: "2025-11-12", note: "Appointed in the February 2025 reshuffle; dismissed in November 2025.", source: "reshuffle2025" },
  { id: "igga-vp-econ", post: "vp-econ", name: "James Wani Igga", how: "reappointed", from: "2025-11-16", note: "Reappointed over the economic cluster.", source: "iggaBack" },
  { id: "igga-vp-feb", post: "vp-other", name: "James Wani Igga", how: "dismissed", to: "2025-02-10", note: "Dismissed as vice-president in February 2025; appointed SPLM Secretary-General the same day.", source: "reshuffle2025" },
  { id: "abdelbagi", post: "vp-other", name: "Hussein Abdelbagi", how: "dismissed", to: "2025-02-10", note: "Dismissed as vice-president and appointed Minister of Agriculture.", source: "reshuffle2025" },
  { id: "lagu", post: "vp-other", name: "Josephine Lagu", how: "appointed", from: "2025-02-10", note: "Appointed vice-president to replace Abdelbagi. Her later status is not in the material we hold.", source: "reshuffle2025" },
  { id: "igga-spl-sg", post: "spl-post", name: "James Wani Igga", how: "appointed", from: "2025-02-10", to: "2025-11-16", note: "Appointed SPLM Secretary-General.", source: "reshuffle2025" },
  { id: "igga-spl-fdc", post: "spl-post", name: "James Wani Igga", how: "reappointed", from: "2025-11-16", note: "First Deputy Chairman of the SPLM.", source: "reshuffle2025b" },
  { id: "machar-first-vp", post: "first-vp", name: "Riek Machar", how: "detained", from: "2025-03-01", note: "Detained after the March 2025 Nasir clashes and on trial since September 2025. UNMISS still called him First Vice-President in January 2026; no removal is recorded in the material we hold.", source: "macharTrial" },
  { id: "rabi-ce", post: "gov-ce", name: "Emmanuel Rabi", how: "dismissed", to: "2025-11-16", note: "Dismissed as Central Equatoria governor.", source: "reshuffle2025b" },
  { id: "adil-ce", post: "gov-ce", name: "Emmanuel Adil Anthony", how: "reinstated", from: "2025-11-16", note: "Reinstated as Central Equatoria governor.", source: "reshuffle2025b" },
  { id: "karaba-we", post: "gov-we", name: "Alfred Futuyo Karaba", how: "dismissed", to: "2025-02-10", note: "Dismissed as Western Equatoria governor; no successor named in the report.", source: "reshuffle2025" },
  { id: "makuei-info", post: "min-info", name: "Michael Makuei Lueth", how: "dismissed", to: "2025-11-16", source: "reshuffle2025b" },
  { id: "ateny-info", post: "min-info", name: "Ateny Wek Ateny", how: "appointed", from: "2025-11-16", source: "reshuffle2025b" },
  { id: "napwon-env", post: "min-env", name: "Josephine Napwon", how: "dismissed", to: "2025-11-16", source: "reshuffle2025b" },
  { id: "garang-env", post: "min-env", name: "Mabior Garang de Mabior", how: "appointed", from: "2025-11-16", note: "Minister of Environment and Forestry.", source: "reshuffle2025b" },
  { id: "mijak-roads", post: "min-roads", name: "Simon Mijak Mijok", how: "dismissed", to: "2025-11-16", source: "reshuffle2025b" },
  { id: "lam-roads", post: "min-roads", name: "Peter Lam Both", how: "appointed", from: "2025-11-16", source: "reshuffle2025b" },
  { id: "geng-justice", post: "min-justice", name: "Joseph Geng Aketch", how: "dismissed", to: "2025-11-16", note: "No successor named in the report.", source: "reshuffle2025b" },
  { id: "awel-health", post: "min-health", name: "Yolanda Awel", how: "dismissed", to: "2025-02-10", note: "No successor named in the report.", source: "reshuffle2025" },
  { id: "manyuat-police", post: "police", name: "Gen. Abraham Manyuat Peter", how: "dismissed", to: "2025-11-16", note: "Inspector-General of Police.", source: "reshuffle2025b" },
  { id: "chawul-police", post: "police", name: "Gen. Saeed Chawul Long", how: "appointed", from: "2025-11-16", note: "Named “Leader of the South Sudan National Police Service” in the report.", source: "reshuffle2025b" },
  { id: "aleu-nss", post: "nss-internal", name: "Gen. Akec Tong Aleu", how: "dismissed", to: "2025-02-10", note: "Had served only a few months.", source: "reshuffle2025" },
  { id: "mayor-nss", post: "nss-internal", name: "Charles Chiech Mayor", how: "acting", from: "2025-02-10", source: "reshuffle2025" },
];

/* ── R-ARCSS benchmarks ───────────────────────────────────── */

export type BenchStatus = "done" | "partial" | "stalled" | "violated" | "contested" | "not_reported";

export interface Benchmark {
  id: string;
  area: string;
  commitment: string;
  status: BenchStatus;
  /** What the latest source says, in one or two sentences. */
  finding: string;
  /** The date of the finding, not of this page. */
  asOf: string;
  source: SourceKey;
}

export const BENCHMARKS: Benchmark[] = [
  { id: "unified-forces", area: "Security", commitment: "Necessary Unified Forces screened, graduated and deployed", status: "stalled", finding: "RJMEC: “over half” of the necessary unified forces graduated, and none were deployed. UNMISS’s January 2026 briefing does not report on the unified forces.", asOf: "2023-09-12", source: "rjmec2023" },
  { id: "ceasefire", area: "Security", commitment: "Permanent ceasefire and cessation of hostilities", status: "violated", finding: "UNMISS: ceasefire violations have become more systemic, with direct military confrontations in eight of ten states. No total count is given.", asOf: "2026-01-23", source: "unmiss" },
  { id: "transition", area: "Transition", commitment: "Transitional period and its end", status: "stalled", finding: "Extended 24 months to February 2025. UNMISS, January 2026, asked the parties to agree a clear path to end the transition. No agreed end date is in the material we hold.", asOf: "2026-01-23", source: "unmiss" },
  { id: "constitution", area: "Constitution", commitment: "Permanent constitution made by constitution-making institutions", status: "stalled", finding: "RJMEC, 2023: the institutions responsible for the constitution had not been set up. Kiir later approved amendments that allow elections without a permanent constitution (Horn Review, citing ChimpReports).", asOf: "2023-09-12", source: "horn" },
  { id: "elections", area: "Elections", commitment: "National Elections Commission reconstituted; elections held", status: "partial", finding: "NEC has fixed 22 December 2026 and says the law needs amending and about US$250 million is needed. RJMEC (2023) had reported the NEC and the National Elections Bill still outstanding; we have no later confirmation of either.", asOf: "2026-06-22", source: "necDate" },
  { id: "inclusion", area: "Power-sharing", commitment: "Inclusive government, with SPLM-IO in cabinet and parliament", status: "violated", finding: "UNMISS: the last mainstream SPLM-IO ministers were removed from cabinet and 11 SPLM-IO MPs from parliament. UNMISS calls the agreement “the only viable framework” for stability.", asOf: "2026-01-23", source: "unmiss" },
  { id: "first-vp", area: "Power-sharing", commitment: "First Vice-President in post", status: "contested", finding: "Machar has been detained since March 2025 and is on trial. The trial was continuing in January 2026, and the government says it will let the legal process run its course.", asOf: "2026-01-23", source: "unmiss" },
  { id: "census", area: "Elections", commitment: "Census before elections", status: "contested", finding: "UNMISS, January 2026: recent moves separate elections from both the constitution-making process and the census. We have no census timetable.", asOf: "2026-01-23", source: "unmiss" },
  { id: "ncrd", area: "Constitution", commitment: "National Constitutional Review Commission (NCRD)", status: "not_reported", finding: "Not reported in the material we hold.", asOf: "2023-09-12", source: "rjmec2023" },
  { id: "justice", area: "Justice", commitment: "Commission for Truth, Reconciliation and Healing; Hybrid Court", status: "not_reported", finding: "Not reported in the material we hold.", asOf: "2023-09-12", source: "rjmec2023" },
  { id: "economy", area: "Economy", commitment: "Economic and financial reforms", status: "not_reported", finding: "Not reported in the material we hold.", asOf: "2023-09-12", source: "rjmec2023" },
];

export const BENCH_LABEL: Record<BenchStatus, string> = {
  done: "Done",
  partial: "Partly done",
  stalled: "Stalled",
  violated: "Violated (per UN)",
  contested: "Contested",
  not_reported: "Not reported",
};

/* ── outlook (analysis, not forecast) ─────────────────────── */

export const SCENARIOS = [
  {
    name: "The vote goes ahead on 22 December, in most places",
    lean: "Possible",
    how: "NEC clears the legal contradictions, funds the register and holds registration on time. Polling happens in the centre, south and west, with weaker or no voting in Jonglei, Upper Nile and Unity.",
    signs: ["The election law is amended before the candidate deadline", "Voter registration opens on the NEC timetable", "Funding for the bulk of the US$250 million is announced"],
  },
  {
    name: "The vote is postponed again",
    lean: "Plausible",
    how: "The legal contradictions, the funding gap and the security situation together make another delay the easier path. The vote has been moved at least twice already, in 2022 and 2024.",
    signs: ["No amendment to the election law by the end of the year", "No voter registration by December", "Parties call for a new transitional arrangement"],
  },
  {
    name: "The vote happens amid fighting, without the main opposition",
    lean: "Plausible",
    how: "The vote is held as scheduled, but the SPLM-IO is excluded or divided, Machar remains detained, and fighting keeps large areas from voting. The result would be contested and would deepen the conflict.",
    signs: ["Machar convicted, or remains detained through the campaign", "Fighting reported in Juba or the Equatorias", "The SPLM-IO announces it will not take part"],
  },
] as const;
