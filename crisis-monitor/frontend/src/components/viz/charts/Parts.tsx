import { useMemo, useState } from "react";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { useSize } from "../../query/shared";
import { clip, dimLabel, fmtCompact, fmtMeasure, inkOn, mix, pct } from "../format";
import { shapeParts, type Part } from "../shape";
import { seriesColor } from "../themes";
import { fieldInfo, isAdditive, measureLabel, valuesOf } from "../types";
import { Frame, Tip, useTip, type ChartProps } from "./kit";

/** Parts of a whole: the donut, the waffle (a hundred squares) and the treemap. */

/** The list beside a donut or waffle: each part's name, figure and share. It is the chart's legend and its labels at once. */
export function PartList({
  parts,
  hover,
  selectedKey,
  onHover,
  onClick,
  format,
}: {
  parts: Part[];
  hover: string | null;
  selectedKey: string | null;
  onHover: (k: string | null) => void;
  onClick?: (p: Part) => void;
  format: (n: number) => string;
}) {
  return (
    <ul className="vz-parts">
      {parts.map((p) => (
        <li
          key={p.key}
          className={`${hover === p.key ? "is-hover" : ""}${selectedKey !== null && selectedKey !== p.key ? " is-dim" : ""}${onClick && !p.other ? " is-click" : ""}`}
          onMouseEnter={() => onHover(p.key)}
          onMouseLeave={() => onHover(null)}
          onClick={() => onClick && !p.other && onClick(p)}
          title={onClick && !p.other ? "Click to filter the other visuals" : undefined}
        >
          <i style={{ background: p.color }} />
          <span>{p.label}</span>
          <b>{format(p.value)}</b>
          <em>{pct(p.share, p.share < 0.1 ? 1 : 0)}</em>
        </li>
      ))}
    </ul>
  );
}

export function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const end = Math.min(a1, a0 + Math.PI * 2 - 0.0001);
  const at = (r: number, a: number) => `${cx + r * Math.sin(a)},${cy - r * Math.cos(a)}`;
  const large = end - a0 > Math.PI ? 1 : 0;
  return `M${at(r1, a0)}A${r1},${r1} 0 ${large} 1 ${at(r1, end)}L${at(r0, end)}A${r0},${r0} 0 ${large} 0 ${at(r0, a0)}Z`;
}

/** A pie is the same drawing with no hole; its shares are written on the slices instead of in the middle. */
export const Pie = (props: ChartProps) => <Donut {...props} hole={0} />;

export function Donut({ viz, result, theme, selectedKey, onPick, hole = 0.62 }: ChartProps & { hole?: number }) {
  const shaped = useMemo(() => shapeParts(viz, result, theme, hole ? 7 : 6), [viz, result, theme, hole]);
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const { parts, total, measure } = shaped;
  const wide = size.width > size.height * 1.35 && size.width > 300;
  const d = Math.max(Math.min(wide ? size.height : size.height * 0.62, wide ? size.width * 0.46 : size.width, 260), 60);
  const r1 = d / 2 - 5;
  const r0 = r1 * hole;
  const focus = parts.find((p) => p.key === (hover ?? selectedKey)) ?? null;
  const format = (n: number) => fmtMeasure(n, measure, viz.options);
  // A sliver of the panel between slices keeps neighbours apart whatever their colours.
  const pad = parts.length > 1 ? 0.012 : 0;
  let angle = 0;

  return (
    <Frame note={shaped.note}>
      <div className={`vz-donut${wide ? " is-wide" : ""}`} ref={ref}>
        {size.width > 0 && parts.length > 0 && (
          <>
            <svg width={d} height={d} role="img" aria-label={hole ? "Donut chart" : "Pie chart"} style={{ flexShrink: 0 }}>
              {parts.map((p) => {
                const a0 = angle;
                angle += p.share * Math.PI * 2;
                const grown = hover === p.key ? 4 : 0;
                const mid = (a0 + angle) / 2;
                return (
                  <g key={p.key}>
                    <path
                      d={arc(d / 2, d / 2, r0, r1 + grown, a0 + pad, Math.max(angle - pad, a0 + pad + 0.002))}
                      fill={p.color}
                      opacity={(hover ?? selectedKey) !== null && (hover ?? selectedKey) !== p.key ? 0.35 : 1}
                      style={{ cursor: onPick && !p.other ? "pointer" : "default", transition: "opacity .15s" }}
                      onMouseEnter={() => setHover(p.key)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => onPick && !p.other && onPick(shaped.dim, shaped.type, p.raw, p.label, p.key)}
                    />
                    {!hole && p.share >= 0.07 && (
                      <text
                        x={d / 2 + r1 * 0.62 * Math.sin(mid)}
                        y={d / 2 - r1 * 0.62 * Math.cos(mid) + 4}
                        textAnchor="middle"
                        fill={inkOn(p.color)}
                        fontFamily={theme.font}
                        fontWeight={700}
                        fontSize={12}
                        pointerEvents="none"
                      >
                        {pct(p.share)}
                      </text>
                    )}
                  </g>
                );
              })}
              {hole > 0 && (
                <>
                  <text x={d / 2} y={d / 2 - 2} textAnchor="middle" fill={theme.ink} fontFamily={theme.display} fontWeight={700} fontSize={Math.max(Math.min(r0 * 0.46, 30), 13)}>
                    {focus ? pct(focus.share, 1) : fmtCompact(total, viz.options)}
                  </text>
                  <text x={d / 2} y={d / 2 + 15} textAnchor="middle" fill={theme.muted} fontFamily={theme.font} fontSize={10.5}>
                    {clip(focus ? focus.label : isAdditive(measure) ? measureLabel(viz, measure) : "all shown", r0 * 1.7, 10.5)}
                  </text>
                </>
              )}
            </svg>
            <PartList
              parts={parts}
              hover={hover}
              selectedKey={selectedKey}
              onHover={setHover}
              format={format}
              onClick={onPick ? (p) => onPick(shaped.dim, shaped.type, p.raw, p.label, p.key) : undefined}
            />
          </>
        )}
      </div>
    </Frame>
  );
}

