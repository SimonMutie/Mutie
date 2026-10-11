import { useMemo, useState } from "react";
import { ELECTION_DAY } from "../data/southSudanElection";
import {
  BEFORE_AFTER,
  CHAIN_CDF,
  CHURN,
  CODED,
  CODED_BY_YEAR,
  FLAGS,
  LEDGER,
  PARTY_TAGS,
  REMOVED,
  ROSTER,
  ROWS_BY_YEAR,
  SEQUENCE,
} from "../data/southSudanLedger";

/**
 * The reshuffle record as an interactive dashboard. The figures come from an
 * analyst compilation (The Reshuffle Ledger, Master Matrix V9, cut-off 2 Oct
 * 2026) that we have not independently verified; they are floors. The 22
 * September order is checked against allAfrica. Caretaker names are as the
 * compilation gives them. Everything here filters or explains the same data.
 */

const DAY = 86_400_000;
const daysToVote = Math.round((Date.parse(`${ELECTION_DAY}T00:00:00Z`) - Date.parse(`${LEDGER.cutOff}T00:00:00Z`)) / DAY);
const pct = (n: number, max: number) => `${Math.max(2, (n / max) * 100)}%`;
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

type Code = "all" | "Violation" | "Contested" | "Mixed";
type Status = "all" | "Prior holder" | "Retained" | "No prior entry";

const SCRUB_START = Date.UTC(2026, 8, 1); // 1 Sep 2026
const SCRUB_DAYS = 31; // to 2 Oct 2026
const isoAt = (i: number) => new Date(SCRUB_START + i * DAY).toISOString().slice(0, 10);
const ORDER = "2026-09-22";
const HEALTH_SWAP = "2026-09-28";

