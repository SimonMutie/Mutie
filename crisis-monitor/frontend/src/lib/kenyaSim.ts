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
  /** National share of decided voters, from the polls. */
  share: number;
  mobilisation: number;
  backyard: string[];
  strongholds: Record<string, number>;
}

export type Groups = Record<string, string | null>;

export interface Ticket {
  key: string;
  label: string;
  members: string[];
  leader: string;
  share: number;
  mobilisation: number;
  backyard: Set<string>;
  strongholds: Record<string, number>;
}

export function buildTickets(cands: SimCandidate[], groups: Groups, transfer: number): Ticket[] {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const groupKeys = [...new Set(cands.map((c) => groups[c.id]).filter((g): g is string => !!g))].sort();
  const tickets: Ticket[] = [];
  const grouped = new Set<string>();
  for (const g of groupKeys) {
    const members = cands.filter((c) => groups[c.id] === g).sort((a, b) => b.share - a.share);
    if (members.length === 0) continue;
    members.forEach((m) => grouped.add(m.id));
    const leader = members[0];
    const carried = members.reduce((s, m) => s + (m.id === leader.id ? m.share : m.share * transfer), 0);
    const total = members.reduce((s, m) => s + m.share, 0);
    const mob = total > 0 ? members.reduce((s, m) => s + m.share * m.mobilisation, 0) / total : leader.mobilisation;
    const strong: Record<string, number> = {};
    for (const r of REGIONS) strong[r] = Math.max(...members.map((m) => m.strongholds[r] ?? 0));
    tickets.push({
      key: `group-${g}`,
      label: members.length === 1 ? leader.name : `${leader.short} ticket (with ${members.slice(1).map((m) => m.short).join(", ")})`,
      members: members.map((m) => m.id),
      leader: leader.id,
      share: carried,
      mobilisation: mob,
      backyard: new Set(members.flatMap((m) => m.backyard)),
      strongholds: strong,
    });
  }
  for (const c of cands) {
    if (grouped.has(c.id)) continue;
    tickets.push({
      key: c.id,
      label: c.name,
      members: [c.id],
      leader: c.id,
      share: c.share,
      mobilisation: c.mobilisation,
      backyard: new Set(byId.get(c.id)?.backyard ?? []),
      strongholds: c.strongholds,
    });
  }
  // Votes that did not carry from the members who left return to every ticket in proportion.
  const lost = cands.reduce((s, c) => {
    if (!groups[c.id]) return s;
    const members = cands.filter((m) => groups[m.id] === groups[c.id]);
    const leader = [...members].sort((a, b) => b.share - a.share)[0];
    return s + (c.id === leader.id ? 0 : c.share * (1 - transfer));
  }, 0);
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
  groups: Groups;
  transfer?: number;
  turnout?: number;
  draws?: number;
  seed?: number;
}

export function simulate(cands: SimCandidate[], settings: SimSettings): SimResult {
  const transfer = settings.transfer ?? TRANSFER_DEFAULT;
  const turnout = settings.turnout ?? TURNOUT_DEFAULT;
  const draws = Math.max(1, settings.draws ?? 1500);
  const tickets = buildTickets(cands, settings.groups, transfer);
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

/* ── scenarios ────────────────────────────────────────────────── */

export interface Scenario {
  id: string;
  name: string;
  blurb: string;
  groups: Groups;
}

const OPPOSITION = ["kalonzo", "gachagua", "matiangi", "karua", "wamalwa"];
const pick = (ids: string[], g: string | null = "A"): Groups => Object.fromEntries(ids.map((id) => [id, g]));

export const SCENARIOS: Scenario[] = [
  { id: "separate", name: "Separate tickets", blurb: "Every candidate runs alone. The baseline the polls measure.", groups: {} },
  { id: "united", name: "United opposition", blurb: "Kalonzo, Gachagua, Matiang’i, Karua and Wamalwa run one ticket, led by the strongest member.", groups: pick(OPPOSITION) },
  { id: "united-sifuna", name: "United opposition with Sifuna", blurb: "The united opposition plus Edwin Sifuna, whose Nairobi base is the largest single city vote.", groups: pick([...OPPOSITION, "sifuna"]) },
  { id: "mt-kenya-ukambani", name: "Mt Kenya and Ukambani", blurb: "Gachagua and Kalonzo only. Tests whether two regional bases add up.", groups: pick(["gachagua", "kalonzo"]) },
];

export interface Realignment {
  id: string;
  date: string; // ISO day the change was announced or took effect
  candidate: string;
  ticket: string | null; // null = leaves its ticket and runs alone
  note: string;
  source: string;
}

/** Simulator candidates from the seeds, with each national share taken from the polls. */
export function candidatesFrom(seeds: CandidateSeed[], polls: Poll[], asOf: string): SimCandidate[] {
  const avg = pollAverage(polls, seeds.map((s) => s.id), asOf);
  return seeds.map((s) => ({
    id: s.id,
    name: s.name,
    short: s.short,
    share: avg[s.id] ?? 0,
    mobilisation: s.mobilisation,
    backyard: s.backyard,
    strongholds: s.strongholds as Record<string, number>,
  }));
}

/** Groups from a live arrangement: realignments dated on or before the as-of date, latest wins. */
export function groupsFromRealignments(events: Pick<Realignment, "date" | "candidate" | "ticket">[], asOf: string): Groups {
  const groups: Groups = {};
  for (const e of [...events].filter((x) => x.date <= asOf).sort((a, b) => a.date.localeCompare(b.date))) {
    groups[e.candidate] = e.ticket;
  }
  return groups;
}
