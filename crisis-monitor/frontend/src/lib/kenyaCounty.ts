import { COUNTIES } from "../data/kenyaElection";
import { COUNTY_HISTORY } from "../data/kenyaCountyHistory";
import { buildTickets, COUNTY_FLOOR, FIRST_ROUND_COUNTIES, FIRST_ROUND_SHARE, OPPOSITION_FIELD, TRANSFER_DEFAULT, type Arrangement, type SimCandidate } from "./kenyaSim";

/**
 * County-level view of the 2027 presidential race, built on the real 2022 county results.
 *
 *  1. Turnout: what each county did in 2013, 2017 and 2022, and a 2027 range extrapolated from the trend.
 *  2. Inheritance: every county's 2022 Ruto and Odinga vote is handed to the 2027 candidates by community
 *     (bloc). The hand-over rates are Afrilens judgements, not measured results.
 *  3. Poll check: the inherited national shares are compared with the poll average and pulled toward it by a
 *     weight the reader sets (0 = 2022 inheritance only, 1 = polls only).
 *  4. Coalitions: a ticket takes its head's votes plus partners' votes at the transfer rate, and a running
 *     mate adds a pull in his or her home bloc. Without a first-round winner the top two go to a runoff.
 *
 * Everything is a pure function of the inputs; there is no randomness here. The Monte Carlo simulator in
 * kenyaSim.ts remains the place for probabilities.
 */

/* ── turnout ──────────────────────────────────────────────────── */

export type TurnoutCase = "low" | "central" | "high";
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface TurnoutRow {
  code: string;
  name: string;
  bloc: string;
  region: string;
  reg2013: number;
  reg2017: number;
  reg2022: number;
  /** 2022 register plus the 2026 drive where the county's figure has been published. */
  reg2027: number;
  cast2013: number;
  cast2017: number;
  cast2022: number;
  t2013: number;
  t2017: number;
  t2022: number;
  t2027: Record<TurnoutCase, number>;
  cast2027: Record<TurnoutCase, number>;
  /** Share of votes cast in 2022 that were rejected. */
  rejected2022: number;
}

/**
 * The three cases for 2027, per county, as a share of the register:
 *  low      the 2017 to 2022 slide carries on in full (or, where turnout rose, falls three points)
 *  central  a quarter of that slide carries on
 *  high     turnout recovers half the way back to 2017 (at least three points above 2022)
 */
export function turnoutRows(): TurnoutRow[] {
  return COUNTY_HISTORY.map((h) => {
    const c = COUNTIES.find((x) => x.code === h.code)!;
    const cast2013 = h.voted2013;
    const cast2017 = Math.round((h.reg2017 * h.turnout2017) / 100);
    const cast2022 = h.valid2022 + h.rejected2022;
    const t2013 = cast2013 / h.reg2013;
    const t2017 = h.turnout2017 / 100;
    const t2022 = cast2022 / h.reg2022;
    const slide = t2022 - t2017;
    const low = clamp(Math.min(t2022 + slide, t2022 - 0.03), 0.3, 0.92);
    const high = clamp(Math.max(t2022 + 0.03, (t2022 + t2017) / 2), 0.3, 0.92);
    const central = Math.min(high, Math.max(low, clamp(t2022 + 0.25 * slide, 0.3, 0.92)));
    const reg2027 = c.reg2022 + (c.new2026 ?? 0);
    const t2027 = { low, central, high };
    return {
      code: h.code,
      name: h.name,
      bloc: h.bloc,
      region: c.region,
      reg2013: h.reg2013,
      reg2017: h.reg2017,
      reg2022: h.reg2022,
      reg2027,
      cast2013,
      cast2017,
      cast2022,
      t2013,
      t2017,
      t2022,
      t2027,
      cast2027: { low: Math.round(reg2027 * low), central: Math.round(reg2027 * central), high: Math.round(reg2027 * high) },
      rejected2022: h.rejected2022 / cast2022,
    };
  });
}

