import { useMemo } from "react";
import { useSize } from "../../query/shared";
import { change, fmtCompact, fmtMeasure, niceScale, pct } from "../format";
import { shapeMatrix } from "../shape";
import type { DashTheme } from "../themes";
import { isCurrentPeriod, measureLabel, valuesOf, type VizSpec } from "../types";
import type { ChartProps } from "./kit";

/** Single figures: the headline number with its trend, the gauge against a target, and the text card. */

/** A rise or fall, coloured only when the author has said which direction is good news. */
function changeColor(delta: number, viz: VizSpec, theme: DashTheme): string {
  const lower = viz.options?.lowerIsBetter;
  if (lower === undefined || delta === 0) return theme.muted;
  return delta < 0 === lower ? theme.good : theme.bad;
}

export function Kpi({ viz, result, theme, title }: ChartProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const measure = valuesOf(viz)[0];
  const hasTrend = viz.rows.length > 0;

  const trend = useMemo(() => {
    if (!hasTrend) return null;
    const asLine: VizSpec = { ...viz, kind: "line", rows: [{ field: viz.rows[0].field, grain: viz.rows[0].grain ?? "month" }], columns: [] };
    const m = shapeMatrix(asLine, { rows: result.rows, truncated: false }, theme, { topN: 0 });
    const cats = m.cats.filter((c) => c.raw !== null);
    const values = (m.series[0]?.values ?? []).slice(0, cats.length);
    // The newest period is usually still running; comparing a part-month with a whole one would show a fall that is not there.
    const running = cats.length > 0 && isCurrentPeriod(cats[cats.length - 1].raw, asLine.rows[0].grain);
    return { cats, values, running };
  }, [viz, result, theme, hasTrend]);

  // The headline is the figure for everything in view; with a trend, the server's own total (right for averages too).
  const overall = hasTrend ? (result.rollups?.find((r) => r.dims.length === 0)?.rows[0]?.m[0] ?? null) : (result.rows[0]?.m[0] ?? null);
  const n = trend?.values.length ?? 0;
  // The two newest finished periods are the ones compared.
  const at = trend?.running ? n - 2 : n - 1;
  const last = trend && at >= 0 ? trend.values[at] : null;
  const before = trend && at >= 1 ? trend.values[at - 1] : null;
  const delta = change(last, before);

  const big = Math.max(Math.min(size.height * (hasTrend ? 0.26 : 0.36), size.width * 0.2, 68), 22);
  const sparkH = Math.max(Math.min(size.height * 0.3, 90), 0);
  const points = useMemo(() => {
    if (!trend || trend.values.length < 2 || !size.width || sparkH < 16) return null;
    const vals = trend.values.map((v) => v ?? 0);
    const lo = Math.min(...vals, 0);
    const hi = Math.max(...vals);
    const x = (i: number) => (i / (vals.length - 1)) * (size.width - 8) + 4;
    const y = (v: number) => sparkH - 5 - ((v - lo) / (hi - lo || 1)) * (sparkH - 10);
    return vals.map((v, i) => [x(i), y(v)] as const);
  }, [trend, size.width, sparkH]);

  return (
    <div className="vz-kpi" ref={ref}>
      {measureLabel(viz, measure).toLowerCase() !== (title ?? "").trim().toLowerCase() && <div className="vz-kpi__label">{measureLabel(viz, measure)}</div>}
      <div className="vz-kpi__value" style={{ fontSize: big, fontFamily: theme.display }} title={fmtMeasure(overall, measure, viz.options)}>
        {overall !== null && Math.abs(overall) >= 100_000 ? fmtCompact(overall, viz.options) : fmtMeasure(overall, measure, viz.options)}
      </div>
      {trend && trend.cats.length > 0 && (
        <div className="vz-kpi__change">
          {delta !== null && (
            <b style={{ color: changeColor(delta, viz, theme) }}>
              {delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} {pct(Math.abs(delta), Math.abs(delta) < 0.1 ? 1 : 0)}
            </b>
          )}
          <span>
            {at >= 0 && `${trend.cats[at].label}: ${fmtMeasure(last, measure, viz.options)}`}
            {at >= 1 && delta !== null ? `, against ${fmtMeasure(before, measure, viz.options)} in ${trend.cats[at - 1].label}` : ""}
            {trend.running && `${at >= 0 ? ". " : ""}${trend.cats[n - 1].label} so far: ${fmtMeasure(trend.values[n - 1], measure, viz.options)}`}
          </span>
        </div>
      )}
      {points && (
        // The margin that pushes the trend to the foot of the card sits on this wrapper, not on the SVG: an image export
        // serialises the SVG with its computed styles, and a margin baked into it would shift the drawing out of view.
        <div className="vz-kpi__spark">
          <svg width={size.width} height={sparkH} role="img" aria-label="Trend">
            <path d={`M${points.map((p) => p.join(",")).join("L")}L${points[points.length - 1][0]},${sparkH}L${points[0][0]},${sparkH}Z`} fill={theme.accent} opacity={0.13} />
            <path
              d={`M${(trend?.running ? points.slice(0, -1) : points).map((p) => p.join(",")).join("L")}`}
              fill="none"
              stroke={theme.accent}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {/* The period still running is drawn dashed and open: its figure will grow. */}
            {trend?.running && points.length > 1 && (
              <path
                d={`M${points[points.length - 2].join(",")}L${points[points.length - 1].join(",")}`}
                fill="none"
                stroke={theme.accent}
                strokeWidth={2}
                strokeDasharray="3 4"
                strokeLinecap="round"
              />
            )}
            <circle
              cx={points[points.length - 1][0]}
              cy={points[points.length - 1][1]}
              r={4}
              fill={trend?.running ? theme.surface : theme.accent}
              stroke={trend?.running ? theme.accent : theme.surface}
              strokeWidth={2}
            />
          </svg>
        </div>
      )}
    </div>
  );
}

