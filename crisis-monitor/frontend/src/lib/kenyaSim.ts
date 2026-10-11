import { COUNTIES, type County, type Poll } from "../data/kenyaElection";

/**
 * The 2027 presidential simulator. Pure functions: the same inputs always give the
 * same answer, so the page, the tests and any export agree.
 *
 * How a run works
 *  1. Each candidate's national share is the average of the polls that name them,
 *     weighted by the pollster's grade and by recency. Undecided voters are shared
 *     out in proportion, so the shares sum to 100%.
 *  2. Candidates can join groups (coalitions). A group runs one ticket, led by its
 *     strongest member. Members carry their votes at a transfer rate, and the votes
 *     that do not carry go back to the field in proportion.
 *  3. Each county gets a share for each ticket from the ticket's national share,
 *     adjusted by its stronghold in that county's region (0 to 2), its mobilisation
 *     and a backyard bonus where the ticket's leader comes from. The county shares
 *     are then calibrated so the national result matches step 2.
 *  4. Monte Carlo draws add poll error, regional error and mobilisation noise, and
 *     each draw is run through the rule in Article 138(4) of the Constitution: a
 *     ticket wins in the first round with more than half of the valid votes and at
 *     least 25% in 24 of the 47 counties. Otherwise there is a runoff.
 *
 * Stronghold, mobilisation and backyard values are Afrilens judgements from each
 * candidate's stated base. They are inputs, not measured results, and are shown as
 * such. They can be replaced in the database as the 2022 county results are loaded.
 */

const DAY = 86_400_000;

/** Votes cast as a share of registered voters in 2022: 7,176,141 votes was 50.49%, so about 14.21 million valid votes on 22.10 million registered. */
export const TURNOUT_DEFAULT = 0.643;
export const GRADE_WEIGHT: Record<Poll["grade"], number> = { A: 1, B: 0.8, C: 0.5, D: 0.2 };
export const POLL_HALF_LIFE_DAYS = 120;
export const NATIONAL_POLL_SD = 0.03;
export const REGIONAL_SD = 0.025;
export const MOBILISATION_SD = 0.05;
export const BACKYARD_BONUS = 1.3;
export const TRANSFER_DEFAULT = 0.85;
export const FIRST_ROUND_SHARE = 0.5;
export const FIRST_ROUND_COUNTIES = 24;
export const COUNTY_FLOOR = 0.25;

export const REGIONS: string[] = [...new Set(COUNTIES.map((c) => c.region))];

/* ── seed inputs (judgements; see note above) ───────────────── */

export interface CandidateSeed {
  id: string;
  name: string;
  short: string;
  /** False for someone who is only a possible running mate: not polled, cannot head a ticket or run alone. */
  presidential?: boolean;
  mobilisation: number; // 0 to 1
  backyard: string[]; // IEBC county codes
  strongholds: Partial<Record<string, number>>; // region -> 0, 1 or 2
}