export function turnoutTotals(rows: TurnoutRow[], tcase: TurnoutCase) {
  const sum = (f: (r: TurnoutRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const reg2013 = sum((r) => r.reg2013), reg2017 = sum((r) => r.reg2017), reg2022 = sum((r) => r.reg2022), reg2027 = sum((r) => r.reg2027);
  const cast2013 = sum((r) => r.cast2013), cast2017 = sum((r) => r.cast2017), cast2022 = sum((r) => r.cast2022), cast2027 = sum((r) => r.cast2027[tcase]);
  return { reg2013, reg2017, reg2022, reg2027, cast2013, cast2017, cast2022, cast2027, t2013: cast2013 / reg2013, t2017: cast2017 / reg2017, t2022: cast2022 / reg2022, t2027: cast2027 / reg2027 };
}

/* ── inheritance: 2022 vote to 2027 candidate ─────────────────── */

type Key = "ruto" | "gachagua" | "kalonzo" | "matiangi" | "sifuna" | "wamalwa" | "karua" | "rest";
type Matrix = Record<string, Partial<Record<Key, number>>>;
const NAMED: Key[] = ["ruto", "gachagua", "kalonzo", "matiangi", "sifuna", "wamalwa", "karua"];

/**
 * Where a 2022 Ruto voter goes in 2027, by community. Afrilens judgement, read from each leader's stated base,
 * the 2024 split between Ruto and Gachagua, and the 2025 and 2026 realignments. Rows are normalised, so only
 * the proportions matter. "rest" is the minor candidates, shared out by their poll standing.
 */
export const INHERIT_FROM_RUTO: Matrix = {
  gema: { ruto: 0.4, gachagua: 0.42, karua: 0.05, kalonzo: 0.02, matiangi: 0.02, sifuna: 0.02, rest: 0.07 },
  "meru-embu": { ruto: 0.5, gachagua: 0.3, karua: 0.03, kalonzo: 0.04, matiangi: 0.02, sifuna: 0.02, rest: 0.09 },
  kamba: { ruto: 0.45, kalonzo: 0.35, gachagua: 0.06, matiangi: 0.03, sifuna: 0.03, rest: 0.08 },
  luo: { ruto: 0.65, sifuna: 0.12, matiangi: 0.06, kalonzo: 0.05, gachagua: 0.02, rest: 0.1 },
  gusii: { ruto: 0.55, matiangi: 0.3, sifuna: 0.04, kalonzo: 0.04, gachagua: 0.02, rest: 0.05 },
  luhya: { ruto: 0.55, wamalwa: 0.12, sifuna: 0.1, kalonzo: 0.08, matiangi: 0.05, gachagua: 0.02, rest: 0.08 },
  kalenjin: { ruto: 0.9, gachagua: 0.02, kalonzo: 0.01, matiangi: 0.01, sifuna: 0.01, rest: 0.05 },
  maasai: { ruto: 0.72, sifuna: 0.08, kalonzo: 0.06, matiangi: 0.04, gachagua: 0.03, rest: 0.07 },
  north: { ruto: 0.7, kalonzo: 0.07, sifuna: 0.08, matiangi: 0.05, gachagua: 0.02, rest: 0.08 },
  somali: { ruto: 0.62, kalonzo: 0.08, sifuna: 0.1, matiangi: 0.06, gachagua: 0.02, rest: 0.12 },
  coast: { ruto: 0.55, sifuna: 0.15, kalonzo: 0.1, matiangi: 0.05, gachagua: 0.03, rest: 0.12 },
  nairobi: { ruto: 0.42, sifuna: 0.2, gachagua: 0.12, kalonzo: 0.08, matiangi: 0.05, karua: 0.04, rest: 0.09 },
  mixed: { ruto: 0.6, sifuna: 0.1, kalonzo: 0.08, gachagua: 0.08, matiangi: 0.04, wamalwa: 0.03, rest: 0.07 },
};

/**
 * Where a 2022 Raila Odinga voter goes in 2027. Odinga died in October 2025, so his coalition vote has no
 * single heir: ODM's base leans to Sifuna (and a part to a deal with Ruto), the Kamba vote to Kalonzo, and the
 * Gusii vote to Matiang’i. Afrilens judgement, as above.
 */
export const INHERIT_FROM_RAILA: Matrix = {
  gema: { sifuna: 0.15, gachagua: 0.3, karua: 0.2, kalonzo: 0.1, matiangi: 0.08, ruto: 0.1, rest: 0.07 },
  "meru-embu": { sifuna: 0.15, gachagua: 0.25, karua: 0.15, kalonzo: 0.15, matiangi: 0.08, ruto: 0.12, rest: 0.1 },
  kamba: { kalonzo: 0.65, sifuna: 0.1, matiangi: 0.05, ruto: 0.12, gachagua: 0.03, rest: 0.05 },
  luo: { sifuna: 0.42, ruto: 0.18, matiangi: 0.15, kalonzo: 0.1, gachagua: 0.02, rest: 0.13 },
  gusii: { matiangi: 0.55, sifuna: 0.15, ruto: 0.12, kalonzo: 0.08, gachagua: 0.02, rest: 0.08 },
  luhya: { sifuna: 0.35, wamalwa: 0.15, kalonzo: 0.12, ruto: 0.15, matiangi: 0.06, gachagua: 0.02, rest: 0.15 },
  kalenjin: { ruto: 0.35, sifuna: 0.25, kalonzo: 0.1, matiangi: 0.08, gachagua: 0.04, rest: 0.18 },
  maasai: { sifuna: 0.35, ruto: 0.22, kalonzo: 0.15, matiangi: 0.08, gachagua: 0.05, rest: 0.15 },
  north: { sifuna: 0.35, ruto: 0.25, kalonzo: 0.12, matiangi: 0.08, gachagua: 0.03, rest: 0.17 },
  somali: { sifuna: 0.35, ruto: 0.22, kalonzo: 0.12, matiangi: 0.08, gachagua: 0.03, rest: 0.2 },
  coast: { sifuna: 0.45, kalonzo: 0.15, ruto: 0.15, matiangi: 0.08, gachagua: 0.03, rest: 0.14 },
  nairobi: { sifuna: 0.38, kalonzo: 0.12, gachagua: 0.12, matiangi: 0.08, ruto: 0.12, karua: 0.08, rest: 0.1 },
  mixed: { sifuna: 0.38, kalonzo: 0.14, ruto: 0.15, gachagua: 0.1, matiangi: 0.07, karua: 0.04, rest: 0.12 },
};

/** The extra pull a running mate who is not himself a presidential candidate brings in his or her home bloc: the share of other tickets' votes there that moves to the ticket. Afrilens judgement. */
export const RUNNING_MATE_PULL: Record<string, { why: string; pull: Record<string, number> }> = {
  kindiki: { why: "Deputy President, from Tharaka-Nithi", pull: { "meru-embu": 0.18, gema: 0.05, mixed: 0.02 } },
  mudavadi: { why: "ANC leader, Vihiga", pull: { luhya: 0.15 } },
  wetangula: { why: "Ford-Kenya leader, Bungoma", pull: { luhya: 0.1 } },
  waiguru: { why: "Governor of Kirinyaga", pull: { gema: 0.1, "meru-embu": 0.03 } },
  wanga: { why: "Governor of Homa Bay, ODM", pull: { luo: 0.1, gusii: 0.02 } },
  oparanya: { why: "Former Kakamega governor", pull: { luhya: 0.08 } },
  joho: { why: "Mining Cabinet Secretary, ODM deputy leader, Mombasa", pull: { coast: 0.12 } },
};

/** Share of a knocked-out ticket's voters who would back Ruto's ticket in a runoff, by head. Afrilens judgement. */
export const RUNOFF_LEAN_TO_RUTO: Record<string, number> = {
  kalonzo: 0.1, gachagua: 0.08, matiangi: 0.12, sifuna: 0.15, karua: 0.08, maraga: 0.15, wamalwa: 0.1, muturi: 0.35, omtatah: 0.1, mwangi: 0.08, wajackoyah: 0.35,
};
const DEFAULT_LEAN = 0.3;

/* ── the county model ─────────────────────────────────────────── */

export interface CountyModel {
  code: string;
  name: string;
  bloc: string;
  region: string;
  /** Valid votes in the county in 2027 at the chosen turnout. */
  valid: number;
  /** The 2022 result, as declared. */
  ruto2022: number;
  raila2022: number;
  other2022: number;
  valid2022: number;
  /** Candidate id to votes in 2027, from 2022 inheritance alone. */
  inherited: Record<string, number>;
  /** Candidate id to votes in 2027, after the poll check. */
  votes: Record<string, number>;
}

export interface CountyModelOptions {
  turnout: TurnoutCase;
  /** 0 = 2022 inheritance only, 1 = fully calibrated to the poll average. */
  pollWeight: number;
}

function normaliseRow(m: Partial<Record<Key, number>>): Partial<Record<Key, number>> {
  const s = Object.values(m).reduce((a, b) => a + (b ?? 0), 0);
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, (v ?? 0) / (s || 1)]));
}

