import { useState } from "react";
import type { QueryOverview } from "../../api";
import { Empty, Panel, ViewSwitch } from "./shared";

/**
 * Where the reporting is, and whether that is shifting: the places most
 * often named, down the side, against the weeks (or days, for a short
 * period) of the period across the top. Each cell is shaded by its count
 * and carries the count itself.
 *
 * Magnitude, so one hue from light to dark. The darkest cell is the
 * largest count in the grid, which makes cells comparable across places as
 * well as along a row.
 */

const HUE = [42, 120, 214]; // #2a78d6, the dashboard's single-measure blue

function shade(value: number, max: number): { background: string; color: string } {
  if (value === 0) return { background: "var(--panel-raised)", color: "var(--text-faint)" };
  const t = 0.14 + 0.86 * (value / max);
  return { background: `rgba(${HUE.join(",")}, ${t.toFixed(3)})`, color: t > 0.55 ? "#ffffff" : "var(--text-primary)" };
}

function bucketHead(bucket: string, weekly: boolean): { label: string; title: string } {
  const [y, m, d] = bucket.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (!weekly) return { label, title: date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) };
  const end = new Date(y, m - 1, d + 6);
  return { label, title: `Week of ${label} to ${end.toLocaleDateString(undefined, { day: "numeric", month: "short" })}` };
}

export default function PlaceTrend({ overview, onSearch }: { overview: QueryOverview | null; onSearch?: (term: string) => void }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const grid = overview?.placeTrend ?? null;
  const weekly = grid?.bucket === "week";
  const max = Math.max(1, ...(grid?.rows.flatMap((r) => r.counts) ?? [1]));
  const heads = (grid?.buckets ?? []).map((b) => bucketHead(b, weekly));

  return (
    <Panel
      title={weekly ? "Places by week" : "Places by day"}
      note={grid && grid.rows.length ? "where the reporting is, and whether it is shifting" : undefined}
      actions={<ViewSwitch view={view} onChange={setView} />}
    >
      {!overview ? (
        <Empty>Loading…</Empty>
      ) : !grid ? (
        <Empty>Choose a period of more than two days to see places over time.</Empty>
      ) : grid.rows.length === 0 ? (
        <Empty>None of the items in this period names a place.</Empty>
      ) : view === "table" ? (
        <div className="qd-scroll">
          <table className="qd-table">
            <thead>
              <tr>
                <th>Place</th>
                {heads.map((h, i) => (
                  <th key={i} className="num" title={h.title}>
                    {h.label}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  {r.counts.map((c, i) => (
                    <td key={i} className="num">
                      {c.toLocaleString()}
                    </td>
                  ))}
                  <td className="num">{r.total.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="qd-scroll">
            <table className="qd-heat" onMouseLeave={() => setHover(null)}>
              <thead>
                <tr>
                  <th />
                  {heads.map((h, i) => (
                    <th key={i} title={h.title} className={hover?.col === i ? "is-on" : ""}>
                      {h.label}
                    </th>
                  ))}
                  <th className="qd-heat__total">Total</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r, ri) => (
                  <tr key={r.label}>
                    <th scope="row" className={hover?.row === ri ? "is-on" : ""}>
                      {onSearch ? (
                        <button type="button" className="qd-link" onClick={() => onSearch(r.label.split(",")[0])} title="Show items mentioning this place">
                          {r.label}
                        </button>
                      ) : (
                        r.label
                      )}
                    </th>
                    {r.counts.map((c, ci) => (
                      <td
                        key={ci}
                        style={shade(c, max)}
                        onMouseEnter={() => setHover({ row: ri, col: ci })}
                        title={`${r.label}, ${heads[ci].title.replace(/^Week of /, "week of ")}: ${c.toLocaleString()} item${c === 1 ? "" : "s"}`}
                      >
                        {c > 0 ? c.toLocaleString() : "·"}
                      </td>
                    ))}
                    <td className="qd-heat__total">{r.total.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="qd-hint">
            Items naming each place{weekly ? ", by week starting Monday" : ", by day"}. Darker is more; the darkest cell is {max.toLocaleString()}.
            {overview.sampled.used < overview.sampled.total ? ` From the most recent ${overview.sampled.used.toLocaleString()} items.` : ""}
          </div>
        </>
      )}
    </Panel>
  );
}
