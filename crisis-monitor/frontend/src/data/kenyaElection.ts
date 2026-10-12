/**
 * Kenya 2027 General Election — the data behind the Election Watch.
 *
 * Everything here is sourced and dated. Official figures (IEBC register,
 * KNBS census) are exact; poll numbers are as published by the pollster and
 * reported by the press; the assessments are Afrilens analysis and are
 * labelled as such in the screens. The file is plain data on purpose: when a
 * new poll, a declaration or an IEBC notice lands, edit it here and nothing
 * else needs to change.
 */

export const AS_OF = "2026-10-10";
export const ELECTION_DAY = "2027-08-10";

export type Region = "Nairobi" | "Central" | "Coast" | "Eastern" | "North Eastern" | "Nyanza" | "Rift Valley" | "Western";

export interface County {
  /** IEBC county code. */
  code: string;
  name: string;
  /** Former province, the grouping Kenyan politics still talks in. */
  region: Region;
  /** 2019 census (KNBS). */
  pop2019: number;
  /** Registered voters in the 2022 General Election register (IEBC). */
  reg2022: number;
  /** New voters registered in the 2026 drive, as reported part-way through (26 of 47 counties). */
  new2026?: number;
}

export const COUNTIES: County[] = [
  { code: "001", name: "Mombasa", region: "Coast", pop2019: 1208333, reg2022: 641913, new2026: 41444 },
  { code: "002", name: "Kwale", region: "Coast", pop2019: 866820, reg2022: 328253, new2026: 24394 },
  { code: "003", name: "Kilifi", region: "Coast", pop2019: 1453787, reg2022: 588602, new2026: 54171 },
  { code: "004", name: "Tana River", region: "Coast", pop2019: 315943, reg2022: 141096 },
  { code: "005", name: "Lamu", region: "Coast", pop2019: 143920, reg2022: 81453, new2026: 8345 },
  { code: "006", name: "Taita Taveta", region: "Coast", pop2019: 340671, reg2022: 181827 },
  { code: "007", name: "Garissa", region: "North Eastern", pop2019: 841353, reg2022: 201473, new2026: 20954 },
  { code: "008", name: "Wajir", region: "North Eastern", pop2019: 781263, reg2022: 207758, new2026: 17930 },
  { code: "009", name: "Mandera", region: "North Eastern", pop2019: 867457, reg2022: 217030, new2026: 14946 },
  { code: "010", name: "Marsabit", region: "Eastern", pop2019: 459785, reg2022: 166912 },
  { code: "011", name: "Isiolo", region: "Eastern", pop2019: 268002, reg2022: 89504, new2026: 9291 },
  { code: "012", name: "Meru", region: "Eastern", pop2019: 1545714, reg2022: 772139, new2026: 56486 },
  { code: "013", name: "Tharaka-Nithi", region: "Eastern", pop2019: 393177, reg2022: 231932 },
  { code: "014", name: "Embu", region: "Eastern", pop2019: 608599, reg2022: 334302 },
  { code: "015", name: "Kitui", region: "Eastern", pop2019: 1136187, reg2022: 532758 },
  { code: "016", name: "Machakos", region: "Eastern", pop2019: 1421932, reg2022: 687565, new2026: 65616 },
  { code: "017", name: "Makueni", region: "Eastern", pop2019: 987653, reg2022: 479401 },
  { code: "018", name: "Nyandarua", region: "Central", pop2019: 638289, reg2022: 361165 },
  { code: "019", name: "Nyeri", region: "Central", pop2019: 759164, reg2022: 481632 },
  { code: "020", name: "Kirinyaga", region: "Central", pop2019: 610411, reg2022: 376001 },
  { code: "021", name: "Murang'a", region: "Central", pop2019: 1056640, reg2022: 620929 },
  { code: "022", name: "Kiambu", region: "Central", pop2019: 2417735, reg2022: 1275008, new2026: 97557 },
  { code: "023", name: "Turkana", region: "Rift Valley", pop2019: 926976, reg2022: 238528 },
  { code: "024", name: "West Pokot", region: "Rift Valley", pop2019: 621241, reg2022: 220026 },
  { code: "025", name: "Samburu", region: "Rift Valley", pop2019: 310327, reg2022: 100014 },
  { code: "026", name: "Trans Nzoia", region: "Rift Valley", pop2019: 990341, reg2022: 398981 },
  { code: "027", name: "Uasin Gishu", region: "Rift Valley", pop2019: 1163186, reg2022: 506138, new2026: 43745 },
  { code: "028", name: "Elgeyo-Marakwet", region: "Rift Valley", pop2019: 454480, reg2022: 213884 },
  { code: "029", name: "Nandi", region: "Rift Valley", pop2019: 885711, reg2022: 406288, new2026: 42334 },
  { code: "030", name: "Baringo", region: "Rift Valley", pop2019: 666763, reg2022: 281053 },
  { code: "031", name: "Laikipia", region: "Rift Valley", pop2019: 518560, reg2022: 263012 },
  { code: "032", name: "Nakuru", region: "Rift Valley", pop2019: 2162202, reg2022: 1054856, new2026: 81166 },
  { code: "033", name: "Narok", region: "Rift Valley", pop2019: 1157873, reg2022: 398784 },
  { code: "034", name: "Kajiado", region: "Rift Valley", pop2019: 1117840, reg2022: 463273, new2026: 44615 },
  { code: "035", name: "Kericho", region: "Rift Valley", pop2019: 901777, reg2022: 428067, new2026: 42315 },
  { code: "036", name: "Bomet", region: "Rift Valley", pop2019: 875689, reg2022: 376985 },
  { code: "037", name: "Kakamega", region: "Western", pop2019: 1867579, reg2022: 844551, new2026: 80711 },
  { code: "038", name: "Vihiga", region: "Western", pop2019: 590013, reg2022: 310043, new2026: 20787 },
  { code: "039", name: "Bungoma", region: "Western", pop2019: 1670570, reg2022: 646598, new2026: 62203 },
  { code: "040", name: "Busia", region: "Western", pop2019: 893681, reg2022: 416756, new2026: 30350 },
  { code: "041", name: "Siaya", region: "Nyanza", pop2019: 993183, reg2022: 533595, new2026: 33295 },
  { code: "042", name: "Kisumu", region: "Nyanza", pop2019: 1155574, reg2022: 606754, new2026: 37090 },
  { code: "043", name: "Homa Bay", region: "Nyanza", pop2019: 1131950, reg2022: 551071, new2026: 39770 },
  { code: "044", name: "Migori", region: "Nyanza", pop2019: 1116436, reg2022: 469019, new2026: 37004 },
  { code: "045", name: "Kisii", region: "Nyanza", pop2019: 1266860, reg2022: 637010, new2026: 50551 },
  { code: "046", name: "Nyamira", region: "Nyanza", pop2019: 605576, reg2022: 323283 },
  { code: "047", name: "Nairobi", region: "Nairobi", pop2019: 4397073, reg2022: 2415310, new2026: 209965 },
];