export function buildCountyModel(cands: SimCandidate[], opts: CountyModelOptions): { counties: CountyModel[]; inheritedShare: Record<string, number>; share: Record<string, number>; pollShare: Record<string, number>; valid: number } {
  const pres = cands.filter((c) => c.presidential);
  const ids = pres.map((c) => c.id);
  const pollShare = Object.fromEntries(pres.map((c) => [c.id, c.share]));
  const minors = ids.filter((id) => !NAMED.includes(id as Key));
  const minorW = minors.map((id) => (pollShare[id] ?? 0) + 0.002);
  const minorSum = minorW.reduce((a, b) => a + b, 0);

  const expand = (row: Partial<Record<Key, number>>, votes: number, into: Record<string, number>) => {
    const r = normaliseRow(row);
    for (const k of NAMED) if (ids.includes(k) && r[k]) into[k] += votes * (r[k] as number);
    const rest = r.rest ?? 0;
    // A named candidate who is not in the field gives their share back to the minor candidates.
    const missing = NAMED.filter((k) => !ids.includes(k)).reduce((s, k) => s + (r[k] ?? 0), 0);
    minors.forEach((id, i) => (into[id] += votes * (rest + missing) * (minorW[i] / minorSum)));
  };

  const turn = turnoutRows();
  const base = COUNTY_HISTORY.map((h, i) => {
    const t = turn[i];
    const valid2027 = t.cast2027[opts.turnout] * (1 - t.rejected2022);
    const scale = valid2027 / h.valid2022;
    const inh: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
    expand(INHERIT_FROM_RUTO[h.bloc] ?? {}, h.ruto2022 * scale, inh);
    expand(INHERIT_FROM_RAILA[h.bloc] ?? {}, h.raila2022 * scale, inh);
    if (minors.length) minors.forEach((id, k) => (inh[id] += h.other2022 * scale * (minorW[k] / minorSum)));
    else inh[ids[0]] += h.other2022 * scale;
    return { h, t, valid2027, inh };
  });

  const total = base.reduce((s, b) => s + b.valid2027, 0);
  const inhShares = base.map((b) => {
    const s = ids.reduce((a, id) => a + b.inh[id], 0) || 1;
    return ids.map((id) => b.inh[id] / s);
  });
  const natInh = ids.map((_, k) => inhShares.reduce((s, row, i) => s + row[k] * base[i].valid2027, 0) / total);

  // Iterative proportional fitting of the inherited shares to the poll average.
  const target = ids.map((id) => pollShare[id]);
  const factor = ids.map(() => 1);
  const fit = (exp: number) =>
    inhShares.map((row) => {
      const v = row.map((x, k) => x * Math.pow(factor[k], exp));
      const s = v.reduce((a, b) => a + b, 0) || 1;
      return v.map((x) => x / s);
    });
  for (let it = 0; it < 60; it++) {
    const shares = fit(1);
    const model = ids.map((_, k) => shares.reduce((s, row, i) => s + row[k] * base[i].valid2027, 0) / total);
    let worst = 0;
    ids.forEach((_, k) => {
      if (model[k] <= 0 || target[k] <= 0) return;
      const ratio = target[k] / model[k];
      factor[k] *= Math.pow(ratio, 0.7);
      worst = Math.max(worst, Math.abs(ratio - 1));
    });
    if (worst < 1e-4) break;
  }
  const w = clamp(opts.pollWeight, 0, 1);
  const finalShares = fit(w);

  const counties: CountyModel[] = base.map((b, i) => {
    const c = COUNTIES.find((x) => x.code === b.h.code)!;
    return {
      code: b.h.code,
      name: b.h.name,
      bloc: b.h.bloc,
      region: c.region,
      valid: b.valid2027,
      ruto2022: b.h.ruto2022,
      raila2022: b.h.raila2022,
      other2022: b.h.other2022,
      valid2022: b.h.valid2022,
      inherited: Object.fromEntries(ids.map((id, k) => [id, inhShares[i][k] * b.valid2027])),
      votes: Object.fromEntries(ids.map((id, k) => [id, finalShares[i][k] * b.valid2027])),
    };
  });
  const share = Object.fromEntries(ids.map((id, k) => [id, finalShares.reduce((s, row, i) => s + row[k] * base[i].valid2027, 0) / total]));
  return { counties, inheritedShare: Object.fromEntries(ids.map((id, k) => [id, natInh[k]])), share, pollShare, valid: total };
}

