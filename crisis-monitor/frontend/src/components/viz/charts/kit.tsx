import { useCallback, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { DashTheme } from "../themes";
import type { FieldType, VizDim, VizResult, VizSpec } from "../types";

/** What every visual is given, and the small pieces they share: the hover tip, the legend, the note under a chart. */

export interface ChartProps {
  viz: VizSpec;
  result: VizResult;
  theme: DashTheme;
  /** The value picked in this visual (its key), when it is filtering the others. */
  selectedKey: string | null;
  /** The card's title, so a visual need not repeat it. */
  title?: string;
  /** A click on a mark: narrows the dashboard's other visuals to that value. Absent where clicking does nothing. */
  onPick?: (dim: VizDim, type: FieldType, raw: string | number | null, label: string, key: string) => void;
}

export interface TipRow {
  color?: string;
  label: string;
  value: string;
  /** Printed fainter after the value (a share, a change). */
  extra?: string;
  strong?: boolean;
}

export interface TipState {
  x: number;
  y: number;
  title: string;
  rows: TipRow[];
  foot?: string;
}

/** A tip that follows the pointer inside one chart. Returns the element to render and the handlers to call. */
export function useTip() {
  const box = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback((e: MouseEvent, title: string, rows: TipRow[], foot?: string) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    // Measured within the box's own content, so the tip stays with the pointer when the box has been scrolled.
    setTip({ x: e.clientX - rect.left + (box.current?.scrollLeft ?? 0), y: e.clientY - rect.top + (box.current?.scrollTop ?? 0), title, rows, foot });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return { box, tip, show, hide };
}

export function Tip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  // Kept inside the chart: flips to the pointer's left near the right edge.
  const flip = tip.x > width - 190;
  const style: CSSProperties = { left: flip ? undefined : tip.x + 14, right: flip ? width - tip.x + 14 : undefined, top: Math.max(tip.y - 12, 0) };
  return (
    <div className="vz-tip" style={style} role="status">
      <div className="vz-tip__title">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div key={i} className={`vz-tip__row${r.strong ? " is-strong" : ""}`}>
          {r.color && <i style={{ background: r.color }} />}
          <span>{r.label}</span>
          <b>{r.value}</b>
          {r.extra && <em>{r.extra}</em>}
        </div>
      ))}
      {tip.foot && <div className="vz-tip__foot">{tip.foot}</div>}
    </div>
  );
}

/** Which colour is which. Shown whenever a chart has two or more series. */
export function Legend({ items }: { items: { key: string; label: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="vz-legend">
      {items.map((s) => (
        <span key={s.key} title={s.label}>
          <i style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return children ? <div className="vz-note">{children}</div> : null;
}

/** The frame most charts share: legend above, the drawing filling what is left, a note beneath. */
export function Frame({ legend, note, children }: { legend?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="vz-frame">
      {legend}
      <div className="vz-frame__plot">{children}</div>
      <Note>{note}</Note>
    </div>
  );
}

/** A bar with only its outer end rounded, as a path. `horizontal` bars grow rightwards; upright ones grow up (or down when `flip`). */
export function barPath(x: number, y: number, w: number, h: number, r: number, side: "top" | "bottom" | "right" | "left" | "none"): string {
  const k = Math.max(Math.min(r, w / 2, h / 2), 0);
  if (side === "none" || k === 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  if (side === "top") return `M${x},${y + h}V${y + k}q0,${-k} ${k},${-k}H${x + w - k}q${k},0 ${k},${k}V${y + h}Z`;
  if (side === "bottom") return `M${x},${y}V${y + h - k}q0,${k} ${k},${k}H${x + w - k}q${k},0 ${k},${-k}V${y}Z`;
  if (side === "right") return `M${x},${y}H${x + w - k}q${k},0 ${k},${k}V${y + h - k}q0,${k} ${-k},${k}H${x}Z`;
  return `M${x + w},${y}H${x + k}q${-k},0 ${-k},${k}V${y + h - k}q0,${k} ${k},${k}H${x + w}Z`;
}

/** SVG text attributes for the small print on a chart. Set as attributes, not classes, so a downloaded image matches. */
export const axisText = (theme: DashTheme, size = 11) => ({ fill: theme.muted, fontSize: size, fontFamily: "Inter, system-ui, sans-serif" }) as const;
