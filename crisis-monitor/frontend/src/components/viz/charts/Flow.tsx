import { useMemo, useState } from "react";
import { useSize } from "../../query/shared";
import { clip, clipMid, fmtCompact, fmtMeasure, inkOn, mix, pct } from "../format";
import { shapeFlows, shapeMatrix, shapeParts, type FlowNode } from "../shape";
import { fieldInfo, measureLabel, valuesOf } from "../types";
import { axisText, Frame, Legend, Tip, useTip, type ChartProps } from "./kit";

/** Flows, ties and narrowing stages: the Sankey, chord, network, funnel and Marimekko. */

// ── Sankey ───────────────────────────────────────────────────────────────

export function Sankey({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const flows = useMemo(() => shapeFlows(viz, result, theme, 9), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const [hover, setHover] = useState<string | null>(null);
  const measure = valuesOf(viz)[0];
  const dims = [...viz.rows, ...viz.columns];
  const { width, height } = size;

  const layout = useMemo(() => {
    if (!width || !height) return null;
    const stages = flows.stages;
    const byStage = Array.from({ length: stages }, (_, s) => flows.nodes.filter((n) => n.stage === s));
    const total = Math.max(...byStage.map((ns) => ns.reduce((a, n) => a + n.value, 0)), 1);
    const gap = 8;
    const most = Math.max(...byStage.map((ns) => ns.length), 1);
    const unit = Math.max(height - 8 - gap * (most - 1), 20) / total;
    const nodeW = 12;
    const labelW = Math.min(Math.max(...flows.nodes.map((n) => n.label.length), 4) * 6.3 + 44, width * 0.26, 190);
    const x = (s: number) => (stages === 1 ? width / 2 : labelW + (s / (stages - 1)) * (width - 2 * labelW - nodeW));
    const pos = new Map<string, { x: number; y: number; h: number; out: number; in: number; node: FlowNode }>();
    byStage.forEach((ns, s) => {
      const used = ns.reduce((a, n) => a + n.value * unit, 0) + gap * (ns.length - 1);
      let y = Math.max((height - used) / 2, 2);
      for (const n of ns) {
        pos.set(n.key, { x: x(s), y, h: Math.max(n.value * unit, 1.5), out: 0, in: 0, node: n });
        y += n.value * unit + gap;
      }
    });
    // Links leave and arrive in the order of the nodes at the other end, which keeps crossings down.
    const order = new Map(flows.nodes.map((n, i) => [n.key, i]));
    const links = [...flows.links]
      .sort((a, b) => order.get(a.source)! - order.get(b.source)! || order.get(a.target)! - order.get(b.target)!)
      .map((l) => {
        const s = pos.get(l.source)!;
        const t = pos.get(l.target)!;
        const h = Math.max(l.value * unit, 1);
        const y0 = s.y + s.out + h / 2;
        s.out += l.value * unit;
        return { ...l, h, y0, s, t, y1: 0 };
      });
    for (const l of [...links].sort((a, b) => order.get(a.target)! - order.get(b.target)! || order.get(a.source)! - order.get(b.source)!)) {
      l.y1 = l.t.y + l.t.in + l.h / 2;
      l.t.in += l.value * unit;
    }
    return { pos, links, nodeW, stages };
  }, [flows, width, height]);

  // A flow keeps the colour of where the whole journey began (for three stages, traced back through the middle).
  const originOf = useMemo(() => {
    const first = new Map<string, string>();
    for (const n of flows.nodes) if (n.stage === 0) first.set(n.key, n.color);
    return (key: string) => first.get(key) ?? theme.neutral;
  }, [flows, theme]);

  return (
    <Frame note={flows.note}>
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {layout && flows.nodes.length > 0 && (
          <svg width={width} height={height} role="img" aria-label="Sankey diagram">
            {layout.links.map((l, i) => {
              const x0 = l.s.x + layout.nodeW;
              const x1 = l.t.x;
              const mid = (x0 + x1) / 2;
              const id = `${l.source}>${l.target}`;
              const lit = hover === null || hover === id || hover === l.source || hover === l.target;
              return (
                <path
                  key={i}
                  d={`M${x0},${l.y0}C${mid},${l.y0} ${mid},${l.y1} ${x1},${l.y1}`}
                  fill="none"
                  stroke={l.s.node.stage === 0 ? originOf(l.source) : theme.neutral}
                  strokeWidth={l.h}
                  strokeOpacity={lit ? (hover === id ? 0.7 : 0.38) : 0.08}
                  onMouseMove={(e) => {
                    setHover(id);
                    show(e, `${l.s.node.label} → ${l.t.node.label}`, [
                      { label: measureLabel(viz, measure), value: fmtMeasure(l.value, measure, viz.options), extra: `${pct(l.value / l.s.node.value)} of ${l.s.node.label}` },
                    ]);
                  }}
                  onMouseLeave={() => {
                    setHover(null);
                    hide();
                  }}
                />
              );
            })}
            {[...layout.pos.values()].map(({ x, y, h, node }) => {
              const dim = dims[node.stage];
              const last = node.stage === layout.stages - 1;
              const dimmed = selectedKey !== null && selectedKey !== node.key;
              return (
                <g
                  key={node.key}
                  opacity={dimmed ? 0.35 : 1}
                  style={{ cursor: onPick && !node.other ? "pointer" : "default" }}
                  onMouseEnter={() => setHover(node.key)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick && !node.other && dim && onPick(dim, fieldInfo(viz, dim.field).type, node.raw, node.label, node.key)}
                >
                  <rect x={x} y={y} width={layout.nodeW} height={h} rx={2} fill={node.stage === 0 ? node.color : theme.dark ? "#a9b8c9" : "#3d4758"} />
                  <text
                    x={last ? x + layout.nodeW + 6 : node.stage === 0 ? x - 6 : x + layout.nodeW + 6}
                    y={y + h / 2 + 4}
                    textAnchor={node.stage === 0 ? "end" : "start"}
                    {...axisText(theme, 11)}
                    fill={theme.ink}
                  >
                    {node.stage === 0 ? (
                      <>
                        {clip(node.label, x - 46)} <tspan fontWeight={700}>{fmtCompact(node.value, viz.options)}</tspan>
                      </>
                    ) : (
                      <>
                        <tspan fontWeight={700}>{fmtCompact(node.value, viz.options)}</tspan> {clip(node.label, last ? width - x - 56 : 90)}
                      </>
                    )}
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

// ── Chord and network: the same ties, drawn two ways ─────────────────────

interface Tie {
  a: number;
  b: number;
  value: number;
}

/** The two fields' values as one set of things, and the ties between them (a tie A–B and a tie B–A are one). */
function useTies(viz: ChartProps["viz"], result: ChartProps["result"], theme: ChartProps["theme"], max: number) {
  return useMemo(() => {
    const flows = shapeFlows(viz, result, theme, 400);
    const names = new Map<string, { label: string; raw: string | number | null; value: number; stage: number }>();
    for (const n of flows.nodes) {
      if (n.other) continue;
      const e = names.get(n.label) ?? { label: n.label, raw: n.raw, value: 0, stage: n.stage };
      e.value += n.value;
      names.set(n.label, e);
    }
    const ranked = [...names.values()].sort((a, b) => b.value - a.value);
    const kept = ranked.slice(0, max);
    const index = new Map(kept.map((n, i) => [n.label, i]));
    const labelOf = new Map(flows.nodes.map((n) => [n.key, n.label]));
    const ties = new Map<string, Tie>();
    for (const l of flows.links) {
      const a = index.get(labelOf.get(l.source)!);
      const b = index.get(labelOf.get(l.target)!);
      if (a === undefined || b === undefined) continue;
      const key = a <= b ? `${a}-${b}` : `${b}-${a}`;
      const t = ties.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), value: 0 };
      t.value += l.value;
      ties.set(key, t);
    }
    const nodes = kept.map((n, i) => ({ ...n, color: i < theme.palette.length ? theme.palette[i] : theme.neutral, weight: 0 }));
    for (const t of ties.values()) {
      nodes[t.a].weight += t.value;
      if (t.b !== t.a) nodes[t.b].weight += t.value;
    }
    return { nodes, ties: [...ties.values()].sort((x, y) => y.value - x.value), note: ranked.length > max ? `The ${max} largest of ${ranked.length} are shown.` : null };
  }, [viz, result, theme, max]);
}

const TAU = Math.PI * 2;
const polar = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

export function Chord({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const data = useTies(viz, result, theme, 12);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const measure = valuesOf(viz)[0];
  const { width, height } = size;
  const R = Math.max(Math.min(width / 2 - 86, height / 2 - 18), 30);
  const cx = width / 2;
  const cy = height / 2;
  const inner = R - 10;

  const layout = useMemo(() => {
    const active = data.nodes.filter((n) => n.weight > 0).length;
    const pad = active > 1 ? 0.04 : 0;
    const total = data.nodes.reduce((s, n) => s + n.weight, 0) || 1;
    const k = (TAU - pad * active) / total;
    let a = 0;
    const arcs = data.nodes.map((n) => {
      const a0 = a;
      a += n.weight * k + (n.weight > 0 ? pad : 0);
      return { a0, a1: a0 + n.weight * k, used: a0 };
    });
    // Each tie takes a slice of the arc at both of its ends.
    const ribbons = data.ties.map((t) => {
      const w = t.value * k;
      const s0 = arcs[t.a].used;
      arcs[t.a].used += w;
      const e0 = t.a === t.b ? s0 : arcs[t.b].used;
      if (t.a !== t.b) arcs[t.b].used += w;
      return { ...t, s0, s1: s0 + w, e0, e1: e0 + w };
    });
    return { arcs, ribbons };
  }, [data]);

  const band = (a0: number, a1: number) => {
    const [x0, y0] = polar(cx, cy, R, a0);
    const [x1, y1] = polar(cx, cy, R, a1);
    const [x2, y2] = polar(cx, cy, inner, a1);
    const [x3, y3] = polar(cx, cy, inner, a0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${inner},${inner} 0 ${large} 0 ${x3},${y3}Z`;
  };
  const ribbon = (r: (typeof layout.ribbons)[number]) => {
    const p = (a: number) => polar(cx, cy, inner - 2, a).join(",");
    const rr = inner - 2;
    return `M${p(r.s0)}A${rr},${rr} 0 0 1 ${p(r.s1)}Q${cx},${cy} ${p(r.e0)}A${rr},${rr} 0 0 1 ${p(r.e1)}Q${cx},${cy} ${p(r.s0)}Z`;
  };
  const dim = viz.rows[0];
  const active = hover ?? (selectedKey !== null ? data.nodes.findIndex((n) => n.label === selectedKey) : null);

  return (
    <Frame note={data.note}>
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && height > 0 && data.nodes.length > 0 && (
          <svg width={width} height={height} role="img" aria-label="Chord diagram">
            {layout.ribbons.map((r, i) => (
              <path
                key={i}
                d={ribbon(r)}
                fill={data.nodes[r.a].color}
                fillOpacity={active === null || active === -1 ? 0.5 : active === r.a || active === r.b ? 0.72 : 0.06}
                stroke={theme.surface}
                strokeWidth={0.5}
                onMouseMove={(e) =>
                  show(e, `${data.nodes[r.a].label} and ${data.nodes[r.b].label}`, [
                    { color: data.nodes[r.a].color, label: measureLabel(viz, measure), value: fmtMeasure(r.value, measure, viz.options) },
                  ])
                }
                onMouseLeave={hide}
              />
            ))}
            {data.nodes.map((n, i) => {
              const { a0, a1 } = layout.arcs[i];
              if (n.weight <= 0) return null;
              const mid = (a0 + a1) / 2;
              const [lx, ly] = polar(cx, cy, R + 8, mid);
              const right = mid < Math.PI;
              return (
                <g
                  key={n.label}
                  style={{ cursor: onPick ? "pointer" : "default" }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick && n.stage === 0 && onPick(dim, fieldInfo(viz, dim.field).type, n.raw, n.label, n.label)}
                >
                  <path d={band(a0, Math.max(a1, a0 + 0.004))} fill={n.color} />
                  {a1 - a0 > 0.07 && (
                    <text x={lx} y={ly + 4} textAnchor={right ? "start" : "end"} {...axisText(theme, 11)} fill={theme.ink} fontWeight={active === i ? 700 : 500}>
                      {clip(n.label, 78)}
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

/** The same ties as dots round a ring with lines between them: the heavier the tie, the heavier the line. */
export function Network({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const data = useTies(viz, result, theme, 24);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const measure = valuesOf(viz)[0];
  const { width, height } = size;
  const R = Math.max(Math.min(width / 2 - 96, height / 2 - 40), 30);
  const cx = width / 2;
  const cy = height / 2;
  const n = data.nodes.length;
  const at = (i: number) => polar(cx, cy, R, (i / Math.max(n, 1)) * TAU);
  const maxTie = Math.max(...data.ties.map((t) => t.value), 1);
  const maxNode = Math.max(...data.nodes.map((x) => x.weight), 1);
  const dim = viz.rows[0];
  const sel = selectedKey !== null ? data.nodes.findIndex((x) => x.label === selectedKey) : -1;
  const active = hover ?? (sel >= 0 ? sel : null);
  const tied = new Set<number>();
  if (active !== null)
    for (const t of data.ties)
      if (t.a === active || t.b === active) {
        tied.add(t.a);
        tied.add(t.b);
      }

  return (
    <Frame
      legend={
        <Legend
          items={[
            { key: "a", label: fieldInfo(viz, viz.rows[0].field).label, color: theme.palette[0] },
            { key: "b", label: fieldInfo(viz, viz.columns[0].field).label, color: theme.palette[1] },
          ]}
        />
      }
      note={[data.note, "Dot size is the total of a thing’s ties; line weight is the strength of one tie."].filter(Boolean).join(" ")}
    >
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && height > 0 && n > 0 && (
          <svg width={width} height={height} role="img" aria-label="Network diagram">
            {data.ties
              .filter((t) => t.a !== t.b)
              .map((t, i) => {
                const [x0, y0] = at(t.a);
                const [x1, y1] = at(t.b);
                // Bowed towards the centre, so lines between neighbours do not hide along the ring.
                const mx = (x0 + x1) / 2 + (cx - (x0 + x1) / 2) * 0.45;
                const my = (y0 + y1) / 2 + (cy - (y0 + y1) / 2) * 0.45;
                const lit = active === null || t.a === active || t.b === active;
                return (
                  <path
                    key={i}
                    d={`M${x0},${y0}Q${mx},${my} ${x1},${y1}`}
                    fill="none"
                    stroke={lit && active !== null ? theme.accent : theme.muted}
                    strokeWidth={1 + (t.value / maxTie) * 7}
                    strokeOpacity={lit ? (active !== null ? 0.75 : 0.32) : 0.06}
                    strokeLinecap="round"
                    onMouseMove={(e) => show(e, `${data.nodes[t.a].label} and ${data.nodes[t.b].label}`, [{ label: measureLabel(viz, measure), value: fmtMeasure(t.value, measure, viz.options) }])}
                    onMouseLeave={hide}
                  />
                );
              })}
            {data.nodes.map((node, i) => {
              const [x, y] = at(i);
              const a = (i / n) * TAU;
              const [lx, ly] = polar(cx, cy, R + 8 + 5 + Math.sqrt(node.weight / maxNode) * 9, a);
              const right = a < Math.PI;
              const dimmed = active !== null && !tied.has(i) && active !== i;
              return (
                <g
                  key={node.label}
                  opacity={dimmed ? 0.3 : 1}
                  style={{ cursor: onPick ? "pointer" : "default" }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick && node.stage === 0 && onPick(dim, fieldInfo(viz, dim.field).type, node.raw, node.label, node.label)}
                >
                  <circle cx={x} cy={y} r={5 + Math.sqrt(node.weight / maxNode) * 9} fill={node.stage === 0 ? theme.palette[0] : theme.palette[1]} stroke={theme.surface} strokeWidth={2} />
                  <text
                    x={lx}
                    y={ly + 4}
                    textAnchor={Math.abs(Math.sin(a)) < 0.12 ? "middle" : right ? "start" : "end"}
                    {...axisText(theme, 11)}
                    fill={theme.ink}
                    fontWeight={active === i ? 700 : 500}
                  >
                    {clipMid(node.label, 88)}
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

// ── Funnel ───────────────────────────────────────────────────────────────

export function Funnel({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const shaped = useMemo(() => shapeParts(viz, result, theme, 8), [viz, result, theme]);
  const [ref, size] = useSize<HTMLDivElement>();
  const { parts, measure } = shaped;
  const stages = parts.filter((p) => !p.other);
  const { width, height } = size;
  const max = Math.max(...stages.map((p) => p.value), 1);
  const rowH = Math.min(Math.max((height - 2) / Math.max(stages.length, 1), 26), 64);
  const sideW = Math.min(width * 0.26, 150);
  const full = Math.max(width - sideW * 2, 40);
  const cx = width / 2;
  const w = (v: number) => Math.max((v / max) * full, 4);

  return (
    <Frame
      note={[
        parts.length > stages.length ? "Only the largest stages are shown." : "",
        "Stages are ordered from the largest figure to the smallest; the percentage is what is kept from the stage above.",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="vz-plot vz-plot--scroll" ref={ref}>
        {width > 0 && stages.length > 0 && (
          <svg width={width} height={stages.length * rowH} role="img" aria-label="Funnel chart">
            {stages.map((p, i) => {
              const top = w(p.value);
              const next = stages[i + 1] ? w(stages[i + 1].value) : top * 0.82;
              const y = i * rowH;
              const fill = mix(theme.palette[0], theme.surface, Math.min(i * 0.09, 0.55));
              const kept = i > 0 && stages[i - 1].value ? p.value / stages[i - 1].value : null;
              return (
                <g
                  key={p.key}
                  opacity={selectedKey !== null && selectedKey !== p.key ? 0.3 : 1}
                  style={{ cursor: onPick ? "pointer" : "default" }}
                  onClick={() => onPick && onPick(shaped.dim, shaped.type, p.raw, p.label, p.key)}
                >
                  <title>{`${p.label}: ${fmtMeasure(p.value, measure, viz.options)}`}</title>
                  <path d={`M${cx - top / 2},${y + 1}H${cx + top / 2}L${cx + next / 2},${y + rowH - 1}H${cx - next / 2}Z`} fill={fill} />
                  <text x={cx} y={y + rowH / 2 + 4} textAnchor="middle" fontFamily={theme.font} fontSize={12.5} fontWeight={700} fill={top > 60 ? inkOn(fill) : theme.ink}>
                    {fmtCompact(p.value, viz.options)}
                  </text>
                  <text x={cx - full / 2 - 8} y={y + rowH / 2 + 4} textAnchor="end" {...axisText(theme, 11.5)} fill={theme.ink} fontWeight={500}>
                    {clip(p.label, sideW - 10, 11.5)}
                  </text>
                  {kept !== null && (
                    <text x={cx + full / 2 + 8} y={y + rowH / 2 + 4} {...axisText(theme, 11)}>
                      {pct(kept)} kept
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </Frame>
  );
}

// ── Marimekko ────────────────────────────────────────────────────────────

/** Columns whose width is their total and whose segments are shares of it: one picture of both size and mix. */
export function Marimekko({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const matrix = useMemo(() => shapeMatrix(viz, result, theme, { topN: 10 }), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const { cats, series } = matrix;
  const { width, height } = size;
  const totals = cats.map((_, i) => series.reduce((s, x) => s + Math.max(x.values[i] ?? 0, 0), 0));
  const grand = totals.reduce((a, b) => a + b, 0) || 1;
  const left = 34;
  const top = 18;
  const bottom = 24;
  const plotW = Math.max(width - left - 6, 10);
  const plotH = Math.max(height - top - bottom, 10);
  const gap = 3;
  const usable = plotW - gap * (cats.length - 1);
  let x0 = left;

  return (
    <Frame legend={<Legend items={series} />} note={[matrix.note, "A column’s width is its share of the grand total; the bands inside are shares of that column."].filter(Boolean).join(" ")}>
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && height > 0 && cats.length > 0 && (
          <svg width={width} height={height} role="img" aria-label="Marimekko chart">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <text key={t} x={left - 6} y={top + plotH - t * plotH + 3.5} textAnchor="end" {...axisText(theme, 10)}>
                {pct(t)}
              </text>
            ))}
            {cats.map((c, i) => {
              const w = Math.max((totals[i] / grand) * usable, 1);
              const x = x0;
              x0 += w + gap;
              let acc = 0;
              return (
                <g
                  key={c.key}
                  opacity={selectedKey !== null && selectedKey !== c.key ? 0.3 : 1}
                  style={{ cursor: onPick && !c.other ? "pointer" : "default" }}
                  onClick={() => onPick && !c.other && onPick(matrix.catDim, matrix.catType, c.raw, c.label, c.key)}
                >
                  {series.map((s) => {
                    const share = totals[i] ? Math.max(s.values[i] ?? 0, 0) / totals[i] : 0;
                    if (!share) return null;
                    const y = top + plotH - (acc + share) * plotH;
                    acc += share;
                    const h = Math.max(share * plotH - 2, 1);
                    return (
                      <g key={s.key}>
                        <rect
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          rx={2}
                          fill={s.color}
                          onMouseMove={(e) =>
                            show(e, `${c.label}, ${s.label}`, [
                              { color: s.color, label: measureLabel(viz, s.measure), value: fmtMeasure(s.values[i], s.measure, viz.options), extra: pct(share) },
                              { label: `${c.label} in all`, value: fmtMeasure(totals[i], s.measure, viz.options), extra: pct(totals[i] / grand), strong: true },
                            ])
                          }
                          onMouseLeave={hide}
                        />
                        {w > 34 && h > 15 && (
                          <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontFamily={theme.font} fontSize={10.5} fontWeight={600} fill={inkOn(s.color)} pointerEvents="none">
                            {pct(share)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  <text x={x + w / 2} y={top - 5} textAnchor="middle" {...axisText(theme, 10.5)} fill={theme.ink} fontWeight={600}>
                    {w > 30 ? fmtCompact(totals[i], viz.options) : ""}
                  </text>
                  <text x={x + w / 2} y={height - 7} textAnchor="middle" {...axisText(theme)} fill={selectedKey === c.key ? theme.ink : theme.muted}>
                    {w > 22 ? clip(c.label, w - 2) : ""}
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
