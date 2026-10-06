import { useMemo, useState } from "react";
import { useSize } from "../../query/shared";
import { clip, dimLabel, dimTick, fmtCompact, fmtMeasure, inkOn, mix, niceScale, pct } from "../format";
import { shapeParts } from "../shape";
import { seriesColor } from "../themes";
import { fieldInfo, isAdditive, measureLabel, valuesOf } from "../types";
import { axisText, barPath, Frame, Legend, Tip, useTip, type ChartProps } from "./kit";

/** The waterfall, the slope chart, the scatter and bubble chart, the heat grid and the leaderboard. */

const keyOf = (v: string | number | null) => (v === null || v === "" ? "\u0000" : String(v));

// ── Waterfall ────────────────────────────────────────────────────────────

export function Waterfall({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const shaped = useMemo(() => shapeParts(viz, result, theme, 12, { keepOrder: true, allowNegative: true }), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const { parts, measure } = shaped;
  const up = theme.palette[0];
  const down = theme.palette[1];
  const sum = theme.dark ? "#8fa3b8" : "#4f5b6e";

  const steps = useMemo(() => {
    let running = 0;
    const out = parts.map((p) => {
      const from = running;
      running += p.value;
      return { ...p, from, to: running, total: false };
    });
    return [...out, { key: "\u0003total", label: "Total", raw: null, value: running, share: 1, color: sum, other: true, from: 0, to: running, total: true }];
  }, [parts, sum]);

  const { width, height } = size;
  const lo = Math.min(0, ...steps.map((s) => Math.min(s.from, s.to)));
  const hi = Math.max(0, ...steps.map((s) => Math.max(s.from, s.to)));
  const scale = niceScale(lo, hi, height < 190 ? 3 : 5);
  const left = Math.min(Math.max(...scale.ticks.map((t) => fmtCompact(t, viz.options).length)) * 6.4 + 12, 90);
  const top = 18;
  const bottom = 26;
  const plotW = Math.max(width - left - 10, 10);
  const plotH = Math.max(height - top - bottom, 10);
  const y = (v: number) => top + plotH - ((v - scale.min) / (scale.max - scale.min || 1)) * plotH;
  const step = plotW / steps.length;
  const band = Math.min(step * 0.7, 60);
  const every = Math.max(Math.ceil((Math.max(...steps.map((s) => dimTick(s.raw, shaped.dim, shaped.type).length), 5) * 6.2 + 8) / step), 1);

  return (
    <Frame
      legend={
        <Legend
          items={[
            { key: "up", label: "Adds", color: up },
            { key: "down", label: "Takes away", color: down },
            { key: "sum", label: "Total", color: sum },
          ].filter((i) => i.key !== "down" || steps.some((s) => !s.total && s.value < 0))}
        />
      }
      note={shaped.note}
    >
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && height > 0 && (
          <svg width={width} height={height} role="img" aria-label="Waterfall chart">
            {scale.ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={width - 10} y1={y(t)} y2={y(t)} stroke={t === 0 ? theme.faint : theme.grid} />
                <text x={left - 8} y={y(t) + 3.5} textAnchor="end" {...axisText(theme)}>
                  {fmtCompact(t, viz.options)}
                </text>
              </g>
            ))}
            {steps.map((s, i) => {
              const x0 = left + step * i + (step - band) / 2;
              const yTop = y(Math.max(s.from, s.to));
              const h = Math.max(Math.abs(y(s.from) - y(s.to)), 1);
              const fill = s.total ? sum : s.value >= 0 ? up : down;
              const label = s.total ? "Total" : s.other ? "Other" : dimTick(s.raw, shaped.dim, shaped.type);
              return (
                <g key={s.key} opacity={selectedKey !== null && selectedKey !== s.key && !s.total ? 0.3 : 1}>
                  {/* The line that carries one step's end to the next step's start. */}
                  {i < steps.length - 1 && <line x1={x0 + band} x2={x0 + step} y1={y(s.to)} y2={y(s.to)} stroke={theme.faint} strokeDasharray="2 3" />}
                  <path
                    d={barPath(x0, yTop, band, h, 3, s.value >= 0 || s.total ? "top" : "bottom")}
                    fill={fill}
                    style={{ cursor: onPick && !s.other ? "pointer" : "default" }}
                    onMouseMove={(e) =>
                      show(
                        e,
                        s.total ? "Total" : s.label,
                        s.total
                          ? [{ color: fill, label: measureLabel(viz, measure), value: fmtMeasure(s.value, measure, viz.options) }]
                          : [
                              { color: fill, label: s.value >= 0 ? "Adds" : "Takes away", value: fmtMeasure(Math.abs(s.value), measure, viz.options) },
                              { label: "Running total", value: fmtMeasure(s.to, measure, viz.options), strong: true },
                            ],
                      )
                    }
                    onMouseLeave={hide}
                    onClick={() => onPick && !s.other && onPick(shaped.dim, shaped.type, s.raw, s.label, s.key)}
                  />
                  {band >= 22 && (
                    <text x={x0 + band / 2} y={yTop - 5} textAnchor="middle" {...axisText(theme, 10.5)} fill={theme.ink} fontWeight={600}>
                      {fmtCompact(s.value, viz.options)}
                    </text>
                  )}
                  {(i % every === 0 || s.total) && (
                    <text x={x0 + band / 2} y={height - 8} textAnchor="middle" {...axisText(theme)} fontWeight={s.total ? 700 : 400} fill={s.total ? theme.ink : theme.muted}>
                      {clip(label, Math.max(step * every - 6, 30))}
                    </text>
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

// ── Slope ────────────────────────────────────────────────────────────────

export function Slope({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const [measureRef, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const measure = valuesOf(viz)[0];
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;
  const colDim = viz.columns[0];
  const colType = fieldInfo(viz, colDim.field).type;

  const shaped = useMemo(() => {
    // The two points compared: the first and last value of an ordered field, or the two largest of an unordered one.
    const colTotals = new Map<string, { raw: string | number | null; total: number }>();
    for (const r of result.rows) {
      if (r.d[1] == null) continue;
      const k = keyOf(r.d[1]);
      const c = colTotals.get(k) ?? { raw: r.d[1], total: 0 };
      c.total += Math.abs(r.m[0] ?? 0);
      colTotals.set(k, c);
    }
    const ordered = !!colDim.grain || colType === "date" || colType === "number";
    const keys = [...colTotals.keys()].sort((a, b) => (ordered ? (colType === "number" && !colDim.grain ? Number(a) - Number(b) : a < b ? -1 : 1) : colTotals.get(b)!.total - colTotals.get(a)!.total));
    if (keys.length < 2) return null;
    const [from, to] = ordered ? [keys[0], keys[keys.length - 1]] : [keys[0], keys[1]];
    const lines = new Map<string, { raw: string | number | null; a: number | null; b: number | null }>();
    for (const r of result.rows) {
      const ck = keyOf(r.d[1] ?? null);
      if (ck !== from && ck !== to) continue;
      const k = keyOf(r.d[0] ?? null);
      const line = lines.get(k) ?? { raw: r.d[0] ?? null, a: null, b: null };
      if (ck === from) line.a = r.m[0];
      else line.b = r.m[0];
      lines.set(k, line);
    }
    // Something with no rows at one end counted nothing there; an average of nothing stays unknown.
    const empty = measure.agg === "count" || measure.agg === "sum" || measure.agg === "distinct" ? 0 : null;
    const all = [...lines.entries()].map(([key, l]) => ({ key, raw: l.raw, label: dimLabel(l.raw, dim, type), a: l.a ?? empty, b: l.b ?? empty })).filter((l) => l.a !== null && l.b !== null) as {
      key: string;
      raw: string | number | null;
      label: string;
      a: number;
      b: number;
    }[];
    all.sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b));
    return {
      from: dimLabel(colTotals.get(from)!.raw, colDim, colType),
      to: dimLabel(colTotals.get(to)!.raw, colDim, colType),
      lines: all.slice(0, 10),
      note:
        [
          all.length > 10 ? `The 10 largest of ${all.length} are shown.` : "",
          keys.length > 2 ? (ordered ? `Compares the first and the last of ${keys.length} points; the ones between are not drawn.` : "Compares the two largest.") : "",
        ]
          .filter(Boolean)
          .join(" ") || null,
    };
  }, [result, dim, type, colDim, colType, measure]);

  const rise = theme.palette[0];
  const fall = theme.palette[1];
  const flat = theme.neutral;
  const { width, height } = size;
  if (!shaped)
    return (
      <Frame>
        <div className="vz-empty">A slope chart needs at least two different values in “From and to”.</div>
      </Frame>
    );
  const values = shaped.lines.flatMap((l) => [l.a, l.b]);
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 1);
  const side = Math.min(Math.max(...shaped.lines.map((l) => l.label.length), 4) * 6.4 + 54, width * 0.36);
  const top = 30;
  const plotH = Math.max(height - top - 12, 10);
  const y = (v: number) => top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  // Labels that would sit on top of each other are nudged apart, keeping their order.
  const spread = (ys: number[]) => {
    const order = ys.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < order.length; i++) if (order[i][0] - order[i - 1][0] < 13) order[i][0] = order[i - 1][0] + 13;
    const overflow = order.length ? Math.max(order[order.length - 1][0] - (top + plotH), 0) : 0;
    const out: number[] = [];
    for (const [v, i] of order) out[i] = v - overflow;
    return out;
  };
  const leftY = spread(shaped.lines.map((l) => y(l.a)));
  const rightY = spread(shaped.lines.map((l) => y(l.b)));
  const active = hover ?? selectedKey;
  const colorOf = (l: { a: number; b: number }) => (l.b > l.a ? rise : l.b < l.a ? fall : flat);

  return (
    <Frame
      legend={
        <Legend
          items={[
            { key: "rise", label: "Rose", color: rise },
            { key: "fall", label: "Fell", color: fall },
          ]}
        />
      }
      note={shaped.note}
    >
      <div className="vz-plot" ref={measureRef}>
        {width > 0 && height > 0 && (
          <svg width={width} height={height} role="img" aria-label={`Slope chart from ${shaped.from} to ${shaped.to}`}>
            <text x={side} y={14} textAnchor="middle" {...axisText(theme, 11.5)} fill={theme.ink} fontWeight={700}>
              {shaped.from}
            </text>
            <text x={width - side} y={14} textAnchor="middle" {...axisText(theme, 11.5)} fill={theme.ink} fontWeight={700}>
              {shaped.to}
            </text>
            <line x1={side} x2={side} y1={top - 6} y2={top + plotH} stroke={theme.grid} />
            <line x1={width - side} x2={width - side} y1={top - 6} y2={top + plotH} stroke={theme.grid} />
            {shaped.lines.map((l, i) => {
              const color = colorOf(l);
              const dimmed = active !== null && active !== l.key;
              return (
                <g
                  key={l.key}
                  opacity={dimmed ? 0.22 : 1}
                  style={{ cursor: onPick ? "pointer" : "default", transition: "opacity .15s" }}
                  onMouseEnter={() => setHover(l.key)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick && onPick(dim, type, l.raw, l.label, l.key)}
                >
                  <line x1={side} x2={width - side} y1={y(l.a)} y2={y(l.b)} stroke="transparent" strokeWidth={12} />
                  <line x1={side} x2={width - side} y1={y(l.a)} y2={y(l.b)} stroke={color} strokeWidth={active === l.key ? 3 : 2} strokeLinecap="round" />
                  <circle cx={side} cy={y(l.a)} r={4} fill={color} stroke={theme.surface} strokeWidth={2} />
                  <circle cx={width - side} cy={y(l.b)} r={4} fill={color} stroke={theme.surface} strokeWidth={2} />
                  <text x={side - 9} y={leftY[i] + 4} textAnchor="end" {...axisText(theme, 11)} fill={theme.ink}>
                    {clip(l.label, side - 50)} <tspan fontWeight={700}>{fmtCompact(l.a, viz.options)}</tspan>
                  </text>
                  <text x={width - side + 9} y={rightY[i] + 4} {...axisText(theme, 11)} fill={theme.ink}>
                    <tspan fontWeight={700}>{fmtCompact(l.b, viz.options)}</tspan> {clip(l.label, side - 50)}
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

// ── Scatter and bubble ───────────────────────────────────────────────────

export function Scatter({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const measures = valuesOf(viz);
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;
  const colorDim = viz.columns[0];
  const colorType = colorDim ? fieldInfo(viz, colorDim.field).type : "text";
  const hasSize = measures.length > 2;

  const shaped = useMemo(() => {
    const groups = new Map<string, { raw: string | number | null; n: number }>();
    const pts = result.rows
      .filter((r) => r.m[0] != null && r.m[1] != null)
      .map((r) => {
        const g = colorDim ? keyOf(r.d[1] ?? null) : "all";
        if (colorDim) groups.set(g, { raw: r.d[1] ?? null, n: (groups.get(g)?.n ?? 0) + 1 });
        return {
          key: `${keyOf(r.d[0] ?? null)}\u0002${g}`,
          pick: keyOf(r.d[0] ?? null),
          raw: r.d[0] ?? null,
          label: dimLabel(r.d[0] ?? null, dim, type),
          group: g,
          x: r.m[0] as number,
          y: r.m[1] as number,
          s: hasSize ? Math.max(r.m[2] ?? 0, 0) : 1,
        };
      });
    const ranked = [...groups.entries()].sort((a, b) => b[1].n - a[1].n);
    const legend = ranked.slice(0, 7).map(([k, g], i) => ({ key: k, label: dimLabel(g.raw, colorDim, colorType), color: seriesColor(theme, i) }));
    if (ranked.length > 7) legend.push({ key: "\u0001other", label: "Other", color: theme.neutral });
    const colors = new Map(legend.map((l) => [l.key, l.color]));
    return { pts, legend, colorOf: (g: string) => (colorDim ? (colors.get(g) ?? theme.neutral) : theme.palette[0]), dropped: result.rows.length - pts.length };
  }, [result, dim, type, colorDim, colorType, hasSize, theme]);

  const { width, height } = size;
  const xs = niceScale(Math.min(...shaped.pts.map((p) => p.x), 0), Math.max(...shaped.pts.map((p) => p.x), 1), width < 360 ? 3 : 5);
  const ys = niceScale(Math.min(...shaped.pts.map((p) => p.y), 0), Math.max(...shaped.pts.map((p) => p.y), 1), height < 200 ? 3 : 5);
  const left = Math.min(Math.max(...ys.ticks.map((t) => fmtCompact(t).length)) * 6.4 + 12, 90);
  const top = 22;
  const bottom = 40;
  const right = 16;
  const plotW = Math.max(width - left - right, 10);
  const plotH = Math.max(height - top - bottom, 10);
  const x = (v: number) => left + ((v - xs.min) / (xs.max - xs.min || 1)) * plotW;
  const y = (v: number) => top + plotH - ((v - ys.min) / (ys.max - ys.min || 1)) * plotH;
  const maxS = Math.max(...shaped.pts.map((p) => p.s), 1);
  // Area, not radius, carries the size — otherwise a value twice as large looks four times as large.
  const radius = (s: number) => (hasSize ? 4 + Math.sqrt(s / maxS) * Math.min(plotH, plotW) * 0.07 : 5);
  // Biggest first, so a small dot is never hidden under a large one.
  const draw = [...shaped.pts].sort((a, b) => b.s - a.s);
  // Names are written beside the most prominent dots first; a name that would run into one already written is left to the hover tip.
  const named = new Map<string, "right" | "left">();
  const taken: [number, number, number, number][] = [];
  for (const p of [...shaped.pts].sort((a, b) => (hasSize ? b.s - a.s : b.y - a.y)).slice(0, 40)) {
    const w = clip(p.label, 110, 10.5).length * 6 + 6;
    const r = radius(p.s);
    // To the dot's right if there is room, else to its left.
    const sides: [number, number, number, number][] = [
      [x(p.x) + r + 2, y(p.y) - 8, x(p.x) + r + 2 + w, y(p.y) + 8],
      [x(p.x) - r - 2 - w, y(p.y) - 8, x(p.x) - r - 2, y(p.y) + 8],
    ];
    const at = sides.findIndex((box) => box[2] <= width - 2 && box[0] >= left && !taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1]));
    if (at < 0) continue;
    taken.push(sides[at]);
    named.set(p.key, at === 0 ? "right" : "left");
  }

  return (
    <Frame
      legend={<Legend items={shaped.legend} />}
      note={
        [
          shaped.dropped > 0 ? `${shaped.dropped} without both figures ${shaped.dropped === 1 ? "is" : "are"} not shown.` : "",
          result.truncated ? "Only the first 1,500 points are drawn." : "",
          hasSize ? `Dot size: ${measureLabel(viz, measures[2])}.` : "",
        ]
          .filter(Boolean)
          .join(" ") || null
      }
    >
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && height > 0 && (
          <svg width={width} height={height} role="img" aria-label="Scatter chart">
            {ys.ticks.map((t) => (
              <g key={`y${t}`}>
                <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke={t === 0 ? theme.faint : theme.grid} />
                <text x={left - 8} y={y(t) + 3.5} textAnchor="end" {...axisText(theme)}>
                  {fmtCompact(t)}
                </text>
              </g>
            ))}
            {xs.ticks.map((t) => (
              <g key={`x${t}`}>
                <line x1={x(t)} x2={x(t)} y1={top} y2={top + plotH} stroke={t === 0 ? theme.faint : theme.grid} />
                <text x={x(t)} y={top + plotH + 15} textAnchor="middle" {...axisText(theme)}>
                  {fmtCompact(t)}
                </text>
              </g>
            ))}
            <text x={0} y={11} {...axisText(theme, 10.5)} fill={theme.faint}>
              ↑ {measureLabel(viz, measures[1])}
            </text>
            <text x={width - right} y={height - 6} textAnchor="end" {...axisText(theme, 10.5)} fill={theme.faint}>
              {measureLabel(viz, measures[0])} →
            </text>
            {draw.map((p) => (
              <circle
                key={p.key}
                cx={x(p.x)}
                cy={y(p.y)}
                r={radius(p.s)}
                fill={shaped.colorOf(p.group)}
                fillOpacity={0.78}
                stroke={theme.surface}
                strokeWidth={1.5}
                opacity={selectedKey !== null && selectedKey !== p.pick ? 0.25 : 1}
                style={{ cursor: onPick ? "pointer" : "default" }}
                onMouseMove={(e) =>
                  show(e, p.label, [
                    { label: measureLabel(viz, measures[0]), value: fmtMeasure(p.x, measures[0], viz.options) },
                    { label: measureLabel(viz, measures[1]), value: fmtMeasure(p.y, measures[1], viz.options) },
                    ...(hasSize ? [{ label: measureLabel(viz, measures[2]), value: fmtMeasure(p.s, measures[2], viz.options) }] : []),
                    ...(colorDim ? [{ color: shaped.colorOf(p.group), label: fieldInfo(viz, colorDim.field).label, value: shaped.legend.find((l) => l.key === p.group)?.label ?? "Other" }] : []),
                  ])
                }
                onMouseLeave={hide}
                onClick={() => onPick && onPick(dim, type, p.raw, p.label, p.pick)}
              />
            ))}
            {draw
              .filter((p) => named.has(p.key))
              .map((p) => (
                <text
                  key={`n${p.key}`}
                  x={named.get(p.key) === "left" ? x(p.x) - radius(p.s) - 4 : x(p.x) + radius(p.s) + 4}
                  y={y(p.y) + 3.5}
                  textAnchor={named.get(p.key) === "left" ? "end" : "start"}
                  {...axisText(theme, 10.5)}
                  fill={theme.ink}
                  pointerEvents="none"
                >
                  {clip(p.label, 110, 10.5)}
                </text>
              ))}
          </svg>
        )}
        <Tip tip={tip} width={width} />
      </div>
    </Frame>
  );
}

// ── Heat grid ────────────────────────────────────────────────────────────

export function Heatmap({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const measure = valuesOf(viz)[0];
  const rowDim = viz.rows[0];
  const rowType = fieldInfo(viz, rowDim.field).type;
  const colDim = viz.columns[0];
  const colType = fieldInfo(viz, colDim.field).type;

  const shaped = useMemo(() => {
    const axis = (index: number, dim: typeof rowDim, type: typeof rowType, max: number) => {
      const totals = new Map<string, { raw: string | number | null; total: number }>();
      for (const r of result.rows) {
        const k = keyOf(r.d[index] ?? null);
        const t = totals.get(k) ?? { raw: r.d[index] ?? null, total: 0 };
        t.total += Math.abs(r.m[0] ?? 0);
        totals.set(k, t);
      }
      const ordered = !!dim.grain || dim.bin !== undefined || type === "date" || type === "number";
      const numeric = dim.bin !== undefined || (type === "number" && !dim.grain);
      let keys = [...totals.keys()].sort((a, b) => (ordered ? (numeric ? Number(a) - Number(b) : a < b ? -1 : 1) : totals.get(b)!.total - totals.get(a)!.total));
      const all = keys.length;
      keys = ordered ? keys.slice(-max) : keys.slice(0, max);
      return { keys, all, ordered, items: keys.map((k) => ({ key: k, raw: totals.get(k)!.raw, label: dimLabel(totals.get(k)!.raw, dim, type), tick: dimTick(totals.get(k)!.raw, dim, type) })) };
    };
    const rows = axis(0, rowDim, rowType, 16);
    const cols = axis(1, colDim, colType, 24);
    const cells = new Map<string, number | null>();
    for (const r of result.rows) cells.set(`${keyOf(r.d[0] ?? null)}\u0002${keyOf(r.d[1] ?? null)}`, r.m[0]);
    const shown = rows.keys.flatMap((rk) => cols.keys.map((ck) => cells.get(`${rk}\u0002${ck}`) ?? 0));
    const notes = [
      rows.all > rows.keys.length ? `${rows.ordered ? "The latest" : "The largest"} ${rows.keys.length} of ${rows.all} rows are shown.` : "",
      cols.all > cols.keys.length ? `${cols.ordered ? "The latest" : "The largest"} ${cols.keys.length} of ${cols.all} columns are shown.` : "",
    ];
    return { rows: rows.items, cols: cols.items, cells, max: Math.max(...shown, 0), note: notes.filter(Boolean).join(" ") || null };
  }, [result, rowDim, rowType, colDim, colType]);

  const { width, height } = size;
  const left = Math.min(Math.max(...shaped.rows.map((r) => r.label.length), 3) * 6.4 + 12, width * 0.32, 200);
  const top = 22;
  const legendH = 24;
  const cw = Math.max((width - left) / Math.max(shaped.cols.length, 1), 4);
  const ch = Math.min(Math.max((height - top - legendH) / Math.max(shaped.rows.length, 1), 14), 44);
  const colEvery = Math.max(Math.ceil((Math.max(...shaped.cols.map((c) => c.tick.length), 2) * 6.2 + 6) / cw), 1);
  // Starts well clear of the panel colour, so the smallest non-zero cell is still visibly a cell.
  const fillOf = (v: number | null) =>
    v ? mix(theme.surface, theme.ramp, 0.14 + 0.86 * Math.sqrt(v / (shaped.max || 1))) : theme.dark ? mix(theme.surface, "#ffffff", 0.04) : mix(theme.surface, "#000000", 0.035);

  return (
    <Frame note={shaped.note}>
      <div
        className="vz-plot vz-plot--scroll"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && shaped.rows.length > 0 && (
          <svg width={width} height={top + shaped.rows.length * ch + legendH} role="img" aria-label="Heat grid">
            {shaped.cols.map((c, ci) =>
              ci % colEvery === 0 ? (
                <text key={c.key} x={left + cw * (ci + 0.5)} y={14} textAnchor="middle" {...axisText(theme)}>
                  {clip(c.tick, cw * colEvery - 4)}
                </text>
              ) : null,
            )}
            {shaped.rows.map((r, ri) => (
              <g key={r.key} opacity={selectedKey !== null && selectedKey !== r.key ? 0.3 : 1}>
                <text x={left - 8} y={top + ch * (ri + 0.5) + 4} textAnchor="end" {...axisText(theme, 11.5)} fill={theme.ink} fontWeight={selectedKey === r.key ? 700 : 500}>
                  {clip(r.label, left - 10, 11.5)}
                </text>
                {shaped.cols.map((c, ci) => {
                  const v = shaped.cells.get(`${r.key}\u0002${c.key}`) ?? null;
                  const fill = fillOf(v);
                  return (
                    <g key={c.key}>
                      <rect
                        x={left + cw * ci + 1}
                        y={top + ch * ri + 1}
                        width={Math.max(cw - 2, 1)}
                        height={ch - 2}
                        rx={3}
                        fill={fill}
                        style={{ cursor: onPick ? "pointer" : "default" }}
                        onMouseMove={(e) =>
                          show(e, `${r.label}, ${c.label}`, [{ color: fill, label: measureLabel(viz, measure), value: fmtMeasure(v ?? (isAdditive(measure) ? 0 : null), measure, viz.options) }])
                        }
                        onMouseLeave={hide}
                        onClick={() => onPick && onPick(rowDim, rowType, r.raw, r.label, r.key)}
                      />
                      {v != null && v !== 0 && cw > 30 && ch > 17 && (
                        <text
                          x={left + cw * (ci + 0.5)}
                          y={top + ch * (ri + 0.5) + 3.5}
                          textAnchor="middle"
                          fontSize={10.5}
                          fontWeight={600}
                          fontFamily="Inter, system-ui, sans-serif"
                          fill={inkOn(fill)}
                          pointerEvents="none"
                        >
                          {fmtCompact(v, viz.options)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
            {/* The key: what the lightest and darkest shade stand for. */}
            <g transform={`translate(${left}, ${top + shaped.rows.length * ch + 9})`}>
              <text x={0} y={9} {...axisText(theme, 10.5)}>
                {measureLabel(viz, measure)}: low
              </text>
              {[0.1, 0.3, 0.5, 0.75, 1].map((t, i) => (
                <rect key={t} x={measureLabel(viz, measure).length * 5.9 + 46 + i * 18} y={0} width={16} height={10} rx={2} fill={fillOf(shaped.max * t * t)} />
              ))}
              <text x={measureLabel(viz, measure).length * 5.9 + 46 + 5 * 18 + 4} y={9} {...axisText(theme, 10.5)}>
                high ({fmtCompact(shaped.max, viz.options)})
              </text>
            </g>
          </svg>
        )}
        <Tip tip={tip} width={width} />
      </div>
    </Frame>
  );
}

// ── Leaderboard ──────────────────────────────────────────────────────────

export function Rank({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const measures = valuesOf(viz);
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;
  const limit = viz.options?.topN && viz.options.topN > 0 ? viz.options.topN : 10;
  const rows = useMemo(() => [...result.rows].sort((a, b) => (b.m[0] ?? -Infinity) - (a.m[0] ?? -Infinity)), [result]);
  const shown = rows.slice(0, limit);
  const max = Math.max(...shown.map((r) => Math.abs(r.m[0] ?? 0)), 1);
  const total = isAdditive(measures[0]) ? rows.reduce((s, r) => s + (r.m[0] ?? 0), 0) : 0;

  return (
    <div className="vz-frame">
      <ol className="vz-rank">
        <li className="vz-rank__head" aria-hidden>
          <span />
          <span />
          <span>{measureLabel(viz, measures[0])}</span>
          {measures[1] && <span>{measureLabel(viz, measures[1])}</span>}
        </li>
        {shown.map((r, i) => {
          const key = keyOf(r.d[0] ?? null);
          const label = dimLabel(r.d[0] ?? null, dim, type);
          const v = r.m[0];
          return (
            <li
              key={key}
              className={`${selectedKey !== null && selectedKey !== key ? "is-dim" : ""}${onPick ? " is-click" : ""}`}
              onClick={() => onPick && onPick(dim, type, r.d[0] ?? null, label, key)}
              title={total && v != null ? `${pct(v / total, 1)} of the total` : undefined}
            >
              <span className="vz-rank__n">{i + 1}</span>
              <span className="vz-rank__name">
                <span>{label}</span>
                <i>
                  <i style={{ width: `${(Math.abs(v ?? 0) / max) * 100}%`, background: i === 0 ? theme.accent : mix(theme.accent, theme.surface, 0.45) }} />
                </i>
              </span>
              <b>{fmtMeasure(v, measures[0], viz.options)}</b>
              {measures[1] && <em>{fmtMeasure(r.m[1], measures[1], viz.options)}</em>}
            </li>
          );
        })}
      </ol>
      {rows.length > shown.length && (
        <div className="vz-note">
          The top {shown.length} of {rows.length.toLocaleString()}
          {result.truncated ? "+" : ""} are shown.
        </div>
      )}
    </div>
  );
}