/* ── coalitions at county level ───────────────────────────────── */

export interface Structure {
  id: string;
  name: string;
  blurb: string;
  arrangement: Arrangement;
  /** True where the structure is a what-if with no deal on the record. */
  hypothetical?: boolean;
}

export const RUTO_STRUCTURES: Structure[] = [
  { id: "r-kindiki", name: "Ruto & Kindiki", blurb: "The ticket as it stands: the incumbent Deputy President stays on.", arrangement: [{ head: "ruto", deputy: "kindiki", backers: [] }] },
  { id: "r-mudavadi", name: "Ruto & Mudavadi", blurb: "Swaps in Musalia Mudavadi to reach the Luhya vote.", arrangement: [{ head: "ruto", deputy: "mudavadi", backers: [] }] },
  { id: "r-waiguru", name: "Ruto & Waiguru", blurb: "Anne Waiguru, Kirinyaga governor, to hold part of Mt Kenya against Gachagua.", arrangement: [{ head: "ruto", deputy: "waiguru", backers: [] }] },
  { id: "r-joho", name: "Ruto & Joho", blurb: "Hassan Joho brings the Coast and an ODM-leaning profile.", arrangement: [{ head: "ruto", deputy: "joho", backers: [] }] },
  { id: "r-wanga", name: "Ruto & Wanga", blurb: "Gladys Wanga, ODM governor of Homa Bay, to reach Lake Victoria.", arrangement: [{ head: "ruto", deputy: "wanga", backers: [] }] },
  { id: "r-minor", name: "Ruto & Kindiki, minor allies back", blurb: "Muturi and Wajackoyah back the ticket. Small, but it shows how little the minor field moves.", arrangement: [{ head: "ruto", deputy: "kindiki", backers: ["muturi", "wajackoyah"] }] },
  { id: "r-odm", name: "Ruto & Wanga, ODM wing backs", blurb: "What-if: the ODM wing around Sifuna backs Ruto. No such deal is on the record; this is a stress test of an ODM pact.", arrangement: [{ head: "ruto", deputy: "wanga", backers: ["sifuna"] }], hypothetical: true },
];

