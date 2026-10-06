import { useMemo, useState } from "react";
import { useSize } from "../../query/shared";
import { clip, fmtCompact, fmtMeasure, niceScale, pct } from "../format";
import { shapeMatrix } from "../shape";
import { isAdditive, isCurrentPeriod } from "../types";
import { axisText, barPath, Frame, Legend, Tip, useTip, type ChartProps, type TipRow } from "./kit";

/**
 * Upright bars (single, grouped, stacked or 100%), lines and areas, and the
 * histogram — everything drawn against a category or time axis with a value
 * axis beside it.
 */

type Stack = "none" | "grouped" | "stacked" | "percent";

/** A curve through the points that never overshoots them (so a smoothed line cannot dip below zero between two zeros). */
export function monotone(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n < 3) return `M${pts.map((p) => p.join(",")).join("L")}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    slope.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1));
  }
  const t: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) t.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  t.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / slope[i];
    const b = t[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * slope[i];
      t[i + 1] = tau * b * slope[i];
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

/** A name broken over at most two lines of about `max` characters, at a space where there is one. */
export function wrap(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const cut = text.lastIndexOf(" ", max);
  const first = cut > max * 0.4 ? text.slice(0, cut) : text.slice(0, max);
  const rest = text.slice(first.length).trim();
  return [first, rest.length > max ? `${rest.slice(0, Math.max(max - 1, 1)).trimEnd()}…` : rest];
}

/** Flat until the next point, then straight up or down to it: for figures that hold until they change. */
const stepped = (pts: [number, number][]) =>
  pts.length
    ? `M${pts[0][0]},${pts[0][1]}${pts
        .slice(1)
        .map((p) => `H${p[0]}V${p[1]}`)
        .join("")}`
    : "";

export const straight = (pts: [number, number][]) => (pts.length ? `M${pts.map((p) => `${p[0]},${p[1]}`).join("L")}` : "");

export default function XYChart({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const matrix = useMemo(() => shapeMatrix(viz, result, theme, { topN: viz.kind === "bar" ? 12 : 60 }), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const [hover, setHover] = useState<number | null>(null);

  const { cats } = matrix;
  // A running total: each point is everything up to and including its period.
  const series = useMemo(
    () =>
      viz.options?.cumulative && viz.kind !== "bar" && viz.kind !== "histogram" && matrix.ordered
        ? matrix.series.map((s) => {
            let run = 0;
            return { ...s, values: s.values.map((v) => (run += v ?? 0)) };
          })
        : matrix.series,
    [matrix, viz.options?.cumulative, viz.kind],
  );
  const histogram = viz.kind === "histogram";
  const mode: "bar" | "line" | "area" = histogram ? "bar" : (viz.kind as "bar" | "line" | "area");
  const many = series.length > 1;
  const stack: Stack =
    mode === "line"
      ? "none"
      : mode === "area"
        ? viz.options?.stack === "percent" && many
          ? "percent"
          : many
            ? "stacked"
            : "none"
        : many
          ? (viz.options?.stack ?? (matrix.splitDim ? "stacked" : "grouped"))
          : "none";
  const stacked = stack === "stacked" || stack === "percent";
  const n = cats.length;
  const options = viz.options;

  // Per category: where each series' segment starts and ends on the value axis.
  const layout = useMemo(() => {
    const segs: { lo: number; hi: number }[][] = [];
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < n; i++) {
      const row: { lo: number; hi: number }[] = [];
      if (stacked) {
        const total = series.reduce((s, x) => s + Math.abs(x.values[i] ?? 0), 0);
        let up = 0;
        let down = 0;
        for (const s of series) {
          const raw = s.values[i] ?? 0;
          const v = stack === "percent" ? (total ? Math.abs(raw) / total : 0) : raw;
          if (v >= 0) {
            row.push({ lo: up, hi: up + v });
            up += v;
          } else {
            row.push({ lo: down + v, hi: down });
            down += v;
          }
        }
        hi = Math.max(hi, up);
        lo = Math.min(lo, down);
      } else {
        for (const s of series) {
          const v = s.values[i];
          row.push({ lo: Math.min(v ?? 0, 0), hi: Math.max(v ?? 0, 0) });
          if (v != null) {
            hi = Math.max(hi, v);
            lo = Math.min(lo, v);
          }
        }
      }
      segs.push(row);
    }
    return { segs, lo, hi };
  }, [series, n, stacked, stack]);

  // A line of figures that never go near zero need not start there; counts and bars always do.
  let domainLo = layout.lo;
  if (mode === "line" && !series.every((s) => isAdditive(s.measure))) {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
    const min = all.length ? Math.min(...all) : 0;
    if (min > 0 && min > layout.hi * 0.5) domainLo = min;
  }
  const { width, height } = size;
  const scale = stack === "percent" ? { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] } : niceScale(domainLo, layout.hi, height < 190 ? 3 : 5);
  const tickLabel = (t: number) => (stack === "percent" ? pct(t) : fmtCompact(t, options));
  const single = series.length === 1;
  const showLabels = !!options?.labels;

  const left = Math.min(Math.max(...scale.ticks.map((t) => tickLabel(t).length)) * 6.4 + 12, 90);
  const top = single ? 24 : showLabels ? 18 : 10;
  const right = 12;
  const plotW = Math.max(width - left - right, 10);
  const stepGuess = plotW / Math.max(cats.length, 1);
  // Names too long for their column go onto a second line rather than being cut to the same few letters.
  const wrapped = cats.map((c) => (matrix.ordered ? [c.tick] : wrap(c.tick, Math.max(Math.floor((stepGuess - 6) / 6.2), 4))));
  const bottom = wrapped.some((w) => w.length > 1) ? 39 : 26;
  const plotH = Math.max(height - top - bottom, 10);
  const y = (v: number) => top + plotH - ((v - scale.min) / (scale.max - scale.min || 1)) * plotH;
  const step = plotW / Math.max(n, 1);
  const cx = (i: number) => left + step * (i + 0.5);
  const band = histogram ? Math.max(step - 1, 1) : Math.min(step * 0.74, 64);
  const groupW = stack === "grouped" ? Math.max((band - (series.length - 1) * 2) / series.length, 1) : band;

  // Tick labels on the category axis. Along time, as many as fit without touching; for names, every one, cut to its column
  // (a name left out would leave a bar with no way to tell what it is).
  const widest = Math.max(...wrapped.map((w) => w[0].length), 1) * 6.2 + 10;
  const every = matrix.ordered ? Math.max(Math.ceil(widest / step), 1) : step < 26 ? Math.ceil(26 / step) : 1;

  // The newest period is usually still running, so its figure is not final: it is drawn open and dashed, and said so.
  const running = n > 1 && !cats[n - 1].other && isCurrentPeriod(cats[n - 1].raw, matrix.catDim.grain);
  const note = [matrix.note, running ? `${cats[n - 1].label} is not over yet, so its figure will still grow.` : ""].filter(Boolean).join(" ") || null;

  const dim = (i: number) => (selectedKey !== null && cats[i].key !== selectedKey ? 0.28 : 1);

  const tipFor = (i: number): TipRow[] => {
    const total = series.reduce((s, x) => s + Math.abs(x.values[i] ?? 0), 0);
    const rows: TipRow[] = series.map((s) => ({
      color: s.color,
      label: s.label,
      value: fmtMeasure(s.values[i], s.measure, options),
      extra: stacked && total ? pct(Math.abs(s.values[i] ?? 0) / total) : undefined,
    }));
    if (stacked && series.every((s) => isAdditive(s.measure))) rows.push({ label: "Total", value: fmtMeasure(total, series[0].measure, options), strong: true });
    return rows;
  };

  const points = (si: number): ([number, number] | null)[] => series[si].values.map((v, i) => (v == null ? null : [cx(i), y(stacked ? layout.segs[i][si].hi : v)]));
  /** Runs of consecutive points, so a gap in the data is a gap in the line. */
  const runs = (pts: ([number, number] | null)[]) => {
    const out: [number, number][][] = [];
    let run: [number, number][] = [];
    for (const p of pts) {
      if (p) run.push(p);
      else if (run.length) {
        out.push(run);
        run = [];
      }
    }
    if (run.length) out.push(run);
    return out;
  };
  const curve = options?.step ? stepped : options?.smooth ? monotone : straight;
  const showMarkers = n <= 31;

  return (
    <Frame legend={<Legend items={series} />} note={note}>
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && height > 0 && n > 0 && (
          <svg width={width} height={height} role="img" aria-label={`${viz.kind} chart`}>
            {single && (
              <text x={0} y={11} {...axisText(theme, 10.5)} fill={theme.faint}>
                {series[0].label}
              </text>
            )}
            {scale.ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke={t === 0 ? theme.faint : theme.grid} strokeWidth={1} />
                <text x={left - 8} y={y(t) + 3.5} textAnchor="end" {...axisText(theme)}>
                  {tickLabel(t)}
                </text>
              </g>
            ))}

            {hover !== null && mode === "bar" && <rect x={left + step * hover} y={top} width={step} height={plotH} fill={theme.ink} opacity={0.06} />}
            {hover !== null && mode !== "bar" && <line x1={cx(hover)} x2={cx(hover)} y1={top} y2={top + plotH} stroke={theme.faint} strokeWidth={1} />}

            {mode === "bar" &&
              cats.map((c, i) => {
                const x0 = cx(i) - band / 2;
                // Only the outermost segment of a stack is rounded.
                const topMost = stacked ? layout.segs[i].reduce((best, s, si) => (s.hi > s.lo && s.hi >= (layout.segs[i][best]?.hi ?? -Infinity) ? si : best), 0) : -1;
                return (
                  <g key={c.key} opacity={dim(i) * (running && i === n - 1 ? 0.55 : 1)}>
                    {series.map((s, si) => {
                      const seg = layout.segs[i][si];
                      if (seg.hi === seg.lo) return null;
                      const x = stack === "grouped" ? x0 + si * (groupW + 2) : x0;
                      const yTop = y(seg.hi);
                      let h = Math.max(y(seg.lo) - yTop, 1);
                      // A sliver of the panel between stacked segments keeps neighbours apart whatever their colours.
                      const gap = stacked && seg.lo !== 0 && h > 4 ? 2 : 0;
                      h -= gap;
                      const negative = !stacked && (s.values[i] ?? 0) < 0;
                      const round = histogram ? "none" : stacked ? (si === topMost ? "top" : "none") : negative ? "bottom" : "top";
                      return <path key={s.key} d={barPath(x, yTop, groupW, h, 3, round)} fill={s.color} />;
                    })}
                    {showLabels && band >= 16 && (stacked || single || groupW >= 22) && (
                      <>
                        {(stacked ? [0] : series.map((_, si) => si)).map((si) => {
                          const value = stacked ? series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0) : series[si].values[i];
                          if (value == null || stack === "percent") return null;
                          const xMid = stack === "grouped" ? x0 + si * (groupW + 2) + groupW / 2 : cx(i);
                          const yAt = stacked ? y(Math.max(...layout.segs[i].map((s) => s.hi))) : y(Math.max(value, 0));
                          return (
                            <text key={si} x={xMid} y={yAt - 5} textAnchor="middle" {...axisText(theme, 10.5)} fill={theme.ink} fontWeight={600}>
                              {fmtCompact(value, options)}
                            </text>
                          );
                        })}
                      </>
                    )}
                  </g>
                );
              })}

            {mode === "area" &&
              series.map((s, si) => {
                if (stacked) {
                  const upper = cats.map((_, i) => `${cx(i)},${y(layout.segs[i][si].hi)}`);
                  const lower = cats.map((_, i) => `${cx(i)},${y(layout.segs[i][si].lo)}`).reverse();
                  return (
                    <g key={s.key}>
                      <path d={`M${upper.join("L")}L${lower.join("L")}Z`} fill={s.color} opacity={0.86} />
                      <path d={`M${upper.join("L")}`} fill="none" stroke={theme.surface} strokeWidth={1.5} />
                    </g>
                  );
                }
                return runs(points(si)).map((run, ri) => (
                  <g key={`${s.key}${ri}`}>
                    <path d={`${curve(run)}L${run[run.length - 1][0]},${y(Math.max(scale.min, 0))}L${run[0][0]},${y(Math.max(scale.min, 0))}Z`} fill={s.color} opacity={0.16} />
                    <path d={curve(run)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                ));
              })}

            {mode === "line" &&
              series.map((s, si) => {
                const pts = points(si);
                const open = running && pts[n - 1] && pts[n - 2];
                return (
                  <g key={s.key}>
                    {runs(open ? pts.slice(0, n - 1) : pts).map((run, ri) => (
                      <path key={ri} d={curve(run)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    ))}
                    {open && <path d={straight([pts[n - 2]!, pts[n - 1]!])} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray="3 4" strokeLinecap="round" />}
                    {pts.map((p, i) =>
                      p && (showMarkers || hover === i || cats[i].key === selectedKey) ? (
                        <circle
                          key={i}
                          cx={p[0]}
                          cy={p[1]}
                          r={hover === i || cats[i].key === selectedKey ? 5 : 4}
                          fill={running && i === n - 1 ? theme.surface : s.color}
                          stroke={running && i === n - 1 ? s.color : theme.surface}
                          strokeWidth={2}
                          opacity={dim(i) < 1 ? 0.45 : 1}
                        />
                      ) : null,
                    )}
                    {showLabels &&
                      single &&
                      n <= 20 &&
                      pts.map((p, i) =>
                        p ? (
                          <text key={`l${i}`} x={p[0]} y={p[1] - 9} textAnchor="middle" {...axisText(theme, 10.5)} fill={theme.ink} fontWeight={600}>
                            {fmtCompact(s.values[i], options)}
                          </text>
                        ) : null,
                      )}
                  </g>
                );
              })}
            {mode === "area" && !stacked && hover !== null && points(0)[hover] && (
              <circle cx={points(0)[hover]![0]} cy={points(0)[hover]![1]} r={5} fill={series[0].color} stroke={theme.surface} strokeWidth={2} />
            )}

            {cats.map((c, i) =>
              i % every === 0 || (matrix.ordered && i === n - 1 && (n - 1) % every > every / 2) ? (
                <text
                  key={c.key}
                  x={histogram ? left + step * i : cx(i)}
                  y={top + plotH + 16}
                  textAnchor="middle"
                  {...axisText(theme)}
                  fill={cats[i].key === selectedKey ? theme.ink : theme.muted}
                  fontWeight={cats[i].key === selectedKey ? 700 : 400}
                >
                  {wrapped[i].map((line, li) => (
                    <tspan key={li} x={histogram ? left + step * i : cx(i)} dy={li === 0 ? 0 : 13}>
                      {line}
                    </tspan>
                  ))}
                </text>
              ) : null,
            )}

            {/* One invisible column per category takes the pointer, so the target is the whole column and not just the mark. */}
            {cats.map((c, i) => (
              <rect
                key={c.key}
                x={left + step * i}
                y={top}
                width={step}
                height={plotH + bottom}
                fill="transparent"
                style={{ cursor: onPick && !c.other ? "pointer" : "default" }}
                onMouseMove={(e) => {
                  setHover(i);
                  show(e, c.label, tipFor(i), onPick && !c.other ? (selectedKey === c.key ? "Click to clear the filter" : "Click to filter the other visuals") : undefined);
                }}
                onMouseLeave={() => {
                  setHover(null);
                  hide();
                }}
                onClick={() => onPick && !c.other && onPick(matrix.catDim, matrix.catType, c.raw, c.label, c.key)}
              />
            ))}
          </svg>
        )}
        <Tip tip={tip} width={width} />
      </div>
    </Frame>
  );
}
