import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { QueryNote, QueryOverview } from "../../api";
import { Empty, Panel, ViewSwitch, bucketLabel } from "./shared";

/**
 * Items collected per day, as a line. Each day is a node; clicking a node —
 * or anywhere in its column, which is a much easier target — opens that
 * day: its events and conversations, and its summary. A day the analyst has
 * written a note on carries a small flag above its node.
 */

const LINE = "#0d9488"; // the site's own signal colour: one series, one colour
const NOTE = "#b3690b"; // a note's flag: the site's amber, with a shape of its own so it does not rest on colour

interface Props {
  overview: QueryOverview | null;
  /** The day currently open ("2026-10-05"), marked on the line. */
  selectedDay: string | null;
  onSelectDay: (day: string) => void;
  notes?: QueryNote[] | null;
}

export default function VolumeLine({ overview, selectedDay, onSelectDay, notes }: Props) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const hourly = overview?.bucket === "hour";
  const notesByDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of notes ?? []) m.set(n.day, [...(m.get(n.day) ?? []), n.body]);
    return m;
  }, [notes]);
  // An hourly line has many points to a day; the day's notes sit on its first hour.
  const data = useMemo(() => {
    const flagged = new Set<string>();
    return (overview?.volume ?? []).map((v) => {
      const day = v.bucket.slice(0, 10);
      const dayNotes = notesByDay.get(day);
      const first = dayNotes && !flagged.has(day);
      if (first) flagged.add(day);
      return { ...v, label: bucketLabel(v.bucket), notes: first ? dayNotes : undefined };
    });
  }, [overview, notesByDay]);
  const peak = useMemo(() => data.reduce<(typeof data)[number] | null>((best, d) => (d.count > (best?.count ?? 0) ? d : best), null), [data]);
  const selectedBucket = selectedDay ? data.find((d) => d.bucket.slice(0, 10) === selectedDay)?.bucket : undefined;

  return (
    <Panel
      title={hourly ? "Events per hour" : "Events per day"}
      note={overview ? `${overview.total.toLocaleString()} in this period${peak && peak.count > 0 ? ` · busiest ${bucketLabel(peak.bucket)} (${peak.count.toLocaleString()})` : ""}` : undefined}
      actions={<ViewSwitch view={view} onChange={setView} />}
    >
      {!overview ? (
        <Empty>Loading…</Empty>
      ) : overview.total === 0 ? (
        <Empty>Nothing was collected in this period.</Empty>
      ) : view === "table" ? (
        <div className="qd-scroll">
          <table className="qd-table">
            <thead>
              <tr>
                <th>{hourly ? "Hour" : "Day"}</th>
                <th className="num">Items</th>
                <th className="num">Events</th>
                <th className="num">Conversations</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.bucket} className={d.bucket === selectedBucket ? "is-selected" : ""}>
                  <td>{bucketLabel(d.bucket, "row")}</td>
                  <td className="num">{d.count.toLocaleString()}</td>
                  <td className="num">{d.events.toLocaleString()}</td>
                  <td className="num">{d.conversations.toLocaleString()}</td>
                  <td>
                    {d.count > 0 && (
                      <button type="button" className="qd-link" onClick={() => onSelectDay(d.bucket.slice(0, 10))}>
                        Open day
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="qd-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                style={{ cursor: "pointer" }}
                // The whole column under the pointer selects its day — nobody has to land on the dot.
                onClick={(state) => {
                  const bucket = (state?.activePayload?.[0]?.payload as { bucket?: string } | undefined)?.bucket;
                  if (bucket) onSelectDay(bucket.slice(0, 10));
                }}
              >
                <CartesianGrid stroke="var(--border-soft)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
                <YAxis allowDecimals={false} tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                <Tooltip cursor={{ stroke: "var(--text-faint)", strokeWidth: 1 }} content={<VolumeTooltip hourly={hourly} />} />
                {selectedBucket && <ReferenceLine x={bucketLabel(selectedBucket)} stroke="var(--text-primary)" strokeWidth={1} />}
                {data
                  .filter((d) => d.notes)
                  .map((d) => (
                    <ReferenceDot key={d.bucket} x={d.label} y={d.count} r={0} isFront shape={<NoteFlag />} />
                  ))}
                <Line
                  type="linear"
                  dataKey="count"
                  name="Items"
                  stroke={LINE}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  isAnimationActive={false}
                  // Nodes carry a ring in the surface colour so they stay legible where they sit on the line.
                  dot={{ r: data.length > 60 ? 2.5 : 4, fill: LINE, stroke: "var(--panel)", strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: LINE, stroke: "var(--panel)", strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="qd-hint">
            Click a {hourly ? "point" : "day"} to see that day's events and conversations, and its summary.
            {notesByDay.size > 0 && (
              <>
                {" "}
                <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden style={{ verticalAlign: "-1px" }}>
                  <path d="M1 0v10M1 0.5h7l-2 2.5 2 2.5H1" fill={NOTE} stroke={NOTE} strokeWidth="1" strokeLinejoin="round" />
                </svg>{" "}
                marks a day with a note.
              </>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

/** A small flag standing on a day's node. */
function NoteFlag({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return null;
  const top = Math.max(2, cy - 22);
  return (
    <g pointerEvents="none">
      <path d={`M${cx} ${cy - 6}V${top}`} stroke={NOTE} strokeWidth={1.5} />
      <path d={`M${cx} ${top}h8l-2.5 3 2.5 3h-8z`} fill={NOTE} stroke="var(--panel)" strokeWidth={1} strokeLinejoin="round" />
    </g>
  );
}

function VolumeTooltip({
  active,
  payload,
  hourly,
}: {
  active?: boolean;
  payload?: { payload: { bucket: string; count: number; events: number; conversations: number; notes?: string[] } }[];
  hourly?: boolean;
}) {
  const d = active ? payload?.[0]?.payload : undefined;
  if (!d) return null;
  return (
    <div className="qd-tip">
      <div className="qd-tip__label">{bucketLabel(d.bucket, true)}</div>
      <div className="qd-tip__value">
        <i className="qd-key" style={{ background: LINE }} />
        <b>{d.count.toLocaleString()}</b> item{d.count === 1 ? "" : "s"}
      </div>
      {d.count > 0 && (
        <div className="qd-tip__sub">
          {d.events.toLocaleString()} event{d.events === 1 ? "" : "s"} · {d.conversations.toLocaleString()} conversation{d.conversations === 1 ? "" : "s"}
        </div>
      )}
      {d.notes?.map((n, i) => (
        <div key={i} className="qd-tip__note">
          Note: {n.length > 140 ? `${n.slice(0, 140)}…` : n}
        </div>
      ))}
      <div className="qd-tip__sub">Click to open {hourly ? "its" : "this"} day</div>
    </div>
  );
}