const backersExcept = (...ids: string[]) => OPPOSITION_FIELD.filter((id) => !ids.includes(id));

export const OPPOSITION_SCENARIOS: Structure[] = [
  { id: "o-split", name: "Opposition fragmented", blurb: "Every opposition candidate runs alone.", arrangement: [] },
  { id: "o-kg", name: "Kalonzo & Gachagua", blurb: "Kalonzo Musyoka heads the ticket, Gachagua is deputy, everyone else backs it.", arrangement: [{ head: "kalonzo", deputy: "gachagua", backers: backersExcept("kalonzo", "gachagua") }] },
  { id: "o-gk", name: "Gachagua & Kalonzo", blurb: "Gachagua heads the ticket, Kalonzo is deputy, everyone else backs it.", arrangement: [{ head: "gachagua", deputy: "kalonzo", backers: backersExcept("kalonzo", "gachagua") }] },
  { id: "o-sg", name: "Sifuna & Gachagua", blurb: "Edwin Sifuna heads the ticket, Gachagua is deputy, everyone else backs it.", arrangement: [{ head: "sifuna", deputy: "gachagua", backers: backersExcept("sifuna", "gachagua") }] },
  { id: "o-sk", name: "Sifuna & Kalonzo", blurb: "Edwin Sifuna heads the ticket, Kalonzo is deputy, everyone else backs it.", arrangement: [{ head: "sifuna", deputy: "kalonzo", backers: backersExcept("sifuna", "kalonzo") }] },
  { id: "o-mg", name: "Matiang’i & Gachagua", blurb: "Fred Matiang’i heads the ticket, Gachagua is deputy, everyone else backs it.", arrangement: [{ head: "matiangi", deputy: "gachagua", backers: backersExcept("matiangi", "gachagua") }] },
  {
    id: "o-two",
    name: "Two opposition tickets",
    blurb: "The pledge to field one candidate fails: Kalonzo & Gachagua run against Sifuna & Matiang’i.",
    arrangement: [
      { head: "kalonzo", deputy: "gachagua", backers: ["wamalwa", "muturi"] },
      { head: "sifuna", deputy: "matiangi", backers: ["karua", "omtatah", "mwangi", "maraga"] },
    ],
  },
];