export const TOTAL_POP_2019 = 47_564_296;
export const TOTAL_REG_2022 = 22_102_532; // excludes 10,443 diaspora and 7,483 prison voters (22,120,458 with them)
export const NEW_REGISTRATIONS_2026 = 2_612_725; // Enhanced Continuous Voter Registration, closed 28 April 2026
export const REGISTER_TARGET_2027 = 28_500_000;

/* ── Timeline ─────────────────────────────────────────────── */

export type Phase = "Context" | "Preparation" | "Parties" | "Candidates" | "Campaign" | "Polling" | "After the vote";

export interface Milestone {
  date: string; // ISO
  /** Optional end date for a window. */
  until?: string;
  title: string;
  detail: string;
  phase: Phase;
  /** "gazetted" = in the IEBC election-period notice; "constitution" = fixed by the Constitution; "event" = something that happened. */
  basis: "gazetted" | "constitution" | "event";
  key?: boolean;
  /** Short label for the timeline strip. */
  short?: string;
}

export const TIMELINE: Milestone[] = [
  { date: "2024-10-17", title: "Gachagua removed as Deputy President", detail: "Impeached by Parliament and removed after the Senate vote. He later founded the Democracy for the Citizens Party (DCP) and declared interest in the presidency. His eligibility turns on a court challenge to the removal.", phase: "Context", basis: "event" },
  { date: "2025-09-29", title: "Continuous voter registration opens", detail: "IEBC resumes registration at constituency offices; 267,249 voters were added this way before the mass drive.", phase: "Preparation", basis: "event" },
  { date: "2025-10-15", title: "Raila Odinga dies", detail: "Odinga died in India; he was buried on 19 October. Dr Oburu Oginga became acting ODM leader. ODM stayed in President Ruto’s broad-based government and its 2027 position remains contested (see Sifuna).", phase: "Context", basis: "event" },
  { date: "2026-03-30", until: "2026-04-28", title: "Mass voter registration drive", detail: "IEBC’s 30-day Enhanced Continuous Voter Registration added 2,345,476 voters; 2,612,725 in total since September 2025. The target for 2027 is a register of 28.5 million.", phase: "Preparation", basis: "event" },
  { date: "2026-08-07", title: "Malindi High Court rules the 2027 date unconstitutional", detail: "Justice Mugure Thande held the presidential election should have fallen in 2026, but suspended the effect of the decision until after the 2027 election. IEBC says 10 August 2027 stands. Appeals and other cases on the date are still running.", phase: "Context", basis: "event" },
  { date: "2026-08-20", title: "Election period gazetted", detail: "IEBC publishes the 2027 election period (Gazette Notice 13497) with the full timetable for parties, aspirants and campaigns.", phase: "Preparation", basis: "gazetted" },
  { date: "2026-10-15", short: "Parties name signatories", title: "Parties submit authorised persons and specimen signatures", detail: "Political parties tell IEBC who may sign nomination documents on their behalf.", phase: "Parties", basis: "gazetted", key: true },
  { date: "2026-10-30", title: "Party nomination rules certified", detail: "The Registrar of Political Parties certifies each party’s nomination rules.", phase: "Parties", basis: "gazetted" },
  { date: "2026-11-06", title: "Certified nomination rules lodged with IEBC", detail: "Final step before parties can run primaries under their own rules.", phase: "Parties", basis: "gazetted" },
  { date: "2027-02-09", short: "Officials must resign", title: "Public officers seeking office must resign", detail: "Civil servants, Cabinet Secretaries and others who want to stand have to leave their posts within six months before election day. IEBC’s June 2026 announcement gives 9 February; one other report says 10 February.", phase: "Candidates", basis: "gazetted", key: true },
  { date: "2027-03-16", title: "Party membership lists and primary details due", detail: "Parties submit membership lists and the names, dates and venues of their primaries.", phase: "Parties", basis: "gazetted" },
  { date: "2027-05-09", short: "9 May 2027: Party primaries end.", title: "9 May 2027: Party primaries end.", detail: "All primaries and intra-party disputes must be concluded (9 May per IEBC’s June 2026 announcement; the gazette summary reported by Citizen Digital says 8 May). Independent candidates submit names and symbols. This is when coalitions have to have settled who their flag-bearer is.", phase: "Parties", basis: "gazetted", key: true },
  { date: "2027-05-24", title: "Presidential supporter lists due", detail: "Presidential candidates lodge supporter lists: at least 2,000 registered voters in a majority of counties (24 or more).", phase: "Candidates", basis: "gazetted" },
  { date: "2027-05-29", until: "2027-06-11", short: "29 May to 11 June 2027: Names of nominated candidates are filed with IEBC.", title: "29 May to 11 June 2027: Names of nominated candidates are filed with IEBC.", detail: "Presidential: 29 May to 11 June. National Assembly: 29 May to 1 June. Senate: 29 May to 2 June. Governor: 3 to 6 June. Woman Representative: 7 to 11 June. Ward: 2 to 11 June. Campaigning may start once a candidate is registered.", phase: "Candidates", basis: "gazetted", key: true },
  { date: "2027-06-12", title: "Last day to lodge nomination disputes", detail: "Disputes must be resolved by 23 June.", phase: "Candidates", basis: "gazetted" },
  { date: "2027-08-07", title: "Campaigns close", detail: "Campaigning ends 48 hours before polling opens.", phase: "Campaign", basis: "gazetted" },
  { date: "2027-08-10", short: "Polling day", title: "General Election", detail: "President, Governors, Senators, MPs, Woman Representatives and MCAs are all on one ballot day.", phase: "Polling", basis: "gazetted", key: true },
  { date: "2027-08-17", title: "Presidential petition window closes (approx.)", detail: "A petition must be filed within 7 days of the declaration. The Supreme Court has 14 days to decide. Dates move with the date of the declaration.", phase: "After the vote", basis: "constitution" },
  { date: "2027-09-09", title: "Run-off deadline (latest, approx.)", detail: "If no candidate has more than half the votes and at least a quarter of the votes in 24 counties, a run-off between the top two is held within 30 days of the first round.", phase: "After the vote", basis: "constitution" },
];

