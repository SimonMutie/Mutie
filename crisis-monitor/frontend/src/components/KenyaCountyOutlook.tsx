import { useMemo, useState } from "react";
import { COUNTIES } from "../data/kenyaElection";
import { BLOC_LABEL } from "../data/kenyaCountyHistory";
import type { Live } from "../data/electionLive";
import { candidatesFrom, TRANSFER_DEFAULT } from "../lib/kenyaSim";
import {
  OPPOSITION_SCENARIOS,
  RUNNING_MATE_PULL,
  RUTO_STRUCTURES,
  buildCountyModel,
  outcomeLine,
  rutoTicket,
  runScenario,
  structuresClash,
  topOpposition,
  turnoutRows,
  turnoutTotals,
  type ScenarioResult,
  type Structure,
  type TurnoutCase,
} from "../lib/kenyaCounty";

/**
 * County turnout history, 2022 votes by candidate, and coalition scenarios for Ruto and the opposition.
 * The model is in lib/kenyaCounty.ts and the county data in data/kenyaCountyHistory.ts. Turnout history and the 2022
 * results are IEBC figures; everything that looks forward is Afrilens analysis and is labelled as such.
 */

const n0 = (n: number) => Math.round(n).toLocaleString("en-GB");
const p1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const mil = (n: number) => `${(n / 1e6).toFixed(2)}M`;
const todayIso = () => new Date().toISOString().slice(0, 10);

const SHOWN = [
  { id: "ruto", label: "Ruto" },
  { id: "gachagua", label: "Gachagua" },
  { id: "kalonzo", label: "Kalonzo" },
  { id: "matiangi", label: "Matiang’i" },
  { id: "sifuna", label: "Sifuna" },
] as const;

type Tab = "turnout" | "votes" | "check" | "ruto" | "opposition" | "matrix";
const TABS: { id: Tab; label: string }[] = [
  { id: "turnout", label: "Turnout history" },
  { id: "votes", label: "Votes by candidate" },
  { id: "check", label: "Ethnic and poll check" },
  { id: "ruto", label: "Ruto coalitions" },
  { id: "opposition", label: "Opposition coalitions" },
  { id: "matrix", label: "All combinations" },
];

const CASES: { id: TurnoutCase; label: string; note: string }[] = [
  { id: "low", label: "Low", note: "The 2017 to 2022 slide in turnout carries on in full." },
  { id: "central", label: "Central", note: "A quarter of that slide carries on." },
  { id: "high", label: "High", note: "Turnout recovers half the way back to 2017." },
];