export interface TicketTally {
  key: string;
  label: string;
  head: string;
  members: string[];
  votes: number;
  share: number;
  /** Counties where the ticket has at least 25% of the votes. */
  floor: number;
  /** Counties where the ticket has the most votes. */
  won: number;
}

export interface ScenarioResult {
  tickets: TicketTally[];
  /** Total valid votes. */
  valid: number;
  /** Article 138(4) test on the first round. */
  firstRoundWinner: string | null;
  runoff: null | { a: TicketTally; b: TicketTally; aVotes: number; bVotes: number; aShare: number; winner: string; aWon: number; bWon: number };
  winner: string;
  /** Votes by bloc for each ticket: bloc to key to votes. */
  byBloc: Record<string, Record<string, number>>;
  /** Per county: the leading ticket's key and its share. */
  leaders: { code: string; key: string; share: number }[];
}

export function runScenario(cands: SimCandidate[], model: CountyModel[], arrangement: Arrangement, transfer: number = TRANSFER_DEFAULT): ScenarioResult {
  const tickets = buildTickets(cands, arrangement, transfer);
  const keys = tickets.map((t) => t.key);
  const T = tickets.length;
  const totals = Array(T).fill(0);
  const floor = Array(T).fill(0);
  const won = Array(T).fill(0);
  const countyVotes: number[][] = [];
  const byBloc: Record<string, Record<string, number>> = {};
  const leaders: ScenarioResult["leaders"] = [];

  for (const c of model) {
    const v = tickets.map((t) => {
      const head = c.votes[t.head] ?? 0;
      const partners = t.members.filter((m) => m !== t.head).reduce((s, m) => s + (c.votes[m] ?? 0), 0);
      return head + partners * transfer;
    });
    const lost = tickets.reduce((s, t) => s + t.members.filter((m) => m !== t.head).reduce((a, m) => a + (c.votes[m] ?? 0), 0) * (1 - transfer), 0);
    // Running mates who are not candidates themselves pull voters from the other tickets in their home bloc.
    tickets.forEach((t, b) => {
      const mate = t.deputy ? RUNNING_MATE_PULL[t.deputy] : undefined;
      const p = mate?.pull[c.bloc] ?? 0;
      if (!p) return;
      const others = v.reduce((s, x, k) => (k === b ? s : s + x), 0);
      const take = others * p;
      v.forEach((x, k) => {
        if (k !== b) v[k] = x - (x / (others || 1)) * take;
      });
      v[b] += take;
    });
    // Votes that do not transfer go back to every ticket in proportion, inside the same county.
    const sum = v.reduce((a, b) => a + b, 0) || 1;
    const final = v.map((x) => x + lost * (x / sum));
    const tot = final.reduce((a, b) => a + b, 0) || 1;
    // Rescale so the county keeps its valid votes (lost votes were redistributed, not removed).
    const k = c.valid / tot;
    const adj = final.map((x) => x * k);
    countyVotes.push(adj);
    let lead = 0;
    adj.forEach((x, b) => {
      totals[b] += x;
      if (x / c.valid >= COUNTY_FLOOR) floor[b] += 1;
      if (x > adj[lead]) lead = b;
      (byBloc[c.bloc] ??= {})[keys[b]] = (byBloc[c.bloc][keys[b]] ?? 0) + x;
    });
    won[lead] += 1;
    leaders.push({ code: c.code, key: keys[lead], share: adj[lead] / c.valid });
  }

  const valid = totals.reduce((a, b) => a + b, 0);
  const tally: TicketTally[] = tickets.map((t, b) => ({ key: t.key, label: t.label, head: t.head, members: t.members, votes: totals[b], share: totals[b] / valid, floor: floor[b], won: won[b] }));
  tally.sort((a, b) => b.votes - a.votes);

  const first = tally.find((t) => t.share > FIRST_ROUND_SHARE && t.floor >= FIRST_ROUND_COUNTIES) ?? null;
  let runoff: ScenarioResult["runoff"] = null;
  let winner = first?.label ?? "";
  if (!first) {
    const [a, b] = tally;
    const ai = keys.indexOf(a.key), bi = keys.indexOf(b.key);
    const rutoInA = a.members.includes("ruto");
    const rutoInB = b.members.includes("ruto");
    let aV = 0, bV = 0, aWon = 0, bWon = 0;
    model.forEach((c, ci) => {
      const row = countyVotes[ci];
      let av = row[ai], bv = row[bi];
      tickets.forEach((t, k) => {
        if (k === ai || k === bi) return;
        const lean = RUNOFF_LEAN_TO_RUTO[t.head] ?? DEFAULT_LEAN;
        // The share who go to Ruto's ticket; with no Ruto ticket in the runoff, the vote splits evenly.
        if (rutoInA) { av += row[k] * lean; bv += row[k] * (1 - lean); }
        else if (rutoInB) { bv += row[k] * lean; av += row[k] * (1 - lean); }
        else { av += row[k] / 2; bv += row[k] / 2; }
      });
      aV += av; bV += bv;
      if (av >= bv) aWon += 1; else bWon += 1;
    });
    const aShare = aV / (aV + bV);
    runoff = { a, b, aVotes: aV, bVotes: bV, aShare, winner: aV >= bV ? a.label : b.label, aWon, bWon };
    winner = runoff.winner;
  }
  return { tickets: tally, valid, firstRoundWinner: first?.label ?? null, runoff, winner, byBloc, leaders };
}

