import { useMemo, useRef, useState } from "react";
import { FloatingPanel } from "../components/FloatingPanel";
import { HISTORY_SINCE, setPeriod, toggleStrategic, useIncidentHistory, usePeriod, useStrategic, type Period } from "./store";
import { CIRCLE_STYLE, kindOf } from "./IncidentCircles";

/**
 * The timeline: the Lens's escalation incidents per month since January 2025 (hybrid warfare and terrorist attacks
 * stacked on top),
 * with a range to drag across. The period chosen narrows the incident circles and the dated incident layers on
 * the map (Conflict Escalation, Terrorist Attacks, events, alerts, My Incidents). For the visit only.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

function monthsSince(since: string): string[] {
  const out: string[] = [];
  const now = new Date();
  let y = Number(since.slice(0, 4)), mo = Number(since.slice(5, 7));
  while (y < now.getUTCFullYear() || (y === now.getUTCFullYear() && mo <= now.getUTCMonth() + 1)) {
    out.push(`${y}-${String(mo).padStart(2, "0")}`);
    if (++mo > 12) {
      mo = 1;
      y++;
    }
  }
  return out;
}

export function TimelineFilter() {
  const on = useStrategic();
  const shown = on.timeline || on.circles;
  const history = useIncidentHistory(shown);
  const period = usePeriod();
  const months = useMemo(() => monthsSince(HISTORY_SINCE), []);
  const counts = useMemo(() => {
    const m = new Map(months.map((k) => [k, { other: 0, terror: 0, hybrid: 0 }]));
    for (const p of history ?? []) {
      const c = m.get(p.date.slice(0, 7));
      if (c) c[kindOf(p)]++;
    }
    return months.map((k) => ({ month: k, ...m.get(k)! }));
  }, [history, months]);
  const sum = (c: { other: number; terror: number; hybrid: number }) => c.other + c.terror + c.hybrid;
  const max = Math.max(1, ...counts.map(sum));
  const bars = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);

  if (!shown) return null;

  const sel: [number, number] | null = drag
    ? [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)]
    : period
      ? [Math.max(0, months.indexOf(period.from.slice(0, 7))), months.indexOf(period.to.slice(0, 7)) < 0 ? months.length - 1 : months.indexOf(period.to.slice(0, 7))]
      : null;
  const indexAt = (clientX: number) => {
    const r = bars.current!.getBoundingClientRect();
    return Math.max(0, Math.min(months.length - 1, Math.floor(((clientX - r.left) / r.width) * months.length)));
  };
  const commit = (a: number, b: number) => {
    const [i, j] = [Math.min(a, b), Math.max(a, b)];
    setPeriod(i === 0 && j === months.length - 1 ? null : { from: `${months[i]}-01`, to: lastDay(months[j]) });
  };
  const preset = (n: number | null): Period => (n == null ? null : { from: `${months[Math.max(0, months.length - n)]}-01`, to: lastDay(months[months.length - 1]) });
  const total = (sel ? counts.slice(sel[0], sel[1] + 1) : counts).reduce((s, c) => s + sum(c), 0);
  const chip = (label: string, p: Period, active: boolean) => (
    <button
      key={label}
      onClick={() => setPeriod(p)}
      style={{ background: active ? "rgba(159,200,240,0.22)" : "transparent", border: `1px solid ${active ? "rgba(159,200,240,0.6)" : "rgba(255,255,255,0.14)"}`, color: active ? "#e6f0fb" : "#9fb2c8", borderRadius: 6, padding: "1px 7px", fontSize: 10.5, cursor: "pointer", fontFamily: "inherit" }}
    >
      {label}
    </button>
  );
  const isPreset = (n: number | null) => JSON.stringify(preset(n)) === JSON.stringify(period);

  return (
    <FloatingPanel
      id="timeline"
      title="Timeline"
      width="min(640px, calc(100% - var(--lens-pad-left, 10px) - var(--lens-pad-right, 12px) - 150px))"
      initial={{ left: "50%", transform: "translateX(-50%)", bottom: 14 }}
    >
    <div style={{ padding: "6px 12px 9px", userSelect: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{sel ? (sel[0] === sel[1] ? monthLabel(months[sel[0]]) : `${monthLabel(months[sel[0]])} – ${monthLabel(months[sel[1]])}`) : "All time"}</span>
        <span style={{ fontSize: 10.5, color: "#8fa3bf" }}>{history ? `${total.toLocaleString()} incidents` : "Loading…"}</span>
        <span style={{ flex: 1 }} />
        {chip("3 months", preset(3), isPreset(3))}
        {chip("12 months", preset(12), isPreset(12))}
        {chip("All time", null, !period)}
        {!on.circles && (
          <button onClick={() => toggleStrategic("timeline", false)} title="Hide the timeline" style={{ background: "none", border: "none", color: "#8fa3bf", cursor: "pointer", fontSize: 13, padding: "0 2px" }}>
            ×
          </button>
        )}
      </div>
      <div
        ref={bars}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const i = indexAt(e.clientX);
          setDrag({ a: i, b: i });
        }}
        onPointerMove={(e) => drag && setDrag({ ...drag, b: indexAt(e.clientX) })}
        onPointerUp={() => {
          if (drag) commit(drag.a, drag.b);
          setDrag(null);
        }}
        title="Drag across the months to narrow the map to that period"
        style={{ position: "relative", height: 46, display: "flex", alignItems: "flex-end", gap: 2, cursor: "crosshair", touchAction: "none" }}
      >
        {counts.map((c, i) => {
          const inSel = !sel || (i >= sel[0] && i <= sel[1]);
          const n = sum(c);
          const h = (n / max) * 44;
          const part = (k: number) => (k / Math.max(1, n)) * h;
          return (
            <div key={c.month} title={`${monthLabel(c.month)}: ${n} incidents, ${c.terror} terrorist attacks, ${c.hybrid} hybrid warfare`} style={{ flex: 1, height: 46, display: "flex", flexDirection: "column", justifyContent: "flex-end", opacity: inSel ? 1 : 0.28 }}>
              <div style={{ height: part(c.terror), background: CIRCLE_STYLE.terror.fill }} />
              <div style={{ height: part(c.hybrid), background: CIRCLE_STYLE.hybrid.fill }} />
              <div style={{ height: part(c.other), background: "#7fa8d6", minHeight: n ? 0 : 1, borderRadius: "1px 1px 0 0" }} />
            </div>
          );
        })}
        {sel && (
          <div
            style={{
              position: "absolute",
              top: -2,
              bottom: -2,
              left: `${(sel[0] / months.length) * 100}%`,
              width: `${((sel[1] - sel[0] + 1) / months.length) * 100}%`,
              border: "1px dashed rgba(230,240,250,0.75)",
              borderRadius: 3,
              pointerEvents: "none",
            }}
          />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "#8fa3bf", marginTop: 3 }}>
        {months.filter((m, i) => m.endsWith("-01") || i === months.length - 1).map((m) => (
          <span key={m}>{m.endsWith("-01") ? m.slice(0, 4) : monthLabel(m)}</span>
        ))}
      </div>
    </div>
    </FloatingPanel>
  );
}