/* ── Candidates ───────────────────────────────────────────── */

export type Standing = "Declared" | "Incumbent" | "Declared interest" | "Not formally declared" | "Polled";

export interface Candidate {
  id: string;
  name: string;
  party: string;
  /** Wikipedia article title, used only to look up a portrait. Initials are shown if there is none. */
  wiki: string;
  standing: Standing;
  role: string;
  born?: number;
  base: string;
  bio: string;
  /** What helps them. */
  assets: string[];
  /** What constrains them. */
  risks: string[];
  /** Latest published poll shares, by poll id. */
  polls: Record<string, number>;
}

export const CANDIDATES: Candidate[] = [
  {
    id: "ruto", name: "William Ruto", party: "UDA (Kenya Kwanza)", wiki: "William_Ruto", standing: "Incumbent", role: "President since September 2022", born: 1966,
    base: "Rift Valley; Kenya Kwanza coalition; a working understanding with ODM since 2025",
    bio: "Deputy President 2013 to 2022 under Uhuru Kenyatta, then won the 2022 election with 50.49% (7,176,141 votes), a margin of about 233,000. He is eligible for a second term and is the only candidate with the machinery of government behind him.",
    assets: ["Leads every published poll", "Control of state resources and appointments", "Opposition is split across several leaders", "ODM inside the broad-based government"],
    risks: ["Mt Kenya vote has cooled since Gachagua’s removal", "Cost-of-living and tax anger, including the 2024 Finance Bill protests", "Needs more than half the votes, not just the most"],
    polls: { politrack: 45.1, infotrak: 32, tifa: 24 },
  },
  {
    id: "kalonzo", name: "Kalonzo Musyoka", party: "Wiper Democratic Movement (United Opposition)", wiki: "Kalonzo_Musyoka", standing: "Declared", role: "Former Vice-President (2008 to 2013); Wiper party leader", born: 1953,
    base: "Ukambani (Kitui, Machakos, Makueni) and parts of the Coast and Nairobi",
    bio: "Veteran of Kenyan politics who has been a running mate rather than the top of the ticket in 2013, 2017 and the Azimio coalition of 2022. He has said he will not back another candidate this time.",
    assets: ["A secure regional base", "Long record and coalition experience", "Consistently second or third in polls"],
    risks: ["Never carried the presidency on his own", "Base is large but not large enough alone", "Rivals in the opposition also want the ticket"],
    polls: { politrack: 10.3, infotrak: 13, tifa: 19 },
  },
  {
    id: "gachagua", name: "Rigathi Gachagua", party: "Democracy for the Citizens Party (DCP)", wiki: "Rigathi_Gachagua", standing: "Declared interest", role: "Former Deputy President (2022 to 2024); DCP leader", born: 1965,
    base: "Mt Kenya region (Central, Meru, Embu, Tharaka-Nithi, Laikipia)",
    bio: "Ruto’s running mate in 2022, impeached and removed in October 2024. He declared his interest in the presidency in May 2026 and says he would back another opposition candidate if the group agrees on one. He is contesting his removal in court.",
    assets: ["Strongest claim to the Mt Kenya vote", "Fierce organiser and campaigner", "Central to any opposition deal"],
    risks: ["Eligibility depends on the outcome of his court case", "Polls at 4 to 9%, low for a regional kingpin", "Divisive outside his base"],
    polls: { politrack: 6.0, infotrak: 4, tifa: 9 },
  },
  {
    id: "matiangi", name: "Fred Matiang’i", party: "Jubilee Party (deputy leader)", wiki: "Fred_Matiang'i", standing: "Declared interest", role: "Former Interior Cabinet Secretary (2018 to 2022)", born: 1964,
    base: "Kisii and Nyamira; urban and professional voters; part of Jubilee’s old base",
    bio: "A former professor who ran Education and then Interior under President Kenyatta, known as an administrator. He is part of the United Opposition talks and has built an organisation quietly, including a foreign advocacy effort.",
    assets: ["Polls in double digits in two of three surveys", "Attractive to Nairobi middle class and Gen Z voters", "Strong in Gusii region"],
    risks: ["Has no party machine of his own", "Linked to the Kenyatta-era state in the eyes of critics", "Overlaps with Sifuna for urban voters"],
    polls: { politrack: 7.2, infotrak: 12, tifa: 14 },
  },
  {
    id: "sifuna", name: "Edwin Sifuna", party: "Linda Mwananchi movement (ODM Senator)", wiki: "Edwin_Sifuna", standing: "Not formally declared", role: "Senator for Nairobi; former ODM Secretary General", born: 1984,
    base: "Nairobi and young urban voters; a slice of the Western and Nyanza vote",
    bio: "Rose as Raila Odinga’s lieutenant and ODM Secretary General. After Odinga’s death he says he was stripped of party roles for resisting ODM’s closeness to Ruto. In July 2026 he said he would not say no to a presidential run if supporters ask.",
    assets: ["Fastest riser in the polls (second in Politrack)", "Appeals to young urban voters", "Could split or inherit parts of the ODM vote"],
    risks: ["No registered party and no declared candidacy", "Competes with the opposition for the same voters", "Sidelined by ODM leadership since Odinga’s death"],
    polls: { politrack: 19.6, infotrak: 12, tifa: 10 },
  },
  {
    id: "karua", name: "Martha Karua", party: "People’s Liberation Party (PLP)", wiki: "Martha_Karua", standing: "Declared", role: "Former Minister of Justice; 2022 running mate to Raila Odinga", born: 1957,
    base: "Kirinyaga and Mt Kenya women and reform-minded voters",
    bio: "Lawyer and long-time reformer who ran for president in 2013 and was Raila Odinga’s running mate in 2022. Part of the United Opposition.",
    assets: ["High name recognition and reputation for integrity", "Credible as a deputy or flag-bearer"],
    risks: ["Polls below 1% in Politrack", "Limited party structures"],
    polls: { politrack: 0.8 },
  },
  {
    id: "maraga", name: "David Maraga", party: "United Green Movement (UGM)", wiki: "David_Maraga", standing: "Declared", role: "Former Chief Justice (2016 to 2021)", born: 1951,
    base: "Kisii-Nyamira; reform and faith voters; part of Gen Z protest sentiment",
    bio: "Led the Supreme Court that annulled the 2017 presidential election. He was unveiled as the UGM presidential candidate on 2 October 2025 and presents himself as the clean-governance option.",
    assets: ["Public trust as a judge", "Appeal to protest generation"],
    risks: ["Low poll numbers (about 1%)", "Small party and thin funding plans", "Shares a home region with Matiang’i"],
    polls: { politrack: 0.8 },
  },
  {
    id: "wamalwa", name: "Eugene Wamalwa", party: "DAP-Kenya", wiki: "Eugene_Wamalwa", standing: "Declared interest", role: "Former Cabinet Secretary; DAP-K leader", born: 1969,
    base: "Bungoma and the Western region",
    bio: "Leads DAP-K and has said he wants to win at least half the vote across 24 or more counties. Included in United Opposition talks.",
    assets: ["Anchor for the Western vote", "Experienced coalition player"],
    risks: ["Not measured in recent polls", "Western votes are contested with ODM and others"],
    polls: {},
  },
  {
    id: "muturi", name: "Justin Muturi", party: "Democratic Party (DP)", wiki: "Justin_Muturi", standing: "Declared", role: "Former Speaker of the National Assembly",
    base: "Embu and parts of the Mt Kenya region",
    bio: "Endorsed by the Democratic Party as its presidential flag-bearer in January 2026 and part of the United Opposition. He has accused Kenya Kwanza of sponsoring rival camps inside opposition parties.",
    assets: ["Respected establishment figure", "Possible compromise candidate"],
    risks: ["Not measured in recent polls", "Small base"],
    polls: {},
  },
  {
    id: "omtatah", name: "Okiya Omtatah", party: "National Reconstruction Alliance", wiki: "Okiya_Omtatah", standing: "Declared interest", role: "Senator for Busia",
    base: "Western and activist networks",
    bio: "Activist-lawyer turned Senator who has formed a committee to test public support for a run.",
    assets: ["Anti-establishment credibility"],
    risks: ["Not measured in recent polls"],
    polls: {},
  },
  {
    id: "mwangi", name: "Boniface Mwangi", party: "Independent / own platform", wiki: "Boniface_Mwangi", standing: "Declared", role: "Photojournalist and activist",
    base: "Nairobi youth and civil-society networks",
    bio: "Activist who stood for Starehe in 2017 and is running on a protest-generation platform.",
    assets: ["Visibility among young voters"],
    risks: ["Not measured in recent polls", "No party machine"],
    polls: {},
  },
  {
    id: "wajackoyah", name: "George Wajackoyah", party: "Roots Party of Kenya", wiki: "George_Wajackoyah", standing: "Polled", role: "2022 presidential candidate (Roots Party)",
    base: "Niche and protest vote",
    bio: "The surprise fourth-place candidate in 2022. Included in Politrack’s list at 1.1%. Has not announced a 2027 bid in the sources reviewed.",
    assets: ["Name recognition"],
    risks: ["Status for 2027 unclear"],
    polls: { politrack: 1.1 },
  },
];

