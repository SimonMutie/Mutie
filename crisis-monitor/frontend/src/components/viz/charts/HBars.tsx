import { useMemo, useState } from "react";
import { useSize } from "../../query/shared";
import { clip, fmtCompact, fmtMeasure, inkOn, pct } from "../format";
import { shapeMatrix } from "../shape";
import { isAdditive } from "../types";
import { axisText, barPath, Frame, Legend, Tip, useTip, type ChartProps, type TipRow } from "./kit";

/**
 * Bars lying down: the layout for names too long, or too many, to sit under
 * an upright bar. Each bar carries its own figure at its end, so there is
 * no value axis to read across to. A long list scrolls.
 */
export default function HBars({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const matrix = useMemo(() => shapeMatrix(viz, result, theme, { topN: 12 }), [viz, result, theme]);
  const [measureRef, size] = useSize<HTMLDivElement>();
  const { box, tip, show, hide } = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const { cats, series } = matrix;
  const options = viz.options;
  const many = series.length > 1;
  const stack = many ? (options?.stack ?? (matrix.splitDim ? "stacked" : "grouped")) : "none";
  const stacked = stack === "stacked" || stack === "percent";
  const percent = stack === "percent";
  const n = cats.length;

  const totals = cats.map((_, i) => series.reduce((s, x) => s + Math.abs(x.values[i] ?? 0), 0));
  const values = series.flatMap((s) => s.values.map((v) => v ?? 0));
  const hi = percent ? 1 : stacked ? Math.max(...totals, 0) : Math.max(...values, 0);
  const lo = stacked ? 0 : Math.min(...values, 0);
  const endLabel = (i: number) => (percent ? "" : stacked ? fmtCompact(totals[i], options) : "");

  const { width, height } = size;
  const labelW = Math.min(Math.max(...cats.map((c) => c.label.length), 3) * 6.5 + 10, Math.max(width * 0.36, 60), 230);
  const valueW = percent ? 6 : Math.max(...cats.map((_, i) => (stacked ? endLabel(i) : fmtCompact(Math.max(...series.map((s) => Math.abs(s.values[i] ?? 0))), options)).length), 1) * 6.8 + 10;
  const barMax = Math.max(width - labelW - valueW, 20);
  const barH = stack === "grouped" ? 10 : 0;
  const rowH = stack === "grouped" ? series.length * (barH + 2) + 10 : Math.min(Math.max(Math.floor((height - 2) / Math.max(n, 1)), 24), 46);
  const thick = stack === "grouped" ? barH : Math.min(rowH - 10, 22);
  const svgH = Math.max(n * rowH, 1);
  const x = (v: number) => labelW + ((v - lo) / (hi - lo || 1)) * barMax;
  const zero = x(0);

  const tipFor = (i: number): TipRow[] => {
    const rows: TipRow[] = series.map((s) => ({
      color: s.color,
      label: s.label,
      value: fmtMeasure(s.values[i], s.measure, options),
      extra: stacked && totals[i] ? pct(Math.abs(s.values[i] ?? 0) / totals[i]) : undefined,
    }));
    if (stacked && series.every((s) => isAdditive(s.measure))) rows.push({ label: "Total", value: fmtMeasure(totals[i], series[0].measure, options), strong: true });
    return rows;
  };

  return (
    <Frame legend={<Legend items={series} />} note={matrix.note}>
      <div
        className="vz-plot vz-plot--scroll"
        ref={(node) => {
          measureRef(node);
          box.current = node;
        }}
      >
        {width > 0 && n > 0 && (
          <svg width={width} height={svgH} role="img" aria-label="Bar chart">
            {lo < 0 && <line x1={zero} x2={zero} y1={0} y2={svgH} stroke={theme.faint} strokeWidth={1} />}
            {cats.map((c, i) => {
              const y0 = i * rowH;
              const picked = selectedKey === c.key;
              let acc = 0;
              return (
                <g key={c.key} opacity={selectedKey !== null && !picked ? 0.3 : 1}>
                  {hover === i && <rect x={0} y={y0} width={width} height={rowH} fill={theme.ink} opacity={0.05} rx={4} />}
                  <text x={labelW - 8} y={y0 + rowH / 2 + 4} textAnchor="end" {...axisText(theme, 11.5)} fill={theme.ink} fontWeight={picked ? 700 : 500}>
                    {clip(c.label, labelW - 10, 11.5)}
                  </text>
                  {stacked
                    ? series.map((s, si) => {
                        const v = Math.abs(s.values[i] ?? 0);
                        const share = percent ? (totals[i] ? v / totals[i] : 0) : v;
                        if (!share) return null;
                        const x0 = x(acc);
                        acc += share;
                        const w = Math.max(x(acc) - x0 - (si < series.length - 1 ? 2 : 0), 1);
                        const last = series.slice(si + 1).every((o) => !o.values[i]);
                        return (
                          <g key={s.key}>
                            <path d={barPath(x0, y0 + (rowH - thick) / 2, w, thick, 3, last ? "right" : "none")} fill={s.color} />
                            {percent && w > 34 && (
                              <text x={x0 + w / 2} y={y0 + rowH / 2 + 3.5} textAnchor="middle" fontSize={10.5} fontFamily="Inter, system-ui, sans-serif" fontWeight={600} fill={inkOn(s.color)}>
                                {pct(share)}
                              </text>
                            )}
                          </g>
                        );
                      })
                    : series.map((s, si) => {
                        const v = s.values[i];
                        if (v == null) return null;
                        const yBar = stack === "grouped" ? y0 + 5 + si * (barH + 2) : y0 + (rowH - thick) / 2;
                        const w = Math.max(Math.abs(x(v) - zero), v === 0 ? 0 : 1);
                        return (
                          <g key={s.key}>
                            <path d={barPath(v < 0 ? zero - w : zero, yBar, w, thick, 3, v < 0 ? "left" : "right")} fill={s.color} />
                            <text x={v < 0 ? zero + 6 : zero + w + 6} y={yBar + thick / 2 + 3.5} {...axisText(theme, stack === "grouped" ? 10 : 11.5)} fill={theme.ink} fontWeight={600}>
                              {fmtCompact(v, options)}
                            </text>
                          </g>
                        );
                      })}
                  {stacked && !percent && (
                    <text x={x(totals[i]) + 6} y={y0 + rowH / 2 + 4} {...axisText(theme, 11.5)} fill={theme.ink} fontWeight={600}>
                      {endLabel(i)}
                    </text>
                  )}
                  <rect
                    x={0}
                    y={y0}
                    width={width}
                    height={rowH}
                    fill="transparent"
                    style={{ cursor: onPick && !c.other ? "pointer" : "default" }}
                    onMouseMove={(e) => {
                      setHover(i);
                      show(e, c.label, tipFor(i), onPick && !c.other ? (picked ? "Click to clear the filter" : "Click to filter the other visuals") : undefined);
                    }}
                    onMouseLeave={() => {
                      setHover(null);
                      hide();
                    }}
                    onClick={() => onPick && !c.other && onPick(matrix.catDim, matrix.catType, c.raw, c.label, c.key)}
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