export default function KenyaCountyOutlook({ live }: { live: Live }) {
  const asOf = todayIso();
  const cands = useMemo(() => candidatesFrom(live.sim.seeds, live.polls, asOf), [live.sim.seeds, live.polls, asOf]);
  const [tab, setTab] = useState<Tab>("turnout");
  const [tcase, setTcase] = useState<TurnoutCase>("central");
  const [pollWeight, setPollWeight] = useState(0.5);
  const [transfer, setTransfer] = useState(TRANSFER_DEFAULT);
  const [rutoId, setRutoId] = useState(RUTO_STRUCTURES[0].id);
  const [oppId, setOppId] = useState(OPPOSITION_SCENARIOS[1].id);
  const [unit, setUnit] = useState<"votes" | "share">("votes");
  const [region, setRegion] = useState("all");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "name", dir: 1 });

  const rows = useMemo(() => turnoutRows(), []);
  const totals = useMemo(() => turnoutTotals(rows, tcase), [rows, tcase]);
  const lowTot = useMemo(() => turnoutTotals(rows, "low"), [rows]);
  const highTot = useMemo(() => turnoutTotals(rows, "high"), [rows]);
  const model = useMemo(() => buildCountyModel(cands, { turnout: tcase, pollWeight }), [cands, tcase, pollWeight]);
  const ruto = RUTO_STRUCTURES.find((s) => s.id === rutoId)!;
  const opp = OPPOSITION_SCENARIOS.find((s) => s.id === oppId)!;
  const run = (r: Structure, o: Structure): ScenarioResult | null => (structuresClash(r, o) ? null : runScenario(cands, model.counties, [...r.arrangement, ...o.arrangement], transfer));
  const selected = useMemo(() => run(ruto, opp), [ruto, opp, cands, model, transfer]); // eslint-disable-line react-hooks/exhaustive-deps
  const matrix = useMemo(
    () => (tab === "matrix" ? RUTO_STRUCTURES.map((r) => OPPOSITION_SCENARIOS.map((o) => run(r, o))) : []),
    [tab, cands, model, transfer], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const name = (id: string) => cands.find((c) => c.id === id)?.short ?? id;

  const regions = useMemo(() => [...new Set(COUNTIES.map((c) => c.region))].sort(), []);
  const sortBy = (key: string) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "name" ? 1 : -1 }));
  const th = (key: string, label: string, title?: string) => (
    <th key={key} title={title} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="co-th" onClick={() => sortBy(key)}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
  const sorted = <T,>(list: T[], get: (x: T, key: string) => number | string) =>
    [...list].sort((a, b) => {
      const x = get(a, sort.key), y = get(b, sort.key);
      return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * sort.dir;
    });

  /* ── tab bodies ── */

  const turnoutBody = () => {
    const list = sorted(rows.filter((r) => region === "all" || r.region === region), (r, k) => {
      const m: Record<string, number | string> = {
        name: r.name, bloc: BLOC_LABEL[r.bloc], reg22: r.reg2022, reg27: r.reg2027, t13: r.t2013, t17: r.t2017, t22: r.t2022, t27: r.t2027[tcase],
        c13: r.cast2013, c17: r.cast2017, c22: r.cast2022, c27: r.cast2027[tcase],
      };
      return m[k] ?? 0;
    });
    return (
      <>
        <div className="co-callouts">
          <div><strong>{p1(totals.t2013)} → {p1(totals.t2017)} → {p1(totals.t2022)}</strong><span>national turnout in 2013, 2017 and 2022. Votes cast: {mil(totals.cast2013)}, {mil(totals.cast2017)}, {mil(totals.cast2022)}.</span></div>
          <div><strong>{p1(totals.t2027)} in 2027</strong><span>{CASES.find((c) => c.id === tcase)!.label.toLowerCase()} case: about {mil(totals.cast2027)} votes on {mil(totals.reg2027)} registered. Range {p1(lowTot.t2027)} to {p1(highTot.t2027)}, or {mil(lowTot.cast2027)} to {mil(highTot.cast2027)} votes.</span></div>
          <div><strong>{mil(totals.reg2027 - totals.reg2022)} more voters</strong><span>on the 2027 register than in 2022, where the 2026 registration drive has been published by county (26 of 47). The other 21 counties are held at their 2022 register, so the 2027 register here is a floor.</span></div>
        </div>
        <div className="co-filter">
          <label>Region <select value={region} onChange={(e) => setRegion(e.target.value)}><option value="all">All 47 counties</option>{regions.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          <span className="sim-muted">Click a heading to sort. Hover a 2027 turnout figure for its low and high case.</span>
        </div>
        <div className="sim-table-wrap">
          <table className="sim-table co-table">
            <thead>
              <tr className="co-group"><th /><th /><th colSpan={2}>Registered</th><th colSpan={4}>Turnout, % of registered</th><th colSpan={4}>Votes cast</th></tr>
              <tr>
                {th("name", "County")}
                {th("bloc", "Community")}
                {th("reg22", "2022")}{th("reg27", "2027 est.")}
                {th("t13", "2013")}{th("t17", "2017")}{th("t22", "2022")}{th("t27", "2027 est.")}
                {th("c13", "2013")}{th("c17", "2017")}{th("c22", "2022")}{th("c27", "2027 est.")}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.code}>
                  <th scope="row">{r.name}</th>
                  <td className="co-small">{BLOC_LABEL[r.bloc].split(" (")[0]}</td>
                  <td>{n0(r.reg2022)}</td><td>{n0(r.reg2027)}</td>
                  <td>{p1(r.t2013)}</td><td>{p1(r.t2017)}</td><td>{p1(r.t2022)}</td>
                  <td title={`Low ${p1(r.t2027.low)} · High ${p1(r.t2027.high)}`}><strong>{p1(r.t2027[tcase])}</strong></td>
                  <td>{n0(r.cast2013)}</td><td>{n0(r.cast2017)}</td><td>{n0(r.cast2022)}</td>
                  <td title={`Low ${n0(r.cast2027.low)} · High ${n0(r.cast2027.high)}`}><strong>{n0(r.cast2027[tcase])}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>Kenya</th>
                <td>{n0(totals.reg2022)}</td><td>{n0(totals.reg2027)}</td>
                <td>{p1(totals.t2013)}</td><td>{p1(totals.t2017)}</td><td>{p1(totals.t2022)}</td><td><strong>{p1(totals.t2027)}</strong></td>
                <td>{n0(totals.cast2013)}</td><td>{n0(totals.cast2017)}</td><td>{n0(totals.cast2022)}</td><td><strong>{n0(totals.cast2027)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </>
    );
  };

  const votesBody = () => {
    const list = sorted(model.counties.filter((c) => region === "all" || c.region === region), (c, k) => {
      const share = (id: string) => c.votes[id] / c.valid;
      if (k === "name") return c.name;
      if (k === "ruto22") return c.ruto2022 / c.valid2022;
      if (k === "raila22") return c.raila2022 / c.valid2022;
      if (k === "valid") return c.valid;
      if (k === "lead") return Math.max(...Object.keys(c.votes).map(share));
      return unit === "votes" ? c.votes[k] ?? 0 : share(k);
    });
    const leader = (c: (typeof list)[number]) => {
      const [id, v] = Object.entries(c.votes).sort((a, b) => b[1] - a[1])[0];
      return { id, share: v / c.valid };
    };
    const cell = (c: (typeof list)[number], id: string) => (unit === "votes" ? n0(c.votes[id] ?? 0) : p1((c.votes[id] ?? 0) / c.valid));
    const nat = (id: string) => model.share[id] ?? 0;
    const others = (c: (typeof list)[number]) => c.valid - SHOWN.reduce((s, x) => s + (c.votes[x.id] ?? 0), 0);
    const natOthers = 1 - SHOWN.reduce((s, x) => s + nat(x.id), 0);
    const validTotal = model.valid;
    const sum22 = (k: "ruto2022" | "raila2022" | "valid2022") => model.counties.reduce((s, c) => s + c[k], 0);
    return (
      <>
        <p className="co-note">
          <strong>Afrilens analysis.</strong> Each county’s 2022 Ruto and Odinga vote is handed to the 2027 candidates by community, then pulled toward the poll average by the weight you set. The 2022 columns are IEBC’s declared results; the 2027 columns are projections at the {CASES.find((c) => c.id === tcase)!.label.toLowerCase()} turnout case ({p1(totals.t2027)}).
        </p>
        <div className="co-filter">
          <label>Region <select value={region} onChange={(e) => setRegion(e.target.value)}><option value="all">All 47 counties</option>{regions.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          <div className="co-seg" role="group" aria-label="Units">
            <button type="button" aria-pressed={unit === "votes"} onClick={() => setUnit("votes")}>Votes</button>
            <button type="button" aria-pressed={unit === "share"} onClick={() => setUnit("share")}>Share of county</button>
          </div>
        </div>
        <div className="sim-table-wrap">
          <table className="sim-table co-table">
            <thead>
              <tr className="co-group"><th /><th colSpan={3}>2022 result (IEBC)</th><th colSpan={SHOWN.length + 2}>2027 potential, {unit === "votes" ? "votes" : "% of county"}</th><th /></tr>
              <tr>
                {th("name", "County")}
                {th("ruto22", "Ruto")}{th("raila22", "Odinga")}
                <th>Valid votes</th>
                {th("valid", "2027 valid")}
                {SHOWN.map((s) => th(s.id, s.label))}
                <th>Others</th>
                {th("lead", "Leads")}
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const l = leader(c);
                return (
                  <tr key={c.code}>
                    <th scope="row">{c.name}</th>
                    <td>{p1(c.ruto2022 / c.valid2022)}</td><td>{p1(c.raila2022 / c.valid2022)}</td><td>{n0(c.valid2022)}</td>
                    <td>{n0(c.valid)}</td>
                    {SHOWN.map((s) => <td key={s.id} className={l.id === s.id ? "co-lead" : undefined}>{cell(c, s.id)}</td>)}
                    <td>{unit === "votes" ? n0(others(c)) : p1(others(c) / c.valid)}</td>
                    <td className="co-small">{name(l.id)} {p1(l.share)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Kenya</th>
                <td>{p1(sum22("ruto2022") / sum22("valid2022"))}</td><td>{p1(sum22("raila2022") / sum22("valid2022"))}</td><td>{n0(sum22("valid2022"))}</td>
                <td>{n0(validTotal)}</td>
                {SHOWN.map((s) => <td key={s.id}>{unit === "votes" ? n0(nat(s.id) * validTotal) : p1(nat(s.id))}</td>)}
                <td>{unit === "votes" ? n0(natOthers * validTotal) : p1(natOthers)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </>
    );
  };

  const checkBody = () => {
    const ids = Object.keys(model.share);
    const blocs = [...new Set(model.counties.map((c) => c.bloc))];
    const gaps = ids.map((id) => ({ id, gap: (model.inheritedShare[id] - model.pollShare[id]) * 100 })).filter((g) => Math.abs(g.gap) >= 3).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    const gapNote = gaps.length
      ? `Where the polls and the 2022 map disagree by three points or more: ${gaps.map((g) => `${name(g.id)} (the 2022 map gives ${Math.abs(g.gap).toFixed(1)} points ${g.gap > 0 ? "more" : "less"} than the polls)`).join("; ")}.`
      : "The polls and the 2022 map agree to within three points for every candidate.";
    const blocRows = blocs
      .map((b) => {
        const cs = model.counties.filter((c) => c.bloc === b);
        const valid = cs.reduce((s, c) => s + c.valid, 0);
        const valid22 = cs.reduce((s, c) => s + c.valid2022, 0);
        const votes = (id: string) => cs.reduce((s, c) => s + (c.votes[id] ?? 0), 0);
        const best = ids.filter((id) => id !== "ruto").sort((a, c) => votes(c) - votes(a))[0];
        return {
          b, n: cs.length, valid,
          ruto22: cs.reduce((s, c) => s + c.ruto2022, 0) / valid22,
          raila22: cs.reduce((s, c) => s + c.raila2022, 0) / valid22,
          ruto27: votes("ruto") / valid,
          best, best27: votes(best) / valid,
        };
      })
      .sort((a, b) => b.valid - a.valid);
    return (
      <>
        <h4 className="co-h">Opinion-poll check</h4>
        <p className="sim-muted">The 2022 inheritance model is compared with the poll average (graded and recency-weighted, undecided removed). At a poll weight of {Math.round(pollWeight * 100)}%, the shares used are pulled that far toward the polls.</p>
        <div className="sim-table-wrap">
          <table className="sim-table co-table">
            <thead><tr><th>Candidate</th><th>Poll average</th><th>From 2022 results</th><th>Gap (pts)</th><th>Used here</th></tr></thead>
            <tbody>
              {[...ids].sort((a, b) => (model.pollShare[b] ?? 0) - (model.pollShare[a] ?? 0)).map((id) => {
                const gap = (model.inheritedShare[id] - model.pollShare[id]) * 100;
                return (
                  <tr key={id}>
                    <th scope="row">{name(id)}</th>
                    <td>{p1(model.pollShare[id])}</td><td>{p1(model.inheritedShare[id])}</td>
                    <td className={Math.abs(gap) >= 3 ? "co-lead" : undefined}>{gap >= 0 ? "+" : ""}{gap.toFixed(1)}</td>
                    <td><strong>{p1(model.share[id])}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="sim-muted">{gapNote}</p>

        <h4 className="co-h">Ethnic formations</h4>
        <p className="sim-muted">Counties are grouped by their dominant community (an Afrilens classification; many counties are mixed). The 2022 columns are what each community’s counties actually delivered; the 2027 columns are the model.</p>
        <div className="sim-table-wrap">
          <table className="sim-table co-table">
            <thead><tr><th>Community</th><th>Counties</th><th>2027 valid votes</th><th>Ruto 2022</th><th>Odinga 2022</th><th>Ruto 2027</th><th>Strongest opposition 2027</th></tr></thead>
            <tbody>
              {blocRows.map((r) => (
                <tr key={r.b}>
                  <th scope="row">{BLOC_LABEL[r.b]}</th>
                  <td>{r.n}</td><td>{n0(r.valid)}</td>
                  <td>{p1(r.ruto22)}</td><td>{p1(r.raila22)}</td>
                  <td><strong>{p1(r.ruto27)}</strong></td>
                  <td>{name(r.best)} {p1(r.best27)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const summaryRow = (label: string, blurb: string, r: ScenarioResult | null, onPick: () => void, picked: boolean, hypothetical?: boolean) => {
    if (!r) return <tr key={label}><th scope="row">{label}</th><td colSpan={7} className="sim-muted">Not possible: a member of this opposition ticket is already in Ruto’s alliance.</td></tr>;
    const ru = rutoTicket(r), op = topOpposition(r);
    const out = outcomeLine(r);
    return (
      <tr key={label} className={picked ? "co-picked" : undefined}>
        <th scope="row">
          <button type="button" className="co-pick" onClick={onPick} title={blurb} aria-pressed={picked}>{label}{hypothetical ? " (what-if)" : ""}</button>
        </th>
        <td>{ru ? n0(ru.votes) : "—"}</td>
        <td><strong>{ru ? p1(ru.share) : "—"}</strong></td>
        <td>{op ? `${op.label}` : "—"}</td>
        <td>{op ? n0(op.votes) : "—"}</td>
        <td><strong>{op ? p1(op.share) : "—"}</strong></td>
        <td>{ru && op ? `${ru.votes >= op.votes ? "Ruto +" : "Opposition +"}${n0(Math.abs(ru.votes - op.votes))}` : "—"}</td>
        <td className={out.rutoWins ? undefined : "co-lead"}>{out.text}</td>
      </tr>
    );
  };

  const head = (first: string) => <thead><tr><th>{first}</th><th>Ruto ticket votes</th><th>Share</th><th>Strongest opposition ticket</th><th>Votes</th><th>Share</th><th>Lead, round one</th><th>Result</th></tr></thead>;

  const detail = () => {
    if (!selected) return <p className="sim-muted">This combination is not possible: Sifuna is already in Ruto’s alliance.</p>;
    const ru = rutoTicket(selected), op = topOpposition(selected);
    const blocRows = Object.entries(selected.byBloc)
      .map(([b, v]) => ({ b, ru: ru ? v[ru.key] ?? 0 : 0, op: op ? v[op.key] ?? 0 : 0, all: Object.values(v).reduce((a, c) => a + c, 0) }))
      .sort((a, b) => b.all - a.all);
    const ro = selected.runoff;
    return (
      <div className="co-detail">
        <h4 className="co-h">{ruto.name} against {opp.name}</h4>
        <p className="sim-muted">{ruto.blurb} {opp.blurb}</p>
        <div className="sim-table-wrap">
          <table className="sim-table co-table">
            <thead><tr><th>Ticket</th><th>Votes</th><th>Share</th><th>Counties with 25% or more</th><th>Counties led</th></tr></thead>
            <tbody>
              {selected.tickets.slice(0, 6).map((t) => (
                <tr key={t.key}>
                  <th scope="row">{t.label}</th><td>{n0(t.votes)}</td><td><strong>{p1(t.share)}</strong></td><td>{t.floor} of 47</td><td>{t.won}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="co-note">
          {selected.firstRoundWinner
            ? `${selected.firstRoundWinner} clears 50% of valid votes and 25% in at least 24 counties, so there is no runoff (Article 138(4)).`
            : ro && `No ticket clears both tests, so the top two go to a runoff. With knocked-out candidates’ voters split by Afrilens runoff leanings, ${ro.a.label} gets ${n0(ro.aVotes)} (${p1(ro.aShare)}) against ${ro.b.label} on ${n0(ro.bVotes)} (${p1(1 - ro.aShare)}), and wins ${ro.aWon} counties to ${ro.bWon}. ${ro.winner} wins.`}
        </p>
        <h4 className="co-h">Where the two lead tickets win and lose, by community</h4>
        <div className="sim-table-wrap">
          <table className="sim-table co-table">
            <thead><tr><th>Community</th><th>{ru?.label ?? "Ruto"}</th><th>{op?.label ?? "Opposition"}</th><th>Margin</th></tr></thead>
            <tbody>
              {blocRows.map((r) => (
                <tr key={r.b}>
                  <th scope="row">{BLOC_LABEL[r.b]}</th><td>{n0(r.ru)}</td><td>{n0(r.op)}</td>
                  <td className={r.ru >= r.op ? undefined : "co-lead"}>{r.ru >= r.op ? "Ruto +" : "Opposition +"}{n0(Math.abs(r.ru - r.op))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const rutoBody = () => (
    <>
      <p className="co-note"><strong>Afrilens analysis.</strong> Each row changes only Ruto’s ticket (running mate and backers); the opposition is held at <strong>{opp.name}</strong>. Pick the opposition scenario to test below. <strong>Read with care:</strong> a united opposition ticket only beats Ruto in round one if most of every rival’s voters follow the backer to it. Lower the transfer slider to 70% and see how the result changes; the answer depends on that assumption more than on any running mate. A running mate who is not a candidate pulls a share of other tickets’ votes in his or her home community: {Object.entries(RUNNING_MATE_PULL).map(([id, m]) => `${name(id)} (${m.why})`).join("; ")}.</p>
      <div className="co-pickers"><label>Opposition <select value={oppId} onChange={(e) => setOppId(e.target.value)}>{OPPOSITION_SCENARIOS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label></div>
      <div className="sim-table-wrap">
        <table className="sim-table co-table">
          {head("Ruto’s ticket")}
          <tbody>{RUTO_STRUCTURES.map((r) => summaryRow(r.name, r.blurb, run(r, opp), () => setRutoId(r.id), r.id === rutoId, r.hypothetical))}</tbody>
        </table>
      </div>
      {detail()}
    </>
  );

  const oppBody = () => (
    <>
      <p className="co-note"><strong>Afrilens analysis.</strong> Each row changes only the opposition; Ruto runs as <strong>{ruto.name}</strong>. Pick Ruto’s ticket to test below. The opposition leaders have pledged to field one candidate against Ruto but have not said who, or how that is decided (Citizen Digital, 30 October 2026), so each pairing is tested, as is the failure of the pledge. <strong>Read with care:</strong> a united opposition ticket only beats Ruto in round one if most of every rival’s voters follow the backer to it. Lower the transfer slider to 70% and see how the result changes; the answer depends on that assumption more than on any running mate.</p>
      <div className="co-pickers"><label>Ruto’s ticket <select value={rutoId} onChange={(e) => setRutoId(e.target.value)}>{RUTO_STRUCTURES.map((r) => <option key={r.id} value={r.id}>{r.name}{r.hypothetical ? " (what-if)" : ""}</option>)}</select></label></div>
      <div className="sim-table-wrap">
        <table className="sim-table co-table">
          {head("Opposition scenario")}
          <tbody>{OPPOSITION_SCENARIOS.map((o) => summaryRow(o.name, o.blurb, run(ruto, o), () => setOppId(o.id), o.id === oppId))}</tbody>
        </table>
      </div>
      {detail()}
    </>
  );

  const matrixBody = () => (
    <>
      <p className="co-note"><strong>Afrilens analysis.</strong> Ruto’s share of valid votes for every pairing, and who wins. Click a cell to open it in the coalition tabs. “R2” means a runoff.</p>
      <div className="sim-table-wrap">
        <table className="sim-table co-table co-matrix">
          <thead><tr><th>Ruto’s ticket ↓ / Opposition →</th>{OPPOSITION_SCENARIOS.map((o) => <th key={o.id}>{o.name}</th>)}</tr></thead>
          <tbody>
            {RUTO_STRUCTURES.map((r, i) => (
              <tr key={r.id}>
                <th scope="row">{r.name}{r.hypothetical ? " (what-if)" : ""}</th>
                {OPPOSITION_SCENARIOS.map((o, j) => {
                  const res = matrix[i]?.[j];
                  if (!res) return <td key={o.id} className="sim-muted">n/a</td>;
                  const ru = rutoTicket(res)!, out = outcomeLine(res);
                  return (
                    <td key={o.id} className={out.rutoWins ? "co-win" : "co-loss"}>
                      <button type="button" className="co-cell" onClick={() => { setRutoId(r.id); setOppId(o.id); setTab("ruto"); }}>
                        <strong>{p1(ru.share)}</strong>
                        <span>{res.firstRoundWinner ? (out.rutoWins ? "Ruto, round one" : "Opposition, round one") : `${out.rutoWins ? "Ruto" : "Opposition"} wins R2`}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <div className="co-wrap">
      <div className="co-controls">
        <div>
          <span className="co-label">2027 turnout</span>
          <div className="co-seg" role="group" aria-label="Turnout case">
            {CASES.map((c) => <button key={c.id} type="button" title={c.note} aria-pressed={tcase === c.id} onClick={() => setTcase(c.id)}>{c.label}</button>)}
          </div>
        </div>
        <label>
          <span className="co-label">Weight on polls vs 2022 results: {Math.round(pollWeight * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={pollWeight} onChange={(e) => setPollWeight(Number(e.target.value))} />
        </label>
        <label>
          <span className="co-label">Votes that follow a backer to the ticket: {Math.round(transfer * 100)}%</span>
          <input type="range" min={0.5} max={1} step={0.05} value={transfer} onChange={(e) => setTransfer(Number(e.target.value))} />
        </label>
      </div>
      <div className="co-tabs" role="tablist">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === "turnout" && turnoutBody()}
      {tab === "votes" && votesBody()}
      {tab === "check" && checkBody()}
      {tab === "ruto" && rutoBody()}
      {tab === "opposition" && oppBody()}
      {tab === "matrix" && matrixBody()}
      <details className="co-method">
        <summary>Method, sources and limits</summary>
        <ul>
          <li><strong>Turnout and 2022 results</strong> are IEBC figures: the Form 34C county declaration (2022), the August 2017 county results and the 2013 county register and votes cast. The 2022 county sum is within 0.05% of the declared national totals. The 2017 sum is within 0.8% of the declared totals, so 2017 is used for turnout and trend, not for fine margins. The 2013 candidate split by county was not available, so 2013 shows turnout only.</li>
          <li><strong>2027 turnout</strong> is extrapolated from the 2017 to 2022 change in each county: the low case carries the slide on in full, the central case a quarter of it, and the high case recovers half the way back to 2017. The 2027 register is the 2022 register plus the 2026 drive in the 26 counties where it has been published.</li>
          <li><strong>Inheritance rates</strong> (what share of a county’s 2022 Ruto and Odinga voters go to each 2027 candidate) are Afrilens judgements by community, based on the 2024 split between Ruto and Gachagua, Raila Odinga’s death in October 2025 and the 2026 realignments. They are inputs, not measurements. Move the poll weight to see how much they matter.</li>
          <li><strong>Polls</strong> are the graded, recency-weighted average used by the simulator. In 2022 three of four final polls had Odinga ahead and he lost, so polls are a cross-check here, not the answer.</li>
          <li><strong>Coalitions</strong>: a ticket gets its head’s votes plus a backer’s votes at the transfer rate you set; votes that do not move go back to every ticket in that county in proportion. Running-mate pulls and runoff leanings are Afrilens judgements. At the default transfer rate, a single united opposition ticket collects most of the opposition vote; lower the slider to see how fast that lead erodes.</li>
          <li>These are scenarios for comparison, not forecasts. The simulator above gives probabilities; this panel shows where the votes would come from.</li>
        </ul>
      </details>
    </div>
  );
}
