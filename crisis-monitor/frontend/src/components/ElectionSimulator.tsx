import { useDeferredValue, useMemo, useState } from "react";
import { slug, type Live } from "../data/electionLive";
import { COUNTIES } from "../data/kenyaElection";
import {
  candidatesFrom,
  groupsFromRealignments,
  REGIONS,
  SCENARIOS,
  simulate,
  TRANSFER_DEFAULT,
  TURNOUT_DEFAULT,
  type Groups,
  type SimResult,
} from "../lib/kenyaSim";
import { watchApi } from "../api";
import { useCountUp } from "../lib/motion";
import { VBars } from "./charts";

/**
 * 2027 presidential simulator. The model is in lib/kenyaSim.ts; this file is the
 * page. Everything here is recomputed whenever the live content changes: a new poll,
 * a realignment, or an edited stronghold or mobilisation input updates every number.
 */

const TICKET_KEYS = ["A", "B", "C"] as const;
const TOTAL_COUNTIES = COUNTIES.length;
const todayIso = () => new Date().toISOString().slice(0, 10);
const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
const DRAWS = 500;

/** A short name for a ticket: the leader's surname for a coalition, the candidate's name otherwise. */
function shortName(t: { label: string; members: string[] }, cands: { id: string; short: string }[]) {
  if (t.members.length < 2) return t.label;
  return `${cands.find((c) => c.id === t.members[0])?.short ?? t.label} ticket`;
}

