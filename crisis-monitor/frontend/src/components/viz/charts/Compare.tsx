import { useMemo, useState } from "react";
import { useSize } from "../../query/shared";
import { clip, dimLabel, fmtCompact, fmtMeasure, mix, niceScale, pct } from "../format";
import { shapePair, shapeParts } from "../shape";
import { fieldInfo, measureLabel, measuresOf, valuesOf } from "../types";
import { axisText, barPath, Frame, Legend, Tip, useTip, type ChartProps } from "./kit";
import { wrap } from "./XYChart";

/** Comparing items: the lollipop, dumbbell, butterfly, bullet, Pareto, box plot and progress bars. */

const keyOf = (v: string | number | null) => (v === null || v === "" ? "\u0000" : String(v));

// ── Lollipop ─────────────────────────────────────────────────────────────

export function Lollipop({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const shaped = useMemo(() => shapeParts(viz, result, theme, viz.options?.topN && viz.options.topN > 0 ? viz.options.topN : 15, { allowNegative: true }), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const { parts, measure } = shaped;
  const { width, height } = size;
  const labelW = Math.min(Math.max(...parts.map((p) => p.label.length), 3) * 6.5 + 10, Math.max(width * 0.36, 60), 230);
  const valueW = Math.max(...parts.map((p) => fmtCompact(p.value, viz.options).length), 1) * 6.8 + 16;
  const rowH = Math.min(Math.max(Math.floor((height - 2) / Math.max(parts.length, 1)), 22), 40);
  const lo = Math.min(...parts.map((p) => p.value), 0);
  const hi = Math.max(...parts.map((p) => p.value), 0);
  const x = (v: number) => labelW + ((v - lo) / (hi - lo || 1)) * Math.max(width - labelW - valueW, 20);

  return (
    <Frame note={shaped.note}>
      <div
        className="vz-plot vz-plot--scroll"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && parts.length > 0 && (
          <svg width={width} height={parts.length * rowH} role="img" aria-label="Lollipop chart">
            {parts.map((p, i) => {
              const y = i * rowH + rowH / 2;
              const picked = selectedKey === p.key;
              return (
                <g key={p.key} opacity={selectedKey !== null && !picked ? 0.3 : 1}>
                  {hover === i && <rect x={0} y={i * rowH} width={width} height={rowH} fill={theme.ink} opacity={0.05} rx={4} />}
                  <text x={labelW - 8} y={y + 4} textAnchor="end" {...axisText(theme, 11.5)} fill={theme.ink} fontWeight={picked ? 700 : 500}>
                    {clip(p.label, labelW - 10, 11.5)}
                  </text>
                  <line x1={x(0)} x2={x(p.value)} y1={y} y2={y} stroke={p.other ? theme.neutral : mix(theme.palette[0], theme.surface, 0.45)} strokeWidth={2} strokeLinecap="round" />
                  <circle cx={x(p.value)} cy={y} r={6} fill={p.other ? theme.neutral : theme.palette[0]} stroke={theme.surface} strokeWidth={2} />
                  <text x={x(p.value) + 12} y={y + 4} {...axisText(theme, 11.5)} fill={theme.ink} fontWeight={600}>
                    {fmtCompact(p.value, viz.options)}
                  </text>
                  <rect
                    x={0}
                    y={i * rowH}
                    width={width}
                    height={rowH}
                    fill="transparent"
                    style={{ cursor: onPick && !p.other ? "pointer" : "default" }}
                    onMouseMove={(e) => {
                      setHover(i);
                      show(e, p.label, [
                        {
                          color: theme.palette[0],
                          label: measureLabel(viz, measure),
                          value: fmtMeasure(p.value, measure, viz.options),
                          extra: p.value > 0 && shaped.total > 0 ? pct(p.share, 1) : undefined,
                        },
                      ]);
                    }}
                    onMouseLeave={() => {
                      setHover(null);
                      hide();
                    }}
                    onClick={() => onPick && !p.other && onPick(shaped.dim, shaped.type, p.raw, p.label, p.key)}
                  />
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

// ── Dumbbell ─────────────────────────────────────────────────────────────

export function Dumbbell({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const pair = useMemo(() => shapePair(viz, result, 16), [viz, result]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const measure = valuesOf(viz)[0];
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;
  const { width, height } = size;
  const colorA = theme.palette[1];
  const colorB = theme.palette[0];
  if (!pair)
    return (
      <Frame>
        <div className="vz-empty">A dumbbell needs two different values in “Two groups”.</div>
      </Frame>
    );
  const rows = pair.rows;
  const values = rows.flatMap((r) => [r.a ?? 0, r.b ?? 0]);
  const scale = niceScale(Math.min(...values, 0), Math.max(...values, 1), width < 380 ? 3 : 5);
  const labelW = Math.min(Math.max(...rows.map((r) => r.label.length), 3) * 6.5 + 10, Math.max(width * 0.34, 60), 220);
  const top = 20;
  const rowH = Math.min(Math.max(Math.floor((height - top - 4) / Math.max(rows.length, 1)), 22), 40);
  const x = (v: number) => labelW + 10 + ((v - scale.min) / (scale.max - scale.min || 1)) * Math.max(width - labelW - 40, 20);

  return (
    <Frame
      legend={
        <Legend
          items={[
            { key: "a", label: pair.from, color: colorA },
            { key: "b", label: pair.to, color: colorB },
          ]}
        />
      }
      note={pair.note}
    >
      <div
        className="vz-plot vz-plot--scroll"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && (
          <svg width={width} height={top + rows.length * rowH} role="img" aria-label={`Dumbbell chart comparing ${pair.from} and ${pair.to}`}>
            {scale.ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={top - 4} y2={top + rows.length * rowH} stroke={t === 0 ? theme.faint : theme.grid} />
                <text x={x(t)} y={10} textAnchor="middle" {...axisText(theme, 10.5)}>
                  {fmtCompact(t, viz.options)}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const y = top + i * rowH + rowH / 2;
              return (
                <g
                  key={r.key}
                  opacity={selectedKey !== null && selectedKey !== r.key ? 0.3 : 1}
                  style={{ cursor: onPick ? "pointer" : "default" }}
                  onMouseMove={(e) =>
                    show(e, r.label, [
                      { color: colorA, label: pair.from, value: fmtMeasure(r.a, measure, viz.options) },
                      { color: colorB, label: pair.to, value: fmtMeasure(r.b, measure, viz.options) },
                      ...(r.a !== null && r.b !== null ? [{ label: "Gap", value: fmtMeasure(r.b - r.a, measure, viz.options), strong: true }] : []),
                    ])
                  }
                  onMouseLeave={hide}
                  onClick={() => onPick && onPick(dim, type, r.raw, r.label, r.key)}
                >
                  <rect x={0} y={top + i * rowH} width={width} height={rowH} fill="transparent" />
                  <text x={labelW - 2} y={y + 4} textAnchor="end" {...axisText(theme, 11.5)} fill={theme.ink} fontWeight={selectedKey === r.key ? 700 : 500}>
                    {clip(r.label, labelW - 6, 11.5)}
                  </text>
                  {r.a !== null && r.b !== null && <line x1={x(r.a)} x2={x(r.b)} y1={y} y2={y} stroke={theme.neutral} strokeWidth={3} strokeLinecap="round" />}
                  {r.a !== null && <circle cx={x(r.a)} cy={y} r={6} fill={colorA} stroke={theme.surface} strokeWidth={2} />}
                  {r.b !== null && <circle cx={x(r.b)} cy={y} r={6} fill={colorB} stroke={theme.surface} strokeWidth={2} />}
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

// ── Butterfly (population pyramid) ───────────────────────────────────────

export function Butterfly({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const pair = useMemo(() => shapePair(viz, result, 24, { keepOrder: true }), [viz, result]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const measure = valuesOf(viz)[0];
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;
  const { width, height } = size;
  const colorA = theme.palette[0];
  const colorB = theme.palette[1];
  if (!pair)
    return (
      <Frame>
        <div className="vz-empty">A butterfly needs two different values in “Two sides”.</div>
      </Frame>
    );
  const rows = pair.rows;
  const max = Math.max(...rows.flatMap((r) => [r.a ?? 0, r.b ?? 0]), 1);
  const mid = Math.min(Math.max(...rows.map((r) => r.label.length), 3) * 6.4 + 16, width * 0.3, 190);
  const valueW = fmtCompact(max, viz.options).length * 6.8 + 10;
  const half = Math.max((width - mid) / 2 - valueW, 10);
  const top = 22;
  const rowH = Math.min(Math.max(Math.floor((height - top - 2) / Math.max(rows.length, 1)), 18), 34);
  const thick = Math.min(rowH - 6, 20);
  const cxL = width / 2 - mid / 2;
  const cxR = width / 2 + mid / 2;

  return (
    <Frame note={pair.note}>
      <div
        className="vz-plot vz-plot--scroll"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && (
          <svg width={width} height={top + rows.length * rowH} role="img" aria-label={`Butterfly chart: ${pair.from} against ${pair.to}`}>
            <text x={cxL} y={13} textAnchor="end" {...axisText(theme, 11.5)} fill={colorA} fontWeight={700}>
              {clip(pair.from, cxL - 4, 11.5)}
            </text>
            <text x={cxR} y={13} {...axisText(theme, 11.5)} fill={colorB} fontWeight={700}>
              {clip(pair.to, width - cxR - 4, 11.5)}
            </text>
            {rows.map((r, i) => {
              const y = top + i * rowH + (rowH - thick) / 2;
              const wa = ((r.a ?? 0) / max) * half;
              const wb = ((r.b ?? 0) / max) * half;
              return (
                <g
                  key={r.key}
                  opacity={selectedKey !== null && selectedKey !== r.key ? 0.3 : 1}
                  style={{ cursor: onPick ? "pointer" : "default" }}
                  onMouseMove={(e) =>
                    show(e, r.label, [
                      { color: colorA, label: pair.from, value: fmtMeasure(r.a, measure, viz.options) },
                      { color: colorB, label: pair.to, value: fmtMeasure(r.b, measure, viz.options) },
                    ])
                  }
                  onMouseLeave={hide}
                  onClick={() => onPick && onPick(dim, type, r.raw, r.label, r.key)}
                >
                  <rect x={0} y={top + i * rowH} width={width} height={rowH} fill="transparent" />
                  <text x={width / 2} y={y + thick / 2 + 4} textAnchor="middle" {...axisText(theme, 11)} fill={theme.ink} fontWeight={500}>
                    {clip(r.label, mid - 8)}
                  </text>
                  {wa > 0 && <path d={barPath(cxL - wa, y, wa, thick, 3, "left")} fill={colorA} />}
                  {wb > 0 && <path d={barPath(cxR, y, wb, thick, 3, "right")} fill={colorB} />}
                  <text x={cxL - wa - 5} y={y + thick / 2 + 4} textAnchor="end" {...axisText(theme, 10.5)} fill={theme.ink} fontWeight={600}>
                    {fmtCompact(r.a, viz.options)}
                  </text>
                  <text x={cxR + wb + 5} y={y + thick / 2 + 4} {...axisText(theme, 10.5)} fill={theme.ink} fontWeight={600}>
                    {fmtCompact(r.b, viz.options)}
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

// ── Bullet ───────────────────────────────────────────────────────────────

/** A figure as a bar, a target as a mark across it, on a track that runs a little past whichever is larger. */
export function Bullet({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const measures = valuesOf(viz);
  const dim = viz.rows[0];
  const type = dim ? fieldInfo(viz, dim.field).type : "text";
  const fixed = viz.options?.target && viz.options.target > 0 ? viz.options.target : null;
  const rows = useMemo(
    () =>
      result.rows
        .map((r) => ({
          key: dim ? keyOf(r.d[0] ?? null) : "all",
          raw: dim ? (r.d[0] ?? null) : null,
          label: dim ? dimLabel(r.d[0] ?? null, dim, type) : measureLabel(viz, measures[0]),
          value: r.m[0] ?? 0,
          target: measures[1] ? (r.m[1] ?? null) : fixed,
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 14),
    [result, dim, type, viz, measures, fixed],
  );
  const { width, height } = size;
  const max = niceScale(0, Math.max(...rows.flatMap((r) => [r.value, r.target ?? 0]), 1) * 1.08, 4).max;
  const labelW = dim ? Math.min(Math.max(...rows.map((r) => r.label.length), 3) * 6.5 + 12, width * 0.32, 200) : 0;
  const valueW = Math.max(...rows.map((r) => fmtCompact(r.value, viz.options).length), 2) * 7.4 + 12 + (rows.some((r) => r.target !== null) ? 40 : 0);
  const rowH = Math.min(Math.max(Math.floor(height / Math.max(rows.length, 1)), 26), 58);
  const trackH = Math.min(rowH - 10, 26);
  const x = (v: number) => labelW + (Math.min(Math.max(v, 0), max) / max) * Math.max(width - labelW - valueW, 20);

  return (
    <Frame note={!measures[1] && !fixed ? "Add a second figure, or set a target in the settings, to mark what each bar is measured against." : null}>
      <div className="vz-plot vz-plot--scroll" ref={ref}>
        {width > 0 && (
          <svg width={width} height={rows.length * rowH} role="img" aria-label="Bullet chart">
            {rows.map((r, i) => {
              const y = i * rowH + (rowH - trackH) / 2;
              const met = r.target !== null && r.value >= r.target;
              return (
                <g
                  key={r.key}
                  opacity={selectedKey !== null && selectedKey !== r.key ? 0.3 : 1}
                  style={{ cursor: onPick && dim ? "pointer" : "default" }}
                  onClick={() => onPick && dim && onPick(dim, type, r.raw, r.label, r.key)}
                >
                  <title>{`${r.label}: ${fmtMeasure(r.value, measures[0], viz.options)}${r.target !== null ? ` against ${fmtMeasure(r.target, measures[1] ?? measures[0], viz.options)}` : ""}`}</title>
                  {dim && (
                    <text x={labelW - 8} y={y + trackH / 2 + 4} textAnchor="end" {...axisText(theme, 11.5)} fill={theme.ink} fontWeight={500}>
                      {clip(r.label, labelW - 10, 11.5)}
                    </text>
                  )}
                  <rect x={labelW} y={y} width={x(max) - labelW} height={trackH} rx={3} fill={theme.grid} />
                  <path d={barPath(labelW, y + trackH * 0.28, Math.max(x(r.value) - labelW, 1), trackH * 0.44, 2, "right")} fill={theme.accent} />
                  {r.target !== null && <rect x={x(r.target) - 1.5} y={y - 2} width={3} height={trackH + 4} rx={1} fill={theme.ink} />}
                  <text x={x(max) + 8} y={y + trackH / 2 + 4} {...axisText(theme, 12)} fill={theme.ink} fontWeight={700}>
                    {fmtCompact(r.value, viz.options)}
                    {r.target !== null && (
                      <tspan fontWeight={400} fill={met ? theme.good : theme.muted} fontSize={10.5}>
                        {" "}
                        {pct(r.target ? r.value / r.target : 0)}
                      </tspan>
                    )}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </Frame>
  );
}

// ── Pareto ───────────────────────────────────────────────────────────────

/**
 * Bars in falling order, each as its share of the total, with the running
 * share drawn over them. Both are percentages of the same total, so they
 * share one axis — the usual two-axis Pareto is avoided on purpose.
 */
export function Pareto({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const shaped = useMemo(() => shapeParts(viz, result, theme, 16), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const { parts, measure } = shaped;
  const { width, height } = size;
  let run = 0;
  const steps = parts.map((p) => ({ ...p, cumulative: (run += p.share) }));
  const cross = steps.findIndex((s) => s.cumulative >= 0.8);
  const left = 40;
  const top = 16;
  const bottom = 40;
  const plotW = Math.max(width - left - 12, 10);
  const plotH = Math.max(height - top - bottom, 10);
  const step = plotW / Math.max(steps.length, 1);
  const band = Math.min(step * 0.74, 56);
  const y = (share: number) => top + plotH - share * plotH;
  const cx = (i: number) => left + step * (i + 0.5);
  const lineColor = theme.palette[1];

  return (
    <Frame
      legend={
        <Legend
          items={[
            { key: "bar", label: "Share of the total", color: theme.palette[0] },
            { key: "line", label: "Running share", color: lineColor },
          ]}
        />
      }
      note={[shaped.note, cross >= 0 ? `The first ${cross + 1} of ${steps.length} make up ${pct(steps[cross].cumulative)} of the total.` : ""].filter(Boolean).join(" ") || null}
    >
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && height > 0 && steps.length > 0 && (
          <svg width={width} height={height} role="img" aria-label="Pareto chart">
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
              <g key={t}>
                <line x1={left} x2={width - 12} y1={y(t)} y2={y(t)} stroke={t === 0 ? theme.faint : theme.grid} strokeDasharray={t === 0.8 ? "4 4" : undefined} />
                <text x={left - 8} y={y(t) + 3.5} textAnchor="end" {...axisText(theme)}>
                  {pct(t)}
                </text>
              </g>
            ))}
            {steps.map((s, i) => (
              <g key={s.key} opacity={selectedKey !== null && selectedKey !== s.key ? 0.3 : 1}>
                <path d={barPath(cx(i) - band / 2, y(s.share), band, Math.max(y(0) - y(s.share), 1), 3, "top")} fill={s.other ? theme.neutral : theme.palette[0]} />
                <text x={cx(i)} y={top + plotH + 15} textAnchor="middle" {...axisText(theme)}>
                  {wrap(s.label, Math.max(Math.floor((step - 4) / 6.2), 4)).map((line, li) => (
                    <tspan key={li} x={cx(i)} dy={li === 0 ? 0 : 12}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            ))}
            <path d={`M${steps.map((s, i) => `${cx(i)},${y(s.cumulative)}`).join("L")}`} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" />
            {steps.map((s, i) => (
              <circle key={s.key} cx={cx(i)} cy={y(s.cumulative)} r={4} fill={lineColor} stroke={theme.surface} strokeWidth={2} />
            ))}
            {steps.map((s, i) => (
              <rect
                key={s.key}
                x={left + step * i}
                y={top}
                width={step}
                height={plotH + bottom}
                fill="transparent"
                style={{ cursor: onPick && !s.other ? "pointer" : "default" }}
                onMouseMove={(e) =>
                  show(e, s.label, [
                    { color: theme.palette[0], label: measureLabel(viz, measure), value: fmtMeasure(s.value, measure, viz.options), extra: pct(s.share, 1) },
                    { color: lineColor, label: "Running share", value: pct(s.cumulative, 1) },
                  ])
                }
                onMouseLeave={hide}
                onClick={() => onPick && !s.other && onPick(shaped.dim, shaped.type, s.raw, s.label, s.key)}
              />
            ))}
          </svg>
        )}
        <Tip tip={tip} width={width} />
      </div>
    </Frame>
  );
}

// ── Box plot ─────────────────────────────────────────────────────────────

export function BoxPlot({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const dim = viz.rows[0];
  const type = dim ? fieldInfo(viz, dim.field).type : "text";
  const field = fieldInfo(viz, viz.values[0]?.field).label;
  const m = measuresOf(viz)[0];
  const rows = useMemo(
    () =>
      result.rows
        // min, lower quartile, median, upper quartile, max, how many
        .map((r) => ({
          key: dim ? keyOf(r.d[0] ?? null) : "all",
          raw: dim ? (r.d[0] ?? null) : null,
          label: dim ? dimLabel(r.d[0] ?? null, dim, type) : field,
          min: r.m[0],
          q1: r.m[1],
          med: r.m[2],
          q3: r.m[3],
          max: r.m[4],
          n: r.m[5] ?? 0,
        }))
        .filter((r) => r.med !== null && r.min !== null && r.max !== null)
        .sort((a, b) => (b.med ?? 0) - (a.med ?? 0))
        .slice(0, 16),
    [result, dim, type, field],
  );
  const { width, height } = size;
  const scale = niceScale(Math.min(...rows.map((r) => r.min ?? 0)), Math.max(...rows.map((r) => r.max ?? 1)), width < 380 ? 3 : 5);
  const labelW = Math.min(Math.max(...rows.map((r) => r.label.length), 3) * 6.5 + 12, Math.max(width * 0.3, 60), 200);
  const top = 20;
  const rowH = Math.min(Math.max(Math.floor((height - top - 4) / Math.max(rows.length, 1)), 24), 46);
  const boxH = Math.min(rowH - 10, 22);
  const x = (v: number) => labelW + 6 + ((v - scale.min) / (scale.max - scale.min || 1)) * Math.max(width - labelW - 60, 20);
  const fill = mix(theme.palette[0], theme.surface, 0.55);

  if (rows.length === 0)
    return (
      <Frame>
        <div className="vz-empty">There are no numbers here to show the spread of.</div>
      </Frame>
    );
  return (
    <Frame note="The box holds the middle half of the values; the line in it is the median; the whiskers reach the smallest and largest.">
      <div
        className="vz-plot vz-plot--scroll"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && (
          <svg width={width} height={top + rows.length * rowH} role="img" aria-label="Box plot">
            {scale.ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={top - 4} y2={top + rows.length * rowH} stroke={theme.grid} />
                <text x={x(t)} y={10} textAnchor="middle" {...axisText(theme, 10.5)}>
                  {fmtCompact(t, viz.options)}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const y = top + i * rowH + rowH / 2;
              return (
                <g
                  key={r.key}
                  opacity={selectedKey !== null && selectedKey !== r.key ? 0.3 : 1}
                  style={{ cursor: onPick && dim ? "pointer" : "default" }}
                  onMouseMove={(e) =>
                    show(
                      e,
                      r.label,
                      [
                        { label: "Largest", value: fmtMeasure(r.max, m, viz.options) },
                        { label: "Upper quartile", value: fmtMeasure(r.q3, m, viz.options) },
                        { label: "Median", value: fmtMeasure(r.med, m, viz.options), strong: true },
                        { label: "Lower quartile", value: fmtMeasure(r.q1, m, viz.options) },
                        { label: "Smallest", value: fmtMeasure(r.min, m, viz.options) },
                      ],
                      `${r.n.toLocaleString()} value${r.n === 1 ? "" : "s"}`,
                    )
                  }
                  onMouseLeave={hide}
                  onClick={() => onPick && dim && onPick(dim, type, r.raw, r.label, r.key)}
                >
                  <rect x={0} y={top + i * rowH} width={width} height={rowH} fill="transparent" />
                  <text x={labelW - 4} y={y + 4} textAnchor="end" {...axisText(theme, 11.5)} fill={theme.ink} fontWeight={500}>
                    {clip(r.label, labelW - 8, 11.5)}
                  </text>
                  <line x1={x(r.min!)} x2={x(r.max!)} y1={y} y2={y} stroke={theme.muted} strokeWidth={1.5} />
                  <line x1={x(r.min!)} x2={x(r.min!)} y1={y - boxH / 4} y2={y + boxH / 4} stroke={theme.muted} strokeWidth={1.5} />
                  <line x1={x(r.max!)} x2={x(r.max!)} y1={y - boxH / 4} y2={y + boxH / 4} stroke={theme.muted} strokeWidth={1.5} />
                  <rect
                    x={x(r.q1 ?? r.med!)}
                    y={y - boxH / 2}
                    width={Math.max(x(r.q3 ?? r.med!) - x(r.q1 ?? r.med!), 2)}
                    height={boxH}
                    rx={3}
                    fill={fill}
                    stroke={theme.palette[0]}
                    strokeWidth={1.5}
                  />
                  <line x1={x(r.med!)} x2={x(r.med!)} y1={y - boxH / 2} y2={y + boxH / 2} stroke={theme.ink} strokeWidth={2.5} />
                  <text x={width - 4} y={y + 4} textAnchor="end" {...axisText(theme, 10)} fill={theme.faint}>
                    n={fmtCompact(r.n)}
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

// ── Progress bars ────────────────────────────────────────────────────────

/** Each item's bar fills towards the target when one is set; otherwise it shows the item's share of the total. */
export function Progress({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const shaped = useMemo(() => shapeParts(viz, result, theme, viz.options?.topN && viz.options.topN > 0 ? viz.options.topN : 10), [viz, result, theme]);
  const { parts, measure } = shaped;
  const target = viz.options?.target && viz.options.target > 0 ? viz.options.target : null;
  return (
    <div className="vz-frame">
      <ul className="vz-progress">
        {parts.map((p) => {
          const frac = target ? p.value / target : p.share;
          return (
            <li
              key={p.key}
              className={`${selectedKey !== null && selectedKey !== p.key ? "is-dim" : ""}${onPick && !p.other ? " is-click" : ""}`}
              onClick={() => onPick && !p.other && onPick(shaped.dim, shaped.type, p.raw, p.label, p.key)}
              title={
                target ? `${fmtMeasure(p.value, measure, viz.options)} of ${fmtMeasure(target, measure, viz.options)}` : `${fmtMeasure(p.value, measure, viz.options)}, ${pct(p.share, 1)} of the total`
              }
            >
              <div>
                <span>{p.label}</span>
                <b>{pct(frac, frac < 0.1 ? 1 : 0)}</b>
                <em>{fmtMeasure(p.value, measure, viz.options)}</em>
              </div>
              <i>
                <i style={{ width: `${Math.min(Math.max(frac, 0), 1) * 100}%`, background: target && frac >= 1 ? theme.good : theme.accent }} />
              </i>
            </li>
          );
        })}
      </ul>
      <div className="vz-note">
        {[target ? `Each bar is measured against a target of ${fmtMeasure(target, measure, viz.options)}.` : "Each bar is the item’s share of the total shown.", shaped.note].filter(Boolean).join(" ")}
      </div>
    </div>
  );
}
