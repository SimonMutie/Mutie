import { useMemo, useState } from "react";
import { hierarchy, pack } from "d3-hierarchy";
import { useSize } from "../../query/shared";
import { clip, dimLabel, fmtCompact, fmtMeasure, inkOn, mix, pct } from "../format";
import { shapeParts } from "../shape";
import { seriesColor } from "../themes";
import { fieldInfo, measureLabel, valuesOf } from "../types";
import { PartList } from "./Parts";
import { Frame, Legend, Tip, useTip, type ChartProps } from "./kit";

/** Infographic pieces: the pictogram, the word cloud, packed bubbles and a row of figures. */

const keyOf = (v: string | number | null) => (v === null || v === "" ? "\u0000" : String(v));

// ── Pictogram ────────────────────────────────────────────────────────────

/** A round number of things per figure, chosen so the whole is at most a hundred or so figures. */
function unitFor(total: number): number {
  if (total <= 120) return 1;
  const raw = total / 100;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

/** A person, drawn in a 10 × 22 box. */
const PERSON =
  "M5 0a2.6 2.6 0 1 1 0 5.2A2.6 2.6 0 0 1 5 0ZM2.4 6.4h5.2A2.4 2.4 0 0 1 10 8.8v5.4a1 1 0 0 1-2 0V9.6h-.5V21a1.1 1.1 0 0 1-2.2 0v-6.2h-.6V21a1.1 1.1 0 0 1-2.2 0V9.6H2v4.6a1 1 0 0 1-2 0V8.8a2.4 2.4 0 0 1 2.4-2.4Z";

export function Pictogram({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const shaped = useMemo(() => shapeParts(viz, result, theme, 6), [viz, result, theme]);
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const { parts, total, measure } = shaped;
  const unit = unitFor(total);
  const icons = useMemo(() => parts.flatMap((p) => Array.from({ length: Math.max(Math.round(p.value / unit), p.value > 0 ? 1 : 0) }, () => p)), [parts, unit]);
  const wide = size.width > size.height * 1.5 && size.width > 380;
  const boxW = Math.max(wide ? size.width * 0.56 : size.width, 60);
  const boxH = Math.max(wide ? size.height : size.height * 0.6, 50);
  // The largest figure size at which every figure still fits the box.
  const fit = useMemo(() => {
    let best = { w: 6, cols: Math.max(Math.floor(boxW / 9), 1) };
    for (let w = 26; w >= 6; w -= 1) {
      const cols = Math.max(Math.floor(boxW / (w * 1.5)), 1);
      const rows = Math.ceil(icons.length / cols);
      if (rows * w * 2.5 <= boxH) {
        best = { w, cols };
        break;
      }
    }
    return best;
  }, [boxW, boxH, icons.length]);
  const cellW = fit.w * 1.5;
  const cellH = fit.w * 2.5;
  const active = hover ?? selectedKey;

  return (
    <Frame note={[`Each figure stands for ${unit === 1 ? "one" : fmtCompact(unit)}${unit === 1 ? "" : " (rounded)"}.`, shaped.note].filter(Boolean).join(" ")}>
      <div className={`vz-donut${wide ? " is-wide" : ""}`} ref={ref}>
        {size.width > 0 && icons.length > 0 && (
          <>
            <svg
              width={Math.min(fit.cols, icons.length) * cellW}
              height={Math.ceil(icons.length / fit.cols) * cellH}
              role="img"
              aria-label={`Pictogram: ${fmtMeasure(total, measure, viz.options)} in all`}
              style={{ flexShrink: 0 }}
            >
              {icons.map((p, i) => (
                <path
                  key={i}
                  d={PERSON}
                  transform={`translate(${(i % fit.cols) * cellW + fit.w * 0.25}, ${Math.floor(i / fit.cols) * cellH + fit.w * 0.15}) scale(${fit.w / 10})`}
                  fill={p.color}
                  opacity={active !== null && active !== p.key ? 0.25 : 1}
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

// ── Word cloud ───────────────────────────────────────────────────────────

/**
 * Words placed from the middle outwards along a spiral, largest first, each
 * at the first spot where its box touches no other. Size follows the square
 * root of the figure, so a word four times as big in value is twice as tall.
 */
export function WordCloud({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const shaped = useMemo(() => shapeParts(viz, result, theme, 70), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const { parts, measure } = shaped;
  const words = useMemo(() => parts.filter((p) => !p.other), [parts]);
  const { width, height } = size;

  const placed = useMemo(() => {
    if (!width || !height || !words.length) return [];
    const max = Math.max(...words.map((w) => w.value), 1);
    const top = Math.max(Math.min(width / 11, height / 5.5, 48), 15);
    const out: { key: string; label: string; x: number; y: number; size: number; w: number; h: number; rank: number; word: (typeof words)[number] }[] = [];
    words.forEach((word, rank) => {
      const fontSize = Math.max(top * Math.sqrt(word.value / max), 10.5);
      const w = word.label.length * fontSize * 0.56 + 6;
      const h = fontSize * 1.06;
      if (w > width - 4) return;
      for (let t = 0; t < 3200; t++) {
        // An oval spiral, wider than tall like the card, stepping finely so gaps between big words get filled.
        const a = t * 0.21;
        const r = 2.6 * Math.sqrt(t);
        const x = width / 2 + r * Math.cos(a) * (width / Math.max(height, 1)) * 0.62 - w / 2;
        const y = height / 2 + r * Math.sin(a) * 0.62 - h / 2;
        if (x < 2 || y < 2 || x + w > width - 2 || y + h > height - 2) continue;
        if (out.some((o) => x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y)) continue;
        out.push({ key: word.key, label: word.label, x, y, size: fontSize, w, h, rank, word });
        break;
      }
    });
    return out;
  }, [words, width, height]);

  return (
    <Frame
      note={[placed.length < words.length ? `${placed.length} of ${words.length} words fit at this size.` : "", "Word size is a rough guide; hover a word for its figure."].filter(Boolean).join(" ")}
    >
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && height > 0 && (
          <svg width={width} height={height} role="img" aria-label="Word cloud">
            {placed.map((p) => (
              <text
                key={p.key}
                x={p.x + p.w / 2}
                y={p.y + p.h * 0.78}
                textAnchor="middle"
                fontFamily={theme.display}
                fontWeight={p.rank < 3 ? 700 : 600}
                fontSize={p.size}
                // The few largest carry the accent; the rest fade with rank so the eye lands on the big ones first.
                fill={p.rank < 5 ? theme.accent : mix(theme.ink, theme.surface, Math.min(0.08 + p.rank * 0.012, 0.5))}
                opacity={selectedKey !== null && selectedKey !== p.key ? 0.25 : 1}
                style={{ cursor: onPick ? "pointer" : "default" }}
                onMouseMove={(e) => show(e, p.label, [{ label: measureLabel(viz, measure), value: fmtMeasure(p.word.value, measure, viz.options), extra: pct(p.word.share, 1) }])}
                onMouseLeave={hide}
                onClick={() => onPick && onPick(shaped.dim, shaped.type, p.word.raw, p.label, p.key)}
              >
                {p.label}
              </text>
            ))}
          </svg>
        )}
        <Tip tip={tip} width={width} />
      </div>
    </Frame>
  );
}

// ── Packed bubbles ───────────────────────────────────────────────────────

export function Bubbles({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const measure = valuesOf(viz)[0];
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;
  const colorDim = viz.columns[0];
  const colorType = colorDim ? fieldInfo(viz, colorDim.field).type : "text";

  const data = useMemo(() => {
    const rows = result.rows.filter((r) => (r.m[0] ?? 0) > 0).sort((a, b) => (b.m[0] ?? 0) - (a.m[0] ?? 0));
    const kept = rows.slice(0, 60);
    const groups = new Map<string, { raw: string | number | null; total: number }>();
    if (colorDim)
      for (const r of kept) {
        const g = groups.get(keyOf(r.d[1] ?? null)) ?? { raw: r.d[1] ?? null, total: 0 };
        g.total += r.m[0] ?? 0;
        groups.set(keyOf(r.d[1] ?? null), g);
      }
    const ranked = [...groups.entries()].sort((a, b) => b[1].total - a[1].total);
    const legend = ranked.slice(0, 7).map(([k, g], i) => ({ key: k, label: dimLabel(g.raw, colorDim, colorType), color: seriesColor(theme, i) }));
    if (ranked.length > 7) legend.push({ key: "\u0001other", label: "Other", color: theme.neutral });
    const colors = new Map(legend.map((l) => [l.key, l.color]));
    const max = kept[0]?.m[0] ?? 1;
    const total = kept.reduce((s, r) => s + (r.m[0] ?? 0), 0);
    return {
      total,
      legend,
      dropped: rows.length - kept.length,
      items: kept.map((r) => {
        const value = r.m[0] ?? 0;
        const g = colorDim ? keyOf(r.d[1] ?? null) : "";
        // One field: a single hue, deeper for bigger. A colour field: one colour per group.
        return {
          key: `${keyOf(r.d[0] ?? null)}\u0002${g}`,
          pick: keyOf(r.d[0] ?? null),
          raw: r.d[0] ?? null,
          label: dimLabel(r.d[0] ?? null, dim, type),
          value,
          group: legend.find((l) => l.key === g)?.label,
          color: colorDim ? (colors.get(g) ?? theme.neutral) : mix(theme.surface, theme.ramp, 0.35 + 0.65 * Math.sqrt(value / max)),
        };
      }),
    };
  }, [result, dim, type, colorDim, colorType, theme]);

  const nodes = useMemo(() => {
    if (!size.width || !size.height || !data.items.length) return [];
    const root = hierarchy<{ children?: typeof data.items; value?: number }>({ children: data.items } as never).sum((d) => (d as { value?: number }).value ?? 0);
    return pack<{ children?: typeof data.items; value?: number }>().size([size.width, size.height]).padding(3)(root).leaves();
  }, [data, size.width, size.height]);

  return (
    <Frame legend={<Legend items={data.legend} />} note={data.dropped > 0 ? `The 60 largest of ${data.dropped + 60} are shown.` : null}>
      <div
        className="vz-plot"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {size.width > 0 && (
          <svg width={size.width} height={size.height} role="img" aria-label="Packed bubble chart">
            {nodes.map((n) => {
              const item = n.data as unknown as (typeof data.items)[number];
              const ink = inkOn(item.color);
              return (
                <g
                  key={item.key}
                  opacity={selectedKey !== null && selectedKey !== item.pick ? 0.3 : 1}
                  style={{ cursor: onPick ? "pointer" : "default" }}
                  onMouseMove={(e) =>
                    show(
                      e,
                      item.label,
                      [{ color: item.color, label: measureLabel(viz, measure), value: fmtMeasure(item.value, measure, viz.options), extra: pct(data.total ? item.value / data.total : 0, 1) }],
                      item.group,
                    )
                  }
                  onMouseLeave={hide}
                  onClick={() => onPick && onPick(dim, type, item.raw, item.label, item.pick)}
                >
                  <circle cx={n.x} cy={n.y} r={n.r} fill={item.color} />
                  {n.r > 20 && (
                    <text
                      x={n.x}
                      y={n.y + (n.r > 30 ? -1 : 4)}
                      textAnchor="middle"
                      fontFamily={theme.font}
                      fontSize={Math.min(Math.max(n.r / 3.6, 10), 14)}
                      fontWeight={600}
                      fill={ink}
                      pointerEvents="none"
                    >
                      {clip(item.label, n.r * 1.75, Math.min(Math.max(n.r / 3.6, 10), 14))}
                    </text>
                  )}
                  {n.r > 30 && (
                    <text x={n.x} y={n.y + 15} textAnchor="middle" fontFamily={theme.font} fontSize={11} fill={ink} opacity={0.85} pointerEvents="none">
                      {fmtCompact(item.value, viz.options)}
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

// ── Row of figures ───────────────────────────────────────────────────────

export function Figures({ viz, result, theme }: ChartProps) {
  const measures = valuesOf(viz);
  const row = result.rows[0];
  return (
    <div className="vz-figures" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${measures.length > 3 ? 110 : 140}px, 1fr))` }}>
      {measures.map((m, i) => {
        const v = row?.m[i] ?? null;
        return (
          <div key={i}>
            <b style={{ fontFamily: theme.display }} title={fmtMeasure(v, m, viz.options)}>
              {v !== null && Math.abs(v) >= 100_000 ? fmtCompact(v, viz.options) : fmtMeasure(v, m, viz.options)}
            </b>
            <span>{measureLabel(viz, m)}</span>
          </div>
        );
      })}
    </div>
  );
}
