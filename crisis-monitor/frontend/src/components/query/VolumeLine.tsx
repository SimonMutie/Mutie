import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { QueryOverview } from "../../api";
import { Empty, Panel, ViewSwitch, bucketLabel } from "./shared";

/**
 * Items collected per day, as a line. Each day is a node; clicking a node —
 * or anywhere in its column, which is a much easier target — opens that
 * day: its events and conversations, and its summary.
 */

const LINE = "#0d9488"; // the site's own signal colour: one series, one colour

interface Props {
  overview: QueryOverview | null;
  /** The day currently open ("2026-10-05"), marked on the line. */
  selectedDay: string | null;
  onSelectDay: (day: string) => void;
}

export default function VolumeLine({ overview, selectedDay, onSelectDay }: Props) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const hourly = overview?.bucket === "hour";
  const data = useMemo(() => (overview?.volume ?? []).map((v) => ({ ...v, label: bucketLabel(v.bucket) })), [overview]);
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
          <div className="qd-hint">Click a {hourly ? "point" : "day"} to see that day's events and conversations, and its summary.</div>
        </>
      )}
    </Panel>
  );
}

function VolumeTooltip({ active, payload, hourly }: { active?: boolean; payload?: { payload: { bucket: string; count: number; events: number; conversations: number } }[]; hourly?: boolean }) {
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
      <div className="qd-tip__sub">Click to open {hourly ? "its" : "this"} day</div>
    </div>
  );
}
