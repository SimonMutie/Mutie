import { useEffect, useMemo, useRef, useState } from "react";
import { useSize } from "../../query/shared";
import { change, clip, clipMid, dimLabel, fmtCompact, fmtMeasure, inkOn, mix, niceScale, pct } from "../format";
import { shapeMatrix } from "../shape";
import { fieldInfo, isAdditive, isCurrentPeriod, measureLabel, valuesOf } from "../types";
import { axisText, barPath, Frame, Legend, Tip, useTip, type ChartProps } from "./kit";
import { monotone } from "./XYChart";

/** Change over time: the bump chart, streamgraph, small multiples, bars-and-line, calendar, trend table and bar race. */

/** Which tick labels fit along an axis of `n` steps. */
const tickEvery = (labels: string[], step: number) => Math.max(Math.ceil((Math.max(...labels.map((l) => l.length), 1) * 6.2 + 10) / Math.max(step, 1)), 1);

// ── Bump chart ───────────────────────────────────────────────────────────

export function Bump({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const matrix = useMemo(() => shapeMatrix(viz, result, theme, { topN: 0, maxSeries: 8 }), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const [hover, setHover] = useState<string | null>(null);
  const cats = matrix.cats.filter((c) => c.raw !== null).slice(-30);
  const offset = matrix.cats.filter((c) => c.raw !== null).length - cats.length;
  const series = matrix.series.filter((s) => !s.other).slice(0, 8);
  const splitType = matrix.splitDim ? fieldInfo(viz, matrix.splitDim.field).type : "text";

  // The place of each series in each period: 1 for the largest figure.
  const ranks = useMemo(
    () =>
      cats.map((_, ci) => {
        const order = series.map((s, si) => [s.values[ci + offset] ?? -Infinity, si] as const).sort((a, b) => b[0] - a[0]);
        const out: number[] = [];
        order.forEach(([, si], place) => (out[si] = place + 1));
        return out;
      }),
    [cats, series, offset],
  );
  const { width, height } = size;
  const n = cats.length;
  const k = series.length;
  const side = Math.min(Math.max(...series.map((s) => s.label.length), 3) * 6.4 + 26, width * 0.28, 190);
  const top = 12;
  const bottom = 24;
  const plotW = Math.max(width - side * 2, 20);
  const plotH = Math.max(height - top - bottom, 20);
  const x = (i: number) => side + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (rank: number) => top + (k > 1 ? ((rank - 1) / (k - 1)) * plotH : plotH / 2);
  const every = tickEvery(
    cats.map((c) => c.tick),
    plotW / Math.max(n - 1, 1),
  );
  const active = hover ?? selectedKey;

  return (
    <Frame note={[matrix.series.length > series.length ? `The ${series.length} largest are ranked.` : "", offset > 0 ? `The latest ${n} periods are shown.` : ""].filter(Boolean).join(" ") || null}>
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && height > 0 && n > 0 && (
          <svg width={width} height={height} role="img" aria-label="Bump chart of rank over time">
            {cats.map((c, i) => (
              <g key={c.key}>
                <line x1={x(i)} x2={x(i)} y1={top - 4} y2={top + plotH + 4} stroke={theme.grid} />
                {(i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every * 0.6) && (
                  <text x={x(i)} y={height - 6} textAnchor="middle" {...axisText(theme)}>
                    {c.tick}
                  </text>
                )}
              </g>
            ))}
            {series.map((s, si) => {
              const pts = cats.map((_, i) => [x(i), y(ranks[i][si])] as [number, number]);
              const dimmed = active !== null && active !== s.key;
              return (
                <g
                  key={s.key}
                  opacity={dimmed ? 0.18 : 1}
                  style={{ cursor: onPick ? "pointer" : "default", transition: "opacity .15s" }}
                  onMouseEnter={() => setHover(s.key)}
                  onMouseLeave={() => {
                    setHover(null);
                    hide();
                  }}
                  onClick={() => onPick && matrix.splitDim && onPick(matrix.splitDim, splitType, s.key === "\u0000" ? null : s.key, s.label, s.key)}
                >
                  <path d={monotone(pts)} fill="none" stroke={s.color} strokeWidth={active === s.key ? 4 : 3} strokeLinecap="round" />
                  {pts.map((p, i) => (
                    <circle
                      key={i}
                      cx={p[0]}
                      cy={p[1]}
                      r={n > 16 ? 3 : 5}
                      fill={s.color}
                      stroke={theme.surface}
                      strokeWidth={2}
                      onMouseMove={(e) =>
                        show(e, `${s.label}, ${cats[i].label}`, [{ color: s.color, label: `Rank ${ranks[i][si]} of ${k}`, value: fmtMeasure(s.values[i + offset], s.measure, viz.options) }])
                      }
                    />
                  ))}
                  <text x={side - 12} y={pts[0][1] + 4} textAnchor="end" {...axisText(theme, 11)} fill={theme.ink}>
                    {clipMid(s.label, side - 30)} <tspan fontWeight={700}>{ranks[0][si]}</tspan>
                  </text>
                  <text x={width - side + 12} y={pts[n - 1][1] + 4} {...axisText(theme, 11)} fill={theme.ink}>
                    <tspan fontWeight={700}>{ranks[n - 1][si]}</tspan> {clipMid(s.label, side - 30)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        <Tip tip={tip} width={width} />
      </div>
    </Frame>
  );
}

// ── Streamgraph ──────────────────────────────────────────────────────────

/** Stacked bands round a centre line rather than on a floor: the eye follows the swelling and thinning, not a baseline. */
export function Stream({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const matrix = useMemo(() => shapeMatrix(viz, result, theme, { topN: 0 }), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const cats = matrix.cats.filter((c) => c.raw !== null);
  const { series } = matrix;
  const n = cats.length;
  const splitType = matrix.splitDim ? fieldInfo(viz, matrix.splitDim.field).type : "text";
  const totals = cats.map((_, i) => series.reduce((s, x) => s + Math.max(x.values[i] ?? 0, 0), 0));
  const max = Math.max(...totals, 1);
  const { width, height } = size;
  const top = 8;
  const bottom = 24;
  const plotH = Math.max(height - top - bottom, 20);
  const x = (i: number) => 6 + (n > 1 ? (i / (n - 1)) * Math.max(width - 12, 10) : width / 2);
  const mid = top + plotH / 2;
  const scale = (plotH - 4) / max;
  // Where each band starts and ends at each period, stacked outwards from the centre line.
  const bands = series.map((_, si) =>
    cats.map((__, i) => {
      const before = series.slice(0, si).reduce((s, o) => s + Math.max(o.values[i] ?? 0, 0), 0);
      const y0 = mid - (totals[i] / 2) * scale + before * scale;
      return [y0, y0 + Math.max(series[si].values[i] ?? 0, 0) * scale] as const;
    }),
  );
  const every = tickEvery(
    cats.map((c) => c.tick),
    (width - 12) / Math.max(n - 1, 1),
  );

  return (
    <Frame
      legend={<Legend items={series} />}
      note={[matrix.note, "The height of a band at any point is its figure; there is no value axis because the bands float round a centre line."].filter(Boolean).join(" ")}
    >
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && height > 0 && n > 1 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label="Streamgraph"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const i = Math.min(Math.max(Math.round(((e.clientX - rect.left - 6) / Math.max(width - 12, 1)) * (n - 1)), 0), n - 1);
              setHover(i);
              show(e, cats[i].label, [
                ...series.map((s) => ({
                  color: s.color,
                  label: s.label,
                  value: fmtMeasure(s.values[i], s.measure, viz.options),
                  extra: totals[i] ? pct(Math.max(s.values[i] ?? 0, 0) / totals[i]) : undefined,
                })),
                ...(isAdditive(series[0]?.measure) ? [{ label: "Total", value: fmtMeasure(totals[i], series[0].measure, viz.options), strong: true }] : []),
              ]);
            }}
            onMouseLeave={() => {
              setHover(null);
              hide();
            }}
          >
            {series.map((s, si) => {
              const upper = monotone(cats.map((_, i) => [x(i), bands[si][i][0]] as [number, number]));
              const lower = monotone(cats.map((_, i) => [x(n - 1 - i), bands[si][n - 1 - i][1]] as [number, number]));
              return (
                <path
                  key={s.key}
                  d={`${upper}L${lower.slice(1)}Z`}
                  fill={s.color}
                  stroke={theme.surface}
                  strokeWidth={1}
                  opacity={selectedKey !== null && selectedKey !== s.key ? 0.3 : 0.92}
                  style={{ cursor: onPick && !s.other ? "pointer" : "default" }}
                  onClick={() => onPick && matrix.splitDim && !s.other && onPick(matrix.splitDim, splitType, s.key === "\u0000" ? null : s.key, s.label, s.key)}
                />
              );
            })}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + plotH} stroke={theme.ink} strokeOpacity={0.5} />}
            {cats.map((c, i) =>
              i % every === 0 ? (
                <text key={c.key} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} {...axisText(theme)}>
                  {c.tick}
                </text>
              ) : null,
            )}
          </svg>
        )}
        <Tip tip={tip} width={width} />
      </div>
    </Frame>
  );
}

// ── Small multiples ──────────────────────────────────────────────────────

export function Multiples({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const matrix = useMemo(() => shapeMatrix(viz, result, theme, { topN: 0, maxSeries: 12 }), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const cats = matrix.cats.filter((c) => c.raw !== null);
  const series = matrix.series.filter((s) => !s.other).slice(0, 12);
  const n = cats.length;
  const splitType = matrix.splitDim ? fieldInfo(viz, matrix.splitDim.field).type : "text";
  const { width, height } = size;
  // As near to square panels as the card allows.
  const cols = Math.max(Math.min(Math.round(Math.sqrt((series.length * width) / Math.max(height, 1) / 1.5)) || 1, series.length), 1);
  const rowsN = Math.ceil(series.length / cols);
  const gap = 14;
  const pw = (width - gap * (cols - 1)) / cols;
  const ph = Math.max((height - gap * (rowsN - 1)) / rowsN, 60);
  const max = Math.max(...series.flatMap((s) => s.values.map((v) => v ?? 0)), 1);
  const scale = niceScale(0, max, 2);
  const running = n > 1 && isCurrentPeriod(cats[n - 1].raw, matrix.catDim.grain);

  return (
    <Frame
      note={[
        matrix.series.length > series.length ? `The ${series.length} largest are shown.` : "",
        `Every panel uses the same scale, 0 to ${fmtCompact(scale.max, viz.options)}.`,
        running ? `${cats[n - 1].label} is not over yet.` : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className="vz-plot vz-plot--scroll"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && n > 1 && (
          <svg width={width} height={rowsN * ph + (rowsN - 1) * gap} role="img" aria-label="Small multiples">
            {series.map((s, si) => {
              const ox = (si % cols) * (pw + gap);
              const oy = Math.floor(si / cols) * (ph + gap);
              const top = 20;
              const bottom = 14;
              const h = ph - top - bottom;
              const x = (i: number) => ox + 2 + (i / (n - 1)) * (pw - 4);
              const y = (v: number) => oy + top + h - (Math.max(v, 0) / scale.max) * h;
              const pts = cats.map((_, i) => [x(i), y(s.values[i] ?? 0)] as [number, number]);
              const solid = running ? pts.slice(0, -1) : pts;
              const last = s.values[running && n > 1 ? n - 2 : n - 1];
              return (
                <g
                  key={s.key}
                  opacity={selectedKey !== null && selectedKey !== s.key ? 0.3 : 1}
                  style={{ cursor: onPick ? "pointer" : "default" }}
                  onClick={() => onPick && matrix.splitDim && onPick(matrix.splitDim, splitType, s.key === "\u0000" ? null : s.key, s.label, s.key)}
                  onMouseMove={(e) => {
                    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                    const i = Math.min(Math.max(Math.round(((e.clientX - rect.left - ox - 2) / Math.max(pw - 4, 1)) * (n - 1)), 0), n - 1);
                    show(e, `${s.label}, ${cats[i].label}`, [{ color: s.color, label: measureLabel(viz, s.measure), value: fmtMeasure(s.values[i], s.measure, viz.options) }]);
                  }}
                  onMouseLeave={hide}
                >
                  <rect x={ox} y={oy} width={pw} height={ph} fill="transparent" />
                  <text x={ox + 2} y={oy + 12} {...axisText(theme, 11.5)} fill={theme.ink} fontWeight={700}>
                    {clipMid(s.label, pw - 54, 11.5)}
                  </text>
                  <text x={ox + pw - 2} y={oy + 12} textAnchor="end" {...axisText(theme, 11.5)} fill={theme.ink}>
                    {fmtCompact(last, viz.options)}
                  </text>
                  <line x1={ox} x2={ox + pw} y1={y(0)} y2={y(0)} stroke={theme.faint} />
                  <line x1={ox} x2={ox + pw} y1={y(scale.max)} y2={y(scale.max)} stroke={theme.grid} strokeDasharray="2 4" />
                  <path d={`M${pts.map((p) => p.join(",")).join("L")}L${pts[n - 1][0]},${y(0)}L${pts[0][0]},${y(0)}Z`} fill={s.color} opacity={0.14} />
                  <path d={`M${solid.map((p) => p.join(",")).join("L")}`} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {running && <path d={`M${pts[n - 2].join(",")}L${pts[n - 1].join(",")}`} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray="3 4" />}
                  {si >= series.length - cols && (
                    <>
                      <text x={ox} y={oy + ph - 1} {...axisText(theme, 9.5)} fill={theme.faint}>
                        {cats[0].tick}
                      </text>
                      <text x={ox + pw} y={oy + ph - 1} textAnchor="end" {...axisText(theme, 9.5)} fill={theme.faint}>
                        {cats[n - 1].tick}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        <Tip tip={tip} width={width} />
      </div>
    </Frame>
  );
}

// ── Bars and line (two panels) ───────────────────────────────────────────

/**
 * Two figures over one axis. Tools usually overlay them on two value axes,
 * which lets any pair of lines be made to look related; here each figure
 * has its own panel and its own honest scale, one above the other.
 */
export function Combo({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const matrix = useMemo(() => shapeMatrix(viz, result, theme, { topN: 24 }), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const { cats, series } = matrix;
  const n = cats.length;
  const { width, height } = size;
  const scales = series.map((s, i) => niceScale(i === 0 ? Math.min(...s.values.map((v) => v ?? 0), 0) : Math.min(...s.values.map((v) => v ?? 0), 0), Math.max(...s.values.map((v) => v ?? 0), 1), 3));
  const left = Math.min(Math.max(...scales.flatMap((sc) => sc.ticks.map((t) => fmtCompact(t, viz.options).length))) * 6.4 + 12, 80);
  const bottom = 24;
  const gap = 22;
  const panelH = Math.max((height - bottom - gap) / 2, 30);
  const plotW = Math.max(width - left - 10, 10);
  const step = plotW / Math.max(n, 1);
  const cx = (i: number) => left + step * (i + 0.5);
  const band = Math.min(step * 0.72, 56);
  const every = matrix.ordered
    ? tickEvery(
        cats.map((c) => c.tick),
        step,
      )
    : 1;
  const running = n > 1 && isCurrentPeriod(cats[n - 1].raw, matrix.catDim.grain);
  const panels = series.slice(0, 2).map((s, pi) => {
    const top = pi * (panelH + gap) + 16;
    const h = panelH - 16;
    const sc = scales[pi];
    const y = (v: number) => top + h - ((v - sc.min) / (sc.max - sc.min || 1)) * h;
    return { s, top, h, sc, y };
  });

  return (
    <Frame note={running ? `${cats[n - 1].label} is not over yet, so its figures will still grow.` : matrix.note}>
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && height > 0 && n > 0 && (
          <svg width={width} height={height} role="img" aria-label="Bars and line, on two panels">
            {panels.map(({ s, top, sc, y }, pi) => (
              <g key={s.key}>
                <text x={left} y={top - 6} {...axisText(theme, 11)} fill={s.color} fontWeight={700}>
                  {s.label}
                </text>
                {sc.ticks.map((t) => (
                  <g key={t}>
                    <line x1={left} x2={width - 10} y1={y(t)} y2={y(t)} stroke={t === 0 ? theme.faint : theme.grid} />
                    <text x={left - 8} y={y(t) + 3.5} textAnchor="end" {...axisText(theme)}>
                      {fmtCompact(t, viz.options)}
                    </text>
                  </g>
                ))}
                {pi === 0
                  ? cats.map((c, i) => {
                      const v = s.values[i] ?? 0;
                      return (
                        <path
                          key={c.key}
                          d={barPath(cx(i) - band / 2, y(Math.max(v, 0)), band, Math.max(Math.abs(y(v) - y(0)), v ? 1 : 0), 3, v < 0 ? "bottom" : "top")}
                          fill={s.color}
                          opacity={(selectedKey !== null && selectedKey !== c.key ? 0.3 : 1) * (running && i === n - 1 ? 0.55 : 1)}
                        />
                      );
                    })
                  : (() => {
                      const pts = cats.map((_, i) => (s.values[i] == null ? null : ([cx(i), y(s.values[i]!)] as [number, number])));
                      const drawn = pts.filter((p): p is [number, number] => !!p);
                      const solid = running && pts[n - 1] ? drawn.slice(0, -1) : drawn;
                      return (
                        <>
                          <path d={`M${solid.map((p) => p.join(",")).join("L")}`} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                          {running && drawn.length > 1 && pts[n - 1] && (
                            <path d={`M${drawn[drawn.length - 2].join(",")}L${drawn[drawn.length - 1].join(",")}`} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray="3 4" />
                          )}
                          {n <= 31 &&
                            pts.map((p, i) =>
                              p ? (
                                <circle
                                  key={i}
                                  cx={p[0]}
                                  cy={p[1]}
                                  r={hover === i ? 5 : 4}
                                  fill={running && i === n - 1 ? theme.surface : s.color}
                                  stroke={running && i === n - 1 ? s.color : theme.surface}
                                  strokeWidth={2}
                                />
                              ) : null,
                            )}
                        </>
                      );
                    })()}
              </g>
            ))}
            {hover !== null && <rect x={left + step * hover} y={0} width={step} height={height - bottom} fill={theme.ink} opacity={0.05} />}
            {cats.map((c, i) =>
              i % every === 0 ? (
                <text key={c.key} x={cx(i)} y={height - 7} textAnchor="middle" {...axisText(theme)}>
                  {matrix.ordered ? c.tick : clip(c.tick, Math.max(step - 4, 24))}
                </text>
              ) : null,
            )}
            {cats.map((c, i) => (
              <rect
                key={c.key}
                x={left + step * i}
                y={0}
                width={step}
                height={height}
                fill="transparent"
                style={{ cursor: onPick && !c.other ? "pointer" : "default" }}
                onMouseMove={(e) => {
                  setHover(i);
                  show(
                    e,
                    c.label,
                    series.slice(0, 2).map((s) => ({ color: s.color, label: s.label, value: fmtMeasure(s.values[i], s.measure, viz.options) })),
                  );
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

// ── Calendar ─────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

/** A year (or the latest year of the data) as weeks across and weekdays down, each day shaded by its figure. */
export function Calendar({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const measure = valuesOf(viz)[0];
  const dim = { field: viz.rows[0].field, grain: "day" as const };
  const data = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of result.rows) if (typeof r.d[0] === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.d[0])) byDay.set(r.d[0].slice(0, 10), r.m[0] ?? 0);
    const days = [...byDay.keys()].sort();
    if (!days.length) return null;
    // The latest 53 weeks the data reaches, starting on a Monday.
    const end = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
    const first = Math.max(Date.parse(`${days[0]}T00:00:00Z`), end - 370 * DAY_MS);
    const startDow = (new Date(first).getUTCDay() + 6) % 7;
    const start = first - startDow * DAY_MS;
    const cells: { day: string; week: number; dow: number; value: number | null; inRange: boolean }[] = [];
    for (let t = start; t <= end; t += DAY_MS) {
      const day = new Date(t).toISOString().slice(0, 10);
      cells.push({ day, week: Math.floor((t - start) / (7 * DAY_MS)), dow: (new Date(t).getUTCDay() + 6) % 7, value: byDay.get(day) ?? null, inRange: t >= first });
    }
    const shown = cells.filter((c) => c.value !== null).map((c) => c.value as number);
    return {
      cells,
      weeks: cells[cells.length - 1].week + 1,
      max: Math.max(...shown, 0),
      earlier: days.filter((d) => Date.parse(`${d}T00:00:00Z`) < first).length,
      total: shown.reduce((a, b) => a + b, 0),
      busiest: cells.reduce((best, c) => ((c.value ?? -1) > (best.value ?? -1) ? c : best), cells[0]),
    };
  }, [result]);

  const { width } = size;
  if (!data)
    return (
      <Frame>
        <div className="vz-empty">A calendar needs dates; this field has none it can read.</div>
      </Frame>
    );
  const left = 30;
  const top = 18;
  const cell = Math.max(Math.min((width - left) / data.weeks, 22), 6);
  const fillOf = (v: number | null) =>
    v ? mix(theme.surface, theme.ramp, 0.16 + 0.84 * Math.sqrt(v / (data.max || 1))) : theme.dark ? mix(theme.surface, "#ffffff", 0.05) : mix(theme.surface, "#000000", 0.045);
  const monthStarts = data.cells.filter((c) => c.day.endsWith("-01") || c === data.cells[0]);

  return (
    <Frame
      note={[
        isAdditive(measure)
          ? `${fmtMeasure(data.total, measure, viz.options)} in the days shown; the busiest was ${dimLabel(data.busiest.day, dim, "date")} with ${fmtMeasure(data.busiest.value, measure, viz.options)}.`
          : "",
        data.earlier ? `${data.earlier.toLocaleString()} earlier days are not shown; narrow the dashboard's dates to see them.` : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className="vz-plot vz-plot--scroll"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && (
          <svg width={width} height={top + cell * 7 + 26} role="img" aria-label="Calendar heat map">
            {["Mon", "Wed", "Fri"].map((d, i) => (
              <text key={d} x={0} y={top + cell * (i * 2 + 0.5) + 3.5} {...axisText(theme, 9.5)}>
                {d}
              </text>
            ))}
            {monthStarts.map((c, i) =>
              i === 0 || c.week - monthStarts[i - 1].week >= 3 ? (
                <text key={c.day} x={left + c.week * cell} y={11} {...axisText(theme, 10)}>
                  {MONTHS[Number(c.day.slice(5, 7)) - 1]}
                  {c.day.slice(5, 7) === "01" || i === 0 ? ` ${c.day.slice(0, 4)}` : ""}
                </text>
              ) : null,
            )}
            {data.cells
              .filter((c) => c.inRange)
              .map((c) => (
                <rect
                  key={c.day}
                  x={left + c.week * cell + 1}
                  y={top + c.dow * cell + 1}
                  width={cell - 2}
                  height={cell - 2}
                  rx={Math.min(cell * 0.2, 3)}
                  fill={fillOf(c.value)}
                  stroke={selectedKey === c.day ? theme.ink : "none"}
                  strokeWidth={1.5}
                  style={{ cursor: onPick ? "pointer" : "default" }}
                  onMouseMove={(e) =>
                    show(e, dimLabel(c.day, dim, "date"), [
                      { color: fillOf(c.value), label: measureLabel(viz, measure), value: fmtMeasure(c.value ?? (isAdditive(measure) ? 0 : null), measure, viz.options) },
                    ])
                  }
                  onMouseLeave={hide}
                  onClick={() => onPick && onPick(dim, "date", c.day, dimLabel(c.day, dim, "date"), c.day)}
                />
              ))}
            <g transform={`translate(${left}, ${top + cell * 7 + 8})`}>
              <text x={0} y={9} {...axisText(theme, 10)}>
                Low
              </text>
              {[0.08, 0.25, 0.5, 0.75, 1].map((t, i) => (
                <rect key={t} x={26 + i * 15} y={0} width={13} height={10} rx={2} fill={fillOf(data.max * t)} />
              ))}
              <text x={26 + 5 * 15 + 4} y={9} {...axisText(theme, 10)}>
                High ({fmtCompact(data.max, viz.options)})
              </text>
            </g>
          </svg>
        )}
        <Tip tip={tip} width={width} />
      </div>
    </Frame>
  );
}

// ── Trend table ──────────────────────────────────────────────────────────

/** One row per item: a spark line, the latest finished period's figure, and the change on the one before. */
export function Trends({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const matrix = useMemo(() => shapeMatrix(viz, result, theme, { topN: 0, maxSeries: 40 }), [viz, result, theme]);
  const cats = matrix.cats.filter((c) => c.raw !== null);
  const n = cats.length;
  const running = n > 1 && isCurrentPeriod(cats[n - 1].raw, matrix.catDim.grain);
  const at = running ? n - 2 : n - 1;
  const splitType = matrix.splitDim ? fieldInfo(viz, matrix.splitDim.field).type : "text";
  const lower = viz.options?.lowerIsBetter;
  const rows = matrix.series
    .filter((s) => !s.other)
    .map((s) => ({ s, last: s.values[at] ?? null, delta: at >= 1 ? change(s.values[at], s.values[at - 1]) : null }))
    .sort((a, b) => (b.last ?? -Infinity) - (a.last ?? -Infinity))
    .slice(0, viz.options?.topN && viz.options.topN > 0 ? viz.options.topN : 12);
  const W = 120;
  const H = 26;

  if (n < 2) return <div className="vz-empty">A trend needs at least two periods.</div>;
  return (
    <div className="vz-frame">
      <div className="vz-trends">
        <table>
          <thead>
            <tr>
              <th />
              <th>
                {cats[0].tick} to {cats[n - 1].tick}
              </th>
              <th>{cats[at].label}</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, last, delta }) => {
              const vals = s.values.slice(0, n).map((v) => v ?? 0);
              const lo = Math.min(...vals, 0);
              const hi = Math.max(...vals, 1);
              const pts = vals.map((v, i) => `${(i / (n - 1)) * (W - 8) + 4},${H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8)}`);
              const color = delta === null || delta === 0 || lower === undefined ? theme.muted : delta < 0 === lower ? theme.good : theme.bad;
              return (
                <tr
                  key={s.key}
                  className={`${selectedKey !== null && selectedKey !== s.key ? "is-dim" : ""}${onPick ? " is-click" : ""}`}
                  onClick={() => onPick && matrix.splitDim && onPick(matrix.splitDim, splitType, s.key === "\u0000" ? null : s.key, s.label, s.key)}
                >
                  <th scope="row">{s.label}</th>
                  <td>
                    <svg width={W} height={H} role="img" aria-label={`Trend for ${s.label}`}>
                      <path d={`M${(running ? pts.slice(0, -1) : pts).join("L")}`} fill="none" stroke={theme.accent} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
                      {running && <path d={`M${pts[n - 2]}L${pts[n - 1]}`} fill="none" stroke={theme.accent} strokeWidth={1.8} strokeDasharray="2 3" />}
                      <circle cx={pts[at].split(",")[0]} cy={pts[at].split(",")[1]} r={3} fill={theme.accent} stroke={theme.surface} strokeWidth={1.5} />
                    </svg>
                  </td>
                  <td>
                    <b>{fmtMeasure(last, s.measure, viz.options)}</b>
                  </td>
                  <td style={{ color }}>{delta === null ? "–" : `${delta > 0 ? "▲" : delta < 0 ? "▼" : ""} ${pct(Math.abs(delta), Math.abs(delta) < 0.1 ? 1 : 0)}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="vz-note">
        {at >= 1 ? `Change is ${cats[at].label} against ${cats[at - 1].label}.` : ""}
        {running ? ` ${cats[n - 1].label} is not over yet, so it is drawn dashed and left out of the change.` : ""}
        {matrix.series.length > rows.length ? ` The ${rows.length} largest are shown.` : ""}
      </div>
    </div>
  );
}

// ── Bar race ─────────────────────────────────────────────────────────────

const prefersStill = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Ranked bars for one period at a time, playing through the periods. It starts by itself unless the viewer has asked for less motion. */
export function Race({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const matrix = useMemo(() => shapeMatrix(viz, result, theme, { topN: 0, maxSeries: 24 }), [viz, result, theme]);
  const cats = useMemo(() => matrix.cats.filter((c) => c.raw !== null), [matrix]);
  const n = cats.length;
  const cumulative = !!viz.options?.cumulative;
  const splitType = matrix.splitDim ? fieldInfo(viz, matrix.splitDim.field).type : "text";
  const series = useMemo(() => {
    const kept = matrix.series.filter((s) => !s.other);
    return kept.map((s) => {
      let run = 0;
      return { ...s, shown: s.values.slice(0, n).map((v) => (cumulative ? (run += v ?? 0) : (v ?? 0))) };
    });
  }, [matrix, n, cumulative]);
  const [frame, setFrame] = useState(n - 1);
  const [playing, setPlaying] = useState(false);
  const started = useRef(false);
  const [ref, size] = useSize<HTMLDivElement>();

  // Play once from the start when first shown.
  useEffect(() => {
    if (started.current || n < 2) return;
    started.current = true;
    if (prefersStill()) return;
    setFrame(0);
    setPlaying(true);
  }, [n]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => {
        setFrame((f) => {
          if (f >= n - 1) {
            setPlaying(false);
            return f;
          }
          return f + 1;
        });
      },
      Math.min(Math.max(9000 / Math.max(n, 1), 260), 900),
    );
    return () => clearInterval(timer);
  }, [playing, n]);

  const f = Math.min(frame, n - 1);
  const bars = 10;
  const order = [...series].sort((a, b) => b.shown[f] - a.shown[f]);
  const place = new Map(order.map((s, i) => [s.key, i]));
  const max = Math.max(...series.map((s) => s.shown[f]), 1);
  const rowH = Math.max(Math.min((size.height - 4) / bars, 40), 20);

  if (n < 2) return <div className="vz-empty">A bar race needs at least two periods to play through.</div>;
  return (
    <div className="vz-frame">
      <div className="vz-race__controls no-drag">
        <button
          type="button"
          onClick={() => {
            if (!playing && f >= n - 1) setFrame(0);
            setPlaying((p) => !p);
          }}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <input
          type="range"
          min={0}
          max={n - 1}
          value={f}
          aria-label="Period"
          onChange={(e) => {
            setPlaying(false);
            setFrame(Number(e.target.value));
          }}
        />
        <b style={{ fontFamily: theme.display }}>{cats[f].label}</b>
      </div>
      <div className="vz-race" ref={ref} style={{ height: rowH * bars }}>
        {series.map((s) => {
          const at = place.get(s.key) ?? bars;
          const hidden = at >= bars || s.shown[f] <= 0;
          return (
            <div
              key={s.key}
              className={`vz-race__row${hidden ? " is-out" : ""}${selectedKey !== null && selectedKey !== s.key ? " is-dim" : ""}`}
              style={{ transform: `translateY(${Math.min(at, bars) * rowH}px)`, height: rowH - 4, cursor: onPick ? "pointer" : "default" }}
              onClick={() => onPick && matrix.splitDim && onPick(matrix.splitDim, splitType, s.key === "\u0000" ? null : s.key, s.label, s.key)}
            >
              <span className="vz-race__name">{s.label}</span>
              <span className="vz-race__track">
                <i style={{ width: `${(s.shown[f] / max) * 100}%`, background: s.color, color: inkOn(s.color) }} />
                <b>{fmtCompact(s.shown[f], viz.options)}</b>
              </span>
            </div>
          );
        })}
      </div>
      <div className="vz-note">
        {cumulative ? "Each period shows the running total so far." : "Each period shows that period’s own figure."}
        {series.length > bars ? ` The ${bars} largest in each period are shown.` : ""}
      </div>
    </div>
  );
}