export default function SouthSudanLedger() {
  const [year, setYear] = useState<number | null>(null);
  const [code, setCode] = useState<Code>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("all");
  const [q, setQ] = useState("");
  const [churn, setChurn] = useState<string | null>(null);
  const [day, setDay] = useState(SCRUB_DAYS);

  const h = LEDGER.headline;
  const maxYear = Math.max(...ROWS_BY_YEAR.map((r) => r.total));
  const maxCoded = Math.max(...CODED_BY_YEAR.flatMap((r) => [r.v, r.c]));
  const maxParty = Math.max(...PARTY_TAGS.map((p) => p.count));
  const maxBA = Math.max(...BEFORE_AFTER.flatMap((r) => [r.before, r.after]));

  const yr = year === null ? null : ROWS_BY_YEAR.find((r) => r.year === year)!;
  const yc = year === null ? null : CODED_BY_YEAR.find((r) => r.year === year)!;

  const coded = useMemo(
    () => CODED.filter((r) => (year === null || r.date.startsWith(String(year))) && (code === "all" || r.code === code)),
    [year, code],
  );

  const rosterTags = useMemo(() => new Set(ROSTER.map((r) => r[2])), []);
  const roster = useMemo(
    () =>
      ROSTER.filter(
        ([post, name, t, , st]) =>
          (!tag || t === tag) &&
          (status === "all" || st === status) &&
          (!q.trim() || `${post} ${name}`.toLowerCase().includes(q.trim().toLowerCase())),
      ),
    [tag, status, q],
  );

  // Dissolution slider: cabinet and vice-presidency counts on the chosen day.
  const iso = isoAt(day);
  const before = BEFORE_AFTER[0]; // vice-presidencies 5 → 0
  const ministers = BEFORE_AFTER[1];
  const cabinet = iso < ORDER ? ministers.before : iso < HEALTH_SWAP ? 13 : ministers.after;
  const vps = iso < ORDER ? before.before : before.after;
  const eventsSoFar = SEQUENCE.filter((s) => s.iso <= iso);

  const toggleTag = (t: string) => setTag((cur) => (cur === t ? null : t));

  return (
    <div className="ssl">
      <p className="ssl-source">{LEDGER.source}. Compiled by an analyst; we have not verified its counts, which are floors. Select a year, a party tag, a seat or a post to filter.</p>

      <div className="ssl-kpis">
        <Kpi n={yr ? yr.total : h.rows} label={yr ? `office-change rows in ${year}` : "office-change rows"} note={yr ? (yr.before !== undefined ? `${yr.before} before 22 Sep, ${yr.after} after` : "one year") : "Jan 2023 to 2 Oct 2026"} />
        <Kpi n={yc ? yc.v : h.violations} label={yc ? `violations in ${year}` : "R-ARCSS violations"} note="seat taken or altered against its allocation" />
        <Kpi n={yc ? yc.c : h.contested} label={yc ? `contested seats in ${year}` : "contested seats"} note="SPLM-IO seats refilled from the Par Kuol splinter" />
        <Kpi n={h.reinstatements} label="reinstatements" note="same person, same post, returned (all years)" />
        <Kpi n={h.caretakerPosts} label="caretaker posts" note="from 22 Sep 2026" />
        <Kpi n={daysToVote} label="days to the 22 Dec vote" note="from the data cut-off" />
      </div>
      {year !== null && <FilterBar label={`Showing ${year}`} onClear={() => setYear(null)} />}

      <h3 className="el-subhead">The pace of change</h3>
      <p className="el-muted el-small">Office-change rows per year. Click a year to filter the figures above and the coded seats below. 2026 is split at the 22 September order.</p>
      <div className="ssl-bars">
        {ROWS_BY_YEAR.map((r) => (
          <button
            key={r.year}
            type="button"
            className={`ssl-row ssl-row--btn ${year === r.year ? "is-on" : year !== null ? "is-dim" : ""}`}
            aria-pressed={year === r.year}
            onClick={() => setYear((cur) => (cur === r.year ? null : r.year))}
          >
            <span className="ssl-row__label">{r.year}</span>
            <span className="ssl-track">
              {r.before !== undefined ? (
                <>
                  <span className="ssl-fill" style={{ width: pct(r.before, maxYear) }} />
                  <span className="ssl-fill ssl-fill--alt" style={{ width: pct(r.after!, maxYear) }} />
                </>
              ) : (
                <span className="ssl-fill" style={{ width: pct(r.total, maxYear) }} />
              )}
            </span>
            <span className="ssl-row__value">{r.total}{r.before !== undefined && <small> ({r.before} before, {r.after} after 22 Sep)</small>}</span>
          </button>
        ))}
      </div>

      <h3 className="el-subhead">The bargain: violations and contested seats</h3>
      <p className="el-muted el-small">The two codes are kept apart on purpose. A violation is a seat taken or altered against its allocation. A contested seat keeps the letter of the allocation while excluding Machar’s wing.</p>
      <div className="ssl-bars">
        {CODED_BY_YEAR.map((r) => (
          <button key={r.year} type="button" className={`ssl-pair ssl-pair--btn ${year === r.year ? "is-on" : year !== null ? "is-dim" : ""}`} aria-pressed={year === r.year} onClick={() => setYear((cur) => (cur === r.year ? null : r.year))}>
            <span className="ssl-row__label">{r.year}</span>
            <span className="ssl-stack">
              <span className="ssl-row ssl-row--tight"><span className="ssl-tag ssl-tag--v">V</span><span className="ssl-track"><span className="ssl-fill ssl-fill--bad" style={{ width: pct(r.v, maxCoded) }} /></span><span className="ssl-row__value">{r.v}</span></span>
              <span className="ssl-row ssl-row--tight"><span className="ssl-tag ssl-tag--c">C</span><span className="ssl-track"><span className="ssl-fill ssl-fill--warn" style={{ width: pct(r.c, maxCoded) }} /></span><span className="ssl-row__value">{r.c}</span></span>
            </span>
          </button>
        ))}
      </div>

      <h3 className="el-subhead">Coded seats</h3>
      <div className="ssl-chips" role="group" aria-label="Filter by code">
        {(["all", "Violation", "Contested", "Mixed"] as Code[]).map((c) => (
          <button key={c} type="button" className="ssl-chip" aria-pressed={code === c} onClick={() => setCode(c)}>
            {c === "all" ? "All codes" : c === "Violation" ? "Violations" : c}
          </button>
        ))}
      </div>
      <p className="ssl-count" aria-live="polite">{coded.length} of {CODED.length} coded rows{year !== null ? ` in ${year}` : ""}</p>
      <div className="ssl-scroll">
        <table className="ssl-table">
          <thead><tr><th>Date</th><th>Post</th><th>Code</th><th>Outgoing → incoming</th></tr></thead>
          <tbody>
            {coded.map((r, i) => (
              <tr key={i}>
                <td className="ssl-nowrap">{r.date}</td>
                <td>{r.post}</td>
                <td><span className={`ssl-code ssl-code--${r.code.toLowerCase()}`}>{r.code === "Violation" ? "V" : r.code === "Contested" ? "C" : "Mixed"}</span></td>
                <td>{r.change}</td>
              </tr>
            ))}
            {coded.length === 0 && <tr><td colSpan={4} className="el-muted">No coded rows match.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="el-muted el-small">The 22 September order is coded C (a neutral electoral transition) under the compilation’s standing ruling, so it is not scored as a violation here.</p>

      <h3 className="el-subhead">Who gets the seats</h3>
      <p className="el-muted el-small">Incoming appointees by party tag, all 236 rows. Click a tag to filter the caretaker roster by it, where the roster has that tag. “IG” is the compilation’s tag for the SPLM under Kiir.</p>
      <div className="ssl-bars">
        {PARTY_TAGS.map((p) => {
          const linked = rosterTags.has(p.note);
          const on = tag === p.note;
          return (
            <button
              key={p.tag}
              type="button"
              className={`ssl-row ssl-row--btn ${on ? "is-on" : ""} ${!linked ? "is-static" : ""}`}
              aria-pressed={on}
              disabled={!linked}
              title={linked ? `Filter the caretaker roster to ${p.note}` : "No caretaker rows carry this tag"}
              onClick={() => toggleTag(p.note)}
            >
              <span className="ssl-row__label ssl-row__label--wide">{p.tag} <small>{p.note}</small></span>
              <span className="ssl-track"><span className={`ssl-fill ${p.note.startsWith("IO") ? "ssl-fill--io" : ""}`} style={{ width: pct(p.count, maxParty) }} /></span>
              <span className="ssl-row__value">{p.count}</span>
            </button>
          );
        })}
      </div>

      <h3 className="el-subhead">Churn: appointments per post</h3>
      <p className="el-muted el-small">Click a category to see how its index is worked out. Security and intelligence posts changed hands 3.29 times each on average, against 1.54 for the cabinet. The index covers ordinary reshuffles from January 2023 to September 2026, and excludes the one-day dissolution.</p>
      <div className="ssl-bars">
        {CHURN.map((c) => {
          const on = churn === c.cat;
          return (
            <div key={c.cat}>
              <button type="button" className={`ssl-row ssl-row--btn ${on ? "is-on" : churn && !on ? "is-dim" : ""}`} aria-expanded={on} onClick={() => setChurn(on ? null : c.cat)}>
                <span className="ssl-row__label ssl-row__label--wide">{c.cat} <small>{c.posts} posts</small></span>
                <span className="ssl-track"><span className={`ssl-fill ${c.index >= 2.5 ? "ssl-fill--bad" : c.index >= 2 ? "ssl-fill--warn" : ""}`} style={{ width: pct(c.index, 3.5) }} /></span>
                <span className="ssl-row__value">{c.index.toFixed(2)} <small>{c.level}</small></span>
              </button>
              {on && (
                <p className="ssl-explain">
                  {c.appts} appointments across {c.posts} posts: {c.appts} ÷ {c.posts} = {c.index.toFixed(2)} per post. {c.level} churn.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <h3 className="el-subhead">The break: 22 September 2026</h3>
      <p className="el-muted el-small">A Republican Order under the National Elections Act 2012, as amended in 2026, dissolved the transitional institutions ahead of the 22 December vote. Reported by allAfrica from the SSBC reading. Drag the slider to see the state of the government on any day from 1 September.</p>
      <div className="ssl-scrub">
        <label htmlFor="ssl-day" className="ssl-scrub__date">{fmt(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</label>
        <input
          id="ssl-day"
          type="range"
          min={0}
          max={SCRUB_DAYS}
          step={1}
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
          aria-valuetext={fmt(iso)}
        />
        <div className="ssl-scrub__marks" aria-hidden="true">
          <span>1 Sep</span><span>22 Sep</span><span>2 Oct</span>
        </div>
        <div className="ssl-kpis ssl-kpis--small">
          <Kpi n={`${vps}`} label="vice-presidents" note={iso < ORDER ? "before the order (5 posts)" : "vice-presidencies abolished"} />
          <Kpi n={`${cabinet} of ${ministers.before}`} label="cabinet ministers" note={iso < ORDER ? "the transitional cabinet" : iso < HEALTH_SWAP ? "13 caretaker ministers" : "17 after four more on 28 Sep"} />
          <Kpi n={10} label="state governors" note="10 caretaker governors from 22 Sep" />
        </div>
        <ol className="ssl-seq">
          {eventsSoFar.length === 0 && <li className="el-muted">No events in the record yet on this day.</li>}
          {eventsSoFar.map((s) => (
            <li key={s.iso}>
              <strong>{s.date}</strong>
              <span>{s.text}{s.note && <small> {s.note}.</small>}</span>
            </li>
          ))}
        </ol>
      </div>

      <h3 className="el-subhead">Chains of office</h3>
      <p className="el-muted el-small">Where a post changes hands repeatedly, the pool of trusted names runs thin. Chief of Defence Forces, from the compilation:</p>
      <ol className="ssl-chain">
        {CHAIN_CDF.map((c) => (
          <li key={c.date + c.name}><small>{c.date}</small> {c.name}</li>
        ))}
      </ol>

      <h3 className="el-subhead">The caretaker government</h3>
      <p className="el-muted el-small">The roster has 37 posts from 22 September: 17 ministers, 3 deputies, 3 authority heads, 10 governors, 3 chief administrators and 1 adviser. The cabinet grew from 13 to 17 in six days. The compilation counts 24 of the 37 as holders who already appear in its matrix; that is a floor. Party tags on these rows are indicative. The caretaker government is not an R-ARCSS power-sharing body.</p>
      <div className="ssl-kpis ssl-kpis--small">
        <Kpi n="8 of 13" label="governors and chief admins kept post" note="6 governors and 2 chief administrators" />
        <Kpi n="24 of 37" label="holders already in the matrix" note="a floor" />
        <Kpi n={28} label="SPLM (Kiir) tagged" note="6 technocrat or career, 2 SPLM-IO (Par Kuol), 1 other" />
      </div>

      <div className="ssl-roster-tools">
        <input
          type="search"
          className="ssl-search"
          placeholder="Search post or name"
          aria-label="Search the caretaker roster"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="ssl-chips" role="group" aria-label="Filter by earlier record">
          {(["all", "Prior holder", "Retained", "No prior entry"] as Status[]).map((s) => (
            <button key={s} type="button" className="ssl-chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s === "all" ? "Any record" : s}
            </button>
          ))}
        </div>
      </div>
      {(tag || status !== "all" || q) && (
        <FilterBar
          label={`${roster.length} of ${ROSTER.length} posts${tag ? `, tag ${tag}` : ""}`}
          onClear={() => {
            setTag(null);
            setStatus("all");
            setQ("");
          }}
        />
      )}
      {!(tag || status !== "all" || q) && <p className="ssl-count">{roster.length} of {ROSTER.length} posts</p>}
      <div className="ssl-scroll">
        <table className="ssl-table">
          <thead><tr><th>Post</th><th>Holder</th><th>Tag</th><th>From</th><th>Earlier record</th></tr></thead>
          <tbody>
            {roster.map(([post, name, t, date, st]) => (
              <tr key={post}>
                <td>{post}</td>
                <td>{name}</td>
                <td>{t}</td>
                <td className="ssl-nowrap">{date}</td>
                <td><span className={`ssl-status-tag ssl-status-tag--${st === "Prior holder" ? "prior" : st === "Retained" ? "kept" : "new"}`}>{st}</span></td>
              </tr>
            ))}
            {roster.length === 0 && <tr><td colSpan={5} className="el-muted">No posts match.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="el-muted el-small">{REMOVED} Governors may name up to eight state ministers and county commissioners each, and those appointments will not appear as presidential decrees.</p>

      <h3 className="el-subhead">What to watch, and the flags</h3>
      <ul className="ssl-flags">
        {FLAGS.map((f) => <li key={f}>{f}</li>)}
      </ul>
      <p className="el-muted el-small">Counting units are kept apart: decrees, office-change rows (236, where a bundled action is one row) and posts (64 tracked, 37 in the caretaker roster). Reinstatement means the incoming official had held the same post before.</p>
    </div>
  );
}

function FilterBar({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="ssl-filterbar" role="status">
      <span>{label}</span>
      <button type="button" onClick={onClear}>Clear</button>
    </div>
  );
}

function Kpi({ n, label, note }: { n: number | string; label: string; note: string }) {
  return (
    <div className="ssl-kpi">
      <strong>{n}</strong>
      <span>{label}</span>
      <small>{note}</small>
    </div>
  );
}
