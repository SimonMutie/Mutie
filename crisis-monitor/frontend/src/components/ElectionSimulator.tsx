import { useDeferredValue, useMemo, useState } from "react";
import { slug, type Live } from "../data/electionLive";
import { COUNTIES } from "../data/kenyaElection";
import {
  arrangementFromRealignments,
  buildTickets,
  candidatesFrom,
  MAX_TICKETS,
  REGIONS,
  SCENARIOS,
  simulate,
  TRANSFER_DEFAULT,
  TURNOUT_DEFAULT,
  type Arrangement,
  type SimCandidate,
  type SimResult,
  type TicketRole,
  type TicketSpec,
} from "../lib/kenyaSim";
import { watchApi } from "../api";
import { useCountUp } from "../lib/motion";
import { VBars } from "./charts";

/**
 * 2027 presidential simulator.
 *
 * A ticket is built in three choices: who runs for president, who is the running
 * mate, and which other candidates back it. Candidates in no ticket run alone.
 * The model is in lib/kenyaSim.ts; this file is the page. Everything recomputes when
 * the live record changes: a new poll, a realignment, or an edited input.
 */

const TOTAL_COUNTIES = COUNTIES.length;
const todayIso = () => new Date().toISOString().slice(0, 10);
const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
const DRAWS = 500;
const TRANSFER_STEPS = [0.5, 0.7, 0.85, 1];

type Draft = { head: string | null; deputy: string | null; backers: string[] };
const EMPTY: Draft = { head: null, deputy: null, backers: [] };