/** Others named in the press or on poll lists; not profiled until they declare. */
export const ALSO_NAMED = ["Babu Owino (Embakasi East MP, 2% in TIFA)", "James Orengo (0.4% Politrack)", "Jimmy Wanjigi (0.3% Politrack)", "George Natembeya", "Morara Kebaso (Inject Party)", "Eliud Owalo", "Peter Salasya"];

/* ── Polls ────────────────────────────────────────────────── */

export interface Poll {
  id: string;
  pollster: string;
  fieldwork: string;
  published: string; // ISO, for ordering
  sample: string;
  margin: string;
  mode: string;
  undecided: number;
  /** Candidate id → share. */
  shares: Record<string, number>;
  /** Names not in CANDIDATES. */
  other?: string;
  /** Afrilens credibility grade for this poll. */
  grade: "A" | "B" | "C" | "D";
  gradeNote: string;
  disclosed: { sample: boolean; margin: boolean; mode: boolean; fieldwork: boolean };
  source: { label: string; url: string };
}

export const POLLS: Poll[] = [
  {
    id: "politrack", pollster: "Politrack Africa", fieldwork: "15 to 25 September 2026", published: "2026-09-30",
    sample: "20,419 respondents", margin: "±3 points at 95% (as reported)", mode: "Not disclosed in the coverage; weighted by each county’s share of registered voters",
    undecided: 8.4, shares: { ruto: 45.1, sifuna: 19.6, kalonzo: 10.3, matiangi: 7.2, gachagua: 6.0, wajackoyah: 1.1, karua: 0.8, maraga: 0.8 }, other: "Orengo 0.4, Wanjigi 0.3",
    grade: "C", gradeNote: "Largest sample and the freshest field dates, and it weights by each county’s share of the register. But the interview mode is not disclosed, so how representative the sample is cannot be judged, and the sample is much larger than a ±3 margin needs. It also finds Ruto 13 to 21 points above the other two polls and far fewer undecided voters. Treat it as the high end of Ruto’s range, not a central estimate.",
    disclosed: { sample: true, margin: true, mode: false, fieldwork: true },
    source: { label: "Capital FM", url: "https://capitalfm.africa/ruto-leads-2027-presidential-race-with-45-1-politrack-africa-poll/" },
  },
  {
    id: "infotrak", pollster: "Infotrak Research & Consulting", fieldwork: "Not stated (released week of 13 July 2026)", published: "2026-07-13",
    sample: "Not stated (“thousands”, all 47 counties)", margin: "Not stated", mode: "Not stated",
    undecided: 18, shares: { ruto: 32, kalonzo: 13, sifuna: 12, matiangi: 12, gachagua: 4 }, other: "Refused 3. Owino, Maraga, Karua each below 4",
    grade: "C", gradeNote: "An established pollster with a published trend (Ruto 21% in Aug 2025, 28% in Dec 2025, 32% in Jul 2026), and a candid undecided share of 18%. But the press coverage gives no sample, margin of error, mode or field dates, which the Publication of Electoral Opinion Polls Act expects. In 2022 its final poll had Raila Odinga ahead by 7 points; he lost.",
    disclosed: { sample: false, margin: false, mode: false, fieldwork: false },
    source: { label: "Bana (Infotrak)", url: "https://www.bana.co.ke/2026/07/ruto-tops-infotrak-poll-for-2027-election-at-32.html" },
  },
  {
    id: "tifa", pollster: "TIFA Research", fieldwork: "2 to 11 May 2026", published: "2026-05-15",
    sample: "More than 2,000 adults", margin: "Not reported in the coverage (about ±2 to 3 points at this size)", mode: "Face-to-face household interviews, English and Swahili, nine zones",
    undecided: 15, shares: { ruto: 24, kalonzo: 19, matiangi: 14, sifuna: 10, gachagua: 9 }, other: "Owino 2, others 3, declined 3",
    grade: "B", gradeNote: "The most transparent of the three: dates, sample, face-to-face method and zones are published, and face-to-face avoids the phone-ownership gap in northern counties. The weaknesses are age (fieldwork is five months old, before Sifuna’s rise) and its 2022 record: the final poll had Raila Odinga 8 points ahead. Its low Ruto figure and 15% undecided make it the low end of the range.",
    disclosed: { sample: true, margin: false, mode: true, fieldwork: true },
    source: { label: "Nairobi Wire (TIFA)", url: "https://nairobiwire.com/2026/05/ruto-leads-2027-kenya-presidential-race-tifa-research-poll.html" },
  },
];