export const CANDIDATE_SEEDS: CandidateSeed[] = [
  { id: "ruto", name: "William Ruto", short: "Ruto", mobilisation: 0.8, backyard: ["027"], strongholds: { "Rift Valley": 2, Western: 1, Nyanza: 1, Coast: 1, Eastern: 1, "North Eastern": 1, Nairobi: 1 } },
  { id: "kalonzo", name: "Kalonzo Musyoka", short: "Kalonzo", mobilisation: 0.6, backyard: ["015", "016", "017"], strongholds: { Eastern: 2, Coast: 1, Nairobi: 1 } },
  { id: "gachagua", name: "Rigathi Gachagua", short: "Gachagua", mobilisation: 0.75, backyard: ["019", "020"], strongholds: { Central: 2, Eastern: 1, "Rift Valley": 1, Nairobi: 1 } },
  { id: "matiangi", name: "Fred Matiang’i", short: "Matiang’i", mobilisation: 0.6, backyard: ["045", "046"], strongholds: { Nyanza: 2, Western: 1, Nairobi: 0 } },
  { id: "sifuna", name: "Edwin Sifuna", short: "Sifuna", mobilisation: 0.55, backyard: ["047"], strongholds: { Nairobi: 2, Nyanza: 1 } },
  { id: "karua", name: "Martha Karua", short: "Karua", mobilisation: 0.45, backyard: ["020"], strongholds: { Central: 1, Nairobi: 1 } },
  { id: "maraga", name: "David Maraga", short: "Maraga", mobilisation: 0.4, backyard: [], strongholds: { Central: 1 } },
  { id: "wamalwa", name: "Eugene Wamalwa", short: "Wamalwa", mobilisation: 0.4, backyard: ["039"], strongholds: { Western: 2, "Rift Valley": 1 } },
  { id: "muturi", name: "Justin Muturi", short: "Muturi", mobilisation: 0.35, backyard: [], strongholds: { Eastern: 1, Central: 1 } },
  { id: "omtatah", name: "Okiya Omtatah", short: "Omtatah", mobilisation: 0.35, backyard: ["040"], strongholds: { Western: 1, Nairobi: 1 } },
  { id: "mwangi", name: "Boniface Mwangi", short: "Mwangi", mobilisation: 0.4, backyard: ["047"], strongholds: { Nairobi: 2 } },
  { id: "wajackoyah", name: "George Wajackoyah", short: "Wajackoyah", mobilisation: 0.3, backyard: [], strongholds: {} },
  // Possible running mates for Ruto. Not polled and not presidential candidates: they add their home region's
  // strength and backyard counties to a ticket they join, and carry no separate vote share. All values are judgements.
  { id: "kindiki", name: "Kithure Kindiki", short: "Kindiki", presidential: false, mobilisation: 0.6, backyard: ["013", "012"], strongholds: { Eastern: 2, Central: 1 } },
  { id: "mudavadi", name: "Musalia Mudavadi", short: "Mudavadi", presidential: false, mobilisation: 0.5, backyard: ["037", "038"], strongholds: { Western: 2 } },
  { id: "wetangula", name: "Moses Wetang’ula", short: "Wetang’ula", presidential: false, mobilisation: 0.5, backyard: ["039"], strongholds: { Western: 2 } },
  { id: "waiguru", name: "Anne Waiguru", short: "Waiguru", presidential: false, mobilisation: 0.5, backyard: ["020"], strongholds: { Central: 2, Eastern: 1 } },
  { id: "wanga", name: "Gladys Wanga", short: "Wanga", presidential: false, mobilisation: 0.5, backyard: ["043"], strongholds: { Nyanza: 2 } },
  { id: "oparanya", name: "Wycliffe Oparanya", short: "Oparanya", presidential: false, mobilisation: 0.4, backyard: ["037"], strongholds: { Western: 2 } },
  { id: "joho", name: "Hassan Joho", short: "Joho", presidential: false, mobilisation: 0.5, backyard: ["001"], strongholds: { Coast: 2 } },
];

/* ── poll average ─────────────────────────────────────────────── */

/** Share given to a candidate a poll does not name. Polls list their named candidates; the rest sit in an "other" line, so 0.5% is the working assumption. */
export const UNNAMED_POLL_SHARE = 0.5;

/**
 * Each candidate's share of decided voters, from every poll. Each poll is first put on a
 * decided basis (undecided and refused are dropped), a candidate it does not name gets
 * UNNAMED_POLL_SHARE, and polls are averaged with grade and recency weights. The result sums to 1.
 */
export function pollAverage(polls: Poll[], candidateIds: string[], asOf: string): Record<string, number> {
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const raw: Record<string, number> = Object.fromEntries(candidateIds.map((id) => [id, 0]));
  let den = 0;
  for (const p of polls) {
    const named = candidateIds.filter((id) => p.shares[id] !== undefined);
    if (named.length === 0) continue;
    const listed = candidateIds.map((id) => p.shares[id] ?? UNNAMED_POLL_SHARE);
    const sumListed = listed.reduce((a, b) => a + b, 0);
    const age = Math.max(0, (asOfMs - Date.parse(`${p.published}T00:00:00Z`)) / DAY);
    const w = GRADE_WEIGHT[p.grade] * Math.exp(-age / POLL_HALF_LIFE_DAYS);
    candidateIds.forEach((id, i) => {
      raw[id] += w * (listed[i] / sumListed);
    });
    den += w;
  }
  if (den <= 0) return Object.fromEntries(candidateIds.map((id) => [id, 1 / candidateIds.length]));
  const total = candidateIds.reduce((s, id) => s + raw[id] / den, 0);
  return Object.fromEntries(candidateIds.map((id) => [id, raw[id] / den / total]));
}

