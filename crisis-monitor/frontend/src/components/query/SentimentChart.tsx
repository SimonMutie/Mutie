import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { QueryOverview } from "../../api";
import { Empty, Panel, TONE_COLOR, TONE_LABEL, ViewSwitch, bucketLabel, type Tone } from "./shared";

/**
 * The tone of what was collected: how many items a day read as negative,
 * neutral or positive, and the split over the whole period.
 *
 * The tone is an estimate from the words each item uses (the backend's
 * lib/sentiment.ts), not a reading of what it means — the panel says so.
 */

const TONES: Tone[] = ["negative", "neutral", "positive"];

interface Props {
  overview: QueryOverview | null;
  onSelectDay: (day: string) => void;
}

export default function SentimentChart({ overview, onSelectDay }: Props) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const series = useMemo(() => (overview?.sentiment.series ?? []).map((s) => ({ ...s, label: bucketLabel(s.bucket) })), [overview]);
  const overall = overview?.sentiment.overall;
  const total = overall ? overall.negative + overall.neutral + overall.positive : 0;
  const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const partial = overview && overview.sampled.used < overview.sampled.total;

  return (
    <Panel title="Sentiment" note="tone of the wording — an estimate" actions={<ViewSwitch view={view} onChange={setView} />}>
      {!overview ? (
        <Empty>Loading…</Empty>
      ) : total === 0 ? (
        <Empty>Nothing was collected in this period.</Empty>
      ) : (
        <>
          {/* The legend is also the period's split: identity is never carried by colour alone. */}
          <div className="qd-legend">
            {TONES.map((t) => (
              <span key={t} className="qd-legend__item">
                <i style={{ background: TONE_COLOR[t] }} />
                {TONE_LABEL[t]} <b>{share(overall![t])}%</b>
                <span className="qd-legend__count">{overall![t].toLocaleString()}</span>
              </span>
            ))}
          </div>
          {/* The whole period as one bar. */}
          <div className="qd-split" role="img" aria-label={`Negative ${share(overall!.negative)} percent, neutral ${share(overall!.neutral)} percent, positive ${share(overall!.positive)} percent`}>
            {TONES.map((t) => overall![t] > 0 && <div key={t} style={{ flexGrow: overall![t], background: TONE_COLOR[t] }} />)}
          </div>
          {view === "table" ? (
            <div className="qd-scroll">
              <table className="qd-table">
                <thead>
                  <tr>
                    <th>{overview.bucket === "hour" ? "Hour" : "Day"}</th>
                    <th className="num">Negative</th>
                    <th className="num">Neutral</th>
                    <th className="num">Positive</th>
                    <th className="num">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {[...series].reverse().map((s) => (
                    <tr key={s.bucket}>
                      <td>{bucketLabel(s.bucket, "row")}</td>
                      <td className="num">{s.negative}</td>
                      <td className="num">{s.neutral}</td>
                      <td className="num">{s.positive}</td>
                      <td className="num">{s.average.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="qd-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={series}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  barCategoryGap="22%"
                  style={{ cursor: "pointer" }}
                  onClick={(state) => {
                    const bucket = (state?.activePayload?.[0]?.payload as { bucket?: string } | undefined)?.bucket;
                    if (bucket) onSelectDay(bucket.slice(0, 10));
                  }}
                >
                  <CartesianGrid stroke="var(--border-soft)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip cursor={{ fill: "var(--panel-raised)" }} content={<ToneTooltip />} />
                  {/* Stacked from the baseline up: negative, neutral, positive. A 2px gap in the surface colour separates the segments. */}
                  {TONES.map((t, i) => (
                    <Bar
                      key={t}
                      dataKey={t}
                      name={TONE_LABEL[t]}
                      stackId="tone"
                      fill={TONE_COLOR[t]}
                      stroke="var(--panel)"
                      strokeWidth={2}
                      maxBarSize={24}
                      isAnimationActive={false}
                      radius={i === TONES.length - 1 ? [4, 4, 0, 0] : 0}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {partial && (
            <div className="qd-hint">
              From the most recent {overview.sampled.used.toLocaleString()} of {overview.sampled.total.toLocaleString()} items in this period.
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function ToneTooltip({ active, payload }: { active?: boolean; payload?: { payload: { bucket: string; negative: number; neutral: number; positive: number; average: number } }[] }) {
  const d = active ? payload?.[0]?.payload : undefined;
  if (!d) return null;
  const n = d.negative + d.neutral + d.positive;
  return (
    <div className="qd-tip">
      <div className="qd-tip__label">{bucketLabel(d.bucket, true)}</div>
      {/* Every series at this day, in the order they are stacked from the top. */}
      {[...TONES].reverse().map((t) => (
        <div key={t} className="qd-tip__value">
          <i className="qd-key" style={{ background: TONE_COLOR[t] }} />
          <b>{d[t]}</b> {TONE_LABEL[t].toLowerCase()}
          <span className="qd-tip__pct">{n ? Math.round((d[t] / n) * 100) : 0}%</span>
        </div>
      ))}
      <div className="qd-tip__sub">Average tone {d.average.toFixed(2)} (−1 to 1)</div>
    </div>
  );
}