export const POLL_2022_LESSON = [
  { pollster: "TIFA", call: "Raila Odinga ahead by 8 points (adjusted 8.8)", right: false },
  { pollster: "Infotrak", call: "Raila Odinga ahead by 7 points (adjusted 7.6)", right: false },
  { pollster: "Ipsos", call: "Raila Odinga ahead by 6 points (adjusted 6.8)", right: false },
  { pollster: "Radio Africa", call: "Ruto 45.5%, Odinga 44.2% (50.4 to 49.0 with undecided removed)", right: true },
];

/* ── Sources ──────────────────────────────────────────────── */

export const SOURCES: { label: string; url: string; note: string }[] = [
  { label: "IEBC: registered voters per constituency, 2022 General Election", url: "https://www.iebc.or.ke/docs/rov_per_constituency.pdf", note: "County totals are the sum of constituencies; 22,102,532 (22,120,458 with diaspora and prison voters)" },
  { label: "Wikipedia: Counties of Kenya by population (KNBS 2019 census)", url: "https://en.wikipedia.org/wiki/List_of_counties_of_Kenya_by_population", note: "National total 47,564,296" },
  { label: "Citizen Digital: IEBC gazettes 2027 election period", url: "https://citizen.digital/article/iebc-gazettes-2027-election-period-unveils-key-timelines-for-aspirants-and-campaigns-n388705", note: "Timetable" },
  { label: "Kenyans.co.ke: IEBC on why 10 August 2027 stands despite the court ruling", url: "https://www.kenyans.co.ke/news/126442-iebc-official-explains-why-2027-election-date-remains-august-10-despite-court-ruling", note: "Malindi High Court ruling, 7 August 2026" },
  { label: "The Star: IEBC registers 2.3 million new voters in 30 days", url: "https://www.the-star.co.ke/news/2026-04-30-iebc-registers-23m-new-voters-in-30-days", note: "2,612,725 new voters to 28 April 2026" },
  { label: "Nation: 2027 numbers, inside Kenya’s shifting voter map", url: "https://nation.africa/kenya/news/2027-numbers-inside-kenya-s-shifting-voter-map-5439208", note: "County registrations for 26 counties" },
  { label: "Capital FM: Politrack Africa poll", url: "https://capitalfm.africa/ruto-leads-2027-presidential-race-with-45-1-politrack-africa-poll/", note: "September 2026" },
  { label: "Bana: Infotrak poll", url: "https://www.bana.co.ke/2026/07/ruto-tops-infotrak-poll-for-2027-election-at-32.html", note: "July 2026" },
  { label: "Nairobi Wire: TIFA poll", url: "https://nairobiwire.com/2026/05/ruto-leads-2027-kenya-presidential-race-tifa-research-poll.html", note: "May 2026" },
  { label: "The Star: Only Radio Africa correctly predicted the 2022 result", url: "https://www.the-star.co.ke/news/2022-09-29-only-radio-africa-correctly-predicted-election-results", note: "Published by an interested party (Radio Africa Group)" },
  { label: "The Elephant: Polls and ballots, getting into the weeds", url: "https://www.theelephant.info/analysis/2022/07/03/polls-and-ballots-getting-into-the-weeds-of-election-based-survey-research/", note: "Method critique of Kenyan polling" },
  { label: "Kenyans.co.ke: Gachagua’s 2027 bid and opposition strategy", url: "https://www.kenyans.co.ke/news/123088-gachagua-unveils-new-opposition-strategy-unseat-ruto-after-declaring-interest", note: "May 2026" },
  { label: "AllAfrica: United Opposition vows a single challenger", url: "https://allafrica.com/stories/202601290059.html", note: "January 2026" },
  { label: "Citizen Digital: Sifuna on a 2027 run", url: "https://citizen.digital/article/edwin-sifuna-speaks-on-whether-he-will-run-for-president-in-2027-n387305", note: "28 July 2026" },
  { label: "Kenyans.co.ke: Maraga declares on the UGM ticket", url: "https://www.kenyans.co.ke/news/116755-maraga-declares-2027-presidential-bid-united-green-movement-party", note: "2 October 2025" },
  { label: "Nation: ODM to stay in the broad-based government until 2027", url: "https://nation.africa/kenya/news/politics/odm-party-will-remain-in-ruto-s-broad-based-government-until-2027-5247260", note: "October 2025" },
];