/* ── random numbers (seeded, so a run can be repeated) ───────── */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(rng: () => number, sd: number): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ── candidates and tickets ───────────────────────────────────── */

export interface SimCandidate {
  id: string;
  name: string;
  short: string;
  /** Can head a ticket and run alone. Running mates have false and carry no vote share. */
  presidential: boolean;
  /** National share of decided voters, from the polls. */
  share: number;
  mobilisation: number;
  backyard: string[];
  strongholds: Record<string, number>;
}

/**
 * A ticket: one presidential candidate, an optional running mate, and any other
 * candidates who back it. A candidate in no ticket runs alone.
 */
export interface TicketSpec {
  head: string;
  deputy: string | null;
  backers: string[];
}
export type Arrangement = TicketSpec[];
export const MAX_TICKETS = 4;

export interface Ticket {
  key: string;
  label: string;
  members: string[];
  head: string;
  deputy: string | null;
  backers: string[];
  share: number;
  mobilisation: number;
  backyard: Set<string>;
  strongholds: Record<string, number>;
}

/** The region where a candidate's base is strongest: their first region at level 2, if any. */
export function homeRegionOf(c: { strongholds: Record<string, number> }): string | null {
  return Object.entries(c.strongholds).find(([, v]) => v === 2)?.[0] ?? null;
}

/** Each ticket's vote: the presidential candidate in full, and the running mate and backers at the transfer rate. Votes that do not move return to every ticket in proportion. */
export function buildTickets(cands: SimCandidate[], arrangement: Arrangement, transfer: number): Ticket[] {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const used = new Set<string>();
  const tickets: Ticket[] = [];
  let lost = 0;

  arrangement.forEach((spec, i) => {
    const head = byId.get(spec.head);
    if (!head || !head.presidential || used.has(head.id)) return;
    used.add(head.id);
    const deputy = spec.deputy && spec.deputy !== head.id && byId.has(spec.deputy) && !used.has(spec.deputy) ? spec.deputy : null;
    if (deputy) used.add(deputy);
    const backers = [...new Set(spec.backers)].filter((id) => id !== head.id && byId.has(id) && !used.has(id));
    backers.forEach((id) => used.add(id));
    const partners = [...(deputy ? [deputy] : []), ...backers].map((id) => byId.get(id)!);
    const members = [head, ...partners];
    lost += partners.reduce((sum, m) => sum + m.share * (1 - transfer), 0);
    const carried = head.share + partners.reduce((sum, m) => sum + m.share * transfer, 0);
    const total = members.reduce((sum, m) => sum + m.share, 0);
    const mob = total > 0 ? members.reduce((sum, m) => sum + m.share * m.mobilisation, 0) / total : head.mobilisation;
    // A running mate brings their home region as a lean, and nowhere else. A base would multiply
    // the ticket's share there about fivefold, and a lean elsewhere would only draw votes from
    // the home region. Both are judgements; see homeRegionOf.
    const deputyHome = deputy ? homeRegionOf(byId.get(deputy)!) : null;
    const strong: Record<string, number> = {};
    for (const r of REGIONS) {
      const headLevel = head.strongholds[r] ?? 0;
      const backerLevels = backers.map((id) => byId.get(id)!.strongholds[r] ?? 0);
      const deputyLevel = r === deputyHome ? 1 : 0;
      strong[r] = Math.max(headLevel, deputyLevel, ...backerLevels);
    }
    const label = deputy ? `${head.short} & ${byId.get(deputy)!.short}` : head.name;
    tickets.push({
      key: `ticket-${i}`,
      label,
      members: members.map((m) => m.id),
      head: head.id,
      deputy,
      backers,
      share: carried,
      mobilisation: mob,
      backyard: new Set(members.flatMap((m) => m.backyard)),
      strongholds: strong,
    });
  });

  for (const c of cands) {
    if (used.has(c.id) || !c.presidential) continue;
    tickets.push({
      key: c.id,
      label: c.name,
      members: [c.id],
      head: c.id,
      deputy: null,
      backers: [],
      share: c.share,
      mobilisation: c.mobilisation,
      backyard: new Set(c.backyard),
      strongholds: c.strongholds,
    });
  }

  const base = tickets.reduce((s, t) => s + t.share, 0);
  if (base > 0 && lost > 0) for (const t of tickets) t.share += lost * (t.share / base);
  const sum = tickets.reduce((s, t) => s + t.share, 0);
  if (sum > 0) for (const t of tickets) t.share /= sum;
  return tickets.sort((a, b) => b.share - a.share);
}