/** Ruto's ticket in a result, if one is there. */
export const rutoTicket = (r: ScenarioResult): TicketTally | undefined => r.tickets.find((t) => t.members.includes("ruto"));
/** The leading ticket without Ruto in it. */
export const topOpposition = (r: ScenarioResult): TicketTally | undefined => r.tickets.find((t) => !t.members.includes("ruto"));

/** One-line outcome for the matrix: who wins, and how. */
export function outcomeLine(r: ScenarioResult): { text: string; rutoWins: boolean } {
  const ruto = rutoTicket(r);
  if (r.firstRoundWinner) return { text: `${r.firstRoundWinner} wins in round one`, rutoWins: !!ruto && r.firstRoundWinner === ruto.label };
  const ro = r.runoff!;
  const rutoIsA = ro.a.members.includes("ruto");
  const rutoIsB = ro.b.members.includes("ruto");
  if (!rutoIsA && !rutoIsB) return { text: `Runoff without Ruto: ${ro.winner}`, rutoWins: false };
  const rShare = rutoIsA ? ro.aShare : 1 - ro.aShare;
  const rutoWins = rShare >= 0.5;
  return { text: `Runoff: Ruto ${(rShare * 100).toFixed(1)}%, ${rutoWins ? "wins" : "loses"}`, rutoWins };
}

/** Whether a scenario's tickets overlap: an opposition structure whose head or deputy is already in Ruto's alliance cannot be run. */
export function structuresClash(a: Structure, b: Structure): boolean {
  const used = new Set(a.arrangement.flatMap((s) => [s.head, s.deputy, ...s.backers].filter(Boolean) as string[]));
  return b.arrangement.some((s) => used.has(s.head) || (s.deputy ? used.has(s.deputy) : false));
}