/** A hundred squares, one per percent. Shares are rounded so they always fill exactly a hundred. */
export function Waffle({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const shaped = useMemo(() => shapeParts(viz, result, theme, 6), [viz, result, theme]);
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const { parts, measure } = shaped;

  const cells = useMemo(() => {
    // Largest-remainder rounding: whole squares first, then the leftover squares to the largest fractions.
    const exact = parts.map((p) => p.share * 100);
    const counts = exact.map(Math.floor);
    let left = 100 - counts.reduce((a, b) => a + b, 0);
    const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) {
      if (left <= 0) break;
      counts[i]++;
      left--;
    }
    return counts.flatMap((c, i) => Array.from({ length: c }, () => parts[i]));
  }, [parts]);

  const wide = size.width > size.height * 1.3 && size.width > 300;
  const side = Math.max(Math.min(wide ? size.height : size.height * 0.6, wide ? size.width * 0.5 : size.width, 300), 60);
  const gap = side > 180 ? 3 : 2;
  const cell = (side - gap * 9) / 10;
  const active = hover ?? selectedKey;

  return (
    <Frame note={shaped.note}>
      <div className={`vz-donut${wide ? " is-wide" : ""}`} ref={ref}>
        {size.width > 0 && parts.length > 0 && (
          <>
            <svg width={side} height={side} role="img" aria-label="Waffle chart: one square per percent" style={{ flexShrink: 0 }}>
              {cells.map((p, i) => (
                <rect
                  key={i}
                  x={(i % 10) * (cell + gap)}
                  y={Math.floor(i / 10) * (cell + gap)}
                  width={cell}
                  height={cell}
                  rx={Math.min(cell * 0.22, 4)}
                  fill={p.color}
                  opacity={active !== null && active !== p.key ? 0.3 : 1}
                  style={{ cursor: onPick && !p.other ? "pointer" : "default", transition: "opacity .15s" }}
                  onMouseEnter={() => setHover(p.key)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onPick && !p.other && onPick(shaped.dim, shaped.type, p.raw, p.label, p.key)}
                />
              ))}
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

interface Leaf {
  key: string;
  label: string;
  raw: string | number | null;
  value: number;
  color: string;
  parent?: string;
  other?: boolean;
}

export function Treemap({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const measure = valuesOf(viz)[0];
  const nested = viz.rows.length > 1;
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;

  const data = useMemo(() => {
    if (!nested) {
      const shaped = shapeParts(viz, result, theme, 30);
      const max = Math.max(...shaped.parts.map((p) => p.value), 1);
      // One field: a single hue, deeper for bigger, so colour repeats what size says rather than inventing a second meaning.
      const leaves: Leaf[] = shaped.parts.map((p) => ({
        key: p.key,
        label: p.label,
        raw: p.raw,
        value: p.value,
        other: p.other,
        color: p.other ? theme.neutral : mix(theme.surface, theme.ramp, 0.28 + 0.72 * Math.sqrt(p.value / max)),
      }));
      return { groups: [{ key: "all", label: "", color: theme.ramp, leaves }], note: shaped.note, total: shaped.total };
    }
    // Two fields: a colour per outer group, its members inside it.
    const inner = viz.rows[1];
    const innerType = fieldInfo(viz, inner.field).type;
    const groups = new Map<string, { raw: string | number | null; total: number; leaves: { raw: string | number | null; value: number }[] }>();
    for (const r of result.rows) {
      const v = r.m[0] ?? 0;
      if (v <= 0) continue;
      const k = r.d[0] === null ? "\u0000" : String(r.d[0]);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { raw: r.d[0] ?? null, total: 0, leaves: [] }));
      g.total += v;
      g.leaves.push({ raw: r.d[1] ?? null, value: v });
    }
    const ordered = [...groups.entries()].sort((a, b) => b[1].total - a[1].total);
    const kept = ordered.slice(0, 8);
    const notes: string[] = [];
    if (ordered.length > 8) notes.push(`The 8 largest of ${ordered.length} groups are shown.`);
    let cut = false;
    const out = kept.map(([k, g], gi) => {
      const sorted = g.leaves.sort((a, b) => b.value - a.value);
      if (sorted.length > 12) cut = true;
      const color = seriesColor(theme, gi);
      return {
        key: k,
        label: dimLabel(g.raw, dim, type),
        color,
        leaves: sorted.slice(0, 12).map((l, li): Leaf => ({
          key: `${k}\u0002${l.raw ?? ""}`,
          parent: k,
          raw: g.raw,
          label: dimLabel(l.raw, inner, innerType),
          value: l.value,
          color: mix(color, theme.surface, Math.min(li * 0.07, 0.42)),
        })),
      };
    });
    if (cut) notes.push("Each group shows its 12 largest members.");
    return { groups: out, note: notes.join(" ") || null, total: out.reduce((s, g) => s + g.leaves.reduce((t, l) => t + l.value, 0), 0) };
  }, [viz, result, theme, nested, dim, type]);

  const nodes = useMemo(() => {
    if (!size.width || !size.height) return [];
    const root = hierarchy<{ leaf?: Leaf; children?: unknown[]; group?: (typeof data.groups)[number] }>({
      children: data.groups.map((g) => ({ group: g, children: g.leaves.map((leaf) => ({ leaf })) })),
    } as never)
      .sum((d) => d.leaf?.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const laid = treemap<{ leaf?: Leaf; group?: (typeof data.groups)[number] }>()
      .tile(treemapSquarify.ratio(1.3))
      .size([size.width, size.height])
      // The outer padding is set first: it would otherwise overwrite the room kept above each group for its name.
      .paddingOuter(nested ? 1 : 0)
      .paddingInner(2)
      .paddingTop((n) => (nested && n.depth === 1 ? 18 : 0))
      .round(true)(root as never);
    return laid.descendants();
  }, [data, size.width, size.height, nested]);

  return (
    <Frame note={data.note}>
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {size.width > 0 && (
          <svg width={size.width} height={size.height} role="img" aria-label="Treemap">
            {nodes.map((n, i) => {
              const w = n.x1 - n.x0;
              const h = n.y1 - n.y0;
              if (n.depth === 1 && nested && n.data.group) {
                return (
                  <text key={`g${i}`} x={n.x0 + 3} y={n.y0 + 12.5} fill={theme.ink} fontSize={11} fontWeight={700} fontFamily={theme.font}>
                    {clip(n.data.group.label, w - 6)}
                  </text>
                );
              }
              const leaf = n.data.leaf;
              if (!leaf || w < 1 || h < 1) return null;
              const groupKey = leaf.parent ?? leaf.key;
              const share = data.total ? leaf.value / data.total : 0;
              const ink = inkOn(leaf.color);
              return (
                <g
                  key={leaf.key}
                  opacity={selectedKey !== null && selectedKey !== groupKey ? 0.3 : 1}
                  style={{ cursor: onPick && !leaf.other ? "pointer" : "default" }}
                  onMouseMove={(e) =>
                    show(e, nested ? `${data.groups.find((g) => g.key === leaf.parent)?.label ?? ""} › ${leaf.label}` : leaf.label, [
                      { color: leaf.color, label: measureLabel(viz, measure), value: fmtMeasure(leaf.value, measure, viz.options), extra: pct(share, 1) },
                    ])
                  }
                  onMouseLeave={hide}
                  onClick={() => onPick && !leaf.other && onPick(dim, type, leaf.raw, nested ? (data.groups.find((g) => g.key === leaf.parent)?.label ?? "") : leaf.label, groupKey)}
                >
                  <rect x={n.x0} y={n.y0} width={w} height={h} rx={3} fill={leaf.color} />
                  {w > 46 && h > 20 && (
                    <text x={n.x0 + 6} y={n.y0 + 15} fill={ink} fontSize={11.5} fontWeight={600} fontFamily={theme.font}>
                      {clip(leaf.label, w - 10, 11.5)}
                    </text>
                  )}
                  {w > 46 && h > 38 && (
                    <text x={n.x0 + 6} y={n.y0 + 30} fill={ink} opacity={0.85} fontSize={11} fontFamily={theme.font}>
                      {w > 96 ? `${fmtCompact(leaf.value, viz.options)} (${pct(share)})` : clip(fmtCompact(leaf.value, viz.options), w - 10)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        <Tip tip={tip} width={size.width} />
      </div>
    </Frame>
  );
}