/* ── counties ─────────────────────────────────────────────────── */

export interface CountyResult {
  county: County;
  votes: number;
  shares: number[]; // per ticket, sums to 1
}

export interface Distribution {
  counties: CountyResult[];
  national: number[]; // per ticket
  countiesAtFloor: number[]; // per ticket: counties with at least 25%
}

const regionRegister = (c: County) => c.reg2022 + (c.new2026 ?? 0);

/** Splits each ticket's national share across the counties and calibrates the result to it. */
export function distribute(tickets: Ticket[], turnout: number, noise?: { region: number[][]; mob: number[] }): Distribution {
  const T = tickets.length;
  const regionW: Record<string, number> = {};
  for (const c of COUNTIES) regionW[c.region] = (regionW[c.region] ?? 0) + regionRegister(c);
  const totalW = Object.values(regionW).reduce((a, b) => a + b, 0);
  const avgStrong = tickets.map((t) => REGIONS.reduce((s, r) => s + (regionW[r] ?? 0) * (t.strongholds[r] ?? 0), 0) / totalW);
  const regionIndex = new Map(REGIONS.map((r, i) => [r, i]));
  const mobAdj = tickets.map((t, b) => 0.85 + 0.3 * Math.min(1, Math.max(0, t.mobilisation + (noise?.mob[b] ?? 0))));

  // raw[c][b] before calibration
  const raw = COUNTIES.map((c) =>
    tickets.map((t, b) => {
      const r = regionIndex.get(c.region) ?? 0;
      const strong = ((t.strongholds[c.region] ?? 0) + 0.5) / (avgStrong[b] + 0.5);
      const yard = t.backyard.has(c.code) ? BACKYARD_BONUS : 1;
      const reg = 1 + (noise?.region[b]?.[r] ?? 0);
      return Math.max(1e-9, t.share * strong * yard * mobAdj[b] * Math.max(0.05, reg));
    }),
  );
  // Iterative proportional fitting: each ticket gets one multiplier, the county shares are
  // renormalised, and the multipliers are nudged until the register-weighted national share matches.
  const total = COUNTIES.reduce((s, c) => s + regionRegister(c), 0);
  const factor = tickets.map(() => 1);
  const fit = () => COUNTIES.map((_, i) => normalise(raw[i].map((v, b) => v * factor[b])));
  let shares = fit();
  for (let iter = 0; iter < 12; iter++) {
    const model = tickets.map((_, b) => COUNTIES.reduce((s, c, i) => s + regionRegister(c) * shares[i][b], 0) / total);
    let worst = 0;
    tickets.forEach((t, b) => {
      if (model[b] <= 0) return;
      const ratio = t.share / model[b];
      factor[b] *= Math.sqrt(ratio); // damped, so the fit settles rather than oscillates
      worst = Math.max(worst, Math.abs(ratio - 1));
    });
    shares = fit();
    if (worst < 5e-4) break;
  }
  const counties: CountyResult[] = COUNTIES.map((c, i) => ({ county: c, votes: regionRegister(c) * turnout, shares: shares[i] }));
  const national = tickets.map((_, b) => counties.reduce((s, c) => s + c.votes * c.shares[b], 0) / counties.reduce((s, c) => s + c.votes, 0));
  const countiesAtFloor = tickets.map((_, b) => counties.filter((c) => c.shares[b] >= COUNTY_FLOOR).length);
  return { counties, national, countiesAtFloor };
}

function normalise(v: number[]): number[] {
  const s = v.reduce((a, b) => a + b, 0);
  return s > 0 ? v.map((x) => x / s) : v.map(() => 1 / v.length);
}

/* ── the simulation ───────────────────────────────────────────── */

export interface TicketOutcome {
  key: string;
  label: string;
  members: string[];
  head: string;
  deputy: string | null;
  backers: string[];
  central: number; // national share in the central run
  p10: number;
  p50: number;
  p90: number;
  pOutright: number; // share of draws won in the first round
  pLeads: number; // share of draws where this ticket has the most votes
  countiesAtFloor: number; // mean across draws
  mobilisation: number;
}