export function Gauge({ viz, result, theme }: ChartProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const measure = valuesOf(viz)[0];
  const value = result.rows[0]?.m[0] ?? null;
  const target = viz.options?.target && viz.options.target > 0 ? viz.options.target : null;
  const top =
    viz.options?.max && viz.options.max > 0 ? viz.options.max : target ? Math.max(target, value ?? 0) * (value !== null && value > target ? 1.05 : 1.2) : niceScale(0, Math.max(value ?? 1, 1), 4).max;
  const frac = Math.min(Math.max((value ?? 0) / (top || 1), 0), 1);

  // A half circle that fits both the width and the height left over for it.
  const r = Math.max(Math.min(size.width / 2 - 14, size.height - 62), 20);
  const cx = size.width / 2;
  const cy = r + 12;
  const thick = Math.max(Math.min(r * 0.2, 22), 8);
  const at = (f: number, radius: number) => [cx - radius * Math.cos(Math.PI * f), cy - radius * Math.sin(Math.PI * f)] as const;
  const sweep = (f0: number, f1: number) => {
    const [x0, y0] = at(f0, r);
    const [x1, y1] = at(f1, r);
    return `M${x0},${y0}A${r},${r} 0 0 1 ${x1},${y1}`;
  };
  const met = target !== null && value !== null && value >= target;
  const shown = value !== null && Math.abs(value) >= 100_000 ? fmtCompact(value, viz.options) : fmtMeasure(value, measure, viz.options);

  return (
    <div className="vz-gauge" ref={ref}>
      {size.width > 0 && (
        <svg
          width={size.width}
          height={cy + 8}
          role="img"
          aria-label={`Gauge: ${fmtMeasure(value, measure, viz.options)}${target ? ` of a target of ${fmtMeasure(target, measure, viz.options)}` : ""}`}
        >
          <path d={sweep(0, 1)} fill="none" stroke={theme.grid} strokeWidth={thick} strokeLinecap="round" />
          {frac > 0 && <path d={sweep(0, frac)} fill="none" stroke={theme.accent} strokeWidth={thick} strokeLinecap="round" />}
          {target !== null && (
            <line
              x1={at(target / top, r - thick / 2 - 3)[0]}
              y1={at(target / top, r - thick / 2 - 3)[1]}
              x2={at(target / top, r + thick / 2 + 3)[0]}
              y2={at(target / top, r + thick / 2 + 3)[1]}
              stroke={theme.ink}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          )}
          <text
            x={cx}
            y={cy - r * 0.1}
            textAnchor="middle"
            fill={theme.ink}
            fontFamily={theme.display}
            fontWeight={700}
            fontSize={Math.max(Math.min(r * 0.42, 46, ((r - thick) * 1.75) / (shown.length * 0.6)), 14)}
          >
            {shown}
          </text>
          <text x={cx - r} y={cy + 8} textAnchor="middle" fill={theme.faint} fontSize={10.5} fontFamily={theme.font} dy={8}>
            0
          </text>
          <text x={cx + r} y={cy + 8} textAnchor="middle" fill={theme.faint} fontSize={10.5} fontFamily={theme.font} dy={8}>
            {fmtCompact(top, viz.options)}
          </text>
        </svg>
      )}
      <div className="vz-gauge__label">
        <b>{measureLabel(viz, measure)}</b>
        {target !== null && value !== null && (
          <span>
            {pct(value / target)} of the target of {fmtMeasure(target, measure, viz.options)}
            {met ? ", reached" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

export function TextCard({ viz, theme }: { viz: VizSpec; theme: DashTheme }) {
  const paragraphs = (viz.options?.text ?? "").split(/\n\s*\n/).filter((p) => p.trim());
  return (
    <div className={`vz-text${viz.options?.align === "center" ? " is-center" : ""}`}>
      {viz.options?.heading && <h3 style={{ fontFamily: theme.display }}>{viz.options.heading}</h3>}
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {!viz.options?.heading && paragraphs.length === 0 && <p className="vz-text__empty">Open the settings to write this card’s heading and text.</p>}
    </div>
  );
}
