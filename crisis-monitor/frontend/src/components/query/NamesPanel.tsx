import { useState } from "react";
import type { QueryInsights, QueryNamed } from "../../api";
import { Empty, Panel } from "./shared";

/**
 * Who and what the reporting names, and what is new in it.
 *
 * "Names" are the people, organisations and armed groups written most often,
 * found by their capital letters in running text. "Rising" are the terms
 * used markedly more in the later half of the period than the earlier half.
 * Both are found by spelling, not by understanding (see the backend's
 * lib/names.ts), and the foot of the panel says so.
 *
 * One measure, one colour: the bar is the number of items. Each row also
 * says in words which half of the period most of them fall in, so the
 * direction is never carried by colour.
 */

function trend(n: QueryNamed): { text: string; title: string } | null {
  const total = n.recent + n.earlier;
  if (total < 4) return null;
  const title = `${n.recent} in the later half of the period, ${n.earlier} in the earlier half`;
  if (n.earlier === 0) return { text: "new in the later half", title };
  if (n.recent >= n.earlier * 2) return { text: "↑ mostly later", title };
  if (n.earlier >= n.recent * 2) return { text: "↓ mostly earlier", title };
  return null;
}

export default function NamesPanel({ insights, error, onSearch }: { insights: QueryInsights | null; error: string | null; onSearch: (term: string, label: string) => void }) {
  const [show, setShow] = useState<"names" | "rising">("names");
  const rows = (show === "names" ? insights?.names : insights?.rising) ?? [];
  const most = Math.max(1, ...rows.map((r) => (show === "names" ? r.count : r.recent)));
  return (
    <Panel
      title={show === "names" ? "Names in the coverage" : "Rising terms"}
      actions={
        <div className="qd-seg" role="group" aria-label="Show">
          <button type="button" className={show === "names" ? "is-on" : ""} aria-pressed={show === "names"} onClick={() => setShow("names")}>
            Names
          </button>
          <button type="button" className={show === "rising" ? "is-on" : ""} aria-pressed={show === "rising"} onClick={() => setShow("rising")}>
            Rising
          </button>
        </div>
      }
    >
      {!insights ? (
        <Empty>{error ?? "Loading…"}</Empty>
      ) : rows.length === 0 ? (
        <Empty>
          {show === "names"
            ? "No name recurs across the items of this period."
            : "Nothing stands out as rising. That needs at least a few items in each half of the period, and a term at least twice as common in the later half."}
        </Empty>
      ) : (
        <>
          <div className="qd-scroll">
            <ul className="qd-bars">
              {rows.map((r) => {
                const t = show === "names" ? trend(r) : null;
                const value = show === "names" ? r.count : r.recent;
                return (
                  <li key={r.term}>
                    <div className="qd-bars__label">
                      <button type="button" className="qd-link" onClick={() => onSearch(r.term, r.label)} title="Show the items that use this">
                        {r.label}
                      </button>
                      <span className="qd-bars__aside">
                        {show === "rising" ? (
                          <span title={`${r.recent} items in the later half of the period, ${r.earlier} in the earlier half`}>{r.fresh ? "new" : `was ${r.earlier}`}</span>
                        ) : (
                          t && <span title={t.title}>{t.text}</span>
                        )}
                        <b>{value.toLocaleString()}</b>
                      </span>
                    </div>
                    <div className="qd-bars__track">
                      <div style={{ width: `${Math.max(2, (value / most) * 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="qd-hint">
            {show === "names"
              ? "People, organisations and armed groups, picked out by their capital letters. The odd entry may be neither; places are in their own panel."
              : `Items using each term in the later half of the period (from ${new Date(insights.splitAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}), against the earlier half.`}
          </div>
        </>
      )}
    </Panel>
  );
}