export interface SimResult {
  tickets: TicketOutcome[];
  pFirstRound: number;
  pRunoff: number;
  /** Mean share by region for the central run, per ticket. */
  regions: { region: string; votes: number; shares: number[] }[];
  /** Histogram of the leading ticket's share across draws, 2-point bins from 20% to 70%. */
  leaderHistogram: { from: number; count: number }[];
  draws: number;
  turnout: number;
  transfer: number;
}

export interface SimSettings {
  arrangement: Arrangement;
  transfer?: number;
  turnout?: number;
  draws?: number;
  seed?: number;
}

export function simulate(cands: SimCandidate[], settings: SimSettings): SimResult {
  const transfer = settings.transfer ?? TRANSFER_DEFAULT;
  const turnout = settings.turnout ?? TURNOUT_DEFAULT;
  const draws = Math.max(1, settings.draws ?? 1500);
  const tickets = buildTickets(cands, settings.arrangement, transfer);
  const central = distribute(tickets, turnout);
  const rng = mulberry32(settings.seed ?? 2027);
  const T = tickets.length;

  const nat: number[][] = [];
  const floors: number[][] = [];
  const outright: boolean[] = [];
  const leads: number[] = [];
  for (let d = 0; d < draws; d++) {
    const noisyShare = tickets.map((t) => Math.max(0.002, t.share + normal(rng, NATIONAL_POLL_SD)));
    const ns = normalise(noisyShare);
    const perTicket = tickets.map((t, b) => ({ ...t, share: ns[b] }));
    const region = Array.from({ length: T }, () => REGIONS.map(() => normal(rng, REGIONAL_SD)));
    const mob = Array.from({ length: T }, () => normal(rng, MOBILISATION_SD));
    const dist = distribute(perTicket, turnout, { region, mob });
    nat.push(dist.national);
    floors.push(dist.countiesAtFloor);
    const win = dist.national.map((s, b) => s > FIRST_ROUND_SHARE && dist.countiesAtFloor[b] >= FIRST_ROUND_COUNTIES);
    outright.push(win.some(Boolean));
    leads.push(dist.national.indexOf(Math.max(...dist.national)));
  }

  const outcomes: TicketOutcome[] = tickets.map((t, b) => {
    const xs = nat.map((n) => n[b]).sort((x, y) => x - y);
    const q = (p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
    const wins = nat.reduce((s, n, d) => s + (n[b] > FIRST_ROUND_SHARE && floors[d][b] >= FIRST_ROUND_COUNTIES ? 1 : 0), 0);
    return {
      key: t.key,
      label: t.label,
      members: t.members,
      head: t.head,
      deputy: t.deputy,
      backers: t.backers,
      central: central.national[b],
      p10: q(0.1),
      p50: q(0.5),
      p90: q(0.9),
      pOutright: wins / draws,
      pLeads: leads.filter((l) => l === b).length / draws,
      countiesAtFloor: floors.reduce((s, f) => s + f[b], 0) / draws,
      mobilisation: t.mobilisation,
    };
  });

  const firstRound = outright.filter(Boolean).length / draws;
  const regions = REGIONS.map((r) => {
    const cs = central.counties.filter((c) => c.county.region === r);
    const votes = cs.reduce((s, c) => s + c.votes, 0);
    return { region: r, votes, shares: tickets.map((_, b) => (votes > 0 ? cs.reduce((s, c) => s + c.votes * c.shares[b], 0) / votes : 0)) };
  });

  const bins = Array.from({ length: 25 }, (_, i) => ({ from: 0.2 + i * 0.02, count: 0 }));
  leads.forEach((l, d) => {
    const v = nat[d][l];
    const i = Math.floor((v - 0.2) / 0.02);
    if (i >= 0 && i < bins.length) bins[i].count += 1;
  });

  return { tickets: outcomes, pFirstRound: firstRound, pRunoff: 1 - firstRound, regions, leaderHistogram: bins, draws, turnout, transfer };
}

export type TicketRole = "head" | "deputy" | "backer";

export interface Realignment {
  id: string;
  date: string; // ISO day the change was announced or took effect
  candidate: string;
  ticket: string | null; // null = leaves its ticket and runs alone
  role: TicketRole;
  note: string;
  source: string;
}

/** Simulator candidates from the seeds, with each national share taken from the polls. */
export function candidatesFrom(seeds: CandidateSeed[], polls: Poll[], asOf: string): SimCandidate[] {
  const presidential = seeds.filter((s) => s.presidential !== false);
  const avg = pollAverage(polls, presidential.map((s) => s.id), asOf);
  return seeds.map((s) => ({
    id: s.id,
    name: s.name,
    short: s.short,
    presidential: s.presidential !== false,
    share: avg[s.id] ?? 0,
    mobilisation: s.mobilisation,
    backyard: s.backyard,
    strongholds: s.strongholds as Record<string, number>,
  }));
}

/* ── scenarios ────────────────────────────────────────────────── */

export interface Scenario {
  id: string;
  name: string;
  blurb: string;
  arrangement: Arrangement;
}

/** Every opposition candidate in the field. Ruto is the only one outside it. */
export const OPPOSITION_FIELD = ["kalonzo", "gachagua", "matiangi", "sifuna", "karua", "maraga", "wamalwa", "muturi", "omtatah", "mwangi", "wajackoyah"];
const backersExcept = (...ids: string[]) => OPPOSITION_FIELD.filter((id) => !ids.includes(id));

export const SCENARIOS: Scenario[] = [
  {
    id: "separate",
    name: "No alliances",
    blurb: "Every candidate runs alone. This is the baseline the polls measure.",
    arrangement: [],
  },
  {
    id: "ruto-kindiki",
    name: "Ruto with Kindiki",
    blurb: "Ruto runs with Kithure Kindiki, the incumbent Deputy President, as running mate. No one else backs the ticket.",
    arrangement: [{ head: "ruto", deputy: "kindiki", backers: [] }],
  },
  {
    id: "kalonzo-gachagua",
    name: "Kalonzo with Gachagua",
    blurb: "Kalonzo Musyoka runs for president with Rigathi Gachagua as running mate. Every other opposition candidate backs the ticket.",
    arrangement: [{ head: "kalonzo", deputy: "gachagua", backers: backersExcept("kalonzo", "gachagua") }],
  },
  {
    id: "sifuna-gachagua",
    name: "Sifuna with Gachagua",
    blurb: "Edwin Sifuna runs for president with Rigathi Gachagua as running mate. Every other opposition candidate backs the ticket.",
    arrangement: [{ head: "sifuna", deputy: "gachagua", backers: backersExcept("sifuna", "gachagua") }],
  },
];

/** The running mates Afrilens tests for Ruto. Each is a judgement of home-region and backyard strength, not a poll. */
export const RUTO_RUNNING_MATES: { id: string; note: string }[] = [
  { id: "kindiki", note: "Incumbent Deputy President" },
  { id: "mudavadi", note: "Western Kenya; senior government figure" },
  { id: "wetangula", note: "Western Kenya" },
  { id: "waiguru", note: "Mt Kenya (Kirinyaga)" },
  { id: "wanga", note: "Lake Victoria (Homa Bay)" },
  { id: "oparanya", note: "Western Kenya (Kakamega)" },
  { id: "joho", note: "Coast (Mombasa)" },
];

/** The arrangement on the record: the latest change per candidate, dated on or before the as-of day. */
export function arrangementFromRealignments(events: Pick<Realignment, "date" | "candidate" | "ticket" | "role">[], asOf: string): Arrangement {
  const latest = new Map<string, (typeof events)[number]>();
  for (const e of [...events].filter((x) => x.date <= asOf).sort((a, b) => a.date.localeCompare(b.date))) latest.set(e.candidate, e);
  const byTicket = new Map<string, { head?: string; deputy?: string; backers: string[] }>();
  for (const [candidate, e] of latest) {
    if (!e.ticket) continue;
    const t = byTicket.get(e.ticket) ?? { backers: [] };
    if (e.role === "head") t.head = candidate;
    else if (e.role === "deputy") t.deputy = candidate;
    else t.backers.push(candidate);
    byTicket.set(e.ticket, t);
  }
  return [...byTicket.values()]
    .filter((t) => t.head)
    .map((t) => ({ head: t.head!, deputy: t.deputy ?? null, backers: t.backers.filter((id) => id !== t.head && id !== t.deputy) }));
}
