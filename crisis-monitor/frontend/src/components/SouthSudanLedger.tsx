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
 * The reshuffle record as a dashboard. The figures come from an analyst
 * compilation (The Reshuffle Ledger, Master Matrix V9, cut-off 2 Oct 2026) that
 * we have not independently verified; they are floors. The 22 September order
 * itself is checked against allAfrica, which reports the SSBC reading. Caretaker
 * names are as the compilation gives them.
 */

const DAY = 86_400_000;
const daysToVote = Math.round((Date.parse(`${ELECTION_DAY}T00:00:00Z`) - Date.parse(`${LEDGER.cutOff}T00:00:00Z`)) / DAY);
const pct = (n: number, max: number) => `${Math.max(2, (n / max) * 100)}%`;

export default function SouthSudanLedger() {
  const h = LEDGER.headline;
  const maxYear = Math.max(...ROWS_BY_YEAR.map((r) => r.total));
  const maxCoded = Math.max(...CODED_BY_YEAR.flatMap((r) => [r.v, r.c]));
  const maxParty = Math.max(...PARTY_TAGS.map((p) => p.count));
  const maxBA = Math.max(...BEFORE_AFTER.flatMap((r) => [r.before, r.after]));

  return (
    <div className="ssl">
      <p className="ssl-source">{LEDGER.source}. Compiled by an analyst; we have not verified its counts, which are floors.</p>

      <div className="ssl-kpis">
        <Kpi n={h.rows} label="office-change rows" note="Jan 2023 to 2 Oct 2026" />
        <Kpi n={h.violations} label="R-ARCSS violations" note="seat taken or altered against its allocation" />
        <Kpi n={h.contested} label="contested seats" note="SPLM-IO seats refilled from the Par Kuol splinter" />
        <Kpi n={h.reinstatements} label="reinstatements" note="same person, same post, returned" />
        <Kpi n={h.caretakerPosts} label="caretaker posts" note="from 22 Sep 2026" />
        <Kpi n={daysToVote} label="days to the 22 Dec vote" note="from the data cut-off" />
      </div>

      <h3 className="el-subhead">The pace of change</h3>
      <p className="el-muted el-small">Office-change rows per year. 2026 is split at the 22 September order. The pace roughly tripled from 2024 to 2025, and 2026 already exceeds all of 2025.</p>
      <div className="ssl-bars" role="img" aria-label="Office-change rows per year">
        {ROWS_BY_YEAR.map((r) => (
          <div key={r.year} className="ssl-row">
            <span className="ssl-row__label">{r.year}</span>
            <div className="ssl-track">
              {r.before !== undefined ? (
                <>
                  <span className="ssl-fill" style={{ width: pct(r.before, maxYear) }} title={`${r.before} before 22 Sep`} />
                  <span className="ssl-fill ssl-fill--alt" style={{ width: pct(r.after!, maxYear) }} title={`${r.after} from 22 Sep`} />
                </>
              ) : (
                <span className="ssl-fill" style={{ width: pct(r.total, maxYear) }} />
              )}
            </div>
            <span className="ssl-row__value">{r.total}{r.before !== undefined && <small> ({r.before} before, {r.after} after 22 Sep)</small>}</span>
          </div>
        ))}
      </div>

      <h3 className="el-subhead">The bargain: violations and contested seats</h3>
      <p className="el-muted el-small">The two codes are kept apart on purpose. A violation is a seat taken or altered against its allocation. A contested seat keeps the letter of the allocation while excluding Machar’s wing.</p>
      <div className="ssl-bars">
        {CODED_BY_YEAR.map((r) => (
          <div key={r.year} className="ssl-pair">
            <span className="ssl-row__label">{r.year}</span>
            <div className="ssl-stack">
              <div className="ssl-row ssl-row--tight"><span className="ssl-tag ssl-tag--v">V</span><div className="ssl-track"><span className="ssl-fill ssl-fill--bad" style={{ width: pct(r.v, maxCoded) }} /></div><span className="ssl-row__value">{r.v}</span></div>
              <div className="ssl-row ssl-row--tight"><span className="ssl-tag ssl-tag--c">C</span><div className="ssl-track"><span className="ssl-fill ssl-fill--warn" style={{ width: pct(r.c, maxCoded) }} /></div><span className="ssl-row__value">{r.c}</span></div>
            </div>
          </div>
        ))}
      </div>

      <details className="ssl-details">
        <summary>All 25 coded seats, and the mixed bundle</summary>
        <div className="ssl-scroll">
          <table className="ssl-table">
            <thead><tr><th>Date</th><th>Post</th><th>Code</th><th>Outgoing → incoming</th></tr></thead>
            <tbody>
              {CODED.map((r, i) => (
                <tr key={i}>
                  <td className="ssl-nowrap">{r.date}</td>
                  <td>{r.post}</td>
                  <td><span className={`ssl-code ssl-code--${r.code.toLowerCase()}`}>{r.code === "Violation" ? "V" : r.code === "Contested" ? "C" : "Mixed"}</span></td>
                  <td>{r.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="el-muted el-small">Coded rows only. The 22 September order is coded C (a neutral electoral transition) under the compilation’s standing ruling, so it is not scored as a violation here.</p>
      </details>

      <h3 className="el-subhead">Who gets the seats</h3>
      <p className="el-muted el-small">Incoming appointees by party tag, all 236 rows. Six are untagged or compound. “IG” is the compilation’s tag for the SPLM under Kiir.</p>
      <div className="ssl-bars">
        {PARTY_TAGS.map((p) => (
          <div key={p.tag} className="ssl-row">
            <span className="ssl-row__label ssl-row__label--wide">{p.tag} <small>{p.note}</small></span>
            <div className="ssl-track"><span className={`ssl-fill ${p.note.startsWith("IO") ? "ssl-fill--io" : ""}`} style={{ width: pct(p.count, maxParty) }} /></div>
            <span className="ssl-row__value">{p.count}</span>
          </div>
        ))}
      </div>

      <h3 className="el-subhead">Churn: appointments per post</h3>
      <p className="el-muted el-small">Security and intelligence posts changed hands 3.29 times each on average, against 1.54 for the cabinet. The index covers ordinary reshuffles from January 2023 to September 2026, and excludes the one-day dissolution. All 64 tracked posts: 120 appointments, 19 re-appointments (16%); 46 of 64 were reshuffled at least once.</p>
      <div className="ssl-bars">
        {CHURN.map((c) => (
          <div key={c.cat} className="ssl-row">
            <span className="ssl-row__label ssl-row__label--wide">{c.cat} <small>{c.posts} posts</small></span>
            <div className="ssl-track"><span className={`ssl-fill ${c.index >= 2.5 ? "ssl-fill--bad" : c.index >= 2 ? "ssl-fill--warn" : ""}`} style={{ width: pct(c.index, 3.5) }} /></div>
            <span className="ssl-row__value">{c.index.toFixed(2)} <small>{c.level}</small></span>
          </div>
        ))}
      </div>

      <h3 className="el-subhead">The break: 22 September 2026</h3>
      <p className="el-muted el-small">A Republican Order under the National Elections Act 2012, as amended in 2026, dissolved the transitional institutions ahead of the 22 December vote. Reported by allAfrica from the SSBC reading. The compilation notes that the vice-presidencies were not replaced and that the matrix records no legislature in the caretaker structure.</p>
      <div className="ssl-ba">
        {BEFORE_AFTER.map((r) => (
          <div key={r.label} className="ssl-ba__item">
            <span className="ssl-ba__label">{r.label}</span>
            <div className="ssl-ba__bars">
              <div className="ssl-row ssl-row--tight"><span className="ssl-tag">before</span><div className="ssl-track"><span className="ssl-fill" style={{ width: pct(r.before, maxBA) }} /></div><span className="ssl-row__value">{r.before}</span></div>
              <div className="ssl-row ssl-row--tight"><span className="ssl-tag ssl-tag--after">after</span><div className="ssl-track"><span className="ssl-fill ssl-fill--alt" style={{ width: pct(r.after, maxBA) }} /></div><span className="ssl-row__value">{r.after}</span></div>
            </div>
          </div>
        ))}
      </div>
      <ol className="ssl-seq">
        {SEQUENCE.map((s) => (
          <li key={s.date}>
            <strong>{s.date}</strong>
            <span>{s.text}{s.note && <small> {s.note}.</small>}</span>
          </li>
        ))}
      </ol>

      <h3 className="el-subhead">Chains of office</h3>
      <p className="el-muted el-small">Where a post changes hands repeatedly, the pool of trusted names runs thin. Chief of Defence Forces, from the compilation:</p>
      <ol className="ssl-chain">
        {CHAIN_CDF.map((c) => (
          <li key={c.date + c.name}><small>{c.date}</small> {c.name}</li>
        ))}
      </ol>

      <h3 className="el-subhead">The caretaker government</h3>
      <p className="el-muted el-small">The roster has 37 posts from 22 September: 17 ministers, 3 deputies, 3 authority heads, 10 governors, 3 chief administrators and 1 adviser. The cabinet grew from 13 to 17 in six days. The compilation counts 24 of the 37 as holders who already appear in its matrix; that is a floor, since people who held office before 2023 may be missed. Party tags on these rows are indicative. The caretaker government is not an R-ARCSS power-sharing body.</p>
      <div className="ssl-kpis ssl-kpis--small">
        <Kpi n="8 of 13" label="governors and chief admins kept post" note="6 governors and 2 chief administrators" />
        <Kpi n="24 of 37" label="holders already in the matrix" note="a floor" />
        <Kpi n={28} label="SPLM (Kiir) tagged" note="6 technocrat or career, 2 SPLM-IO (Par Kuol), 1 other" />
      </div>
      <details className="ssl-details">
        <summary>The 37 caretaker posts, as listed</summary>
        <div className="ssl-scroll">
          <table className="ssl-table">
            <thead><tr><th>Post</th><th>Holder</th><th>Tag</th><th>From</th><th>Earlier record</th></tr></thead>
            <tbody>
              {ROSTER.map(([post, name, tag, date, status]) => (
                <tr key={post}>
                  <td>{post}</td>
                  <td>{name}</td>
                  <td>{tag}</td>
                  <td className="ssl-nowrap">{date}</td>
                  <td><span className={`ssl-status-tag ssl-status-tag--${status === "Prior holder" ? "prior" : status === "Retained" ? "kept" : "new"}`}>{status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="el-muted el-small">{REMOVED} Governors may name up to eight state ministers and county commissioners each, and those appointments will not appear as presidential decrees. The state-level record is therefore thinner after 22 September.</p>
      </details>

      <h3 className="el-subhead">What to watch, and the flags</h3>
      <ul className="ssl-flags">
        {FLAGS.map((f) => <li key={f}>{f}</li>)}
      </ul>
      <p className="el-muted el-small">Counting units are kept apart: decrees, office-change rows (236, where a bundled action is one row) and posts (64 tracked, 37 in the caretaker roster). Reinstatement means the incoming official had held the same post before.</p>
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
