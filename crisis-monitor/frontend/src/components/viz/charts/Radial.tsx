import { useMemo, useState } from "react";
import { hierarchy, partition } from "d3-hierarchy";
import { useSize } from "../../query/shared";
import { clip, dimLabel, fmtCompact, fmtMeasure, mix, niceScale, pct } from "../format";
import { shapeMatrix, shapeParts } from "../shape";
import { seriesColor } from "../themes";
import { fieldInfo, measureLabel, valuesOf } from "../types";
import { arc, PartList } from "./Parts";
import { axisText, Frame, Legend, Tip, useTip, type ChartProps } from "./kit";

/** Visuals drawn round a centre: the rose, radial bars, the sunburst, the radar, the progress ring and the hemicycle. */

const TAU = Math.PI * 2;
const polar = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

// ── Rose (polar area) ────────────────────────────────────────────────────

/** Equal slices; the figure sets how far each reaches. Area carries the value, so the radius grows with its square root. */
export function Rose({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const shaped = useMemo(() => shapeParts(viz, result, theme, 12, { keepOrder: true }), [viz, result, theme]);
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const { parts, measure } = shaped;
  const wide = size.width > size.height * 1.35 && size.width > 320;
  const d = Math.max(Math.min(wide ? size.height : size.height * 0.64, wide ? size.width * 0.5 : size.width, 320), 80);
  const R = d / 2 - 6;
  const max = Math.max(...parts.map((p) => p.value), 1);
  const step = TAU / Math.max(parts.length, 1);
  const active = hover ?? selectedKey;
  // More petals than there are colours: one colour, since the names are in the list beside it.
  const colorOf = (i: number) => (parts.length > theme.palette.length ? theme.palette[0] : parts[i].color);

  return (
    <Frame note={shaped.note}>
      <div className={`vz-donut${wide ? " is-wide" : ""}`} ref={ref}>
        {size.width > 0 && parts.length > 0 && (
          <>
            <svg width={d} height={d} role="img" aria-label="Rose chart" style={{ flexShrink: 0 }}>
              {[0.25, 0.5, 0.75, 1].map((t) => (
                <circle key={t} cx={d / 2} cy={d / 2} r={R * Math.sqrt(t)} fill="none" stroke={theme.grid} />
              ))}
              {parts.map((p, i) => (
                <path
                  key={p.key}
                  d={arc(d / 2, d / 2, 0, Math.max(R * Math.sqrt(p.value / max), 3), i * step + 0.012, (i + 1) * step - 0.012)}
                  fill={colorOf(i)}
                  opacity={active !== null && active !== p.key ? 0.3 : 0.92}
                  style={{ cursor: onPick && !p.other ? "pointer" : "default", transition: "opacity .15s" }}
                  onMouseEnter={() => setHover(p.key)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick && !p.other && onPick(shaped.dim, shaped.type, p.raw, p.label, p.key)}
                />
              ))}
            </svg>
            <PartList
              parts={parts.map((p, i) => ({ ...p, color: colorOf(i) }))}
              hover={hover}
              selectedKey={selectedKey}
              onHover={setHover}
              format={(n) => fmtMeasure(n, measure, viz.options)}
              onClick={onPick ? (p) => onPick(shaped.dim, shaped.type, p.raw, p.label, p.key) : undefined}
            />
          </>
        )}
      </div>
    </Frame>
  );
}

// ── Radial bars ──────────────────────────────────────────────────────────

export function RadialBar({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const shaped = useMemo(() => shapeParts(viz, result, theme, 8), [viz, result, theme]);
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const { parts, measure } = shaped;
  const d = Math.max(Math.min(size.width, size.height, 420), 80);
  const cx = size.width / 2;
  const cy = d / 2;
  const outer = d / 2 - 4;
  const inner = outer * 0.24;
  const band = (outer - inner) / Math.max(parts.length, 1);
  const thick = Math.max(Math.min(band - 3, 18), 3);
  const max = Math.max(...parts.map((p) => p.value), 1);
  // Three quarters of a turn at most, leaving the top-left quarter for the names.
  const sweep = TAU * 0.75;
  const active = hover ?? selectedKey;
  const ring = (r: number, a0: number, a1: number) => {
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a1);
    return `M${x0},${y0}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
  };

  return (
    <Frame note={shaped.note}>
      <div className="vz-plot" ref={ref}>
        {size.width > 0 && parts.length > 0 && (
          <svg width={size.width} height={d} role="img" aria-label="Radial bar chart">
            {parts.map((p, i) => {
              const r = outer - band * i - band / 2;
              const frac = Math.max(p.value / max, 0.004);
              return (
                <g
                  key={p.key}
                  opacity={active !== null && active !== p.key ? 0.3 : 1}
                  style={{ cursor: onPick && !p.other ? "pointer" : "default", transition: "opacity .15s" }}
                  onMouseEnter={() => setHover(p.key)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick && !p.other && onPick(shaped.dim, shaped.type, p.raw, p.label, p.key)}
                >
                  <path d={ring(r, 0, sweep)} fill="none" stroke={theme.grid} strokeWidth={thick} strokeLinecap="round" />
                  <path d={ring(r, 0, sweep * frac)} fill="none" stroke={p.color} strokeWidth={thick} strokeLinecap="round" />
                  <text x={cx - 8} y={cy - r + 4} textAnchor="end" {...axisText(theme, Math.min(Math.max(band * 0.62, 9.5), 12))} fill={theme.ink}>
                    {clip(p.label, cx - 14, 11)} <tspan fontWeight={700}>{fmtCompact(p.value, viz.options)}</tspan>
                  </text>
                </g>
              );
            })}
            <text x={cx} y={cy + 4} textAnchor="middle" {...axisText(theme, 10.5)}>
              {clip(measureLabel(viz, measure), inner * 2.4, 10.5)}
            </text>
          </svg>
        )}
      </div>
    </Frame>
  );
}

// ── Sunburst ─────────────────────────────────────────────────────────────

interface Arc {
  key: string;
  label: string;
  raw: string | number | null;
  groupKey: string;
  groupLabel: string;
  value: number;
  color: string;
  depth: number;
  a0: number;
  a1: number;
}

export function Sunburst({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const measure = valuesOf(viz)[0];
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;
  const nested = viz.rows.length > 1;

  const data = useMemo(() => {
    const groups = new Map<string, { raw: string | number | null; total: number; leaves: Map<string, { raw: string | number | null; value: number }> }>();
    for (const r of result.rows) {
      const v = r.m[0] ?? 0;
      if (v <= 0) continue;
      const k = r.d[0] === null ? "\u0000" : String(r.d[0]);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { raw: r.d[0] ?? null, total: 0, leaves: new Map() }));
      g.total += v;
      if (nested) g.leaves.set(String(r.d[1] ?? "\u0000"), { raw: r.d[1] ?? null, value: v });
    }
    const ranked = [...groups.entries()].sort((a, b) => b[1].total - a[1].total);
    const kept = ranked.slice(0, 8);
    const inner = nested ? viz.rows[1] : null;
    const innerType = inner ? fieldInfo(viz, inner.field).type : "text";
    const tree = {
      children: kept.map(([k, g], gi) => ({
        key: k,
        label: dimLabel(g.raw, dim, type),
        raw: g.raw,
        color: seriesColor(theme, gi),
        value: nested ? 0 : g.total,
        children: nested
          ? [...g.leaves.values()]
              .sort((a, b) => b.value - a.value)
              .slice(0, 14)
              .map((l, li) => ({
                key: `${k}\u0002${l.raw ?? ""}`,
                label: dimLabel(l.raw, inner!, innerType),
                raw: g.raw,
                value: l.value,
                color: mix(seriesColor(theme, gi), theme.surface, Math.min(0.12 + li * 0.06, 0.6)),
              }))
          : undefined,
      })),
    };
    type Node = { key?: string; label?: string; raw?: string | number | null; color?: string; value?: number; children?: Node[] };
    const root = hierarchy<Node>(tree as Node).sum((n) => (n.children ? 0 : (n.value ?? 0)));
    partition<Node>().size([TAU, root.height + 1])(root);
    const arcs: Arc[] = [];
    for (const n of root.descendants()) {
      if (n.depth === 0) continue;
      const p = n as typeof n & { x0: number; x1: number };
      const group = n.depth === 1 ? n : n.parent!;
      arcs.push({
        key: n.data.key!,
        label: n.data.label!,
        raw: n.data.raw ?? null,
        groupKey: group.data.key!,
        groupLabel: group.data.label!,
        value: n.value ?? 0,
        color: n.data.color!,
        depth: n.depth,
        a0: p.x0,
        a1: p.x1,
      });
    }
    const total = kept.reduce((s, [, g]) => s + g.total, 0);
    return {
      arcs,
      total,
      levels: root.height,
      note: ranked.length > 8 ? `The 8 largest of ${ranked.length} groups are shown.` : null,
      groups: kept.map(([k, g], gi) => ({ key: k, label: dimLabel(g.raw, dim, type), raw: g.raw, value: g.total, share: total ? g.total / total : 0, color: seriesColor(theme, gi) })),
    };
  }, [viz, result, theme, nested, dim, type]);

  const wide = size.width > size.height * 1.4 && size.width > 360;
  const d = Math.max(Math.min(wide ? size.height : size.height * 0.66, wide ? size.width * 0.52 : size.width, 380), 80);
  const R = d / 2 - 4;
  const hole = R * 0.26;
  const ringW = (R - hole) / Math.max(data.levels, 1);

  return (
    <Frame note={data.note}>
      <div
        className={`vz-donut${wide ? " is-wide" : ""}`}
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
        style={{ position: "relative" }}
      >
        {size.width > 0 && data.arcs.length > 0 && (
          <>
            <svg width={d} height={d} role="img" aria-label="Sunburst chart" style={{ flexShrink: 0 }}>
              {data.arcs.map((a) => (
                <path
                  key={a.key}
                  d={arc(d / 2, d / 2, hole + ringW * (a.depth - 1) + 1, hole + ringW * a.depth - 1, a.a0 + 0.006, Math.max(a.a1 - 0.006, a.a0 + 0.008))}
                  fill={a.color}
                  opacity={selectedKey !== null && selectedKey !== a.groupKey ? 0.3 : 1}
                  style={{ cursor: onPick ? "pointer" : "default" }}
                  onMouseMove={(e) =>
                    show(e, a.depth === 1 ? a.label : `${a.groupLabel} › ${a.label}`, [
                      { color: a.color, label: measureLabel(viz, measure), value: fmtMeasure(a.value, measure, viz.options), extra: pct(data.total ? a.value / data.total : 0, 1) },
                    ])
                  }
                  onMouseLeave={hide}
                  onClick={() => onPick && onPick(dim, type, a.raw, a.groupLabel, a.groupKey)}
                />
              ))}
              <text x={d / 2} y={d / 2 + 5} textAnchor="middle" fill={theme.ink} fontFamily={theme.display} fontWeight={700} fontSize={Math.max(Math.min(hole * 0.5, 22), 11)}>
                {fmtCompact(data.total, viz.options)}
              </text>
            </svg>
            <PartList
              parts={data.groups}
              hover={null}
              selectedKey={selectedKey}
              onHover={() => {}}
              format={(n) => fmtMeasure(n, measure, viz.options)}
              onClick={onPick ? (p) => onPick(dim, type, p.raw, p.label, p.key) : undefined}
            />
          </>
        )}
        <Tip tip={tip} width={size.width} />
      </div>
    </Frame>
  );
}

// ── Radar ────────────────────────────────────────────────────────────────

export function Radar({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const matrix = useMemo(() => shapeMatrix({ ...viz, options: { ...viz.options, topN: viz.options?.topN ?? 10 } }, result, theme, { topN: 10 }), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const { cats } = matrix;
  const series = matrix.series.slice(0, 5);
  const n = cats.length;
  const { width, height } = size;
  const R = Math.max(Math.min(width / 2 - 70, height / 2 - 22), 30);
  const cx = width / 2;
  const cy = height / 2;
  const max = Math.max(...series.flatMap((s) => s.values.map((v) => v ?? 0)), 1);
  const scale = niceScale(0, max, 4);
  const at = (i: number, v: number) => polar(cx, cy, (R * Math.max(v, 0)) / scale.max, (i / n) * TAU);

  if (n < 3)
    return (
      <Frame>
        <div className="vz-empty">A radar needs at least three spokes; this field has {n}.</div>
      </Frame>
    );
  return (
    <Frame legend={<Legend items={series} />} note={[matrix.note, matrix.series.length > 5 ? "The five largest shapes are shown." : ""].filter(Boolean).join(" ") || null}>
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && height > 0 && (
          <svg width={width} height={height} role="img" aria-label="Radar chart">
            {scale.ticks.slice(1).map((t) => (
              <g key={t}>
                <polygon points={cats.map((_, i) => at(i, t).join(",")).join(" ")} fill="none" stroke={theme.grid} />
                <text x={cx + 3} y={cy - (R * t) / scale.max - 2} {...axisText(theme, 9.5)} fill={theme.faint}>
                  {fmtCompact(t, viz.options)}
                </text>
              </g>
            ))}
            {cats.map((c, i) => {
              const [x, y] = polar(cx, cy, R, (i / n) * TAU);
              const [lx, ly] = polar(cx, cy, R + 10, (i / n) * TAU);
              const side = Math.abs(lx - cx) < 4 ? "middle" : lx > cx ? "start" : "end";
              return (
                <g key={c.key} opacity={selectedKey !== null && selectedKey !== c.key ? 0.4 : 1}>
                  <line x1={cx} y1={cy} x2={x} y2={y} stroke={theme.grid} />
                  <text
                    x={lx}
                    y={ly + (ly > cy + 4 ? 9 : ly < cy - 4 ? -2 : 4)}
                    textAnchor={side}
                    {...axisText(theme, 11)}
                    fill={theme.ink}
                    fontWeight={selectedKey === c.key ? 700 : 500}
                    style={{ cursor: onPick && !c.other ? "pointer" : "default" }}
                    onClick={() => onPick && !c.other && onPick(matrix.catDim, matrix.catType, c.raw, c.label, c.key)}
                  >
                    {clip(c.label, 64 + (side === "middle" ? 60 : 0))}
                  </text>
                </g>
              );
            })}
            {series.map((s) => (
              <g key={s.key}>
                <polygon points={cats.map((_, i) => at(i, s.values[i] ?? 0).join(",")).join(" ")} fill={s.color} fillOpacity={0.14} stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                {cats.map((c, i) => {
                  const [x, y] = at(i, s.values[i] ?? 0);
                  return (
                    <circle
                      key={c.key}
                      cx={x}
                      cy={y}
                      r={4}
                      fill={s.color}
                      stroke={theme.surface}
                      strokeWidth={2}
                      onMouseMove={(e) =>
                        show(
                          e,
                          c.label,
                          series.map((o) => ({ color: o.color, label: o.label, value: fmtMeasure(o.values[i], o.measure, viz.options) })),
                        )
                      }
                      onMouseLeave={hide}
                    />
                  );
                })}
              </g>
            ))}
          </svg>
        )}
        <Tip tip={tip} width={width} />
      </div>
    </Frame>
  );
}

// ── Progress ring ────────────────────────────────────────────────────────

export function Ring({ viz, result, theme }: ChartProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const measure = valuesOf(viz)[0];
  const value = result.rows[0]?.m[0] ?? null;
  const target = viz.options?.target && viz.options.target > 0 ? viz.options.target : null;
  const top = target ?? (viz.options?.max && viz.options.max > 0 ? viz.options.max : null);
  const frac = top && value !== null ? Math.min(Math.max(value / top, 0), 1) : 0;
  const d = Math.max(Math.min(size.width - 8, size.height - 44, 260), 60);
  const r = d / 2 - Math.max(d * 0.07, 6);
  const thick = Math.max(d * 0.1, 8);
  const cx = size.width / 2;
  const cy = d / 2;
  const [ex, ey] = polar(cx, cy, r, TAU * Math.min(frac, 0.9999));
  const shown = top ? pct(value !== null ? value / top : 0) : value !== null && Math.abs(value) >= 100_000 ? fmtCompact(value, viz.options) : fmtMeasure(value, measure, viz.options);

  return (
    <div className="vz-gauge" ref={ref}>
      {size.width > 0 && (
        <svg width={size.width} height={d} role="img" aria-label={`Progress ring: ${shown}`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={theme.grid} strokeWidth={thick} />
          {frac > 0 && <path d={`M${cx},${cy - r}A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${ex},${ey}`} fill="none" stroke={theme.accent} strokeWidth={thick} strokeLinecap="round" />}
          <text
            x={cx}
            y={cy + r * 0.14}
            textAnchor="middle"
            fill={theme.ink}
            fontFamily={theme.display}
            fontWeight={700}
            fontSize={Math.max(Math.min(r * 0.5, ((r - thick) * 1.7) / (shown.length * 0.6)), 14)}
          >
            {shown}
          </text>
        </svg>
      )}
      <div className="vz-gauge__label">
        <b>{measureLabel(viz, measure)}</b>
        <span>{top ? `${fmtMeasure(value, measure, viz.options)} of ${fmtMeasure(top, measure, viz.options)}` : "Set a target in the settings to show progress towards it."}</span>
      </div>
    </div>
  );
}

// ── Hemicycle ────────────────────────────────────────────────────────────

/** Dots in rows of a half circle. The whole is rounded to at most a few hundred dots, shared out so they always add up. */
export function Parliament({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const shaped = useMemo(() => shapeParts(viz, result, theme, 8), [viz, result, theme]);
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const { parts, total, measure } = shaped;
  const wide = size.width > size.height * 2.1 && size.width > 420;
  const w = Math.max(Math.min(wide ? size.width * 0.58 : size.width, (wide ? size.height : size.height * 0.6) * 2, 560), 120);
  const h = w / 2 + 6;

  const layout = useMemo(() => {
    const seats = Math.max(Math.min(Math.round(total), 240), parts.length);
    // Largest-remainder rounding, so the dots add up to exactly `seats`.
    const exact = parts.map((p) => p.share * seats);
    const counts = exact.map(Math.floor);
    let left = seats - counts.reduce((a, b) => a + b, 0);
    for (const [, i] of exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0])) {
      if (left-- <= 0) break;
      counts[i]++;
    }
    // Rows from the outside in; each row holds as many dots as fit its length.
    const rows = seats > 150 ? 7 : seats > 80 ? 6 : seats > 40 ? 5 : seats > 16 ? 4 : seats > 8 ? 3 : 2;
    const R = w / 2 - 6;
    const r0 = R * 0.38;
    const gap = (R - r0) / rows;
    const radii = Array.from({ length: rows }, (_, i) => R - gap * (i + 0.5));
    const lengths = radii.map((r) => Math.PI * r);
    const sum = lengths.reduce((a, b) => a + b, 0);
    const perRow = lengths.map((l) => Math.floor((l / sum) * seats));
    let spare = seats - perRow.reduce((a, b) => a + b, 0);
    for (let i = 0; spare > 0; i = (i + 1) % rows, spare--) perRow[i]++;
    const dots: { x: number; y: number; angle: number; r: number }[] = [];
    radii.forEach((r, ri) => {
      for (let k = 0; k < perRow[ri]; k++) {
        const angle = perRow[ri] === 1 ? Math.PI / 2 : (k / (perRow[ri] - 1)) * Math.PI;
        dots.push({ x: w / 2 - r * Math.cos(angle), y: h - 4 - r * Math.sin(angle), angle, r });
      }
    });
    // Sweeping left to right hands each group a wedge, the way a chamber is seated.
    dots.sort((a, b) => a.angle - b.angle || b.r - a.r);
    const owners = counts.flatMap((c, i) => Array.from({ length: c }, () => i));
    const size = Math.max(Math.min(gap * 0.42, (Math.PI * radii[radii.length - 1]) / Math.max(perRow[perRow.length - 1], 1) / 2.3), 2);
    return { dots: dots.map((d, i) => ({ ...d, part: parts[owners[i] ?? parts.length - 1] })), size, seats };
  }, [parts, total, w, h]);
  const active = hover ?? selectedKey;
  const each = total / layout.seats;

  return (
    <Frame note={[shaped.note, each > 1.0001 ? `Each dot stands for about ${fmtCompact(each)}.` : ""].filter(Boolean).join(" ") || null}>
      <div className={`vz-donut${wide ? " is-wide" : ""}`} ref={ref}>
        {size.width > 0 && parts.length > 0 && (
          <>
            <svg width={w} height={h} role="img" aria-label="Hemicycle chart" style={{ flexShrink: 0 }}>
              {layout.dots.map((d, i) => (
                <circle
                  key={i}
                  cx={d.x}
                  cy={d.y}
                  r={layout.size}
                  fill={d.part.color}
                  opacity={active !== null && active !== d.part.key ? 0.25 : 1}
                  style={{ cursor: onPick && !d.part.other ? "pointer" : "default", transition: "opacity .15s" }}
                  onMouseEnter={() => setHover(d.part.key)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick && !d.part.other && onPick(shaped.dim, shaped.type, d.part.raw, d.part.label, d.part.key)}
                />
              ))}
              <text x={w / 2} y={h - 8} textAnchor="middle" fill={theme.ink} fontFamily={theme.display} fontWeight={700} fontSize={Math.max(Math.min(w * 0.07, 30), 13)}>
                {fmtCompact(total, viz.options)}
              </text>
            </svg>
            <PartList
              parts={parts}
              hover={hover}
              selectedKey={selectedKey}
              onHover={setHover}
              format={(n) => fmtMeasure(n, measure, viz.options)}
              onClick={onPick ? (p) => onPick(shaped.dim, shaped.type, p.raw, p.label, p.key) : undefined}
            />
          </>
        )}
      </div>
    </Frame>
  );
}