export default function ElectionSimulator({ live, isAdmin, onChanged }: { live: Live; isAdmin: boolean; onChanged: () => void }) {
  const asOf = todayIso();
  const cands = useMemo(() => candidatesFrom(live.sim.seeds, live.polls, asOf), [live.sim.seeds, live.polls, asOf]);
  const byId = useMemo(() => new Map(cands.map((c) => [c.id, c])), [cands]);
  const liveArrangement = useMemo(() => arrangementFromRealignments(live.sim.realignments, asOf), [live.sim.realignments, asOf]);

  // "live" shows the record; "custom" is whatever the reader has built or loaded from a preset.
  const [mode, setMode] = useState<"live" | "custom">("live");
  const [custom, setCustom] = useState<Arrangement>([]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transfer, setTransfer] = useState(TRANSFER_DEFAULT);
  const [turnout, setTurnout] = useState(TURNOUT_DEFAULT);

  const arrangement = mode === "live" ? liveArrangement : custom;
  // Sliders update at once; the simulation catches up behind them so dragging stays smooth.
  const dTransfer = useDeferredValue(transfer);
  const dTurnout = useDeferredValue(turnout);
  const result = useMemo(
    () => simulate(cands, { arrangement, transfer: dTransfer, turnout: dTurnout, draws: DRAWS }),
    [cands, arrangement, dTransfer, dTurnout],
  );

  const name = (id: string | null) => (id ? byId.get(id)?.name ?? id : "");
  const short = (id: string | null) => (id ? byId.get(id)?.short ?? id : "");
  const aloneIds = cands.map((c) => c.id).filter((id) => !arrangement.some((t) => t.head === id || t.deputy === id || t.backers.includes(id)));

  /* ── building ─────────────────────────────────────────── */

  const loadPreset = (id: string) => {
    const p = SCENARIOS.find((s) => s.id === id);
    if (!p) return;
    setCustom(p.arrangement.map((t) => ({ ...t, backers: [...t.backers] })));
    setPresetId(id);
    setMode("custom");
    setDraft(EMPTY);
    setEditing(null);
    setNotice(null);
  };

  const editLive = () => {
    setCustom(liveArrangement.map((t) => ({ ...t, backers: [...t.backers] })));
    setPresetId(null);
    setMode("custom");
    setDraft(EMPTY);
    setEditing(null);
    setNotice(null);
  };

  const setHead = (id: string) => setDraft((d) => ({ ...d, head: id, deputy: d.deputy === id ? null : d.deputy, backers: d.backers.filter((b) => b !== id) }));
  const setDeputy = (id: string | null) => setDraft((d) => ({ ...d, deputy: id, backers: id ? d.backers.filter((b) => b !== id) : d.backers }));
  const toggleBacker = (id: string) =>
    setDraft((d) => ({ ...d, backers: d.backers.includes(id) ? d.backers.filter((b) => b !== id) : [...d.backers, id] }));
  const backAll = () => setDraft((d) => ({ ...d, backers: cands.map((c) => c.id).filter((id) => id !== d.head && id !== d.deputy) }));

  const saveTicket = () => {
    if (!draft.head) return;
    const spec: TicketSpec = { head: draft.head, deputy: draft.deputy, backers: draft.backers.filter((b) => b !== draft.head && b !== draft.deputy) };
    const claimed = new Set([spec.head, spec.deputy, ...spec.backers].filter((x): x is string => !!x));
    // Anyone placed in this ticket leaves whatever ticket they were in before.
    const others = custom
      .filter((_, i) => i !== editing)
      .filter((t) => !claimed.has(t.head))
      .map((t) => ({ head: t.head, deputy: t.deputy && !claimed.has(t.deputy) ? t.deputy : null, backers: t.backers.filter((b) => !claimed.has(b)) }));
    if (others.length >= MAX_TICKETS) {
      setNotice(`A ballot can carry up to ${MAX_TICKETS} tickets. Remove one first.`);
      return;
    }
    const next = [...others, spec];
    setCustom(next);
    setMode("custom");
    setPresetId(null);
    setDraft(EMPTY);
    setEditing(null);
    setNotice(null);
  };

  const editTicket = (i: number) => {
    const t = custom[i];
    if (!t) return;
    setDraft({ head: t.head, deputy: t.deputy, backers: [...t.backers] });
    setEditing(i);
    setNotice(null);
  };

  const removeTicket = (i: number) => {
    setCustom(custom.filter((_, j) => j !== i));
    setMode("custom");
    setPresetId(null);
    if (editing === i) {
      setDraft(EMPTY);
      setEditing(null);
    }
  };

  /* ── what is on screen ────────────────────────────────── */

  const leader = [...result.tickets].sort((a, b) => b.pLeads - a.pLeads)[0];
  const firstRound = useCountUp(result.pFirstRound * 100, 700);
  const runoff = useCountUp(result.pRunoff * 100, 700);
  const sensitivity = useMemo(
    () =>
      TRANSFER_STEPS.map((t) => {
        const tickets = buildTickets(cands, arrangement, t);
        const top = tickets.find((x) => x.members.length > 1) ?? tickets[0];
        return { transfer: t, share: top?.share ?? 0, label: top?.label ?? "" };
      }),
    [cands, arrangement],
  );

  const sourceLine =
    mode === "live"
      ? liveArrangement.length === 0
        ? "Showing the live record. No tickets are recorded yet, so every candidate runs alone."
        : `Showing the live record to ${asOf}: ${liveArrangement.length} ticket${liveArrangement.length === 1 ? "" : "s"} recorded.`
      : presetId
        ? `Showing the preset “${SCENARIOS.find((s) => s.id === presetId)?.name}”. You can change it below.`
        : "Showing your own ballot. Build or change tickets below.";

  return (
    <div className="sim">
      <div className="sim-caveat" role="note">
        <strong>Inputs are judgements, outcomes are simulated.</strong> Poll shares and realignments come from the live record. Strongholds, backyards and mobilisation scores are Afrilens estimates from each candidate’s base, not 2022 county results, and should be checked against IEBC’s county figures once they are loaded. The simulation runs {DRAWS.toLocaleString("en-GB")} elections with poll, regional and mobilisation error. It shows a range of plausible outcomes, not a forecast.
      </div>

      <div className="sim-howto">
        <p className="sim-howto__title">How a ticket works</p>
        <ol>
          <li><strong>Presidential candidate.</strong> The name on the ballot for president. Their own votes count in full.</li>
          <li><strong>Running mate.</strong> Their votes move to the ticket at the transfer rate below.</li>
          <li><strong>Backers.</strong> Other candidates who tell their supporters to vote for the ticket. Their votes also move at the transfer rate. Votes that do not move go back to the field.</li>
        </ol>
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
          <p className="sim-stat__value sim-stat__value--name">{leader ? leader.label : "—"}</p>
          <p className="sim-stat__note">{leader ? `First in ${pct(leader.pLeads)} of simulated elections` : ""}</p>
        </div>
      </div>

      <div className="sim-card sim-card--wide">
        <h3>Start from a ballot</h3>
        <p className="sim-muted">Pick a ready-made set of tickets, then change it in the builder. Or start from the live record.</p>
        <div className="sim-presets">
          <button type="button" className={`sim-preset${mode === "live" ? " is-on" : ""}`} onClick={() => { setMode("live"); setPresetId(null); setDraft(EMPTY); setEditing(null); setNotice(null); }}>
            <span className="sim-live-dot" aria-hidden="true" />
            <b>Live record</b>
            <small>{liveArrangement.length ? `${liveArrangement.length} ticket${liveArrangement.length === 1 ? "" : "s"} recorded` : "Nothing recorded yet"}</small>
          </button>
          {SCENARIOS.map((s) => (
            <button key={s.id} type="button" className={`sim-preset${presetId === s.id ? " is-on" : ""}`} onClick={() => loadPreset(s.id)}>
              <b>{s.name}</b>
              <small>{s.blurb}</small>
            </button>
          ))}
        </div>
        <p className="sim-blurb">{sourceLine}</p>
        {mode === "live" && liveArrangement.length > 0 && (
          <button type="button" className="sim-reset" onClick={editLive}>Edit these tickets</button>
        )}
      </div>

      <div className="sim-card sim-card--wide sim-builder">
        <div className="sim-builder__head">
          <div>
            <h3>{editing !== null ? "Change this ticket" : "Build a ticket"}</h3>
            <p className="sim-muted">Choose the presidential candidate, the running mate, and the backers. Anyone you place in a ticket leaves their previous ticket.</p>
          </div>
          {mode === "live" && <span className="sim-tag sim-tag--live">Read only. Edit the tickets to build your own.</span>}
        </div>

        <div className={`sim-steps${mode === "live" ? " is-locked" : ""}`}>
          <fieldset className="sim-step" disabled={mode === "live"}>
            <legend><span>1</span> President</legend>
            <div className="sim-pick">
              {cands.map((c) => (
                <button key={c.id} type="button" className={`sim-pick__item${draft.head === c.id ? " is-on" : ""}`} aria-pressed={draft.head === c.id} onClick={() => setHead(c.id)}>
                  <span>{c.short}</span>
                  <small>{pct(c.share, 1)}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="sim-step" disabled={mode === "live" || !draft.head}>
            <legend><span>2</span> Running mate</legend>
            <div className="sim-pick">
              <button type="button" className={`sim-pick__item${draft.deputy === null ? " is-on" : ""}`} aria-pressed={draft.deputy === null} onClick={() => setDeputy(null)}>
                <span>None</span>
                <small>Runs without a running mate</small>
              </button>
              {cands.filter((c) => c.id !== draft.head).map((c) => (
                <button key={c.id} type="button" className={`sim-pick__item${draft.deputy === c.id ? " is-on" : ""}`} aria-pressed={draft.deputy === c.id} onClick={() => setDeputy(c.id)}>
                  <span>{c.short}</span>
                  <small>{pct(c.share, 1)}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="sim-step" disabled={mode === "live" || !draft.head}>
            <legend><span>3</span> Backed by</legend>
            <div className="sim-step__tools">
              <button type="button" className="sim-link" onClick={backAll}>Every other candidate</button>
              <button type="button" className="sim-link" onClick={() => setDraft((d) => ({ ...d, backers: [] }))}>None</button>
            </div>
            <div className="sim-pick">
              {cands.filter((c) => c.id !== draft.head && c.id !== draft.deputy).map((c) => {
                const on = draft.backers.includes(c.id);
                return (
                  <button key={c.id} type="button" className={`sim-pick__item sim-pick__item--check${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => toggleBacker(c.id)}>
                    <span>{on ? "✓ " : ""}{c.short}</span>
                    <small>{pct(c.share, 1)}</small>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        <div className="sim-summary" aria-live="polite">
          {draft.head ? (
            <p>
              <strong>{name(draft.head)}</strong> for president
              {draft.deputy ? <> with <strong>{name(draft.deputy)}</strong> as running mate</> : " with no running mate"}
              {draft.backers.length > 0 ? <>, backed by {draft.backers.length === 1 ? short(draft.backers[0]) : `${draft.backers.length} other candidates`}</> : ", with no backers"}.
            </p>
          ) : (
            <p className="sim-muted">Choose a presidential candidate to start the ticket.</p>
          )}
          <div className="sim-summary__actions">
            {editing !== null && (
              <button type="button" className="sim-reset" onClick={() => { setDraft(EMPTY); setEditing(null); setNotice(null); }}>Cancel</button>
            )}
            <button type="button" className="sim-save" disabled={!draft.head || mode === "live"} onClick={saveTicket}>
              {editing !== null ? "Save changes" : "Add ticket to the ballot"}
            </button>
          </div>
          {notice && <p className="sim-error" role="alert">{notice}</p>}
        </div>

        <h4 className="sim-subhead">Tickets on the ballot</h4>
        {arrangement.length === 0 ? (
          <p className="sim-empty">No tickets. Every candidate runs alone.</p>
        ) : (
          <div className="sim-ballot">
            {arrangement.map((t, i) => {
              const sum = [t.head, ...(t.deputy ? [t.deputy] : []), ...t.backers].reduce((s, id) => s + (byId.get(id)?.share ?? 0), 0);
              return (
                <div key={`${t.head}-${i}`} className={`sim-ticket${editing === i ? " is-editing" : ""}`}>
                  <div className="sim-ticket__head">
                    <span className="sim-ticket__letter">{String.fromCharCode(65 + i)}</span>
                    <div>
                      <p className="sim-ticket__name">{short(t.head)}{t.deputy ? ` & ${short(t.deputy)}` : ""}</p>
                      <p className="sim-muted">{pct(sum, 1)} of poll support across the ticket</p>
                    </div>
                  </div>
                  <dl className="sim-ticket__rows">
                    <div><dt>President</dt><dd>{name(t.head)}</dd></div>
                    <div><dt>Running mate</dt><dd>{t.deputy ? name(t.deputy) : "None"}</dd></div>
                    <div><dt>Backed by</dt><dd>{t.backers.length ? t.backers.map((b) => short(b)).join(", ") : "No one"}</dd></div>
                  </dl>
                  {mode === "custom" && (
                    <div className="sim-ticket__actions">
                      <button type="button" className="sim-link" onClick={() => editTicket(i)}>Change</button>
                      <button type="button" className="sim-link sim-link--danger" onClick={() => removeTicket(i)}>Remove</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {aloneIds.length > 0 && arrangement.length > 0 && (
          <p className="sim-muted sim-alone"><strong>Running alone:</strong> {aloneIds.map((id) => short(id)).join(", ")}</p>
        )}
      </div>

      <div className="sim-card sim-card--wide">
        <h3>Outcome by ticket</h3>
        <p className="sim-muted">Bar: 10th to 90th percentile of the national share across simulated elections. Dark mark: the central run. Dashed line: the 50% first-round threshold.</p>
        <TicketRows result={result} />
      </div>

      <div className="sim-grid">
        <div className="sim-card">
          <h3>How much depends on the transfer</h3>
          <p className="sim-muted">The biggest assumption in any ticket is how many of its backers’ votes actually move. This shows the central share of the largest ticket at different transfer rates.</p>
          <div className="sim-sens">
            {sensitivity.map((s) => (
              <div key={s.transfer} className={`sim-sens__row${Math.abs(s.transfer - transfer) < 0.001 ? " is-current" : ""}`}>
                <span>{Math.round(s.transfer * 100)}% transfer</span>
                <div className="sim-sens__bar"><span style={{ width: `${Math.min(100, s.share * 100 / 0.8)}%` }} /><i style={{ left: `${(0.5 / 0.8) * 100}%` }} aria-hidden="true" /></div>
                <b>{pct(s.share, 1)}</b>
              </div>
            ))}
          </div>
          <p className="sim-muted sim-sens__note">{sensitivity[0]?.label ? `For ${sensitivity[0].label}. The dashed line is 50%.` : ""}</p>
        </div>

        <div className="sim-card">
          <h3>Counties at 25% or more</h3>
          <p className="sim-muted">Round one also needs 24 of the 47 counties. Each ticket’s average count across simulations.</p>
          <FloorRows result={result} />
        </div>

        <div className="sim-card">
          <h3>Leading share, across elections</h3>
          <p className="sim-muted">How often the winning ticket’s share lands in each 2-point band.</p>
          <VBars
            label="Histogram of the leading ticket’s share"
            height={170}
            data={result.leaderHistogram.map((b) => ({ label: `${Math.round(b.from * 100)}`, value: b.count }))}
            fmt={(n) => `${n}`}
          />
        </div>

        <div className="sim-card">
          <h3>Settings</h3>
          <div className="sim-sliders sim-sliders--stack">
            <label>
              <span>Vote transfer to a ticket <strong>{Math.round(transfer * 100)}%</strong></span>
              <input type="range" min={50} max={100} step={1} value={Math.round(transfer * 100)} onChange={(e) => setTransfer(Number(e.target.value) / 100)} />
            </label>
            <label>
              <span>Turnout of registered voters <strong>{(turnout * 100).toFixed(1)}%</strong></span>
              <input type="range" min={50} max={75} step={0.5} value={turnout * 100} onChange={(e) => setTurnout(Number(e.target.value) / 100)} />
            </label>
          </div>
          <button type="button" className="sim-reset" onClick={() => { setTransfer(TRANSFER_DEFAULT); setTurnout(TURNOUT_DEFAULT); }}>Reset settings</button>
        </div>
      </div>

      <div className="sim-grid">
        <div className="sim-card sim-card--wide">
          <h3>Where the tickets stand, by region</h3>
          <p className="sim-muted">Average share of valid votes per region in the central run. Darker is stronger; the outlined cell is the leader.</p>
          <RegionGrid result={result} />
        </div>

        <div className="sim-card">
          <h3>What moved</h3>
          <p className="sim-muted">Changes on the record. Each one sets a candidate’s role on the ballot from its date.</p>
          {live.sim.realignments.length === 0 ? (
            <p className="sim-empty">No changes recorded yet. Every candidate runs alone until one is.</p>
          ) : (
            <ol className="sim-moves">
              {[...live.sim.realignments].reverse().map((r) => (
                <li key={r.id}>
                  <time>{new Date(`${r.date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</time>
                  <p><strong>{short(r.candidate)}</strong> {describeRole(r.role, r.ticket)}</p>
                  {r.note && <p className="sim-muted">{r.note}</p>}
                  {r.source && <p className="sim-src">{r.source}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="sim-card sim-card--wide">
          <h3>The inputs behind the numbers</h3>
          <p className="sim-muted">Each candidate’s poll share, mobilisation, backyard and strongholds. Strongholds run from 0 (none) to 2 (base). A backyard county gives the ticket’s president a 30% bonus there.</p>
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

        {isAdmin && <SimEditor live={live} onChanged={onChanged} asOf={asOf} cands={cands} />}
      </div>
    </div>
  );
}

function describeRole(role: TicketRole, ticket: string | null) {
  if (!ticket) return "leaves its ticket and runs alone";
  if (role === "head") return `becomes the presidential candidate on Ticket ${ticket}`;
  if (role === "deputy") return `becomes the running mate on Ticket ${ticket}`;
  return `backs Ticket ${ticket}`;
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
            <span className="sim-muted sim-row__sub">{pct(t.pLeads)} first · {pct(t.pOutright)} outright</span>
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

function FloorRows({ result }: { result: SimResult }) {
  return (
    <div className="sim-rows">
      {result.tickets.map((t) => (
        <div key={t.key} className="sim-row sim-row--floor">
          <div className="sim-row__name"><span>{t.label}</span></div>
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

function RegionGrid({ result }: { result: SimResult }) {
  const top = result.tickets.slice(0, 4);
  return (
    <div className="sim-table-wrap">
      <table className="sim-heat">
        <thead>
          <tr>
            <th>Region</th>
            <th>Votes</th>
            {top.map((t) => <th key={t.key}>{t.label}</th>)}
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

function SimEditor({ live, onChanged, asOf, cands }: { live: Live; onChanged: () => void; asOf: string; cands: SimCandidate[] }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState(live.sim.seeds[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seed = live.sim.seeds.find((s) => s.id === who);
  const [rz, setRz] = useState({ date: asOf, candidate: "", ticket: "A", role: "head" as TicketRole, note: "", source: "" });

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

          <h4 className="sim-editor__h">Record a change on the ballot</h4>
          <div className="sim-form">
            <label>Date<input type="date" value={rz.date} onChange={(e) => setRz({ ...rz, date: e.target.value })} /></label>
            <label>Candidate
              <select value={rz.candidate} onChange={(e) => setRz({ ...rz, candidate: e.target.value })}>
                <option value="">Choose</option>
                {cands.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Ticket
              <select value={rz.ticket} onChange={(e) => setRz({ ...rz, ticket: e.target.value })}>
                <option value="">Runs alone</option>
                {["A", "B", "C", "D"].map((k) => <option key={k} value={k}>Ticket {k}</option>)}
              </select>
            </label>
            <label>Role
              <select value={rz.role} onChange={(e) => setRz({ ...rz, role: e.target.value as TicketRole })} disabled={!rz.ticket}>
                <option value="head">Presidential candidate</option>
                <option value="deputy">Running mate</option>
                <option value="backer">Backs the ticket</option>
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
                  await watchApi("ke").saveContent("realignment", `${rz.date}-${rz.candidate}`, {
                    date: rz.date,
                    candidate: rz.candidate,
                    ticket: rz.ticket || null,
                    role: rz.ticket ? rz.role : "backer",
                    note: rz.note,
                    source: rz.source,
                  });
                  setRz({ ...rz, note: "", source: "" });
                })
              }
            >
              Save change
            </button>
          </div>
          {live.sim.realignments.length > 0 && (
            <ul className="sim-editor__list">
              {live.sim.realignments.map((r) => (
                <li key={r.id}>
                  <span>{r.date} · {r.candidate} · {r.ticket ? `Ticket ${r.ticket}, ${r.role}` : "alone"}</span>
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