export default function ElectionSimulator({ live, isAdmin, onChanged }: { live: Live; isAdmin: boolean; onChanged: () => void }) {
  const asOf = todayIso();
  const cands = useMemo(() => candidatesFrom(live.sim.seeds, live.polls, asOf), [live.sim.seeds, live.polls, asOf]);
  const liveGroups = useMemo(() => groupsFromRealignments(live.sim.realignments, asOf), [live.sim.realignments, asOf]);
  const appliedCount = live.sim.realignments.filter((r) => r.date <= asOf).length;

  const [pick, setPick] = useState<string>("live");
  const [custom, setCustom] = useState<Groups>({});
  const [transfer, setTransfer] = useState(TRANSFER_DEFAULT);
  const [turnout, setTurnout] = useState(TURNOUT_DEFAULT);

  const groups: Groups =
    pick === "live" ? liveGroups : pick === "custom" ? custom : SCENARIOS.find((s) => s.id === pick)?.groups ?? {};
  // Sliders update at once; the simulation catches up behind them so dragging stays smooth.
  const dTransfer = useDeferredValue(transfer);
  const dTurnout = useDeferredValue(turnout);
  const result = useMemo(
    () => simulate(cands, { groups, transfer: dTransfer, turnout: dTurnout, draws: DRAWS }),
    [cands, groups, dTransfer, dTurnout],
  );

  const setTicket = (id: string, t: string | null) => {
    setCustom({ ...groups, [id]: t });
    setPick("custom");
  };

  const leader = [...result.tickets].sort((a, b) => b.pLeads - a.pLeads)[0];
  const scenarioName = pick === "live" ? "Live arrangement" : pick === "custom" ? "Custom arrangement" : SCENARIOS.find((s) => s.id === pick)?.name ?? "";
  const scenarioBlurb =
    pick === "live"
      ? `Tickets as recorded in the realignment log to ${asOf}. ${appliedCount === 0 ? "None are recorded yet, so every candidate runs alone." : `${appliedCount} recorded change${appliedCount === 1 ? "" : "s"} applied.`}`
      : pick === "custom"
        ? "Your own ticket arrangement. Change the scenario to return to a preset."
        : SCENARIOS.find((s) => s.id === pick)?.blurb ?? "";

  const firstRound = useCountUp(result.pFirstRound * 100, 700);
  const runoff = useCountUp(result.pRunoff * 100, 700);

  return (
    <div className="sim">
      <div className="sim-caveat" role="note">
        <strong>Inputs are judgements, outcomes are simulated.</strong> Poll shares, realignments and mobilisation are read from the live record. Strongholds, backyards and mobilisation scores are Afrilens estimates from each candidate’s base, not 2022 county results, and should be checked against IEBC’s county figures once they are loaded. The simulation draws {DRAWS.toLocaleString("en-GB")} elections with poll, regional and mobilisation error; it is a range of plausible outcomes, not a forecast.
      </div>

      <div className="sim-headline">
        <div className="sim-stat">
          <p className="sim-stat__label">Won outright in round one</p>
          <p className="sim-stat__value">{firstRound.toFixed(0)}<span>%</span></p>
          <p className="sim-stat__note">Needs over 50% and 25% in 24 of 47 counties (Article 138(4))</p>
        </div>
        <div className="sim-stat">
          <p className="sim-stat__label">Goes to a run-off</p>
          <p className="sim-stat__value">{runoff.toFixed(0)}<span>%</span></p>
          <p className="sim-stat__note">The two strongest tickets meet again within 30 days</p>
        </div>
        <div className="sim-stat">
          <p className="sim-stat__label">Most likely to finish first</p>
          <p className="sim-stat__value sim-stat__value--name">{leader ? shortName(leader, cands) : "—"}</p>
          <p className="sim-stat__note">{leader ? `Top in ${pct(leader.pLeads)} of simulated elections` : ""}</p>
        </div>
      </div>

      <div className="sim-scenarios" role="tablist" aria-label="Scenario">
        <button type="button" role="tab" aria-selected={pick === "live"} className={`sim-chip${pick === "live" ? " is-on" : ""}`} onClick={() => setPick("live")}>
          <span className="sim-live-dot" aria-hidden="true" /> Live arrangement
        </button>
        {SCENARIOS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={pick === s.id} className={`sim-chip${pick === s.id ? " is-on" : ""}`} onClick={() => setPick(s.id)}>
            {s.name}
          </button>
        ))}
        {pick === "custom" && (
          <button type="button" role="tab" aria-selected className="sim-chip is-on">Custom</button>
        )}
      </div>
      <p className="sim-blurb"><strong>{scenarioName}.</strong> {scenarioBlurb}</p>

      <div className="sim-grid">
        <div className="sim-card sim-card--wide">
          <h3>Who runs with whom</h3>
          <p className="sim-muted">A ticket is led by its strongest member. Members bring their votes at the transfer rate below; the rest return to the field in proportion.</p>
          <div className="sim-cands">
            {cands.map((c) => {
              const t = groups[c.id] ?? null;
              return (
                <div key={c.id} className={`sim-cand${t ? " is-joined" : ""}`}>
                  <div className="sim-cand__head">
                    <span className="sim-cand__name">{c.short}</span>
                    <span className="sim-cand__share">{pct(c.share, 1)}</span>
                  </div>
                  <div className="sim-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, c.share * 100 * 2.2)}%` }} /></div>
                  <div className="sim-seg" role="radiogroup" aria-label={`${c.name} ticket`}>
                    {[null, ...TICKET_KEYS].map((k) => (
                      <button key={k ?? "solo"} type="button" role="radio" aria-checked={t === k} className={t === k ? "is-on" : ""} onClick={() => setTicket(c.id, k)}>
                        {k ?? "Alone"}
                      </button>
                    ))}
                  </div>
                  <div className="sim-cand__meta">
                    <span title="Mobilisation: ability to get supporters to the polling station">Mobilisation {Math.round(c.mobilisation * 100)}</span>
                    <span>{c.backyard.length} backyard count{c.backyard.length === 1 ? "y" : "ies"}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="sim-sliders">
            <label>
              <span>Vote transfer to a ticket <strong>{Math.round(transfer * 100)}%</strong></span>
              <input type="range" min={50} max={100} step={1} value={Math.round(transfer * 100)} onChange={(e) => setTransfer(Number(e.target.value) / 100)} />
            </label>
            <label>
              <span>Turnout of registered voters <strong>{(turnout * 100).toFixed(1)}%</strong></span>
              <input type="range" min={50} max={75} step={0.5} value={turnout * 100} onChange={(e) => setTurnout(Number(e.target.value) / 100)} />
            </label>
            <button type="button" className="sim-reset" onClick={() => { setTransfer(TRANSFER_DEFAULT); setTurnout(TURNOUT_DEFAULT); }}>Reset settings</button>
          </div>
        </div>

        <div className="sim-card sim-card--wide">
          <h3>Outcome by ticket</h3>
          <p className="sim-muted">Bar: 10th to 90th percentile of the national share across simulated elections. Dark mark: the central run. Line: the 50% first-round threshold.</p>
          <TicketRows result={result} />
        </div>

        <div className="sim-card">
          <h3>Counties at 25% or more</h3>
          <p className="sim-muted">Round one also needs 24 of the 47 counties. Each ticket’s average count across simulations.</p>
          <FloorRows result={result} cands={cands} />
        </div>

        <div className="sim-card">
          <h3>Leading share, across elections</h3>
          <p className="sim-muted">How often the winning ticket&apos;s share lands in each 2-point band.</p>
          <VBars
            label="Histogram of the leading ticket’s share"
            height={170}
            data={result.leaderHistogram.map((b) => ({ label: `${Math.round(b.from * 100)}`, value: b.count }))}
            fmt={(n) => `${n}`}
          />
        </div>

        <div className="sim-card sim-card--wide">
          <h3>Where the tickets stand, by region</h3>
          <p className="sim-muted">Average share of valid votes per region in the central run. Darker is stronger.</p>
          <RegionGrid result={result} cands={cands} />
        </div>

        <div className="sim-card">
          <h3>What moved</h3>
          <p className="sim-muted">Realignments on the record. Each one changes the ticket arrangement the live scenario uses.</p>
          {live.sim.realignments.length === 0 ? (
            <p className="sim-empty">No realignments recorded yet. Every candidate runs alone until one is.</p>
          ) : (
            <ol className="sim-moves">
              {[...live.sim.realignments].reverse().map((r) => {
                const who = cands.find((c) => c.id === r.candidate)?.short ?? r.candidate;
                return (
                  <li key={r.id}>
                    <time>{new Date(`${r.date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</time>
                    <p><strong>{who}</strong> {r.ticket ? `joins Ticket ${r.ticket}` : "leaves its ticket"}</p>
                    {r.note && <p className="sim-muted">{r.note}</p>}
                    {r.source && <p className="sim-src">{r.source}</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="sim-card sim-card--wide">
          <h3>The inputs behind the numbers</h3>
          <p className="sim-muted">Each candidate’s poll share, mobilisation, backyard and strongholds. Strongholds run from 0 (none) to 2 (base); a backyard county gives the ticket’s leader a 30% bonus there.</p>
          <div className="sim-table-wrap">
            <table className="sim-table">
              <thead>
                <tr><th>Candidate</th><th>Poll share</th><th>Mobilisation</th><th>Backyard counties</th><th>Strongholds</th></tr>
              </thead>
              <tbody>
                {cands.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{pct(c.share, 1)}</td>
                    <td>{Math.round(c.mobilisation * 100)}</td>
                    <td>{c.backyard.length ? c.backyard.map((code) => COUNTIES.find((x) => x.code === code)?.name ?? code).join(", ") : "—"}</td>
                    <td className="sim-strong">
                      {REGIONS.filter((r) => (c.strongholds[r] ?? 0) > 0).map((r) => (
                        <span key={r} className={`sim-tag sim-tag--${c.strongholds[r]}`}>{r} {c.strongholds[r] === 2 ? "base" : "lean"}</span>
                      ))}
                      {REGIONS.every((r) => !(c.strongholds[r] > 0)) && "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {isAdmin && <SimEditor live={live} onChanged={onChanged} asOf={asOf} />}
      </div>
    </div>
  );
}

/* ── outcome rows ─────────────────────────────────────────── */

function TicketRows({ result }: { result: SimResult }) {
  const max = Math.max(0.6, ...result.tickets.map((t) => t.p90 + 0.02));
  const at = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div className="sim-rows">
      {result.tickets.map((t) => (
        <div key={t.key} className="sim-row">
          <div className="sim-row__name">
            <span>{t.label}</span>
            <span className="sim-muted sim-row__sub">{pct(t.pLeads)} top · {pct(t.pOutright)} outright</span>
          </div>
          <div className="sim-range" aria-label={`${t.label}: ${pct(t.central, 1)} central, 10th to 90th percentile ${pct(t.p10, 1)} to ${pct(t.p90, 1)}`}>
            <span className="sim-range__half" style={{ left: at(0.5) }} aria-hidden="true" />
            <span className="sim-range__band" style={{ left: at(t.p10), width: `${((t.p90 - t.p10) / max) * 100}%` }} />
            <span className="sim-range__mark" style={{ left: at(t.central) }} />
          </div>
          <div className="sim-row__val">{pct(t.central, 1)}</div>
        </div>
      ))}
      <div className="sim-scale" aria-hidden="true"><span>0%</span><span style={{ left: at(0.5) }}>50%</span><span style={{ left: at(max) }}>{pct(max)}</span></div>
    </div>
  );
}

function FloorRows({ result, cands }: { result: SimResult; cands: { id: string; short: string }[] }) {
  return (
    <div className="sim-rows">
      {result.tickets.map((t) => (
        <div key={t.key} className="sim-row sim-row--floor">
          <div className="sim-row__name"><span>{shortName(t, cands)}</span></div>
          <div className="sim-floor" aria-label={`${t.countiesAtFloor.toFixed(1)} of ${TOTAL_COUNTIES} counties at 25% or more`}>
            <span style={{ width: `${(t.countiesAtFloor / TOTAL_COUNTIES) * 100}%` }} />
            <i style={{ left: `${(24 / TOTAL_COUNTIES) * 100}%` }} aria-hidden="true" />
          </div>
          <div className="sim-row__val">{t.countiesAtFloor.toFixed(0)}<span className="sim-muted">/{TOTAL_COUNTIES}</span></div>
        </div>
      ))}
    </div>
  );
}

/* ── regional grid ────────────────────────────────────────── */

function RegionGrid({ result, cands }: { result: SimResult; cands: { id: string; short: string }[] }) {
  const top = result.tickets.slice(0, 4);
  return (
    <div className="sim-table-wrap">
      <table className="sim-heat">
        <thead>
          <tr>
            <th>Region</th>
            <th>Votes</th>
            {top.map((t) => <th key={t.key}>{shortName(t, cands)}</th>)}
            {result.tickets.length > 4 && <th>Others</th>}
          </tr>
        </thead>
        <tbody>
          {result.regions.map((r) => {
            const leadIdx = r.shares.indexOf(Math.max(...r.shares));
            return (
              <tr key={r.region}>
                <th scope="row">{r.region}</th>
                <td>{r.votes > 0 ? `${Math.round(r.votes / 1000)}k` : "—"}</td>
                {top.map((t, i) => {
                  const s = r.shares[i] ?? 0;
                  return (
                    <td key={t.key} className={leadIdx === i ? "is-lead" : ""}>
                      <span className="sim-heat__cell" style={{ background: `color-mix(in srgb, var(--signal) ${Math.round(Math.min(1, s / 0.6) * 85)}%, var(--panel))` }}>
                        {pct(s)}
                      </span>
                    </td>
                  );
                })}
                {result.tickets.length > 4 && <td>{pct(r.shares.slice(4).reduce((a, b) => a + b, 0))}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── admin editor ─────────────────────────────────────────── */

function SimEditor({ live, onChanged, asOf }: { live: Live; onChanged: () => void; asOf: string }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState(live.sim.seeds[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seed = live.sim.seeds.find((s) => s.id === who);
  const [rz, setRz] = useState({ date: asOf, candidate: "", ticket: "", note: "", source: "" });

  const save = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch {
      setErr("Could not save. Check the connection and that you are signed in as an admin.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sim-card sim-card--wide sim-editor">
      <div className="sim-editor__head">
        <div>
          <h3>Edit simulator inputs</h3>
          <p className="sim-muted">Saved changes apply to every reader’s page on the next load. Values are judgements until they are checked against county results.</p>
        </div>
        <button type="button" className="sim-reset" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Close editor" : "Open editor"}</button>
      </div>
      {open && (
        <div className="sim-editor__body">
          {err && <p className="sim-error" role="alert">{err}</p>}
          {seed && (
            <CandidateEditor
              key={seed.id}
              seed={seed}
              candidates={live.sim.seeds}
              onPick={setWho}
              busy={busy}
              onSave={(next) =>
                save(async () => {
                  await watchApi("ke").saveContent("candidate-input", seed.id, { mobilisation: next.mobilisation, backyard: next.backyard });
                  for (const r of REGIONS) {
                    const was = seed.strongholds[r] ?? 0;
                    const now = next.strongholds[r] ?? 0;
                    if (was === now) continue;
                    const id = `${seed.id}-${slug(r)}`;
                    if (now === 0) await watchApi("ke").removeContent("stronghold", id);
                    else await watchApi("ke").saveContent("stronghold", id, { candidate: seed.id, region: r, level: now });
                  }
                })
              }
            />
          )}

          <h4 className="sim-editor__h">Record a realignment</h4>
          <div className="sim-form">
            <label>Date<input type="date" value={rz.date} onChange={(e) => setRz({ ...rz, date: e.target.value })} /></label>
            <label>Candidate
              <select value={rz.candidate} onChange={(e) => setRz({ ...rz, candidate: e.target.value })}>
                <option value="">Choose</option>
                {live.sim.seeds.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Ticket
              <select value={rz.ticket} onChange={(e) => setRz({ ...rz, ticket: e.target.value })}>
                <option value="">Runs alone</option>
                {TICKET_KEYS.map((k) => <option key={k} value={k}>Ticket {k}</option>)}
              </select>
            </label>
            <label className="sim-form__wide">Note<input value={rz.note} onChange={(e) => setRz({ ...rz, note: e.target.value })} placeholder="What changed, in one line" /></label>
            <label className="sim-form__wide">Source<input value={rz.source} onChange={(e) => setRz({ ...rz, source: e.target.value })} placeholder="Link or outlet" /></label>
            <button
              type="button"
              className="sim-reset"
              disabled={busy || !rz.candidate || !rz.date}
              onClick={() =>
                save(async () => {
                  await watchApi("ke").saveContent("realignment", `${rz.date}-${rz.candidate}`, { date: rz.date, candidate: rz.candidate, ticket: rz.ticket || null, note: rz.note, source: rz.source });
                  setRz({ ...rz, note: "", source: "" });
                })
              }
            >
              Save realignment
            </button>
          </div>
          {live.sim.realignments.length > 0 && (
            <ul className="sim-editor__list">
              {live.sim.realignments.map((r) => (
                <li key={r.id}>
                  <span>{r.date} · {r.candidate} → {r.ticket ? `Ticket ${r.ticket}` : "alone"}</span>
                  <button type="button" disabled={busy} onClick={() => save(() => watchApi("ke").removeContent("realignment", r.id))}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CandidateEditor({
  seed,
  candidates,
  onPick,
  onSave,
  busy,
}: {
  seed: { id: string; name: string; mobilisation: number; backyard: string[]; strongholds: Partial<Record<string, number>> };
  candidates: { id: string; name: string }[];
  onPick: (id: string) => void;
  onSave: (next: { mobilisation: number; backyard: string[]; strongholds: Partial<Record<string, number>> }) => void;
  busy: boolean;
}) {
  const [mob, setMob] = useState(Math.round(seed.mobilisation * 100));
  const [yard, setYard] = useState(seed.backyard.join(", "));
  const [strong, setStrong] = useState<Partial<Record<string, number>>>({ ...seed.strongholds });
  const codes = yard.split(/[ ,]+/).map((x) => x.trim()).filter((x) => /^\d{3}$/.test(x));
  const unknown = yard.split(/[ ,]+/).map((x) => x.trim()).filter((x) => x && !/^\d{3}$/.test(x));
  return (
    <div className="sim-cand-edit">
      <div className="sim-form">
        <label>Candidate
          <select value={seed.id} onChange={(e) => onPick(e.target.value)}>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Mobilisation (0 to 100)
          <input type="number" min={0} max={100} value={mob} onChange={(e) => setMob(Math.min(100, Math.max(0, Number(e.target.value))))} />
        </label>
        <label className="sim-form__wide">Backyard county codes (3 digits, comma separated)
          <input value={yard} onChange={(e) => setYard(e.target.value)} placeholder="027, 015" />
          {unknown.length > 0 && <span className="sim-error">Ignored: {unknown.join(", ")}</span>}
        </label>
      </div>
      <div className="sim-strong-edit">
        {REGIONS.map((r) => (
          <label key={r}>
            <span>{r}</span>
            <select value={strong[r] ?? 0} onChange={(e) => setStrong({ ...strong, [r]: Number(e.target.value) })}>
              <option value={0}>None</option>
              <option value={1}>Lean</option>
              <option value={2}>Base</option>
            </select>
          </label>
        ))}
      </div>
      <button type="button" className="sim-reset" disabled={busy} onClick={() => onSave({ mobilisation: mob / 100, backyard: codes, strongholds: strong })}>
        Save inputs for {seed.name}
      </button>
    </div>
  );
}
